import { describe, expect, test } from "bun:test";

import { isRepositoryAssistantSubmitShortcut } from "../../../src/lib/repositoryAssistant";

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
