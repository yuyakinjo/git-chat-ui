interface GenerateTitleInput {
  openAiToken: string;
  claudeCodeToken: string;
  changedFiles: string[];
  diffSnippet: string;
}

const TITLE_SYSTEM_PROMPT =
  'You are a Git assistant. Return only a concise commit title in imperative mood, max 72 chars.';

function buildHeuristicTitle(changedFiles: string[]): string {
  if (changedFiles.length === 0) {
    return 'Update repository state';
  }

  const uniqueRoots = new Set(
    changedFiles.map((file) => {
      const [root] = file.split('/');
      return root || file;
    })
  );

  if (uniqueRoots.size === 1) {
    const [onlyRoot] = [...uniqueRoots];
    return `Update ${onlyRoot}`;
  }

  if (changedFiles.length === 1) {
    return `Update ${changedFiles[0]}`;
  }

  return `Refine ${changedFiles.length} files`;
}

function normalizeTitle(rawTitle: string, fallback: string): string {
  const trimmed = rawTitle
    .replace(/[\r\n]+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();

  if (!trimmed) {
    return fallback;
  }

  return trimmed.slice(0, 72);
}

async function generateWithOpenAI(
  token: string,
  changedFiles: string[],
  diffSnippet: string
): Promise<string | null> {
  if (!token) {
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        temperature: 0.2,
        input: [
          { role: 'system', content: TITLE_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Changed files:\n${changedFiles.join('\n')}\n\nDiff snippet:\n${diffSnippet}`
          }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const json = (await response.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };

    if (json.output_text && json.output_text.trim()) {
      return json.output_text;
    }

    const firstText = json.output?.[0]?.content?.[0]?.text;
    return firstText ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function generateWithClaude(
  token: string,
  changedFiles: string[],
  diffSnippet: string
): Promise<string | null> {
  if (!token) {
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': token,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-latest',
        max_tokens: 80,
        system: TITLE_SYSTEM_PROMPT,
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
      return null;
    }

    const json = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };

    return json.content?.find((item) => item.type === 'text')?.text ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function generateCommitTitle(input: GenerateTitleInput): Promise<string> {
  const fallback = buildHeuristicTitle(input.changedFiles);
  const limitedDiff = input.diffSnippet.slice(0, 4000);

  const openAiTitle = await generateWithOpenAI(input.openAiToken, input.changedFiles, limitedDiff);
  if (openAiTitle) {
    return normalizeTitle(openAiTitle, fallback);
  }

  const claudeTitle = await generateWithClaude(
    input.claudeCodeToken,
    input.changedFiles,
    limitedDiff
  );
  if (claudeTitle) {
    return normalizeTitle(claudeTitle, fallback);
  }

  return normalizeTitle(fallback, 'Update repository state');
}
