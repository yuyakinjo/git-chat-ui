import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { RepositoryAssistantSidebar } from "../../../src/components/RepositoryAssistantSidebar";

describe("RepositoryAssistantSidebar", () => {
  test("renders an empty state with composer affordances", () => {
    const html = renderToStaticMarkup(
      <RepositoryAssistantSidebar
        repository={{
          name: "git-chat-ui",
          path: "/tmp/git-chat-ui",
        }}
        messages={[]}
        draft=""
        pending={false}
        error={null}
        onDraftChange={() => {}}
        onSubmit={() => {}}
        onClearConversation={() => {}}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("AI Repo Chat");
    expect(html).toContain("複雑な Git 操作をここで相談できます。");
    expect(html).toContain("Cmd/Ctrl + Enter で送信");
    expect(html).toContain('placeholder="複雑な branch 操作や conflict 対応を相談する"');
    expect(html).toContain(">Send</span>");
    expect(html).toContain("Clear conversation");
    expect(html).toContain("Close AI sidebar");
  });

  test("renders chat history, pending state, and inline errors", () => {
    const html = renderToStaticMarkup(
      <RepositoryAssistantSidebar
        repository={{
          name: "git-chat-ui",
          path: "/tmp/git-chat-ui",
        }}
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
});
