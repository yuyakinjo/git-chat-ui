import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { RepositoryAssistantSidebar } from "../../../src/components/RepositoryAssistantSidebar";

const repositoryAssistantSettings = {
  openAiModel: "gpt-5.4",
  reasoningEffort: "xhigh" as const,
};

const nonReasoningRepositoryAssistantSettings = {
  openAiModel: "gpt-4.1-mini",
  reasoningEffort: "high" as const,
};

describe("RepositoryAssistantSidebar", () => {
  test("renders an empty state with composer affordances", () => {
    const html = renderToStaticMarkup(
      <RepositoryAssistantSidebar
        open
        openAiToken=""
        settings={repositoryAssistantSettings}
        messages={[]}
        draft=""
        pending={false}
        error={null}
        onSettingsChange={() => {}}
        onDraftChange={() => {}}
        onSubmit={() => {}}
        onClearConversation={() => {}}
        onClose={() => {}}
      />,
    );

    expect(html).not.toContain("AI Repo Chat");
    expect(html).not.toContain(
      "branch / working tree / recent commits を見ながら Git 操作を整理します。",
    );
    expect(html).toContain("複雑な Git 操作をここで相談できます。");
    expect(html).toContain("Chat Model");
    expect(html).toContain("推論の労力");
    expect(html).not.toContain("Cmd/Ctrl + Enter で送信");
    expect(html).toContain('placeholder="複雑な branch 操作や conflict 対応を相談する"');
    expect(html).toContain("repository-assistant__composer-settings");
    expect(html).toContain(">Send</span>");
    expect(html).toContain("Clear conversation");
    expect(html).toContain("Close AI sidebar");
  });

  test("renders chat history, pending state, and inline errors", () => {
    const html = renderToStaticMarkup(
      <RepositoryAssistantSidebar
        open
        openAiToken=""
        settings={repositoryAssistantSettings}
        messages={[
          {
            id: "user-1",
            role: "user",
            content: "How should I resolve this conflict?",
            createdAt: "2026-04-03T00:00:00.000Z",
          },
          {
            id: "assistant-1",
            role: "assistant",
            content: "Start with the conflicted files in the working tree.",
            createdAt: "2026-04-03T00:01:00.000Z",
          },
        ]}
        draft="What about rebasing after that?"
        pending
        error="AI sidebar には Config の OpenAI token が必要です。"
        onSettingsChange={() => {}}
        onDraftChange={() => {}}
        onSubmit={() => {}}
        onClearConversation={() => {}}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("How should I resolve this conflict?");
    expect(html).toContain("Start with the conflicted files in the working tree.");
    expect(html).toContain("thinking");
    expect(html).toContain("repo 状態を確認しています…");
    expect(html).toContain("AI sidebar には Config の OpenAI token が必要です。");
    expect(html).toContain("repository-assistant__message--assistant");
    expect(html).toContain("repository-assistant__message--user");
    expect(html).toContain('aria-label="2 messages"');
  });

  test("hides the reasoning effort selector for models that do not support it", () => {
    const html = renderToStaticMarkup(
      <RepositoryAssistantSidebar
        open
        openAiToken=""
        settings={nonReasoningRepositoryAssistantSettings}
        messages={[]}
        draft=""
        pending={false}
        error={null}
        onSettingsChange={() => {}}
        onDraftChange={() => {}}
        onSubmit={() => {}}
        onClearConversation={() => {}}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("Chat Model");
    expect(html).not.toContain("推論の労力");
    expect(html).toContain("repository-assistant__composer-settings--single-column");
  });

  test("stays mounted but hidden when closed", () => {
    const html = renderToStaticMarkup(
      <RepositoryAssistantSidebar
        open={false}
        openAiToken=""
        settings={repositoryAssistantSettings}
        messages={[]}
        draft=""
        pending={false}
        error={null}
        onSettingsChange={() => {}}
        onDraftChange={() => {}}
        onSubmit={() => {}}
        onClearConversation={() => {}}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("hidden");
    expect(html).toContain('aria-hidden="true"');
  });
});
