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
      invokeJsonRoute(
        createAiRouter({ aiService: { generateCommitTitle }, readConfig, getDiffSnippet }),
        "post",
        "/api/generate-title",
        {
          body: {
            repoPath: "/tmp/repo",
            changedFiles: ["src/App.tsx"],
            selectedAiProvider: "claudeCode",
          },
        },
      ),
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

  test("delegates repository assistant chat to the injected assistant generator", async () => {
    const readConfig = mock(async () => ({
      ...DEFAULT_APP_CONFIG,
      openAiToken: "sk-config-token",
      openAiModel: "gpt-4.1-mini",
      repositoryAssistantOpenAiModel: "gpt-4.1-mini",
    }));
    const generateRepositoryAssistantReply = mock(async () => "Check the conflicted files first.");

    const result = await invokeJsonRoute(
      createAiRouter({
        readConfig,
        generateRepositoryAssistantReply,
      }),
      "post",
      "/api/ai/chat",
      {
        body: {
          repoPath: "/tmp/repo",
          openAiModel: "gpt-5.4",
          reasoningEffort: "high",
          messages: [
            {
              id: "user-1",
              role: "user",
              content: "What should I do next?",
              createdAt: "2026-04-03T00:00:00.000Z",
            },
          ],
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({
      message: {
        id: expect.any(String),
        role: "assistant",
        content: "Check the conflicted files first.",
        createdAt: expect.any(String),
      },
    });
    expect(readConfig).toHaveBeenCalledTimes(1);
    expect(generateRepositoryAssistantReply).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "What should I do next?",
          createdAt: "2026-04-03T00:00:00.000Z",
        },
      ],
      openAiToken: "sk-config-token",
      openAiModel: "gpt-5.4",
      reasoningEffort: "high",
    });
  });

  test("uses saved repository assistant settings when the request omits them", async () => {
    const readConfig = mock(async () => ({
      ...DEFAULT_APP_CONFIG,
      openAiToken: "sk-config-token",
      repositoryAssistantOpenAiModel: "gpt-5.4",
      repositoryAssistantReasoningEffort: "medium" as const,
    }));
    const generateRepositoryAssistantReply = mock(async () => "Use the saved assistant model.");

    const result = await invokeJsonRoute(
      createAiRouter({
        readConfig,
        generateRepositoryAssistantReply,
      }),
      "post",
      "/api/ai/chat",
      {
        body: {
          repoPath: "/tmp/repo",
          messages: [],
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(generateRepositoryAssistantReply).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      messages: [],
      openAiToken: "sk-config-token",
      openAiModel: "gpt-5.4",
      reasoningEffort: "medium",
    });
  });
});
