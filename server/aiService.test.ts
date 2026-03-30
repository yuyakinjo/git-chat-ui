import { afterEach, describe, expect, test } from 'bun:test';

import {
  DEFAULT_COMMIT_TITLE_PROMPT,
  generateCommitTitle,
  normalizeGeneratedCommitMessage,
  resolveCommitTitlePrompt,
  validateClaudeCodeToken
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

  test('uses a default prompt that asks for an Angular-style prefix', () => {
    expect(DEFAULT_COMMIT_TITLE_PROMPT).toContain('Angular-style conventional commit title');
    expect(DEFAULT_COMMIT_TITLE_PROMPT).toContain('feat:');
    expect(DEFAULT_COMMIT_TITLE_PROMPT).toContain('fix:');
  });

  test('preserves a custom prompt', () => {
    expect(resolveCommitTitlePrompt('Summarize changes as a short Japanese commit title.')).toBe(
      'Summarize changes as a short Japanese commit title.'
    );
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

  test('moves characters beyond 72 in the first line into the description', () => {
    const result = normalizeGeneratedCommitMessage(
      'feat: add a very long summary line that keeps going past the expected seventy-two character limit',
      'Update UI'
    );

    expect(result.title).toBe('feat: add a very long summary line that keeps going past the expected se');
    expect(result.description).toBe('venty-two character limit');
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

