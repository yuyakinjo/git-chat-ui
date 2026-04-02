import { ChevronDown, LoaderCircle, PanelRightClose, SendHorizonal, Trash2 } from "lucide-react";
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
import { isRepositoryAssistantSubmitShortcut } from "../lib/repositoryAssistant";
import { OPENAI_REASONING_EFFORT_VALUES, supportsOpenAiReasoningEffort } from "../../shared/ai.js";
import type {
  OpenAiReasoningEffort,
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
  error: string | null;
  onSettingsChange: (value: RepositoryAssistantSettings) => void;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onClearConversation: () => void;
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

export function RepositoryAssistantSidebar({
  open,
  openAiToken,
  settings,
  messages,
  draft,
  pending,
  error,
  onSettingsChange,
  onDraftChange,
  onSubmit,
  onClearConversation,
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

  const hasMessages = messages.length > 0;
  const canSubmit = draft.trim().length > 0 && !pending;
  const normalizedToken = openAiToken.trim();
  const messageCountLabel = useMemo(() => `${messages.length} messages`, [messages.length]);
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
  }, [normalizedToken]);

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
              <div className="repository-assistant__message-body">
                <ReactMarkdown components={{ a: RepositoryAssistantMarkdownLink }}>
                  {message.content}
                </ReactMarkdown>
              </div>
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
    </aside>
  );
}
