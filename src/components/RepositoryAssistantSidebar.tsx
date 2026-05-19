import {
  Bot,
  CircleUserRound,
  ChevronDown,
  LoaderCircle,
  PanelRightClose,
  SendHorizonal,
  Shield,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type JSX,
  type KeyboardEvent,
} from "react";
import ReactMarkdown from "react-markdown";

import { api } from "../lib/api";
import {
  buildOpenAiModelOptions,
  filterOpenAiModelOptions,
  resolveListboxScrollTop,
} from "../lib/openAiModelCombobox";
import {
  formatRepositoryAssistantActionArgs,
  getRepositoryAssistantActionDisplayLabel,
  isRepositoryAssistantSubmitShortcut,
} from "../lib/repositoryAssistant";
import { OPENAI_REASONING_EFFORT_VALUES, supportsOpenAiReasoningEffort } from "../../shared/ai.js";
import {
  REPOSITORY_ASSISTANT_ACTION_SPECS,
  getRepositoryAssistantActionSpec,
} from "../../shared/repositoryAssistant.js";
import type {
  OpenAiReasoningEffort,
  RepositoryAssistantAction,
  RepositoryAssistantActionId,
  RepositoryAssistantMessage,
  RepositoryAssistantSettings,
} from "../types";

interface RepositoryAssistantSidebarProps {
  open: boolean;
  openAiToken: string;
  settings: RepositoryAssistantSettings;
  messages: RepositoryAssistantMessage[];
  draft: string;
  pending: boolean;
  policySaving: boolean;
  allowedActionIds: RepositoryAssistantActionId[];
  userAvatarUrl?: string | null;
  userLogin?: string | null;
  error: string | null;
  onSettingsChange: (value: RepositoryAssistantSettings) => void;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onClearConversation: () => void;
  onSetActionAllowed: (actionId: RepositoryAssistantActionId, allowed: boolean) => void;
  onExecuteAction: (proposalId: string, action: RepositoryAssistantAction) => void;
  onClose: () => void;
}

const openAiModelsCache = new Map<string, string[]>();

const REASONING_EFFORT_LABELS: Record<OpenAiReasoningEffort, string> = {
  default: "モデル既定",
  none: "なし",
  minimal: "最小",
  low: "低い",
  medium: "中程度",
  high: "高い",
  xhigh: "非常に高い",
};

const ACTION_GROUP_LABELS = {
  git: "Git",
  githubPr: "GitHub PR",
  appApi: "App API",
} as const;

const ACTION_RISK_LABELS = {
  low: "Low",
  medium: "Medium",
  high: "High",
} as const;

type RepositoryAssistantMarkdownLinkProps = ComponentProps<"a"> & { node?: unknown };

