import { describe, expect, mock, test } from "bun:test";

import {
  assertRepositoryAssistantActionSafe,
  createRepositoryAssistantActionExecutor,
} from "../../server/ai/repositoryAssistantActions.js";
import { getCurrentBranch } from "../../server/gitService.js";

describe("assertRepositoryAssistantActionSafe", () => {
  test("allows metadata-only actions in the app repository", async () => {
    await expect(
      assertRepositoryAssistantActionSafe(process.cwd(), {
        id: "git.stage_file",
        args: {
          file: "src/App.tsx",
        },
      }),
    ).resolves.toBeUndefined();

    await expect(
      assertRepositoryAssistantActionSafe(process.cwd(), {
        id: "git.commit",
        args: {
          title: "test: metadata only",
          description: "",
        },
      }),
    ).resolves.toBeUndefined();
  });

  test("blocks working-tree mutations in the app repository", async () => {
    await expect(
      assertRepositoryAssistantActionSafe(process.cwd(), {
        id: "git.checkout_ref",
        args: {
          ref: "main",
        },
      }),
    ).rejects.toThrow(
      "Repository assistant cannot run Checkout Ref against git-chat-ui's own repository while the app is running from that checkout.",
    );
  });

  test("allows merge into a non-current branch in the app repository", async () => {
    await expect(
      assertRepositoryAssistantActionSafe(process.cwd(), {
        id: "git.merge_branches",
        args: {
          sourceBranch: "feature/safe-merge",
          targetBranch: "__self_repo_safe_target__",
        },
      }),
    ).resolves.toBeUndefined();
  });

  test("blocks merge into the checked out branch in the app repository", async () => {
    const currentBranch = await getCurrentBranch(process.cwd());

    await expect(
      assertRepositoryAssistantActionSafe(process.cwd(), {
        id: "git.merge_branches",
        args: {
          sourceBranch: "feature/unsafe-merge",
          targetBranch: currentBranch,
        },
      }),
    ).rejects.toThrow(
      "Repository assistant cannot run Merge Branches against git-chat-ui's own repository when the target branch is currently checked out while the app is running from that checkout.",
    );
  });

  test("allows merge-session follow-up actions in the app repository", async () => {
    await expect(
      assertRepositoryAssistantActionSafe(process.cwd(), {
        id: "git.resolve_conflict_side",
        args: {
          file: "src/App.tsx",
          side: "ours",
          sessionId: "session-1",
        },
      }),
    ).resolves.toBeUndefined();

    await expect(
      assertRepositoryAssistantActionSafe(process.cwd(), {
        id: "git.complete_merge_session",
        args: {
          sessionId: "session-1",
        },
      }),
    ).resolves.toBeUndefined();

    await expect(
      assertRepositoryAssistantActionSafe(process.cwd(), {
        id: "git.abort_merge_session",
        args: {
          sessionId: "session-1",
        },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("createRepositoryAssistantActionExecutor", () => {
  test("dispatches checkout actions to the Git service layer", async () => {
    const checkoutRef = mock(async () => {});
    const execute = createRepositoryAssistantActionExecutor({ checkoutRef });

    await expect(
      execute("/tmp/repo", {
        id: "git.checkout_ref",
        args: {
          ref: "feature/login",
        },
      }),
    ).resolves.toEqual({
      action: {
        id: "git.checkout_ref",
        args: {
          ref: "feature/login",
        },
      },
      status: "succeeded",
      message: "Checked out feature/login.",
      createdAt: expect.any(String),
    });

    expect(checkoutRef).toHaveBeenCalledWith("/tmp/repo", "feature/login");
  });

  test("returns a failed result when merge produces conflicts", async () => {
    const mergeBranches = mock(async () => ({
      ok: false as const,
      conflict: {
        contextType: "repository" as const,
        operation: "merge" as const,
        files: [
          {
            file: "src/App.tsx",
            x: "U",
            y: "U",
            statusLabel: "Both Modified",
          },
        ],
      },
    }));
    const execute = createRepositoryAssistantActionExecutor({ mergeBranches });

    await expect(
      execute("/tmp/repo", {
        id: "git.merge_branches",
        args: {
          sourceBranch: "feature/login",
          targetBranch: "main",
        },
      }),
    ).resolves.toEqual({
      action: {
        id: "git.merge_branches",
        args: {
          sourceBranch: "feature/login",
          targetBranch: "main",
        },
      },
      status: "failed",
      message:
        "Merge from feature/login into main started. Conflicts require manual resolution (1 file).",
      createdAt: expect.any(String),
      data: {
        ok: false,
        conflict: {
          contextType: "repository",
          operation: "merge",
          files: [
            {
              file: "src/App.tsx",
              x: "U",
              y: "U",
              statusLabel: "Both Modified",
            },
          ],
        },
      },
    });
  });

  test("dispatches GitHub pull request actions to the PR service layer", async () => {
    const createPullRequest = mock(async () => ({
      url: "https://github.com/example/repo/pull/42",
    }));
    const execute = createRepositoryAssistantActionExecutor({ createPullRequest });

    await expect(
      execute("/tmp/repo", {
        id: "gh.pr.create",
        args: {
          sourceBranch: "feature/login",
          targetBranch: "main",
          pushSourceBranch: true,
        },
      }),
    ).resolves.toEqual({
      action: {
        id: "gh.pr.create",
        args: {
          sourceBranch: "feature/login",
          targetBranch: "main",
          pushSourceBranch: true,
        },
      },
      status: "succeeded",
      message: "Created pull request: https://github.com/example/repo/pull/42",
      createdAt: expect.any(String),
      data: {
        url: "https://github.com/example/repo/pull/42",
      },
    });

    expect(createPullRequest).toHaveBeenCalledWith("/tmp/repo", "feature/login", "main", true);
  });
});
