import { afterEach, describe, expect, test } from 'bun:test';

import {
  DEFAULT_COMMIT_TITLE_PROMPT,
  DEFAULT_OPENAI_MODEL,
  generateCommitTitle,
  listOpenAiModels,
  normalizeGeneratedCommitMessage,
  resolveCommitTitlePrompt,
  resolveOpenAiModel,
  validateClaudeCodeToken,
  validateOpenAiToken
} from './aiService.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('resolveCommitTitlePrompt', () => {
  test('falls back to the default prompt when the config value is blank', () => {
    expect(resolveCommitTitlePrompt('')).toBe(DEFAULT_COMMIT_TITLE_PROMPT);
    expect(resolveCommitTitlePrompt('   ')).toBe(DEFAULT_COMMIT_TITLE_PROMPT);
    expect(resolveCommitTitlePrompt(undefined)).toBe(DEFAULT_COMMIT_TITLE_PROMPT);
  });

  test('uses a default prompt that asks for an Angular-style prefix, short title, and description', () => {
    expect(DEFAULT_COMMIT_TITLE_PROMPT).toContain('Angular-style conventional commit title');
    expect(DEFAULT_COMMIT_TITLE_PROMPT).toContain('72 characters or fewer');
    expect(DEFAULT_COMMIT_TITLE_PROMPT).toContain('rewrite it shorter');
    expect(DEFAULT_COMMIT_TITLE_PROMPT).toContain('always include a short description');
  });

  test('preserves a custom prompt', () => {
    expect(resolveCommitTitlePrompt('Summarize changes as a short Japanese commit title.')).toBe(
      'Summarize changes as a short Japanese commit title.'
    );
  });
});

describe('resolveOpenAiModel', () => {
  test('falls back to the default OpenAI model when blank', () => {
    expect(resolveOpenAiModel('')).toBe(DEFAULT_OPENAI_MODEL);
    expect(resolveOpenAiModel('   ')).toBe(DEFAULT_OPENAI_MODEL);
    expect(resolveOpenAiModel(undefined)).toBe(DEFAULT_OPENAI_MODEL);
  });

  test('preserves a custom OpenAI model', () => {
    expect(resolveOpenAiModel('gpt-4.1')).toBe('gpt-4.1');
  });
});

describe('normalizeGeneratedCommitMessage', () => {
  test('uses the first line as the title and the rest as the description', () => {
    expect(
      normalizeGeneratedCommitMessage('feat(ui): tighten commit prompt handling\n\n- add prefix guidance', 'Update UI')
    ).toEqual({
      title: 'feat(ui): tighten commit prompt handling',
      description: '- add prefix guidance'
    });
  });

  test('keeps long titles intact instead of moving overflow into the description', () => {
    const result = normalizeGeneratedCommitMessage(
      'feat: add a very long summary line that keeps going past the expected seventy-two character limit',
      'Update UI'
    );

    expect(result.title).toBe(
      'feat: add a very long summary line that keeps going past the expected seventy-two character limit'
    );
    expect(result.description).toBe('');
  });

  test('falls back to the heuristic title when the model output is blank', () => {
    expect(normalizeGeneratedCommitMessage('   ', 'Refine 2 files')).toEqual({
      title: 'Refine 2 files',
      description: ''
    });
  });
});

