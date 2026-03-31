import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DEFAULT_COMMIT_TITLE_PROMPT } from "../../../src/lib/commitTitlePrompt";
import {
  buildOpenAiModelOptions,
  ConfigView,
  resolveSelectedAiProvider,
  TokenValidationIndicator,
} from "../../../src/components/ConfigView";
import type { AppConfig } from "../../../src/types";

const config: AppConfig = {
  openAiToken: "",
  openAiModel: "gpt-4.1-mini",
  claudeCodeToken: "",
  selectedAiProvider: "openAi",
  commitTitlePrompt: DEFAULT_COMMIT_TITLE_PROMPT,
  commitGraphMode: "detailed",
  repositoryScanDepth: 4,
  recentlyUsed: [],
  windowState: null,
};

describe("TokenValidationIndicator", () => {
  test("renders the done icon when the token is valid", () => {
    const html = renderToStaticMarkup(
      <TokenValidationIndicator providerName="Claude Code" validationState="valid" />,
    );

    expect(html).toContain('aria-label="Claude Code token is valid"');
  });

  test("renders the invalid icon when the token is invalid", () => {
    const html = renderToStaticMarkup(
      <TokenValidationIndicator providerName="OpenAI" validationState="invalid" />,
    );

    expect(html).toContain('aria-label="OpenAI token is invalid"');
  });

  test("renders the loading icon while the token is being validated", () => {
    const html = renderToStaticMarkup(
      <TokenValidationIndicator providerName="OpenAI" validationState="checking" />,
    );

    expect(html).toContain('aria-label="OpenAI token is being validated"');
    expect(html).toContain("animate-spin");
  });

  test("renders nothing while idle", () => {
    const html = renderToStaticMarkup(
      <TokenValidationIndicator providerName="OpenAI" validationState="idle" />,
    );

    expect(html).toBe("");
  });
});

describe("resolveSelectedAiProvider", () => {
  test("switches to Claude Code when OpenAI is selected but only Claude has a token", () => {
    expect(resolveSelectedAiProvider("openAi", "", "cc-token")).toBe("claudeCode");
  });

  test("keeps the current provider when both tokens are present", () => {
    expect(resolveSelectedAiProvider("claudeCode", "sk-openai", "cc-token")).toBe("claudeCode");
  });
});

describe("buildOpenAiModelOptions", () => {
  test("keeps the selected model even when it is missing from the fetched list", () => {
    expect(buildOpenAiModelOptions(["gpt-4.1", "gpt-4.1-mini"], "gpt-4.1-nano")).toEqual([
      "gpt-4.1-nano",
      "gpt-4.1-mini",
      "gpt-4.1",
    ]);
  });

  test("falls back to the default model when no fetched model exists", () => {
    expect(buildOpenAiModelOptions([], "")).toEqual(["gpt-4.1-mini"]);
  });
});

describe("ConfigView", () => {
  test("renders the default commit title prompt as the textarea value instead of a placeholder", () => {
    const html = renderToStaticMarkup(
      <ConfigView
        onNotify={() => {}}
        config={config}
        onConfigSaved={() => {}}
        onAiGenerationConfigChange={() => {}}
      />,
    );

    expect(html).toContain(
      "You are a Git assistant. Write a Git commit message from the provided staged changes.",
    );
    expect(html).not.toContain('placeholder="You are a Git assistant..."');
  });

  test("renders a reset button for restoring the default prompt", () => {
    const html = renderToStaticMarkup(
      <ConfigView
        onNotify={() => {}}
        config={config}
        onConfigSaved={() => {}}
        onAiGenerationConfigChange={() => {}}
      />,
    );

    expect(html).toContain("デフォルトに戻す");
    expect(html).toContain('disabled=""');
  });
});
