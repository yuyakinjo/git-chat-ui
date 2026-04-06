import { describe, expect, test } from "bun:test";

import { shouldAttemptRemoteCommitAvatarHydration } from "../../../src/lib/commitAvatarHydration";
import type { CommitListItem } from "../../../src/types";

function createCommit(sha: string): CommitListItem {
  return {
    sha,
    parentShas: [],
    author: "Developer",
    date: "2026-04-06T00:00:00.000Z",
    subject: `Commit ${sha}`,
    decoration: "",
  };
}

describe("shouldAttemptRemoteCommitAvatarHydration", () => {
  test("skips remote hydration while appending older pages", () => {
    expect(
      shouldAttemptRemoteCommitAvatarHydration({
        append: true,
        commits: [createCommit("abc1234")],
        currentAvatars: {},
      }),
    ).toBe(false);
  });

  test("hydrates again when the visible page still includes commits without cached avatars", () => {
    expect(
      shouldAttemptRemoteCommitAvatarHydration({
        append: false,
        commits: [createCommit("top-commit"), createCommit("cached-commit")],
        currentAvatars: {
          "cached-commit": "data:image/png;base64,cached",
        },
      }),
    ).toBe(true);
  });

  test("skips remote hydration once every visible commit already has an avatar", () => {
    expect(
      shouldAttemptRemoteCommitAvatarHydration({
        append: false,
        commits: [createCommit("abc1234"), createCommit("def5678")],
        currentAvatars: {
          abc1234: "data:image/png;base64,first",
          def5678: "data:image/png;base64,second",
        },
      }),
    ).toBe(false);
  });
});
