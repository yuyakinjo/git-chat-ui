interface GenerateTitleInput {
  openAiToken: string;
  openAiModel: string;
  claudeCodeToken: string;
  commitTitlePrompt: string;
  changedFiles: string[];
  diffSnippet: string;
}

export interface GeneratedCommitMessage {
  title: string;
  description: string;
}

interface ProviderAttemptResult {
  attempted: boolean;
  provider: 'OpenAI' | 'Claude Code';
  error: string | null;
  message: string | null;
}

const ANTHROPIC_API_VERSION = '2023-06-01';
const NO_STAGED_CHANGES_ERROR = 'No staged changes are available for commit message generation.';
const NO_AI_PROVIDER_ERROR = 'No AI provider is configured for commit message generation.';
export const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';

function isAnthropicApiKey(token: string): boolean {
  return token.startsWith('sk-ant');
}

function getClaudeAuthHeaderVariants(token: string): Array<Record<string, string>> {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return [];
  }

  const apiKeyHeaders = { 'x-api-key': normalizedToken };
  const bearerHeaders = { Authorization: `Bearer ${normalizedToken}` };

  return isAnthropicApiKey(normalizedToken) ? [apiKeyHeaders, bearerHeaders] : [bearerHeaders, apiKeyHeaders];
}

export const DEFAULT_COMMIT_TITLE_PROMPT =
  [
    'You are a Git assistant. Write a Git commit message from the provided staged changes.',
    'Requirements:',
    '- The first line must be an Angular-style conventional commit title such as feat:, fix:, docs:, style:, refactor:, perf:, test:, build:, ci:, chore:, or revert:. Use an optional scope when it adds clarity.',
    '- Keep the title in imperative mood. The title line must be 72 characters or fewer including prefix, scope, spaces, and punctuation.',
    '- If the title would exceed 72 characters, rewrite it shorter. Do not continue the overflow on the next line or in the description.',
    '- After the title, insert a blank line and always include a short description of the key changes.',
    '- Prefer 1-3 concise bullet points for the description. The first line becomes the title and the rest becomes the description.',
    '- Do not add labels like Title: or Description:, and do not wrap the response in quotes or code fences.',
    '- Do not omit the description, even for small changes.'
  ].join('\n');

export function resolveCommitTitlePrompt(prompt: string | null | undefined): string {
  const normalized = typeof prompt === 'string' ? prompt.trim() : '';
  return normalized.length > 0 ? normalized : DEFAULT_COMMIT_TITLE_PROMPT;
}

export function resolveOpenAiModel(model: string | null | undefined): string {
  const normalized = typeof model === 'string' ? model.trim() : '';
  return normalized.length > 0 ? normalized : DEFAULT_OPENAI_MODEL;
}

function sortOpenAiModelIds(modelIds: string[]): string[] {
  const deduped = [...new Set(modelIds.map((modelId) => modelId.trim()).filter((modelId) => modelId.length > 0))];

  deduped.sort((left, right) => {
    if (left === DEFAULT_OPENAI_MODEL && right !== DEFAULT_OPENAI_MODEL) {
      return -1;
    }

    if (right === DEFAULT_OPENAI_MODEL && left !== DEFAULT_OPENAI_MODEL) {
      return 1;
    }

    return left.localeCompare(right);
  });

  return deduped;
}

export async function listOpenAiModels(token: string): Promise<string[]> {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return [];
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${normalizedToken}`
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`OpenAI models endpoint returned status ${response.status}.`);
    }

    const json = (await response.json()) as {
      data?: Array<{ id?: string }>;
    };

    return sortOpenAiModelIds(json.data?.map((entry) => entry.id ?? '') ?? []);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function validateOpenAiToken(token: string): Promise<boolean> {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return false;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${normalizedToken}`
      },
      signal: controller.signal
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildHeuristicTitle(changedFiles: string[]): string {
  if (changedFiles.length === 0) {
    return 'chore: update repository state';
  }

  const uniqueRoots = new Set(
    changedFiles.map((file) => {
      const [root] = file.split('/');
      return root || file;
    })
  );

  if (uniqueRoots.size === 1) {
    const [onlyRoot] = [...uniqueRoots];
    return `chore: update ${onlyRoot}`;
  }

  if (changedFiles.length === 1) {
    return `chore: update ${changedFiles[0]}`;
  }

  return `chore: refine ${changedFiles.length} files`;
}

function normalizeTitle(rawTitle: string, fallback: string): string {
  const trimmed = rawTitle
    .replace(/[\r\n]+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();

  if (!trimmed) {
    return fallback;
  }

  return trimmed;
}

function stripLabel(value: string, labels: string[]): string {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();

  for (const label of labels) {
    const prefix = `${label}:`;
    if (lower.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trimStart();
    }
  }

  return trimmed;
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start].trim().length === 0) {
    start += 1;
  }

  while (end > start && lines[end - 1].trim().length === 0) {
    end -= 1;
  }

  return lines.slice(start, end);
}

