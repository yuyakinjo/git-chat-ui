import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DEFAULT_COMMIT_TITLE_PROMPT } from "../../../src/lib/commitTitlePrompt";
import {
  buildOpenAiModelOptions,
  ConfigView,
  filterOpenAiModelOptions,
  resolveListboxScrollTop,
  resolveSelectedAiProvider,
  TokenValidationIndicator,
} from "../../../src/components/ConfigView";
import type { AppConfig } from "../../../src/types";

const config: AppConfig = {
  openAiToken: "",
  openAiModel: "gpt-4.1-mini",
  repositoryAssistantOpenAiModel: "gpt-5.4",
  repositoryAssistantReasoningEffort: "high",
  claudeCodeToken: "",
  selectedAiProvider: "openAi",
  commitTitlePrompt: DEFAULT_COMMIT_TITLE_PROMPT,
  commitGraphMode: "detailed",
  commitGraphStyle: "standard",
  commitMergeAnimation: "none",
  diffViewerMode: "builtin",
  repositoryScanDepth: 4,
  repositoryAssistantPolicies: {},
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

describe("filterOpenAiModelOptions", () => {
  test("filters model options by partial match", () => {
    expect(filterOpenAiModelOptions(["gpt-5", "gpt-5-mini", "gpt-4.1"], "mini")).toEqual([
      "gpt-5-mini",
    ]);
  });

  test("matches case-insensitively", () => {
    expect(filterOpenAiModelOptions(["GPT-5", "gpt-4.1"], "gpt")).toEqual(["GPT-5", "gpt-4.1"]);
  });

  test("returns no option when nothing matches the filter", () => {
    expect(filterOpenAiModelOptions(["gpt-5", "gpt-5-mini", "gpt-4.1"], "audio")).toEqual([]);
  });
});

describe("resolveListboxScrollTop", () => {
  test("keeps the current scroll when the active option is already visible", () => {
    expect(
      resolveListboxScrollTop({
        optionOffsetTop: 120,
        optionOffsetHeight: 28,
        listScrollTop: 100,
        listClientHeight: 80,
      }),
    ).toBe(100);
  });

  test("scrolls upward when the active option is above the viewport", () => {
    expect(
      resolveListboxScrollTop({
        optionOffsetTop: 72,
        optionOffsetHeight: 28,
        listScrollTop: 100,
        listClientHeight: 80,
      }),
    ).toBe(72);
  });

  test("scrolls downward when the active option is below the viewport", () => {
    expect(
      resolveListboxScrollTop({
        optionOffsetTop: 196,
        optionOffsetHeight: 32,
        listScrollTop: 100,
        listClientHeight: 80,
      }),
    ).toBe(148);
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
    expect(html).toContain('class="input config-view__commit-title-prompt min-h-32 resize-y"');
    expect(html).toContain('wrap="soft"');
  });

  test("renders config content inside a scrollable body so long forms stay within the panel", () => {
    const html = renderToStaticMarkup(
      <ConfigView
        onNotify={() => {}}
        config={config}
        onConfigSaved={() => {}}
        onAiGenerationConfigChange={() => {}}
      />,
    );

    expect(html).toContain(
      'class="panel mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col overflow-hidden p-6"',
    );
    expect(html).toContain('class="min-h-0 flex-1 overflow-y-auto pr-1"');
    expect(html).toContain('class="mt-4 shrink-0"');
  });

  test("renders config selects with the shared input-select styling hook", () => {
    const html = renderToStaticMarkup(
      <ConfigView
        onNotify={() => {}}
        config={config}
        onConfigSaved={() => {}}
        onAiGenerationConfigChange={() => {}}
      />,
    );

    expect(html.match(/class="input input-select"/g)?.length).toBe(4);
    expect(html).toContain("Commit Graph Style");
    expect(html).toContain(">Standard</option>");
    expect(html).toContain(">Japanese Express</option>");
    expect(html).toContain("Merge Node Animation");
    expect(html).toContain(">None (オフ)</option>");
    expect(html).toContain(">Pulse (合流パルス)</option>");
    expect(html).toContain("Diff Viewer");
    expect(html).toContain(">@pierre/diffs</option>");
  });

  test("renders a merge animation preview that reflects the selected animation", () => {
    const html = renderToStaticMarkup(
      <ConfigView
        onNotify={() => {}}
        config={{
          ...config,
          commitGraphStyle: "japaneseExpress",
          commitMergeAnimation: "particle",
        }}
        onConfigSaved={() => {}}
        onAiGenerationConfigChange={() => {}}
      />,
    );

    expect(html).toContain('class="config-view__merge-animation-field"');
    expect(html).toContain('class="config-view__merge-animation-preview"');
    expect(html).toContain('class="config-view__merge-animation-preview-node"');
    expect(html).toContain(
      'aria-label="Merge Node Animation preview: Particle (パーティクル集束)"',
    );
    expect(html).toContain("commit-node-merge-ring--particle");
    expect(html).toContain("commit-node--japanese-express");
    expect(html).not.toContain("config-view__merge-animation-preview-graph");
  });

  test("renders an OpenAI model combobox control", () => {
    const html = renderToStaticMarkup(
      <ConfigView
        onNotify={() => {}}
        config={config}
        onConfigSaved={() => {}}
        onAiGenerationConfigChange={() => {}}
      />,
    );

    expect(html).toContain('class="config-view__combobox"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('placeholder="OpenAI model を選択"');
    expect(html).toContain('class="config-view__combobox-toggle"');
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
