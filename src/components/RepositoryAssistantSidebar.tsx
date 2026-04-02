import { LoaderCircle, PanelRightClose, SendHorizonal, Trash2 } from "lucide-react";
import { type JSX, useMemo } from "react";

import type { Repository, RepositoryAssistantMessage } from "../types";

interface RepositoryAssistantSidebarProps {
  repository: Repository;
  messages: RepositoryAssistantMessage[];
  draft: string;
  pending: boolean;
  error: string | null;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onClearConversation: () => void;
  onClose: () => void;
}

function formatTimestamp(value: string): string {
  const numericValue = Number(value);
  const date =
    Number.isFinite(numericValue) && /^\d+$/.test(value) ? new Date(numericValue) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function RepositoryAssistantSidebar({
  repository,
  messages,
  draft,
  pending,
  error,
  onDraftChange,
  onSubmit,
  onClearConversation,
  onClose,
}: RepositoryAssistantSidebarProps): JSX.Element {
  const hasMessages = messages.length > 0;
  const canSubmit = draft.trim().length > 0 && !pending;
  const messageCountLabel = useMemo(() => `${messages.length} messages`, [messages.length]);

  return (
    <aside className="panel repository-assistant">
      <header className="repository-assistant__header">
        <div className="min-w-0">
          <div className="repository-assistant__eyebrow">AI Repo Chat</div>
          <div className="repository-assistant__title">{repository.name}</div>
          <div className="repository-assistant__subtitle">
            branch / working tree / recent commits を見ながら Git 操作を整理します。
          </div>
        </div>
        <div className="repository-assistant__header-actions">
          <button
            type="button"
            className="repository-assistant__icon-button"
            aria-label="Clear conversation"
            title="Clear conversation"
            disabled={!hasMessages || pending}
            onClick={onClearConversation}
          >
            <Trash2 size={15} />
          </button>
          <button
            type="button"
            className="repository-assistant__icon-button"
            aria-label="Close AI sidebar"
            title="Close AI sidebar"
            onClick={onClose}
          >
            <PanelRightClose size={15} />
          </button>
        </div>
      </header>

      <section className="repository-assistant__thread" aria-label={messageCountLabel}>
        {hasMessages ? (
          messages.map((message) => (
            <article
              key={message.id}
              className={`repository-assistant__message repository-assistant__message--${message.role}`}
            >
              <div className="repository-assistant__message-meta">
                <span>{message.role === "assistant" ? "Assistant" : "You"}</span>
                <span>{formatTimestamp(message.createdAt)}</span>
              </div>
              <div className="repository-assistant__message-body">{message.content}</div>
            </article>
          ))
        ) : (
          <div className="repository-assistant__empty-state">
            <div className="repository-assistant__empty-title">
              複雑な Git 操作をここで相談できます。
            </div>
            <div className="repository-assistant__empty-copy">
              例: 「rebase 前に安全確認したい」「conflict をどう解くべきか整理したい」「この working
              tree から次にやるべき操作を教えて」
            </div>
          </div>
        )}

        {pending ? (
          <article className="repository-assistant__message repository-assistant__message--assistant is-pending">
            <div className="repository-assistant__message-meta">
              <span>Assistant</span>
              <span>thinking</span>
            </div>
            <div className="repository-assistant__pending">
              <LoaderCircle size={15} className="repository-assistant__spinner" />
              <span>repo 状態を確認しています…</span>
            </div>
          </article>
        ) : null}
      </section>

      <form
        className="repository-assistant__composer"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label
          className="repository-assistant__composer-label"
          htmlFor="repository-assistant-input"
        >
          Message
        </label>
        <textarea
          id="repository-assistant-input"
          className="input repository-assistant__textarea"
          value={draft}
          rows={5}
          disabled={pending}
          placeholder="複雑な branch 操作や conflict 対応を相談する"
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        {error ? <div className="repository-assistant__error">{error}</div> : null}
        <div className="repository-assistant__composer-footer">
          <div className="repository-assistant__shortcut-hint">Cmd/Ctrl + Enter で送信</div>
          <button type="submit" className="button button-primary" disabled={!canSubmit}>
            <span className="inline-flex items-center gap-2">
              <SendHorizonal size={15} />
              <span>Send</span>
            </span>
          </button>
        </div>
      </form>
    </aside>
  );
}
