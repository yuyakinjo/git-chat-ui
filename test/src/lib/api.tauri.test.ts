import { afterEach, describe, expect, mock, test } from "bun:test";

const originalWindow = globalThis.window;
const repositoryAssistantSettings = {
  openAiModel: "gpt-4.1-mini",
  reasoningEffort: "medium" as const,
};

afterEach(() => {
  mock.restore();

  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
    return;
  }

  Object.defineProperty(globalThis, "window", {
    value: originalWindow,
    configurable: true,
    writable: true,
  });
});

describe("api in Tauri", () => {
  test("selects the invoke transport for business API calls", async () => {
    const invokeMock = mock(
      async (command: string, args?: Record<string, unknown>) => ({ command, args }) as unknown,
    );

    mock.module("@tauri-apps/api/core", () => ({
      invoke: invokeMock,
    }));

    Object.defineProperty(globalThis, "window", {
      value: { __TAURI_INTERNALS__: {} },
      configurable: true,
      writable: true,
    });

    const { api } = await import("../../../src/lib/api");

    await api.health();
    await api.getBranchPullRequests("/tmp/repo");
    await api.getCommitAuthorAvatars("/tmp/repo", "refs/heads/main", ["abc1234"], true);
    await api.generateCommitMessage("/tmp/repo", ["src/App.tsx"], {
      openAiToken: "",
      openAiModel: "gpt-4.1-mini",
      claudeCodeToken: "cc-live-token",
      selectedAiProvider: "claudeCode",
      commitTitlePrompt: "Write a short Japanese commit message.",
    });
    await api.chatWithRepositoryAssistant(
      "/tmp/repo",
      [
        {
          id: "user-1",
          role: "user",
          content: "How should I resolve this branch state?",
          createdAt: "2026-04-03T00:00:00.000Z",
        },
      ],
      repositoryAssistantSettings,
    );
    await api.discardFile("/tmp/repo", "src/App.tsx");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "health", undefined);
    expect(invokeMock).toHaveBeenNthCalledWith(2, "get_branch_pull_requests", {
      repoPath: "/tmp/repo",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "get_commit_author_avatars", {
      repoPath: "/tmp/repo",
      refName: "refs/heads/main",
      shas: ["abc1234"],
      allowRemoteFetch: true,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, "generate_title", {
      input: {
        repoPath: "/tmp/repo",
        changedFiles: ["src/App.tsx"],
        openAiToken: "",
        openAiModel: "gpt-4.1-mini",
        claudeCodeToken: "cc-live-token",
        selectedAiProvider: "claudeCode",
        commitTitlePrompt: "Write a short Japanese commit message.",
      },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(5, "chat_with_repository_assistant", {
      input: {
        repoPath: "/tmp/repo",
        messages: [
          {
            id: "user-1",
            role: "user",
            content: "How should I resolve this branch state?",
            createdAt: "2026-04-03T00:00:00.000Z",
          },
        ],
        openAiModel: "gpt-4.1-mini",
        reasoningEffort: "medium",
      },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(6, "discard_file", {
      repoPath: "/tmp/repo",
      file: "src/App.tsx",
    });
  });

  test("routes conflict commands and conflict-aware mutations through invoke", async () => {
    const invokeMock = mock(
      async (command: string, args?: Record<string, unknown>) => ({ command, args }) as unknown,
    );

    mock.module("@tauri-apps/api/core", () => ({
      invoke: invokeMock,
    }));

    Object.defineProperty(globalThis, "window", {
      value: { __TAURI_INTERNALS__: {} },
      configurable: true,
      writable: true,
    });

    const { api } = await import("../../../src/lib/api");

    await api.getConflictSummary("/tmp/repo", "session-1");
    await api.getConflictFileDetail("/tmp/repo", "conflict.txt", "session-1");
    await api.resolveConflictVersion("/tmp/repo", "conflict.txt", "theirs", "session-1");
    await api.completeMergeSession("/tmp/repo", "session-1");
    await api.abortMergeSession("/tmp/repo", "session-1");
    await api.mergeBranches("/tmp/repo", "feature/conflict", "main");
    await api.deleteStash("/tmp/repo", "stash@{0}");
    await api.applyStash("/tmp/repo", "stash@{0}");
    await api.popStash("/tmp/repo", "stash@{0}");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "get_conflict_summary", {
      repoPath: "/tmp/repo",
      sessionId: "session-1",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "get_conflict_file_detail", {
      repoPath: "/tmp/repo",
      file: "conflict.txt",
      sessionId: "session-1",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "resolve_conflict_version", {
      repoPath: "/tmp/repo",
      file: "conflict.txt",
      side: "theirs",
      sessionId: "session-1",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, "complete_merge_session", {
      repoPath: "/tmp/repo",
      sessionId: "session-1",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(5, "abort_merge_session", {
      repoPath: "/tmp/repo",
      sessionId: "session-1",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(6, "merge_branches", {
      repoPath: "/tmp/repo",
      sourceBranch: "feature/conflict",
      targetBranch: "main",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(7, "delete_stash", {
      repoPath: "/tmp/repo",
      stashId: "stash@{0}",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(8, "apply_stash", {
      repoPath: "/tmp/repo",
      stashId: "stash@{0}",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(9, "pop_stash", {
      repoPath: "/tmp/repo",
      stashId: "stash@{0}",
    });
  });
});