export function normalizeGeneratedCommitMessage(
  rawMessage: string | null | undefined,
  fallbackTitle: string
): GeneratedCommitMessage {
  const normalized = typeof rawMessage === 'string' ? rawMessage.replace(/\r\n?/g, '\n').trim() : '';
  const fallback = normalizeTitle(fallbackTitle, 'chore: update repository state');

  if (!normalized) {
    return {
      title: fallback,
      description: ''
    };
  }

  const fencedLines = normalized.split('\n');
  if (fencedLines[0]?.trimStart().startsWith('```')) {
    fencedLines.shift();
  }
  if (fencedLines.at(-1)?.trimStart().startsWith('```')) {
    fencedLines.pop();
  }

  const lines = trimBlankLines(fencedLines);
  if (lines.length === 0) {
    return {
      title: fallback,
      description: ''
    };
  }

  const rawTitleLine = stripLabel(lines[0].replace(/^["'`]+|["'`]+$/g, ''), ['title', 'summary', 'subject']);
  const title = normalizeTitle(rawTitleLine, fallback);
  const descriptionLines = [...lines.slice(1)];

  const firstDescriptionLine = descriptionLines.findIndex((line) => line.trim().length > 0);
  if (firstDescriptionLine >= 0) {
    descriptionLines[firstDescriptionLine] = stripLabel(descriptionLines[firstDescriptionLine], ['description', 'body']);
  }

  return {
    title,
    description: trimBlankLines(descriptionLines).join('\n')
  };
}

async function generateWithOpenAI(
  token: string,
  model: string,
  prompt: string,
  changedFiles: string[],
  diffSnippet: string
): Promise<ProviderAttemptResult> {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return {
      attempted: false,
      provider: 'OpenAI',
      error: null,
      message: null
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${normalizedToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: resolveOpenAiModel(model),
        temperature: 0.2,
        input: [
          { role: 'system', content: prompt },
          {
            role: 'user',
            content: `Changed files:\n${changedFiles.join('\n')}\n\nDiff snippet:\n${diffSnippet}`
          }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        attempted: true,
        provider: 'OpenAI',
        error: `OpenAI API returned status ${response.status}.`,
        message: null
      };
    }

    const json = (await response.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };

    if (json.output_text && json.output_text.trim()) {
      return {
        attempted: true,
        provider: 'OpenAI',
        error: null,
        message: json.output_text
      };
    }

    const firstText = json.output?.[0]?.content?.[0]?.text;
    return {
      attempted: true,
      provider: 'OpenAI',
      error: firstText?.trim() ? null : 'OpenAI API returned no text.',
      message: firstText ?? null
    };
  } catch (error) {
    return {
      attempted: true,
      provider: 'OpenAI',
      error: error instanceof Error ? error.message : 'OpenAI request failed.',
      message: null
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function generateWithClaude(
  token: string,
  prompt: string,
  changedFiles: string[],
  diffSnippet: string
): Promise<ProviderAttemptResult> {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return {
      attempted: false,
      provider: 'Claude Code',
      error: null,
      message: null
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000);

  try {
    let failureMessage = 'Claude Code request failed.';

    for (const authHeaders of getClaudeAuthHeaderVariants(normalizedToken)) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          ...authHeaders,
          'anthropic-version': ANTHROPIC_API_VERSION,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-latest',
          max_tokens: 200,
          system: prompt,
          messages: [
            {
              role: 'user',
              content: `Changed files:\n${changedFiles.join('\n')}\n\nDiff snippet:\n${diffSnippet}`
            }
          ]
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        failureMessage = `Claude Code API returned status ${response.status}.`;
        continue;
      }

      const json = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };

      const text = json.content?.find((item) => item.type === 'text')?.text ?? null;
      if (text?.trim()) {
        return {
          attempted: true,
          provider: 'Claude Code',
          error: null,
          message: text
        };
      }

      failureMessage = 'Claude Code API returned no text.';
    }

    return {
      attempted: true,
      provider: 'Claude Code',
      error: failureMessage,
      message: null
    };
  } catch (error) {
    return {
      attempted: true,
      provider: 'Claude Code',
      error: error instanceof Error ? error.message : 'Claude Code request failed.',
      message: null
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildCommitGenerationFailureMessage(results: ProviderAttemptResult[]): string {
  const providers = results.map((result) => result.provider).join(' and ');
  const details = results
    .map((result) => `${result.provider}: ${result.error ?? 'Unknown failure.'}`)
    .join(' ');

  return `Commit message generation failed for ${providers}. ${details}`;
}

export async function validateClaudeCodeToken(token: string): Promise<boolean> {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return false;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000);

  try {
    for (const authHeaders of getClaudeAuthHeaderVariants(normalizedToken)) {
      const response = await fetch('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: {
          ...authHeaders,
          'anthropic-version': ANTHROPIC_API_VERSION
        },
        signal: controller.signal
      });

      if (response.ok) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function generateCommitTitle(input: GenerateTitleInput): Promise<GeneratedCommitMessage> {
  const changedFiles = input.changedFiles.map((file) => file.trim()).filter((file) => file.length > 0);
  if (changedFiles.length === 0) {
    throw new Error(NO_STAGED_CHANGES_ERROR);
  }

  const fallback = buildHeuristicTitle(changedFiles);
  const limitedDiff = input.diffSnippet.slice(0, 4000);
  const prompt = resolveCommitTitlePrompt(input.commitTitlePrompt);

  const openAiResult = await generateWithOpenAI(
    input.openAiToken,
    input.openAiModel,
    prompt,
    changedFiles,
    limitedDiff
  );
  if (openAiResult.message) {
    return normalizeGeneratedCommitMessage(openAiResult.message, fallback);
  }

  const claudeResult = await generateWithClaude(
    input.claudeCodeToken,
    prompt,
    changedFiles,
    limitedDiff
  );
  if (claudeResult.message) {
    return normalizeGeneratedCommitMessage(claudeResult.message, fallback);
  }

  const attemptedProviders = [openAiResult, claudeResult].filter((result) => result.attempted);
  if (attemptedProviders.length === 0) {
    throw new Error(NO_AI_PROVIDER_ERROR);
  }

  throw new Error(buildCommitGenerationFailureMessage(attemptedProviders));
}
