import { describe, expect, test } from "bun:test";

import {
  normalizeGithubHistoryRef,
  parseGithubCommitAvatarGraphQlResponse,
} from "../../server/git/commitAvatars";

describe("normalizeGithubHistoryRef", () => {
  test("normalizes local and remote refs to GitHub history expressions", () => {
    expect(normalizeGithubHistoryRef("refs/heads/main")).toBe("main");
    expect(normalizeGithubHistoryRef("refs/remotes/origin/feature/avatar")).toBe("feature/avatar");
    expect(normalizeGithubHistoryRef("origin/main")).toBe("main");
    expect(normalizeGithubHistoryRef("abc1234")).toBe("abc1234");
    expect(normalizeGithubHistoryRef("")).toBe("HEAD");
  });
});

describe("parseGithubCommitAvatarGraphQlResponse", () => {
  test("extracts commit sha to avatar url mappings from GitHub GraphQL history nodes", () => {
    const result = parseGithubCommitAvatarGraphQlResponse(
      JSON.stringify({
        data: {
          repository: {
            object: {
              history: {
                nodes: [
                  {
                    oid: "abc1234",
                    author: {
                      user: {
                        avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4&s=72",
                      },
                    },
                  },
                  {
                    oid: "def5678",
                    author: {
                      user: null,
                    },
                  },
                ],
              },
            },
          },
        },
      }),
    );

    expect(result.size).toBe(1);
    expect(result.get("abc1234")).toBe("https://avatars.githubusercontent.com/u/1?v=4&s=72");
  });
});
