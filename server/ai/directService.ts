import {
  buildHeuristicTitle,
  DEFAULT_OPENAI_MODEL,
  normalizeGeneratedCommitMessage,
  resolveCommitTitlePrompt,
  resolveOpenAiModel,
} from "./normalize.js";
import type { AiService, GenerateCommitTitleInput } from "./service.js";

interface ProviderAttemptResult {
  attempted: boolean;
  provider: "OpenAI" | "Claude Code";
  error: string | null;
  message: string | null;
}

const ANTHROPIC_API_VERSION = "2023-06-01";
const NO_STAGED_CHANGES_ERROR = "No staged changes are available for commit message generation.";
const NO_AI_PROVIDER_ERROR = "No AI provider is configured for commit message generation.";

function isAnthropicApiKey(token: string): boolean {
  return token.startsWith("sk-ant");
}

function getClaudeAuthHeaderVariants(token: string): Array<Record<string, string>> {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return [];
  }

  const apiKeyHeaders = { "x-api-key": normalizedToken };
  const bearerHeaders = { Authorization: `Bearer ${normalizedToken}` };

  return isAnthropicApiKey(normalizedToken)
    ? [apiKeyHeaders, bearerHeaders]
    : [bearerHeaders, apiKeyHeaders];
}

function sortOpenAiModelIds(modelIds: string[]): string[] {
  const deduped = [
    ...new Set(modelIds.map((modelId) => modelId.trim()).filter((modelId) => modelId.length > 0)),
  ];

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

function buildAiUserPrompt(changedFiles: string[], diffSnippet: string): string {
  return `Changed files:\n${changedFiles.join("\n")}\n\nDiff snippet:\n${diffSnippet}`;
}

async function generateWithOpenAI(
  token: string,
  model: string,
  prompt: string,
  changedFiles: string[],
  diffSnippet: string,
): Promise<ProviderAttemptResult> {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return {
      attempted: false,
      provider: "OpenAI",
      error: null,
      message: null,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${normalizedToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: resolveOpenAiModel(model),
        temperature: 0.2,
        input: [
          { role: "system", content: prompt },
          {
            role: "user",
            content: buildAiUserPrompt(changedFiles, diffSnippet),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        attempted: true,
        provider: "OpenAI",
        error: `OpenAI API returned status ${response.status}.`,
        message: null,
      };
    }

    const json = (await response.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };

    if (json.output_text && json.output_text.trim()) {
      return {
        attempted: true,
        provider: "OpenAI",
        error: null,
        message: json.output_text,
      };
    }

    const firstText = json.output?.[0]?.content?.[0]?.text;
    return {
      attempted: true,
      provider: "OpenAI",
      error: firstText?.trim() ? null : "OpenAI API returned no text.",
      message: firstText ?? null,
    };
  } catch (error) {
    return {
      attempted: true,
      provider: "OpenAI",
      error: error instanceof Error ? error.message : "OpenAI request failed.",
      message: null,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function generateWithClaude(
  token: string,
  prompt: string,
  changedFiles: string[],
  diffSnippet: string,
): Promise<ProviderAttemptResult> {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return {
      attempted: false,
      provider: "Claude Code",
      error: null,
      message: null,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000);

  try {
    let failureMessage = "Claude Code request failed.";

    for (const authHeaders of getClaudeAuthHeaderVariants(normalizedToken)) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          ...authHeaders,
          "anthropic-version": ANTHROPIC_API_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-latest",
          max_tokens: 200,
          system: prompt,
          messages: [
            {
              role: "user",
              content: buildAiUserPrompt(changedFiles, diffSnippet),
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        failureMessage = `Claude Code API returned status ${response.status}.`;
        continue;
      }

      const json = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };

      const text = json.content?.find((item) => item.type === "text")?.text ?? null;
      if (text?.trim()) {
        return {
          attempted: true,
          provider: "Claude Code",
          error: null,
          message: text,
        };
      }

      failureMessage = "Claude Code API returned no text.";
    }

    return {
      attempted: true,
      provider: "Claude Code",
      error: failureMessage,
      message: null,
    };
  } catch (error) {
    return {
      attempted: true,
      provider: "Claude Code",
      error: error instanceof Error ? error.message : "Claude Code request failed.",
      message: null,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildCommitGenerationFailureMessage(results: ProviderAttemptResult[]): string {
  const providers = results.map((result) => result.provider).join(" and ");
  const details = results
    .map((result) => `${result.provider}: ${result.error ?? "Unknown failure."}`)
    .join(" ");

  return `Commit message generation failed for ${providers}. ${details}`;
}

async function listOpenAiModels(token: string): Promise<string[]> {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return [];
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${normalizedToken}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenAI models endpoint returned status ${response.status}.`);
    }

    const json = (await response.json()) as {
      data?: Array<{ id?: string }>;
    };

    return sortOpenAiModelIds(json.data?.map((entry) => entry.id ?? "") ?? []);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function validateOpenAiToken(token: string): Promise<boolean> {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return false;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${normalizedToken}`,
      },
      signal: controller.signal,
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function validateClaudeCodeToken(token: string): Promise<boolean> {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return false;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000);

  try {
    for (const authHeaders of getClaudeAuthHeaderVariants(normalizedToken)) {
      const response = await fetch("https://api.anthropic.com/v1/models", {
        method: "GET",
        headers: {
          ...authHeaders,
          "anthropic-version": ANTHROPIC_API_VERSION,
        },
        signal: controller.signal,
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

async function generateCommitTitle(
  input: GenerateCommitTitleInput,
): Promise<import("../../shared/ai.js").GeneratedCommitMessage> {
  const changedFiles = input.changedFiles
    .map((file) => file.trim())
    .filter((file) => file.length > 0);
  if (changedFiles.length === 0) {
    throw new Error(NO_STAGED_CHANGES_ERROR);
  }

  const fallback = buildHeuristicTitle(changedFiles);
  const limitedDiff = input.diffSnippet.slice(0, 4000);
  const prompt = resolveCommitTitlePrompt(input.commitTitlePrompt);

  const providerResult =
    input.selectedAiProvider === "claudeCode"
      ? await generateWithClaude(input.claudeCodeToken, prompt, changedFiles, limitedDiff)
      : await generateWithOpenAI(
          input.openAiToken,
          input.openAiModel,
          prompt,
          changedFiles,
          limitedDiff,
        );

  if (providerResult.message) {
    return normalizeGeneratedCommitMessage(providerResult.message, fallback);
  }

  if (!providerResult.attempted) {
    throw new Error(NO_AI_PROVIDER_ERROR);
  }

  throw new Error(buildCommitGenerationFailureMessage([providerResult]));
}

export function createDirectAiService(): AiService {
  return {
    generateCommitTitle,
    listOpenAiModels,
    validateOpenAiToken,
    validateClaudeCodeToken,
  };
}
