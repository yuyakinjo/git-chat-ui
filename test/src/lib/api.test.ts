import { afterEach, describe, expect, test } from "bun:test";

import { api } from "../../../src/lib/api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("api.generateCommitMessage", () => {
  test("includes the in-memory AI config in the request payload", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      return new Response(JSON.stringify({ title: "feat: use input token", description: "" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await api.generateCommitMessage("/tmp/repo", ["src/App.tsx"], {
      openAiToken: "",
      openAiModel: "gpt-4.1-mini",
      claudeCodeToken: "cc-live-token",
      selectedAiProvider: "claudeCode",
      commitTitlePrompt: "Write a short Japanese commit message.",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://localhost:4141/api/generate-title");
    expect(requests[0]?.body).toEqual({
      repoPath: "/tmp/repo",
      changedFiles: ["src/App.tsx"],
      openAiToken: "",
      openAiModel: "gpt-4.1-mini",
      claudeCodeToken: "cc-live-token",
      selectedAiProvider: "claudeCode",
      commitTitlePrompt: "Write a short Japanese commit message.",
    });
  });
});

describe("api.chatWithRepositoryAssistant", () => {
  test("posts repository chat messages to the AI chat endpoint", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      return new Response(
        JSON.stringify({
          message: {
            id: "assistant-1",
            role: "assistant",
            content: "Start by checking the conflicted files.",
            createdAt: "2026-04-03T00:00:00.000Z",
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    await api.chatWithRepositoryAssistant("/tmp/repo", [
      {
        id: "user-1",
        role: "user",
        content: "What should I do next?",
        createdAt: "2026-04-03T00:00:00.000Z",
      },
    ]);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://localhost:4141/api/ai/chat");
    expect(requests[0]?.body).toEqual({
      repoPath: "/tmp/repo",
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "What should I do next?",
          createdAt: "2026-04-03T00:00:00.000Z",
        },
      ],
    });
  });
});

describe("api.health", () => {
  test("uses the HTTP business transport on web", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await expect(api.health()).resolves.toEqual({ ok: true });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://localhost:4141/api/health");
    expect(requests[0]?.body).toBeNull();
  });
});

describe("api.getCommitAuthorAvatars", () => {
  test("posts commit avatar hydration input to the avatar endpoint", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      return new Response(
        JSON.stringify({ avatars: { abc1234: "data:image/png;base64,avatar" } }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    await api.getCommitAuthorAvatars("/tmp/repo", "refs/heads/main", ["abc1234"], true);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://localhost:4141/api/commits/avatars");
    expect(requests[0]?.body).toEqual({
      repoPath: "/tmp/repo",
      ref: "refs/heads/main",
      shas: ["abc1234"],
      allowRemoteFetch: true,
    });
  });
});

describe("api.getBranchPullRequests", () => {
  test("loads branch pull request metadata from the branches pull-requests endpoint", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      return new Response(
        JSON.stringify({
          pullRequests: {
            "feature/pr-link": {
              url: "https://github.com/example/repo/pull/42",
              hasConflicts: true,
            },
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    await expect(api.getBranchPullRequests("/tmp/repo")).resolves.toEqual({
      pullRequests: {
        "feature/pr-link": {
          url: "https://github.com/example/repo/pull/42",
          hasConflicts: true,
        },
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "http://localhost:4141/api/branches/pull-requests?repoPath=%2Ftmp%2Frepo",
    );
    expect(requests[0]?.body).toBeNull();
  });
});

describe("api.validateOpenAiToken", () => {
  test("posts the token to the OpenAI validation endpoint", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      return new Response(JSON.stringify({ valid: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await api.validateOpenAiToken("sk-openai-valid");

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://localhost:4141/api/config/validate-openai-token");
    expect(requests[0]?.body).toEqual({ token: "sk-openai-valid" });
  });
});

describe("api.getOpenAiModels", () => {
  test("posts the token to the OpenAI models endpoint", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      return new Response(JSON.stringify({ models: ["gpt-4.1-mini", "gpt-4.1"] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await expect(api.getOpenAiModels("sk-openai-valid")).resolves.toEqual({
      models: ["gpt-4.1-mini", "gpt-4.1"],
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://localhost:4141/api/config/openai-models");
    expect(requests[0]?.body).toEqual({ token: "sk-openai-valid" });
  });
});

describe("api.renameStash", () => {
  test("posts stash rename payload to the stash rename endpoint", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await api.renameStash("/tmp/repo", "stash@{1}", "Renamed first stash");

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://localhost:4141/api/stashes/rename");
    expect(requests[0]?.body).toEqual({
      repoPath: "/tmp/repo",
      stashId: "stash@{1}",
      message: "Renamed first stash",
    });
  });
});

describe("api.deleteStash", () => {
  test("posts stash delete payload to the stash delete endpoint", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await api.deleteStash("/tmp/repo", "stash@{1}");

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://localhost:4141/api/stashes/delete");
    expect(requests[0]?.body).toEqual({
      repoPath: "/tmp/repo",
      stashId: "stash@{1}",
    });
  });
});

describe("api.appendFileToStash", () => {
  test("posts append payload to the stash append endpoint", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await api.appendFileToStash("/tmp/repo", "stash@{1}", "README.md");

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://localhost:4141/api/stashes/append-file");
    expect(requests[0]?.body).toEqual({
      repoPath: "/tmp/repo",
      stashId: "stash@{1}",
      file: "README.md",
    });
  });
});

describe("api.discardFile", () => {
  test("posts discard payload to the discard endpoint", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await api.discardFile("/tmp/repo", "src/App.tsx");

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://localhost:4141/api/discard");
    expect(requests[0]?.body).toEqual({
      repoPath: "/tmp/repo",
      file: "src/App.tsx",
    });
  });
});

describe("api.deleteBranch", () => {
  test("posts the force delete flag to the branch delete endpoint", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await api.deleteBranch("/tmp/repo", "feature/delete-me", "local", true);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://localhost:4141/api/branches/delete");
    expect(requests[0]?.body).toEqual({
      repoPath: "/tmp/repo",
      branchName: "feature/delete-me",
      branchType: "local",
      forceDelete: true,
    });
  });
});

describe("api.getPullStatus", () => {
  test("requests current branch pull status from the pull status endpoint", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      return new Response(
        JSON.stringify({
          branchName: "main",
          upstreamName: "origin/main",
          remoteName: "origin",
          remoteBranchName: "main",
          aheadCount: 0,
          behindCount: 2,
          canPull: true,
          state: "behind",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    await expect(api.getPullStatus("/tmp/repo")).resolves.toMatchObject({
      branchName: "main",
      upstreamName: "origin/main",
      behindCount: 2,
      state: "behind",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://localhost:4141/api/pull/status?repoPath=%2Ftmp%2Frepo");
    expect(requests[0]?.body).toBeNull();
  });

  test("passes branchName when requesting pull status for a specific local branch", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      return new Response(
        JSON.stringify({
          branchName: "main",
          upstreamName: "origin/main",
          remoteName: "origin",
          remoteBranchName: "main",
          aheadCount: 0,
          behindCount: 1,
          canPull: true,
          state: "behind",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    await api.getPullStatus("/tmp/repo", "main");

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "http://localhost:4141/api/pull/status?repoPath=%2Ftmp%2Frepo&branchName=main",
    );
  });
});

describe("api.pull", () => {
  test("posts to the pull endpoint", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await api.pull("/tmp/repo");

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://localhost:4141/api/pull");
    expect(requests[0]?.body).toEqual({ repoPath: "/tmp/repo" });
  });

  test("posts branchName when pulling a specific local branch", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await api.pull("/tmp/repo", "main");

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://localhost:4141/api/pull");
    expect(requests[0]?.body).toEqual({
      repoPath: "/tmp/repo",
      branchName: "main",
    });
  });
});

describe("conflict API transport", () => {
  test("requests conflict summary and file detail with session-aware query params", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      return new Response(
        JSON.stringify(
          requests.length === 1
            ? {
                contextType: "mergeSession",
                operation: "merge",
                sessionId: "session-1",
                sourceBranch: "feature/conflict",
                targetBranch: "main",
                files: [{ file: "conflict.txt", x: "U", y: "U", statusLabel: "Both Modified" }],
              }
            : {
                file: "conflict.txt",
                x: "U",
                y: "U",
                statusLabel: "Both Modified",
                merged: { isBinary: false, content: "<<<<<<< ours\n" },
                base: { isBinary: false, content: "base\n" },
                ours: { isBinary: false, content: "ours\n" },
                theirs: { isBinary: false, content: "theirs\n" },
              },
        ),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    await expect(api.getConflictSummary("/tmp/repo", "session-1")).resolves.toMatchObject({
      contextType: "mergeSession",
      sessionId: "session-1",
    });
    await expect(
      api.getConflictFileDetail("/tmp/repo", "conflict.txt", "session-1"),
    ).resolves.toMatchObject({
      file: "conflict.txt",
      statusLabel: "Both Modified",
    });

    expect(requests).toEqual([
      {
        url: "http://localhost:4141/api/conflicts?repoPath=%2Ftmp%2Frepo&sessionId=session-1",
        body: null,
      },
      {
        url: "http://localhost:4141/api/conflicts/file?repoPath=%2Ftmp%2Frepo&file=conflict.txt&sessionId=session-1",
        body: null,
      },
    ]);
  });

  test("posts conflict resolution and merge-session actions", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await api.resolveConflictVersion("/tmp/repo", "conflict.txt", "ours", "session-1");
    await api.completeMergeSession("/tmp/repo", "session-1");
    await api.abortMergeSession("/tmp/repo", "session-1");

    expect(requests).toEqual([
      {
        url: "http://localhost:4141/api/conflicts/resolve",
        body: {
          repoPath: "/tmp/repo",
          file: "conflict.txt",
          side: "ours",
          sessionId: "session-1",
        },
      },
      {
        url: "http://localhost:4141/api/conflicts/complete-merge-session",
        body: { repoPath: "/tmp/repo", sessionId: "session-1" },
      },
      {
        url: "http://localhost:4141/api/conflicts/abort-merge-session",
        body: { repoPath: "/tmp/repo", sessionId: "session-1" },
      },
    ]);
  });

  test("returns conflict-aware results for merge and stash mutations", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      return new Response(
        JSON.stringify({
          ok: false,
          conflict: {
            contextType: "repository",
            operation:
              requests.length === 1 ? "merge" : requests.length === 2 ? "stashApply" : "stashPop",
            files: [{ file: "conflict.txt", x: "U", y: "U", statusLabel: "Both Modified" }],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    await expect(api.mergeBranches("/tmp/repo", "feature/conflict", "main")).resolves.toMatchObject(
      {
        ok: false,
        conflict: { operation: "merge" },
      },
    );
    await expect(api.applyStash("/tmp/repo", "stash@{0}")).resolves.toMatchObject({
      ok: false,
      conflict: { operation: "stashApply" },
    });
    await expect(api.popStash("/tmp/repo", "stash@{0}")).resolves.toMatchObject({
      ok: false,
      conflict: { operation: "stashPop" },
    });

    expect(requests).toEqual([
      {
        url: "http://localhost:4141/api/branches/merge",
        body: {
          repoPath: "/tmp/repo",
          sourceBranch: "feature/conflict",
          targetBranch: "main",
        },
      },
      {
        url: "http://localhost:4141/api/stashes/apply",
        body: { repoPath: "/tmp/repo", stashId: "stash@{0}" },
      },
      {
        url: "http://localhost:4141/api/stashes/pop",
        body: { repoPath: "/tmp/repo", stashId: "stash@{0}" },
      },
    ]);
  });
});
