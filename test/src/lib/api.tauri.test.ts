import { afterEach, describe, expect, mock, test } from "bun:test";

const originalWindow = globalThis.window;

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

describe("api.generateCommitMessage in Tauri", () => {
  test("wraps the payload in the required input argument", async () => {
    const invokeMock = mock(
      async (command: string, args?: Record<string, unknown>) =>
        ({ command, args }) as unknown,
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

    await api.generateCommitMessage("/tmp/repo", ["src/App.tsx"], {
      openAiToken: "",
      openAiModel: "gpt-4.1-mini",
      claudeCodeToken: "cc-live-token",
      selectedAiProvider: "claudeCode",
      commitTitlePrompt: "Write a short Japanese commit message.",
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("generate_title", {
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
  });
});
