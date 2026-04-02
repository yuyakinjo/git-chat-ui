import { describe, expect, test } from "bun:test";

import {
  createRepositoryAssistantSettingsFromConfig,
  isRepositoryAssistantSubmitShortcut,
  toRepositoryAssistantConfigPatch,
} from "../../../src/lib/repositoryAssistant";

describe("isRepositoryAssistantSubmitShortcut", () => {
  test("matches Cmd/Ctrl + Enter without extra modifiers", () => {
    expect(
      isRepositoryAssistantSubmitShortcut({
        key: "Enter",
        metaKey: true,
      }),
    ).toBe(true);

    expect(
      isRepositoryAssistantSubmitShortcut({
        key: "enter",
        ctrlKey: true,
      }),
    ).toBe(true);
  });

  test("rejects plain Enter, unrelated keys, and extra modifiers", () => {
    expect(
      isRepositoryAssistantSubmitShortcut({
        key: "Enter",
      }),
    ).toBe(false);

    expect(
      isRepositoryAssistantSubmitShortcut({
        key: "k",
        metaKey: true,
      }),
    ).toBe(false);

    expect(
      isRepositoryAssistantSubmitShortcut({
        key: "Enter",
        metaKey: true,
        shiftKey: true,
      }),
    ).toBe(false);
  });
});

describe("createRepositoryAssistantSettingsFromConfig", () => {
  test("prefers the dedicated assistant config values", () => {
    expect(
      createRepositoryAssistantSettingsFromConfig({
        openAiModel: "gpt-4.1-mini",
        repositoryAssistantOpenAiModel: "gpt-5.4",
        repositoryAssistantReasoningEffort: "high",
      }),
    ).toEqual({
      openAiModel: "gpt-5.4",
      reasoningEffort: "high",
    });
  });

  test("falls back to the commit model when the dedicated assistant model is blank", () => {
    expect(
      createRepositoryAssistantSettingsFromConfig({
        openAiModel: "gpt-4.1",
        repositoryAssistantOpenAiModel: "   ",
        repositoryAssistantReasoningEffort: "default",
      }),
    ).toEqual({
      openAiModel: "gpt-4.1",
      reasoningEffort: "default",
    });
  });
});

describe("toRepositoryAssistantConfigPatch", () => {
  test("maps chat settings to the dedicated config fields", () => {
    expect(
      toRepositoryAssistantConfigPatch({
        openAiModel: "gpt-5.4",
        reasoningEffort: "xhigh",
      }),
    ).toEqual({
      repositoryAssistantOpenAiModel: "gpt-5.4",
      repositoryAssistantReasoningEffort: "xhigh",
    });
  });
});