describe('generateCommitTitle', () => {
  test('rejects when no AI provider is configured', async () => {
    await expect(
      generateCommitTitle({
        openAiToken: '',
        openAiModel: '',
        claudeCodeToken: '',

        commitTitlePrompt: '',
        changedFiles: ['src/components/GitOperationPanel.tsx', 'src/components/ControllerView.tsx'],
        diffSnippet: ''
      })
    ).rejects.toThrow('No AI provider is configured for commit message generation.');
  });

  test('rejects when there are no staged changes to summarize', async () => {
    await expect(
      generateCommitTitle({
        openAiToken: 'sk-live-token',
        openAiModel: '',
        claudeCodeToken: '',

        commitTitlePrompt: '',
        changedFiles: [],
        diffSnippet: ''
      })
    ).rejects.toThrow('No staged changes are available for commit message generation.');
  });

  test('uses the provided OpenAI token when generating a commit message', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];

    globalThis.fetch = ((async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([String(input), init]);

      return new Response(JSON.stringify({ output_text: 'feat: use live token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as unknown) as typeof fetch;

    await expect(
      generateCommitTitle({
        openAiToken: 'sk-live-token',
        openAiModel: 'gpt-4.1',
        claudeCodeToken: '',

        commitTitlePrompt: 'Write a short Japanese commit message.',
        changedFiles: ['src/App.tsx'],
        diffSnippet: '+ const token = input;'
      })
    ).resolves.toEqual({
      title: 'feat: use live token',
      description: ''
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('https://api.openai.com/v1/responses');
    expect(calls[0]?.[1]?.headers).toEqual({
      Authorization: 'Bearer sk-live-token',
      'Content-Type': 'application/json'
    });
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toMatchObject({
      model: 'gpt-4.1'
    });
  });

  test('surfaces provider failures instead of silently falling back to a generic title', async () => {
    globalThis.fetch = ((async () =>
      new Response(JSON.stringify({ error: { message: 'unauthorized' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })) as unknown) as typeof fetch;

    await expect(
      generateCommitTitle({
        openAiToken: 'sk-live-token',
        openAiModel: '',
        claudeCodeToken: '',

        commitTitlePrompt: '',
        changedFiles: ['src/App.tsx'],
        diffSnippet: '+ const token = input;'
      })
    ).rejects.toThrow('Commit message generation failed for OpenAI. OpenAI: OpenAI API returned status 401.');
  });

  test('tries OpenAI first then Claude when both tokens are configured', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];

    globalThis.fetch = ((async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([String(input), init]);

      const url = String(input);
      if (url.includes('openai.com')) {
        return new Response(JSON.stringify({ output_text: 'feat: openai result' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'fix: claude result' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as unknown) as typeof fetch;

    await expect(
      generateCommitTitle({
        openAiToken: 'sk-openai-token',
        openAiModel: '',
        claudeCodeToken: 'cc-live-token',
        commitTitlePrompt: '',
        changedFiles: ['src/App.tsx'],
        diffSnippet: '+ const token = input;'
      })
    ).resolves.toEqual({
      title: 'feat: openai result',
      description: ''
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('https://api.openai.com/v1/responses');
  });
});

describe('listOpenAiModels', () => {
  test('returns sorted model ids with the default model first', async () => {
    globalThis.fetch = ((async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 'gpt-4.1' }, { id: 'gpt-4.1-mini' }, { id: 'o4-mini' }, { id: 'gpt-4.1' }]
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )) as unknown) as typeof fetch;

    await expect(listOpenAiModels('sk-openai-valid')).resolves.toEqual(['gpt-4.1-mini', 'gpt-4.1', 'o4-mini']);
  });
});

describe('validateOpenAiToken', () => {
  test('does not call OpenAI when the token is blank', async () => {
    let called = false;
    globalThis.fetch = ((async () => {
      called = true;
      return new Response(null, { status: 500 });
    }) as unknown) as typeof fetch;

    await expect(validateOpenAiToken('   ')).resolves.toBe(false);
    expect(called).toBe(false);
  });

  test('calls the OpenAI models endpoint with bearer auth', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];

    globalThis.fetch = ((async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([String(input), init]);
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as unknown) as typeof fetch;

    await expect(validateOpenAiToken('sk-openai-valid')).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('https://api.openai.com/v1/models');
    expect(calls[0]?.[1]?.method).toBe('GET');
    expect(calls[0]?.[1]?.headers).toEqual({
      Authorization: 'Bearer sk-openai-valid'
    });
  });

  test('returns false when the OpenAI models endpoint rejects the token', async () => {
    globalThis.fetch = ((async () =>
      new Response(JSON.stringify({ error: { message: 'unauthorized' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })) as unknown) as typeof fetch;

    await expect(validateOpenAiToken('sk-openai-invalid')).resolves.toBe(false);
  });
});

describe('validateClaudeCodeToken', () => {
  test('does not call Anthropic when the token is blank', async () => {
    let called = false;
    globalThis.fetch = ((async () => {
      called = true;
      return new Response(null, { status: 500 });
    }) as unknown) as typeof fetch;

    await expect(validateClaudeCodeToken('   ')).resolves.toBe(false);
    expect(called).toBe(false);
  });

  test('uses bearer auth first for Claude Code style tokens', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];

    globalThis.fetch = ((async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([String(input), init]);
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as unknown) as typeof fetch;

    await expect(validateClaudeCodeToken('cc-valid-token')).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('https://api.anthropic.com/v1/models');
    expect(calls[0]?.[1]?.method).toBe('GET');
    expect(calls[0]?.[1]?.headers).toEqual({
      Authorization: 'Bearer cc-valid-token',
      'anthropic-version': '2023-06-01'
    });
  });

  test('uses x-api-key first for Anthropic API keys', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];

    globalThis.fetch = ((async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([String(input), init]);
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as unknown) as typeof fetch;

    await expect(validateClaudeCodeToken('sk-ant-valid-token')).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]?.headers).toEqual({
      'x-api-key': 'sk-ant-valid-token',
      'anthropic-version': '2023-06-01'
    });
  });

  test('returns false when the Anthropic models endpoint rejects the token', async () => {
    globalThis.fetch = ((async () =>
      new Response(JSON.stringify({ error: { type: 'authentication_error' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })) as unknown) as typeof fetch;

    await expect(validateClaudeCodeToken('cc-invalid-token')).resolves.toBe(false);
  });

  test('falls back to x-api-key when bearer auth fails for a Claude Code token', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];

    globalThis.fetch = ((async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([String(input), init]);

      if (calls.length === 1) {
        return new Response(JSON.stringify({ error: { type: 'authentication_error' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as unknown) as typeof fetch;

    await expect(validateClaudeCodeToken('cc-fallback-token')).resolves.toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[1]?.headers).toEqual({
      Authorization: 'Bearer cc-fallback-token',
      'anthropic-version': '2023-06-01'
    });
    expect(calls[1]?.[1]?.headers).toEqual({
      'x-api-key': 'cc-fallback-token',
      'anthropic-version': '2023-06-01'
    });
  });
});
