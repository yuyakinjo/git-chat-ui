import { describe, expect, test } from "bun:test";

import { parseGithubViewerResponse } from "../../server/ai/repositoryAssistantUserProfile";

describe("parseGithubViewerResponse", () => {
  test("extracts the authenticated GitHub login and avatar URL", () => {
    expect(
      parseGithubViewerResponse(
        JSON.stringify({
          login: "octocat",
          avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
        }),
      ),
    ).toEqual({
      login: "octocat",
      avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
    });
  });

  test("normalizes blank GitHub profile fields to null", () => {
    expect(
      parseGithubViewerResponse(
        JSON.stringify({
          login: "   ",
          avatar_url: "",
        }),
      ),
    ).toEqual({
      login: null,
      avatarUrl: null,
    });
  });
});
