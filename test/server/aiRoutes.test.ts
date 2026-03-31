import { describe, expect, mock, test } from "bun:test";

import { DEFAULT_APP_CONFIG } from "../../shared/config.js";
import { createAiRouter } from "../../server/routes/ai.js";
import { invokeJsonRoute } from "./routeHarness";

describe("createAiRouter", () => {
  test("delegates commit generation to the injected AI service", async () => {
    const readConfig = mock(async () => ({
      ...DEFAULT_APP_CONFIG,
      openAiToken: "sk-config-token",
      openAiModel: "gpt-4.1-mini",
      claudeCodeToken: "cc-config-token",
      selectedAiProvider: "openAi" as const,
      commitTitlePrompt: "config prompt",
    }));
    const getDiffSnippet = mock(async () => "+ diff");
    const generateCommitTitle = mock(async () => ({
      title: "feat: generated title",
      description: "- detail",
    }));

    await expect(
      invokeJsonRoute(createAiRouter({ aiService: { generateCommitTitle }, readConfig, getDiffSnippet }), "post", "/api/generate-title", {
        body: {
          repoPath: "/tmp/repo",
          changedFiles: ["src/App.tsx"],
          selectedAiProvider: "claudeCode",
        },
      }),
    ).resolves.toEqual({
      statusCode: 200,
      body: {
        title: "feat: generated title",
        description: "- detail",
      },
    });

    expect(readConfig).toHaveBeenCalledTimes(1);
    expect(getDiffSnippet).toHaveBeenCalledWith("/tmp/repo", ["src/App.tsx"]);
    expect(generateCommitTitle).toHaveBeenCalledWith({
      openAiToken: "sk-config-token",
      openAiModel: "gpt-4.1-mini",
      claudeCodeToken: "cc-config-token",
      selectedAiProvider: "claudeCode",
      commitTitlePrompt: "config prompt",
      changedFiles: ["src/App.tsx"],
      diffSnippet: "+ diff",
    });
  });
});