function RepositoryAssistantMarkdownLink({
  href,
  children,
  ...props
}: RepositoryAssistantMarkdownLinkProps): JSX.Element {
  return (
    <a
      {...props}
      href={href}
      rel="noreferrer"
      onClick={(event) => {
        if (!href) {
          return;
        }

        event.preventDefault();
        void api.openExternalUrl(href);
      }}
    >
      {children}
    </a>
  );
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

function RepositoryAssistantMessageAuthor({
  role,
  userAvatarUrl,
  userLogin,
}: {
  role: RepositoryAssistantMessage["role"];
  userAvatarUrl: string | null;
  userLogin: string | null;
}): JSX.Element {
  const label = role === "assistant" ? "Assistant" : "You";
  const hasUserAvatar = role === "user" && Boolean(userAvatarUrl?.trim());

  return (
    <div className="repository-assistant__message-author">
      <span
        className={`repository-assistant__avatar repository-assistant__avatar--${role}`}
        title={role === "user" && userLogin ? `GitHub: ${userLogin}` : undefined}
      >
        {role === "assistant" ? (
          <Bot size={14} aria-hidden="true" />
        ) : hasUserAvatar ? (
          <img
            src={userAvatarUrl ?? undefined}
            alt=""
            className="repository-assistant__avatar-image"
          />
        ) : (
          <CircleUserRound size={13} aria-hidden="true" />
        )}
      </span>
      <span>{label}</span>
    </div>
  );
}

export function RepositoryAssistantSidebar({
  open,
  openAiToken,
  settings,
  messages,
  draft,
  pending,
  policySaving,
  allowedActionIds,
  userAvatarUrl = null,
  userLogin = null,
  error,
  onSettingsChange,
  onDraftChange,
  onSubmit,
  onClearConversation,
  onSetActionAllowed,
  onExecuteAction,
  onClose,
}: RepositoryAssistantSidebarProps): JSX.Element {
  const [openAiModels, setOpenAiModels] = useState<string[]>([]);
  const [loadingOpenAiModels, setLoadingOpenAiModels] = useState(false);
  const [openAiModelsError, setOpenAiModelsError] = useState<string | null>(null);
  const [openAiModelFilter, setOpenAiModelFilter] = useState("");
  const [isOpenAiModelFilterDirty, setIsOpenAiModelFilterDirty] = useState(false);
  const [isOpenAiModelComboboxOpen, setIsOpenAiModelComboboxOpen] = useState(false);
  const [activeOpenAiModelIndex, setActiveOpenAiModelIndex] = useState(-1);
  const openAiModelsRequestIdRef = useRef(0);
  const openAiModelComboboxRef = useRef<HTMLDivElement | null>(null);
  const openAiModelInputRef = useRef<HTMLInputElement | null>(null);
  const openAiModelMenuRef = useRef<HTMLDivElement | null>(null);
  const openAiModelOptionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const openAiModelComboboxId = useId();
  const [isPolicyDialogOpen, setPolicyDialogOpen] = useState(false);

  const hasMessages = messages.length > 0;
  const canSubmit = draft.trim().length > 0 && !pending;
  const normalizedToken = openAiToken.trim();
  const messageCountLabel = useMemo(() => `${messages.length} messages`, [messages.length]);
  const allowedActionIdSet = useMemo(() => new Set(allowedActionIds), [allowedActionIds]);
  const actionGroups = useMemo(
    () =>
      (Object.keys(ACTION_GROUP_LABELS) as Array<keyof typeof ACTION_GROUP_LABELS>).map((group) => ({
        group,
        label: ACTION_GROUP_LABELS[group],
        actions: REPOSITORY_ASSISTANT_ACTION_SPECS.filter((spec) => spec.group === group),
      })),
    [],
  );
  const openAiModelOptions = useMemo(
    () => buildOpenAiModelOptions(openAiModels, settings.openAiModel),
    [openAiModels, settings.openAiModel],
  );
  const openAiModelFilterQuery = isOpenAiModelFilterDirty ? openAiModelFilter : "";
  const filteredOpenAiModelOptions = useMemo(
    () => filterOpenAiModelOptions(openAiModelOptions, openAiModelFilterQuery),
    [openAiModelFilterQuery, openAiModelOptions],
  );
  const isOpenAiModelComboboxEnabled =
    normalizedToken.length > 0 && !pending && !loadingOpenAiModels && openAiModelOptions.length > 0;
  const openAiModelInputValue = isOpenAiModelComboboxOpen
    ? isOpenAiModelFilterDirty
      ? openAiModelFilter
      : settings.openAiModel
    : settings.openAiModel;
  const showReasoningEffortSetting = useMemo(
    () => supportsOpenAiReasoningEffort(settings.openAiModel),
    [settings.openAiModel],
  );
  const openAiModelControlTitle = useMemo(() => {
    if (!normalizedToken) {
      return "Config の OpenAI token を設定すると chat 用モデルを選べます。";
    }

    if (loadingOpenAiModels) {
      return "OpenAI の利用可能モデルを取得中です。";
    }

    return openAiModelsError;
  }, [loadingOpenAiModels, normalizedToken, openAiModelsError]);

  useEffect(() => {
    openAiModelsRequestIdRef.current += 1;
    const requestId = openAiModelsRequestIdRef.current;

    if (!open) {
      setLoadingOpenAiModels(false);
      setOpenAiModelsError(null);
      return;
    }

    if (!normalizedToken) {
      setLoadingOpenAiModels(false);
      setOpenAiModels([]);
      setOpenAiModelsError(null);
      return;
    }

    const cachedOpenAiModels = openAiModelsCache.get(normalizedToken);
    if (cachedOpenAiModels) {
      setLoadingOpenAiModels(false);
      setOpenAiModels(cachedOpenAiModels);
      setOpenAiModelsError(null);
      return;
    }

    let active = true;
    setLoadingOpenAiModels(true);
    setOpenAiModelsError(null);

    void (async () => {
      try {
        const response = await api.getOpenAiModels(normalizedToken);
        if (!active || openAiModelsRequestIdRef.current !== requestId) {
          return;
        }

        openAiModelsCache.set(normalizedToken, response.models);
        setOpenAiModels(response.models);
      } catch (fetchError) {
        if (!active || openAiModelsRequestIdRef.current !== requestId) {
          return;
        }

        setOpenAiModels([]);
        setOpenAiModelsError(
          fetchError instanceof Error
            ? fetchError.message
            : "OpenAI モデル一覧を取得できませんでした。",
        );
      } finally {
        if (active && openAiModelsRequestIdRef.current === requestId) {
          setLoadingOpenAiModels(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [normalizedToken, open]);

  useEffect(() => {
    if (!isOpenAiModelComboboxOpen) {
      setActiveOpenAiModelIndex(-1);
      return;
    }

    if (filteredOpenAiModelOptions.length === 0) {
      setActiveOpenAiModelIndex(-1);
      return;
    }

    const selectedIndex = filteredOpenAiModelOptions.indexOf(settings.openAiModel);
    setActiveOpenAiModelIndex((current) => {
      if (selectedIndex >= 0) {
        return selectedIndex;
      }

      if (current >= 0 && current < filteredOpenAiModelOptions.length) {
        return current;
      }

      return 0;
    });
  }, [filteredOpenAiModelOptions, isOpenAiModelComboboxOpen, settings.openAiModel]);

  useEffect(() => {
    if (!isOpenAiModelComboboxOpen || activeOpenAiModelIndex < 0) {
      return;
    }

    const menu = openAiModelMenuRef.current;
    const option = openAiModelOptionRefs.current[activeOpenAiModelIndex];
    if (!menu || !option) {
      return;
    }

    menu.scrollTop = resolveListboxScrollTop({
      optionOffsetTop: option.offsetTop,
      optionOffsetHeight: option.offsetHeight,
      listScrollTop: menu.scrollTop,
      listClientHeight: menu.clientHeight,
    });
  }, [activeOpenAiModelIndex, isOpenAiModelComboboxOpen]);

  useEffect(() => {
    if (!isOpenAiModelComboboxOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (openAiModelComboboxRef.current?.contains(target)) {
        return;
      }

      setIsOpenAiModelComboboxOpen(false);
      setOpenAiModelFilter("");
      setIsOpenAiModelFilterDirty(false);
      setActiveOpenAiModelIndex(-1);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpenAiModelComboboxOpen]);

  useEffect(() => {
    if (isOpenAiModelComboboxEnabled) {
      return;
    }

    setIsOpenAiModelComboboxOpen(false);
    setOpenAiModelFilter("");
    setIsOpenAiModelFilterDirty(false);
    setActiveOpenAiModelIndex(-1);
  }, [isOpenAiModelComboboxEnabled]);

  const closeOpenAiModelCombobox = (): void => {
    setIsOpenAiModelComboboxOpen(false);
    setOpenAiModelFilter("");
    setIsOpenAiModelFilterDirty(false);
    setActiveOpenAiModelIndex(-1);
  };

  const focusOpenAiModelInput = (selectText: boolean): void => {
    requestAnimationFrame(() => {
      const input = openAiModelInputRef.current;
      if (!input) {
        return;
      }

      input.focus();
      if (selectText && input.value) {
        input.select();
      }
    });
  };

  const openOpenAiModelCombobox = (selectText: boolean): void => {
    if (!isOpenAiModelComboboxEnabled) {
      return;
    }

    setIsOpenAiModelComboboxOpen(true);
    setOpenAiModelFilter("");
    setIsOpenAiModelFilterDirty(false);
    focusOpenAiModelInput(selectText);
  };

  const handleOpenAiModelOptionSelect = (modelId: string): void => {
    onSettingsChange({
      ...settings,
      openAiModel: modelId,
    });
    closeOpenAiModelCombobox();
  };

  const handleOpenAiModelInputFocus = (): void => {
    if (!isOpenAiModelComboboxEnabled || isOpenAiModelComboboxOpen) {
      return;
    }

    setIsOpenAiModelComboboxOpen(true);
    setOpenAiModelFilter("");
    setIsOpenAiModelFilterDirty(false);
    focusOpenAiModelInput(Boolean(settings.openAiModel.trim()));
  };

  const handleOpenAiModelInputChange = (value: string): void => {
    if (!isOpenAiModelComboboxEnabled) {
      return;
    }

    if (!isOpenAiModelComboboxOpen) {
      setIsOpenAiModelComboboxOpen(true);
    }

    setOpenAiModelFilter(value);
    setIsOpenAiModelFilterDirty(true);
  };

  const handleOpenAiModelInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (!isOpenAiModelComboboxEnabled) {
      return;
    }

    if (event.key === "Tab") {
      closeOpenAiModelCombobox();
      return;
    }

    if (event.key === "Escape") {
      if (isOpenAiModelComboboxOpen) {
        event.preventDefault();
        closeOpenAiModelCombobox();
        openAiModelInputRef.current?.blur();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpenAiModelComboboxOpen) {
        openOpenAiModelCombobox(false);
        return;
      }

      setActiveOpenAiModelIndex((current) => {
        if (filteredOpenAiModelOptions.length === 0) {
          return -1;
        }

        return Math.min(current + 1, filteredOpenAiModelOptions.length - 1);
      });
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpenAiModelComboboxOpen) {
        openOpenAiModelCombobox(false);
        return;
      }

      setActiveOpenAiModelIndex((current) => {
        if (filteredOpenAiModelOptions.length === 0) {
          return -1;
        }

        if (current < 0) {
          return filteredOpenAiModelOptions.length - 1;
        }

        return Math.max(current - 1, 0);
      });
      return;
    }

    if (event.key === "Enter" && isOpenAiModelComboboxOpen && activeOpenAiModelIndex >= 0) {
      event.preventDefault();
      const activeModel = filteredOpenAiModelOptions[activeOpenAiModelIndex];
      if (activeModel) {
        handleOpenAiModelOptionSelect(activeModel);
      }
      return;
    }

    if (!isOpenAiModelComboboxOpen) {
      setIsOpenAiModelComboboxOpen(true);
    }
  };

  const handleComposerTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (!canSubmit || !isRepositoryAssistantSubmitShortcut(event)) {
      return;
    }

    event.preventDefault();
    onSubmit();
  };

  return (
    <aside className="panel repository-assistant" hidden={!open} aria-hidden={!open}>
      <header className="repository-assistant__header">
        <div className="repository-assistant__header-actions">
          <button
            type="button"
            className="repository-assistant__icon-button"
            aria-label="Assistant allowlist"
            title="Assistant allowlist"
            disabled={policySaving}
            onClick={() => setPolicyDialogOpen(true)}
          >
            <Shield size={15} />
          </button>
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
                <RepositoryAssistantMessageAuthor
                  role={message.role}
                  userAvatarUrl={userAvatarUrl}
                  userLogin={userLogin}
                />
                <span className="repository-assistant__message-time">
                  {formatTimestamp(message.createdAt)}
                </span>
              </div>
              <div className="repository-assistant__message-body">
                <ReactMarkdown components={{ a: RepositoryAssistantMarkdownLink }}>
                  {message.content}
                </ReactMarkdown>
              </div>
              {message.proposedActions && message.proposedActions.length > 0 ? (
                <div className="repository-assistant__action-list">
                  {message.proposedActions.map((proposal) => {
                    const spec = getRepositoryAssistantActionSpec(proposal.action.id);
                    const allowed = allowedActionIdSet.has(proposal.action.id);
                    const canRun =
                      allowed && !pending && proposal.status !== "running" && proposal.status !== "stale";

                    return (
                      <div key={proposal.id} className="repository-assistant__action-card">
                        <div className="repository-assistant__action-header">
                          <div className="repository-assistant__action-title">
                            {getRepositoryAssistantActionDisplayLabel(proposal.action)}
                          </div>
                          <div className="repository-assistant__action-badges">
                            <span className="repository-assistant__action-badge">
                              {ACTION_GROUP_LABELS[spec.group]}
                            </span>
                            <span className="repository-assistant__action-badge">
                              Risk: {ACTION_RISK_LABELS[spec.risk]}
                            </span>
                            <span className="repository-assistant__action-badge">
                              {proposal.status}
                            </span>
                          </div>
                        </div>
                        <div className="repository-assistant__action-copy">{proposal.reason}</div>
                        <div className="repository-assistant__action-copy is-subtle">
                          <code>{proposal.action.id}</code> {formatRepositoryAssistantActionArgs(proposal.action)}
                        </div>
                        <div className="repository-assistant__action-footer">
                          <span
                            className={`repository-assistant__action-permission ${allowed ? "is-allowed" : "is-blocked"}`}
                          >
                            {allowed ? "Allowed" : "Blocked by allowlist"}
                          </span>
                          <div className="repository-assistant__action-buttons">
                            <button
                              type="button"
                              className="button button-secondary"
                              disabled={policySaving || pending}
                              onClick={() => onSetActionAllowed(proposal.action.id, !allowed)}
                            >
                              {allowed ? "Disallow" : "Allow"}
                            </button>
                            <button
                              type="button"
                              className="button button-primary"
                              disabled={!canRun}
                              onClick={() => onExecuteAction(proposal.id, proposal.action)}
                            >
                              {proposal.status === "running" ? "Running..." : "Approve & Run"}
                            </button>
                          </div>
                        </div>
                        {proposal.result ? (
                          <div
                            className={`repository-assistant__action-result ${
                              proposal.result.status === "failed" ? "is-error" : ""
                            }`}
                          >
                            {proposal.result.message}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
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
              <RepositoryAssistantMessageAuthor
                role="assistant"
                userAvatarUrl={userAvatarUrl}
                userLogin={userLogin}
              />
              <span className="repository-assistant__message-time">thinking</span>
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
          onKeyDown={handleComposerTextareaKeyDown}
        />
        {error ? <div className="repository-assistant__error">{error}</div> : null}
        <div className="repository-assistant__composer-footer">
          <div
            className={`repository-assistant__composer-settings${showReasoningEffortSetting ? "" : " repository-assistant__composer-settings--single-column"}`}
          >
            <div
              className="repository-assistant__setting"
              title={openAiModelControlTitle ?? undefined}
            >
              <label
                className="repository-assistant__setting-label"
                htmlFor="repository-assistant-model"
              >
                Chat Model
              </label>
              <div ref={openAiModelComboboxRef} className="config-view__combobox">
                <div
                  className={`config-view__combobox-control${isOpenAiModelComboboxOpen ? " is-open" : ""}`}
                >
                  <input
                    id="repository-assistant-model"
                    ref={openAiModelInputRef}
                    className="config-view__combobox-input"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-controls={`${openAiModelComboboxId}-listbox`}
                    aria-expanded={isOpenAiModelComboboxOpen}
                    aria-activedescendant={
                      activeOpenAiModelIndex >= 0
                        ? `${openAiModelComboboxId}-option-${activeOpenAiModelIndex}`
                        : undefined
                    }
                    placeholder="OpenAI model を選択"
                    value={openAiModelInputValue}
                    disabled={!normalizedToken || pending || loadingOpenAiModels}
                    onFocus={handleOpenAiModelInputFocus}
                    onChange={(event) => handleOpenAiModelInputChange(event.target.value)}
                    onKeyDown={handleOpenAiModelInputKeyDown}
                  />
                  <button
                    type="button"
                    className="config-view__combobox-toggle"
                    aria-label={
                      isOpenAiModelComboboxOpen
                        ? "OpenAI model list を閉じる"
                        : "OpenAI model list を開く"
                    }
                    disabled={!isOpenAiModelComboboxEnabled}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (isOpenAiModelComboboxOpen) {
                        closeOpenAiModelCombobox();
                        return;
                      }

                      openOpenAiModelCombobox(Boolean(settings.openAiModel.trim()));
                    }}
                  >
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                </div>

                {isOpenAiModelComboboxOpen ? (
                  <div
                    id={`${openAiModelComboboxId}-listbox`}
                    ref={openAiModelMenuRef}
                    className="config-view__combobox-menu"
                    role="listbox"
                  >
                    {filteredOpenAiModelOptions.length > 0 ? (
                      filteredOpenAiModelOptions.map((modelId, index) => {
                        const isSelected = modelId === settings.openAiModel;
                        const isActive = index === activeOpenAiModelIndex;

                        return (
                          <button
                            key={modelId}
                            id={`${openAiModelComboboxId}-option-${index}`}
                            ref={(element) => {
                              openAiModelOptionRefs.current[index] = element;
                            }}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            className={`config-view__combobox-option${isSelected ? " is-selected" : ""}${isActive ? " is-active" : ""}`}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => setActiveOpenAiModelIndex(index)}
                            onClick={() => handleOpenAiModelOptionSelect(modelId)}
                          >
                            <span className="config-view__combobox-option-label">{modelId}</span>
                            {isSelected ? (
                              <span className="config-view__combobox-option-meta">選択中</span>
                            ) : null}
                          </button>
                        );
                      })
                    ) : (
                      <div className="config-view__combobox-empty">一致するモデルはありません</div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            {showReasoningEffortSetting ? (
              <div className="repository-assistant__setting">
                <label
                  className="repository-assistant__setting-label"
                  htmlFor="repository-assistant-reasoning-effort"
                >
                  推論の労力
                </label>
                <select
                  id="repository-assistant-reasoning-effort"
                  className="input input-select repository-assistant__reasoning-select"
                  value={settings.reasoningEffort}
                  disabled={pending}
                  onChange={(event) =>
                    onSettingsChange({
                      ...settings,
                      reasoningEffort: event.target.value as OpenAiReasoningEffort,
                    })
                  }
                >
                  {OPENAI_REASONING_EFFORT_VALUES.map((effort) => (
                    <option key={effort} value={effort}>
                      {REASONING_EFFORT_LABELS[effort]}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
          <button type="submit" className="button button-primary" disabled={!canSubmit}>
            <span className="inline-flex items-center gap-2">
              <SendHorizonal size={15} />
              <span>Send</span>
            </span>
          </button>
        </div>
      </form>

      {isPolicyDialogOpen ? (
        <div className="repository-assistant__dialog-backdrop" onClick={() => setPolicyDialogOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="repository assistant allowlist"
            className="repository-assistant__policy-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="repository-assistant__policy-header">
              <div>
                <div className="repository-assistant__policy-title">Assistant Allowlist</div>
                <div className="repository-assistant__policy-copy">
                  Allowlisted actions can be approved and executed from assistant proposals.
                </div>
              </div>
              <button
                type="button"
                className="repository-assistant__icon-button"
                aria-label="Close allowlist"
                title="Close allowlist"
                onClick={() => setPolicyDialogOpen(false)}
              >
                <PanelRightClose size={15} />
              </button>
            </div>

            <div className="repository-assistant__policy-groups">
              {actionGroups.map(({ group, label, actions }) => (
                <section key={group} className="repository-assistant__policy-group">
                  <div className="repository-assistant__policy-group-title">{label}</div>
                  {actions.length > 0 ? (
                    <div className="repository-assistant__policy-list">
                      {actions.map((action) => (
                        <label key={action.id} className="repository-assistant__policy-item">
                          <input
                            type="checkbox"
                            checked={allowedActionIdSet.has(action.id)}
                            disabled={policySaving}
                            onChange={(event) =>
                              onSetActionAllowed(action.id, event.target.checked)
                            }
                          />
                          <span className="repository-assistant__policy-item-copy">
                            <span className="repository-assistant__policy-item-title">
                              {action.label}
                            </span>
                            <span className="repository-assistant__policy-item-meta">
                              <code>{action.id}</code> · Risk {ACTION_RISK_LABELS[action.risk]}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="repository-assistant__policy-empty">
                      No app-only actions are available in v1.
                    </div>
                  )}
                </section>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
