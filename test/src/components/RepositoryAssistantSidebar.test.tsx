import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { RepositoryAssistantSidebar } from "../../../src/components/RepositoryAssistantSidebar";
import type { RepositoryAssistantActionId } from "../../../src/types";

const repositoryAssistantSettings = {
  openAiModel: "gpt-5.4",
  reasoningEffort: "xhigh" as const,
};

const nonReasoningRepositoryAssistantSettings = {
  openAiModel: "gpt-4.1-mini",
  reasoningEffort: "high" as const,
};

const baseSidebarProps = {
  open: true,
  openAiToken: "",
  settings: repositoryAssistantSettings,
  messages: [],
  draft: "",
  pending: false,
  policySaving: false,
  allowedActionIds: [] as RepositoryAssistantActionId[],
  error: null,
  onSettingsChange: () => {},
  onDraftChange: () => {},
  onSubmit: () => {},
  onClearConversation: () => {},
  onSetActionAllowed: () => {},
  onExecuteAction: () => {},
  onClose: () => {},
};

describe("RepositoryAssistantSidebar", () => {
  test("renders an empty state with composer affordances", () => {
    const html = renderToStaticMarkup(<RepositoryAssistantSidebar {...baseSidebarProps} />);

    expect(html).not.toContain("AI Repo Chat");
    expect(html).not.toContain(
      "branch / working tree / recent commits を見ながら Git 操作を整理します。",
    );
    expect(html).toContain("複雑な Git 操作をここで相談できます。");
    expect(html).toContain("Chat Model");
    expect(html).toContain("推論の労力");
    expect(html).toContain("Assistant allowlist");
    expect(html).toContain('placeholder="複雑な branch 操作や conflict 対応を相談する"');
    expect(html).toContain("repository-assistant__composer-settings");
    expect(html).toContain(">Send</span>");
    expect(html).toContain("Clear conversation");
    expect(html).toContain("Close AI sidebar");
  });

  test("renders chat history, pending state, and inline errors", () => {
    const html = renderToStaticMarkup(
      <RepositoryAssistantSidebar
        {...baseSidebarProps}
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

  test("renders the GitHub user avatar and assistant robot avatar", () => {
    const html = renderToStaticMarkup(
      <RepositoryAssistantSidebar
        {...baseSidebarProps}
        userAvatarUrl="https://avatars.githubusercontent.com/u/1?v=4"
        userLogin="octocat"
        messages={[
          {
            id: "user-1",
            role: "user",
            content: "Stage everything I changed.",
            createdAt: "2026-04-03T00:00:00.000Z",
          },
          {
            id: "assistant-1",
            role: "assistant",
            content: "Only one file is still unstaged.",
            createdAt: "2026-04-03T00:01:00.000Z",
          },
        ]}
      />,
    );

    expect(html).toContain('src="https://avatars.githubusercontent.com/u/1?v=4"');
    expect(html).toContain("repository-assistant__avatar--user");
    expect(html).toContain("repository-assistant__avatar--assistant");
    expect(html).toContain('title="GitHub: octocat"');
  });

  test("renders markdown for both user and assistant messages", () => {
    const html = renderToStaticMarkup(
      <RepositoryAssistantSidebar
        {...baseSidebarProps}
        messages={[
          {
            id: "user-1",
            role: "user",
            content: "Please review **feature/login** before merge.",
            createdAt: "2026-04-03T00:00:00.000Z",
          },
          {
            id: "assistant-1",
            role: "assistant",
            content:
              "1. Run `git status`\n2. Open [the PR](https://example.com/pr/1)\n\n```bash\ngit rebase origin/main\n```",
            createdAt: "2026-04-03T00:01:00.000Z",
          },
        ]}
      />,
    );

    expect(html).toContain("<strong>feature/login</strong>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<code>git status</code>");
    expect(html).toContain("<pre><code");
    expect(html).toContain('href="https://example.com/pr/1"');
  });

  test("renders action proposals with allow and run controls", () => {
    const html = renderToStaticMarkup(
      <RepositoryAssistantSidebar
        {...baseSidebarProps}
        allowedActionIds={["git.checkout_ref"]}
        messages={[
          {
            id: "assistant-1",
            role: "assistant",
            content: "The next safe step is to checkout the feature branch.",
            createdAt: "2026-04-03T00:01:00.000Z",
            proposedActions: [
              {
                id: "proposal-1",
                reason: "Move to the branch before comparing diffs.",
                status: "proposed",
                result: null,
                action: {
                  id: "git.checkout_ref",
                  args: {
                    ref: "feature/login",
                  },
                },
              },
            ],
          },
        ]}
      />,
    );

    expect(html).toContain("Approve &amp; Run");
    expect(html).toContain("Allow");
    expect(html).toContain("feature/login");
    expect(html).toContain("repository-assistant__action-card");
  });

  test("hides the reasoning effort selector for models that do not support it", () => {
    const html = renderToStaticMarkup(
      <RepositoryAssistantSidebar
        {...baseSidebarProps}
        settings={nonReasoningRepositoryAssistantSettings}
      />,
    );

    expect(html).toContain("Chat Model");
    expect(html).not.toContain("推論の労力");
    expect(html).toContain("repository-assistant__composer-settings--single-column");
  });

  test("stays mounted but hidden when closed", () => {
    const html = renderToStaticMarkup(
      <RepositoryAssistantSidebar {...baseSidebarProps} open={false} />,
    );

    expect(html).toContain("hidden");
    expect(html).toContain('aria-hidden="true"');
  });
});
