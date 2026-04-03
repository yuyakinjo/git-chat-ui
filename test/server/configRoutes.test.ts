import { describe, expect, mock, test } from "bun:test";

import { DEFAULT_APP_CONFIG } from "../../shared/config.js";
import { createConfigRouter } from "../../server/routes/config.js";
import { invokeJsonRoute } from "./routeHarness";

describe("createConfigRouter", () => {
  test("delegates OpenAI token validation to the injected AI service", async () => {
    const validateOpenAiToken = mock(async (token: string) => token === "sk-openai-valid");

    await expect(
      invokeJsonRoute(
        createConfigRouter({
          aiService: {
            validateOpenAiToken,
            validateClaudeCodeToken: mock(async () => false),
            listOpenAiModels: mock(async () => []),
          },
        }),
        "post",
        "/api/config/validate-openai-token",
        {
          body: { token: "sk-openai-valid" },
        },
      ),
    ).resolves.toEqual({
      statusCode: 200,
      body: { valid: true },
    });

    expect(validateOpenAiToken).toHaveBeenCalledWith("sk-openai-valid");
  });

  test("uses readConfig fallback and delegates model listing to the injected AI service", async () => {
    const readConfig = mock(async () => ({
      ...DEFAULT_APP_CONFIG,
      openAiToken: "sk-config-token",
    }));
    const listOpenAiModels = mock(async () => ["gpt-4.1-mini", "gpt-4.1"]);

    await expect(
      invokeJsonRoute(
        createConfigRouter({
          aiService: {
            validateOpenAiToken: mock(async () => true),
            validateClaudeCodeToken: mock(async () => false),
            listOpenAiModels,
          },
          readConfig,
        }),
        "post",
        "/api/config/openai-models",
      ),
    ).resolves.toEqual({
      statusCode: 200,
      body: {
        models: ["gpt-4.1-mini", "gpt-4.1"],
      },
    });

    expect(readConfig).toHaveBeenCalledTimes(1);
    expect(listOpenAiModels).toHaveBeenCalledWith("sk-config-token");
  });

  test("persists repository assistant settings separately from the commit model", async () => {
    let persisted = {
      ...DEFAULT_APP_CONFIG,
      openAiModel: "gpt-4.1-mini",
      repositoryAssistantOpenAiModel: "gpt-4.1-mini",
      repositoryAssistantReasoningEffort: "default" as const,
    };
    const readConfig = mock(async () => persisted);
    const writeConfig = mock(async (nextConfig) => {
      persisted = nextConfig;
    });

    await expect(
      invokeJsonRoute(
        createConfigRouter({
          aiService: {
            validateOpenAiToken: mock(async () => true),
            validateClaudeCodeToken: mock(async () => false),
            listOpenAiModels: mock(async () => []),
          },
          readConfig,
          writeConfig,
        }),
        "put",
        "/api/config",
        {
          body: {
            repositoryAssistantOpenAiModel: "gpt-5.4",
            repositoryAssistantReasoningEffort: "high",
          },
        },
      ),
    ).resolves.toEqual({
      statusCode: 200,
      body: {
        ok: true,
        config: {
          ...DEFAULT_APP_CONFIG,
          openAiModel: "gpt-4.1-mini",
          repositoryAssistantOpenAiModel: "gpt-5.4",
          repositoryAssistantReasoningEffort: "high",
        },
      },
    });

    expect(writeConfig).toHaveBeenCalledWith({
      ...DEFAULT_APP_CONFIG,
      openAiModel: "gpt-4.1-mini",
      repositoryAssistantOpenAiModel: "gpt-5.4",
      repositoryAssistantReasoningEffort: "high",
    });
  });
});
