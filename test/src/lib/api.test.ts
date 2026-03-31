import { afterEach, describe, expect, test } from 'bun:test';

import { api } from '../../../src/lib/api';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('api.generateCommitMessage', () => {
  test('includes the in-memory AI config in the request payload', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = ((async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null
      });

      return new Response(JSON.stringify({ title: 'feat: use input token', description: '' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as unknown) as typeof fetch;

    await api.generateCommitMessage('/tmp/repo', ['src/App.tsx'], {
      openAiToken: '',
      openAiModel: 'gpt-4.1-mini',
      claudeCodeToken: 'cc-live-token',
      selectedAiProvider: 'claudeCode',
      commitTitlePrompt: 'Write a short Japanese commit message.'
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('http://localhost:4141/api/generate-title');
    expect(requests[0]?.body).toEqual({
      repoPath: '/tmp/repo',
      changedFiles: ['src/App.tsx'],
      openAiToken: '',
      openAiModel: 'gpt-4.1-mini',
      claudeCodeToken: 'cc-live-token',
      selectedAiProvider: 'claudeCode',
      commitTitlePrompt: 'Write a short Japanese commit message.'
    });
  });
});

describe('api.validateOpenAiToken', () => {
  test('posts the token to the OpenAI validation endpoint', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = ((async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null
      });

      return new Response(JSON.stringify({ valid: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as unknown) as typeof fetch;

    await api.validateOpenAiToken('sk-openai-valid');

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('http://localhost:4141/api/config/validate-openai-token');
    expect(requests[0]?.body).toEqual({ token: 'sk-openai-valid' });
  });
});

describe('api.getOpenAiModels', () => {
  test('posts the token to the OpenAI models endpoint', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = ((async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null
      });

      return new Response(JSON.stringify({ models: ['gpt-4.1-mini', 'gpt-4.1'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as unknown) as typeof fetch;

    await expect(api.getOpenAiModels('sk-openai-valid')).resolves.toEqual({
      models: ['gpt-4.1-mini', 'gpt-4.1']
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('http://localhost:4141/api/config/openai-models');
    expect(requests[0]?.body).toEqual({ token: 'sk-openai-valid' });
  });
});

describe('api.renameStash', () => {
  test('posts stash rename payload to the stash rename endpoint', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = ((async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null
      });

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as unknown) as typeof fetch;

    await api.renameStash('/tmp/repo', 'stash@{1}', 'Renamed first stash');

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('http://localhost:4141/api/stashes/rename');
    expect(requests[0]?.body).toEqual({
      repoPath: '/tmp/repo',
      stashId: 'stash@{1}',
      message: 'Renamed first stash'
    });
  });
});

describe('api.deleteBranch', () => {
  test('posts the force delete flag to the branch delete endpoint', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = ((async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null
      });

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as unknown) as typeof fetch;

    await api.deleteBranch('/tmp/repo', 'feature/delete-me', 'local', true);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('http://localhost:4141/api/branches/delete');
    expect(requests[0]?.body).toEqual({
      repoPath: '/tmp/repo',
      branchName: 'feature/delete-me',
      branchType: 'local',
      forceDelete: true
    });
  });
});
