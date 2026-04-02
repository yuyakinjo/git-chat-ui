import { Bot, Cog, ExternalLink, FolderGit2, Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";

import { AppTabBranchBadge } from "./components/AppTabBranchBadge";
import { ConfigView } from "./components/ConfigView";
import { ControllerView } from "./components/ControllerView";
import { DashboardView } from "./components/DashboardView";
import { RepositoryAssistantSidebar } from "./components/RepositoryAssistantSidebar";
import {
  closeRepositoryTab,
  CONFIG_TAB_ID,
  DASHBOARD_TAB_ID,
  createRepositoryStub,
  findRepositoryForTab,
  getRepositoryTabBranchLabel,
  getRepositoryTabId,
  resolveConfigEscapeTabId,
  resolveGithubButtonRepository,
  resolveRestoredActiveTabId,
  serializeAppSession,
  type AppTabId,
  type PersistedAppSession,
  type PersistedRepositoryAssistantConversation,
  upsertRepositoryTab,
} from "./lib/appTabs";
import { api } from "./lib/api";
import {
  APP_THEME_OPTIONS,
  getAppThemeLabel,
  getAppThemeMode,
  getNativeWindowAppearance,
  normalizeAppTheme,
  type AppThemeId,
} from "./lib/appTheme";
import {
  APP_SESSION_STORAGE_KEY,
  APP_THEME_STORAGE_KEY,
  getInitialLaunchState,
  getInitialPersistedAppSession,
  pickAiGenerationConfig,
} from "./lib/sessionInit";
import { isConfigShortcut } from "./lib/configShortcut";
import {
  createRepositoryAssistantMessage,
  createDefaultRepositoryAssistantSettings,
  createRepositoryAssistantSettingsFromConfig,
  isEditableShortcutTarget,
  isRepositoryAssistantShortcut,
  normalizeRepositoryAssistantSettings,
  toRepositoryAssistantConfigPatch,
} from "./lib/repositoryAssistant";
import type {
  AiGenerationConfig,
  AppConfig,
  Repository,
  RepositoryAssistantMessage,
  RepositoryAssistantSettings,
} from "./types";

interface RepositoryAssistantConversationState {
  messages: RepositoryAssistantMessage[];
  draft: string;
  pending: boolean;
  error: string | null;
}

function createEmptyRepositoryAssistantConversationState(): RepositoryAssistantConversationState {
  return {
    messages: [],
    draft: "",
    pending: false,
    error: null,
  };
}

function getRepositoryAssistantConversationState(
  conversations: Record<string, RepositoryAssistantConversationState>,
  repoPath: string,
): RepositoryAssistantConversationState {
  return conversations[repoPath] ?? createEmptyRepositoryAssistantConversationState();
}

function createRepositoryAssistantConversationStateFromPersisted(
  conversation: PersistedRepositoryAssistantConversation,
): RepositoryAssistantConversationState {
  return {
    messages: conversation.messages,
    draft: conversation.draft,
    pending: false,
    error: null,
  };
}

function createInitialRepositoryAssistantConversations(
  session: PersistedAppSession,
): Record<string, RepositoryAssistantConversationState> {
  return Object.fromEntries(
    Object.entries(session.repositoryAssistantConversations).map(([repoPath, conversation]) => [
      repoPath,
      createRepositoryAssistantConversationStateFromPersisted(conversation),
    ]),
  );
}

function createPersistedRepositoryAssistantConversations(
  conversations: Record<string, RepositoryAssistantConversationState>,
): Record<string, PersistedRepositoryAssistantConversation> {
  return Object.entries(conversations).reduce<
    Record<string, PersistedRepositoryAssistantConversation>
  >((accumulator, [repoPath, conversation]) => {
    if (conversation.messages.length === 0 && conversation.draft.length === 0) {
      return accumulator;
    }

    accumulator[repoPath] = {
      messages: conversation.messages,
      draft: conversation.draft,
    };
    return accumulator;
  }, {});
}

export default function App(): JSX.Element {
  const [initialPersistedAppSession] = useState<PersistedAppSession>(getInitialPersistedAppSession);
  const [activeTabId, setActiveTabId] = useState<AppTabId>(DASHBOARD_TAB_ID);
  const [appTheme, setAppTheme] = useState<AppThemeId>(initialPersistedAppSession.appThemeId);
  const [query, setQuery] = useState("");
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loadingRepositories, setLoadingRepositories] = useState(false);
  const [openRepositories, setOpenRepositories] = useState<Repository[]>([]);
  const [hasInitializedSession, setHasInitializedSession] = useState(false);
  const [repositoryBranchLabels, setRepositoryBranchLabels] = useState<
    Record<string, string | null>
  >({});
  const [hasVisitedConfig, setHasVisitedConfig] = useState(false);
  const [lastRepositoryPath, setLastRepositoryPath] = useState<string | null>(null);
  const [githubButtonUrl, setGithubButtonUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>("");
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [_aiGenerationConfig, setAiGenerationConfig] = useState<AiGenerationConfig | null>(null);
  const [commandPaletteOpenRequestId, setCommandPaletteOpenRequestId] = useState(0);
  const [isRepositoryAssistantOpen, setRepositoryAssistantOpen] = useState(
    initialPersistedAppSession.isRepositoryAssistantOpen,
  );
  const [repositoryAssistantConversations, setRepositoryAssistantConversations] = useState<
    Record<string, RepositoryAssistantConversationState>
  >(() => createInitialRepositoryAssistantConversations(initialPersistedAppSession));
  const [repositoryAssistantSettings, setRepositoryAssistantSettings] =
    useState<RepositoryAssistantSettings>(() => createDefaultRepositoryAssistantSettings(null));
  const repositoryAssistantSettingsSaveRequestIdRef = useRef(0);

  const isDashboardActive = activeTabId === DASHBOARD_TAB_ID;
  const isConfigActive = activeTabId === CONFIG_TAB_ID;
  const activeRepository = useMemo(
    () => findRepositoryForTab(openRepositories, activeTabId),
    [activeTabId, openRepositories],
  );
  const githubButtonRepository = useMemo(
    () => resolveGithubButtonRepository(openRepositories, activeTabId, lastRepositoryPath),
    [activeTabId, lastRepositoryPath, openRepositories],
  );
  const configEscapeTabId = useMemo(
    () => resolveConfigEscapeTabId(openRepositories, lastRepositoryPath),
    [lastRepositoryPath, openRepositories],
  );
  const configReturnTabId = configEscapeTabId ?? DASHBOARD_TAB_ID;
  const activeThemeLabel = getAppThemeLabel(appTheme);
  const isTauriDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const activeRepositoryAssistantConversation = useMemo(
    () =>
      activeRepository
        ? getRepositoryAssistantConversationState(
            repositoryAssistantConversations,
            activeRepository.path,
          )
        : null,
    [activeRepository, repositoryAssistantConversations],
  );

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.body.dataset.theme = appTheme;
      document.body.dataset.themeMode = getAppThemeMode(appTheme);
      document.body.dataset.windowChrome = isTauriDesktop ? "overlay-titlebar" : "default";
    }

    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(APP_THEME_STORAGE_KEY, appTheme);
    } catch {
      // Ignore storage failures and keep the in-memory theme.
    }
  }, [appTheme, isTauriDesktop]);

  useEffect(() => {
    void api.syncWindowAppearance(getNativeWindowAppearance(appTheme)).catch(() => {
      // Ignore native window sync failures so the webview theme can still update.
    });
  }, [appTheme]);

  useEffect(() => {
    if (typeof window === "undefined") {
      setHasInitializedSession(true);
      return;
    }

    const launchState = getInitialLaunchState(window.location.search);
    const repoPathsToRestore = launchState.repoPath
      ? [launchState.repoPath]
      : initialPersistedAppSession.openRepositoryPaths;
    const preferredActiveTabId =
      launchState.activeTabIdOverride ?? initialPersistedAppSession.activeTabId;

    if (repoPathsToRestore.length === 0) {
      setActiveTabId(resolveRestoredActiveTabId([], preferredActiveTabId));
      setHasInitializedSession(true);
      return;
    }

    if (launchState.repoPath) {
      const restoredRepositories = repoPathsToRestore.map(createRepositoryStub);
      setOpenRepositories(restoredRepositories);
      setActiveTabId(resolveRestoredActiveTabId(restoredRepositories, preferredActiveTabId));
      setHasInitializedSession(true);
      return;
    }

    let active = true;

    void (async () => {
      try {
        const response = await api.resolveRepositories(repoPathsToRestore);
        if (!active) {
          return;
        }

        setOpenRepositories(response.repositories);
        setActiveTabId(resolveRestoredActiveTabId(response.repositories, preferredActiveTabId));
      } catch (error) {
        if (!active) {
          return;
        }

        const fallbackRepositories = repoPathsToRestore.map(createRepositoryStub);
        setOpenRepositories(fallbackRepositories);
        setActiveTabId(resolveRestoredActiveTabId(fallbackRepositories, preferredActiveTabId));
        setNotice(
          error instanceof Error ? error.message : "前回開いていたリポジトリの復元に失敗しました。",
        );
      }

      if (active) {
        setHasInitializedSession(true);
      }
    })();

    return () => {
      active = false;
    };
  }, [initialPersistedAppSession]);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const config = await api.getConfig();
        if (active) {
          setAppConfig(config);
          setAiGenerationConfig(
            (current: AiGenerationConfig | null) => current ?? pickAiGenerationConfig(config),
          );
        }
      } catch (error) {
        if (active) {
          setNotice(error instanceof Error ? error.message : "設定の読み込みに失敗しました。");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!appConfig) {
      return;
    }

    setRepositoryAssistantSettings((current) => {
      const normalized = createRepositoryAssistantSettingsFromConfig(appConfig);

      return current.openAiModel === normalized.openAiModel &&
        current.reasoningEffort === normalized.reasoningEffort
        ? current
        : normalized;
    });
  }, [appConfig]);

  useEffect(() => {
    if (!activeRepository) {
      return;
    }

    setLastRepositoryPath((current) =>
      current === activeRepository.path ? current : activeRepository.path,
    );
  }, [activeRepository]);

  useEffect(() => {
    if (!githubButtonRepository) {
      setGithubButtonUrl(null);
      return;
    }

    let active = true;
    setGithubButtonUrl(null);

    void (async () => {
      try {
        const response = await api.getRepositoryGithubUrl(githubButtonRepository.path);
        if (active) {
          setGithubButtonUrl(response.url ?? null);
        }
      } catch {
        if (active) {
          setGithubButtonUrl(null);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [githubButtonRepository]);

  useEffect(() => {
    if (!isConfigActive || !configEscapeTabId || typeof window === "undefined") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      setActiveTabId(configEscapeTabId);
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [configEscapeTabId, isConfigActive]);

  useEffect(() => {
    if (!hasInitializedSession || activeRepository) {
      return;
    }

    setRepositoryAssistantOpen(false);
  }, [activeRepository, hasInitializedSession]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        !activeRepository ||
        isEditableShortcutTarget(event.target) ||
        !isRepositoryAssistantShortcut(event)
      ) {
        return;
      }

      event.preventDefault();
      setRepositoryAssistantOpen((current) => !current);
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeRepository]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !isConfigShortcut(event)) {
        return;
      }

      event.preventDefault();
      setActiveTabId((current) => (current === CONFIG_TAB_ID ? configReturnTabId : CONFIG_TAB_ID));
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [configReturnTabId]);

  useEffect(() => {
    if (!isDashboardActive) {
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      setLoadingRepositories(true);
      try {
        const response = await api.getRepositories(query);
        if (!active) {
          return;
        }
        setRepositories(response.repositories);
      } catch (error) {
        if (active) {
          setNotice(
            error instanceof Error ? error.message : "リポジトリ一覧の取得に失敗しました。",
          );
        }
      } finally {
        if (active) {
          setLoadingRepositories(false);
        }
      }
    }, 220);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [appConfig?.repositoryScanDepth, isDashboardActive, query]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = setTimeout(() => {
      setNotice("");
    }, 3000);

    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (isConfigActive) {
      setHasVisitedConfig(true);
    }
  }, [isConfigActive]);

  useEffect(() => {
    if (!hasInitializedSession || typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(
        APP_SESSION_STORAGE_KEY,
        JSON.stringify(
          serializeAppSession(openRepositories, activeTabId, appTheme, {
            isRepositoryAssistantOpen,
            repositoryAssistantConversations: createPersistedRepositoryAssistantConversations(
              repositoryAssistantConversations,
            ),
          }),
        ),
      );
    } catch {
      // Ignore storage failures and keep the in-memory session.
    }
  }, [
    activeTabId,
    appTheme,
    hasInitializedSession,
    isRepositoryAssistantOpen,
    openRepositories,
    repositoryAssistantConversations,
  ]);

  const handleSelectRepository = (repository: Repository): void => {
    void api.markRecentRepository(repository.path);
    setOpenRepositories((current) => upsertRepositoryTab(current, repository));
    setLastRepositoryPath(repository.path);
    setActiveTabId(getRepositoryTabId(repository.path));
  };

  const handleCloseRepository = (repository: Repository): void => {
    const result = closeRepositoryTab(openRepositories, repository.path, activeTabId);
    setOpenRepositories(result.repositories);
    setActiveTabId(result.activeTabId);
    setRepositoryBranchLabels((current) => {
      if (!(repository.path in current)) {
        return current;
      }

      const next = { ...current };
      delete next[repository.path];
      return next;
    });
  };

  const handleRepositoryBranchChange = useCallback(
    (repoPath: string, branchName: string | null): void => {
      const nextBranchLabel = getRepositoryTabBranchLabel(branchName);
      setRepositoryBranchLabels((current) =>
        current[repoPath] === nextBranchLabel
          ? current
          : {
              ...current,
              [repoPath]: nextBranchLabel,
            },
      );
    },
    [],
  );

  const handleOpenGithubRepository = async (): Promise<void> => {
    if (!githubButtonUrl) {
      return;
    }

    try {
      await api.openExternalUrl(githubButtonUrl);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "GitHub を開けませんでした。");
    }
  };

  const handleOpenCommandPalette = (): void => {
    if (!activeRepository) {
      return;
    }

    setCommandPaletteOpenRequestId((current) => current + 1);
  };

  const handleOpenConfig = useCallback((): void => {
    setActiveTabId(CONFIG_TAB_ID);
  }, []);

  const handleSelectAppTheme = useCallback((themeId: AppThemeId): void => {
    setAppTheme(normalizeAppTheme(themeId));
  }, []);

  const handleAssistantDraftChange = (value: string): void => {
    if (!activeRepository) {
      return;
    }

    setRepositoryAssistantConversations((current) => ({
      ...current,
      [activeRepository.path]: {
        ...getRepositoryAssistantConversationState(current, activeRepository.path),
        draft: value,
        error: null,
      },
    }));
  };

  const handleRepositoryAssistantSettingsChange = useCallback(
    (value: RepositoryAssistantSettings): void => {
      const normalized = normalizeRepositoryAssistantSettings(
        value,
        appConfig?.repositoryAssistantOpenAiModel ?? appConfig?.openAiModel ?? null,
      );

      if (
        repositoryAssistantSettings.openAiModel === normalized.openAiModel &&
        repositoryAssistantSettings.reasoningEffort === normalized.reasoningEffort
      ) {
        return;
      }

      setRepositoryAssistantSettings(normalized);

      repositoryAssistantSettingsSaveRequestIdRef.current += 1;
      const requestId = repositoryAssistantSettingsSaveRequestIdRef.current;

      void api
        .saveConfig(toRepositoryAssistantConfigPatch(normalized))
        .then((response) => {
          if (
            requestId !== repositoryAssistantSettingsSaveRequestIdRef.current ||
            !response.config
          ) {
            return;
          }

          setAppConfig(response.config);
        })
        .catch((error) => {
          if (requestId !== repositoryAssistantSettingsSaveRequestIdRef.current) {
            return;
          }

          setNotice(error instanceof Error ? error.message : "AI chat 設定の保存に失敗しました。");
        });
    },
    [appConfig, repositoryAssistantSettings],
  );

  const handleClearAssistantConversation = (): void => {
    if (!activeRepository) {
      return;
    }

    setRepositoryAssistantConversations((current) => ({
      ...current,
      [activeRepository.path]: createEmptyRepositoryAssistantConversationState(),
    }));
  };

  const handleSubmitAssistantConversation = (): void => {
    if (!activeRepository || !activeRepositoryAssistantConversation) {
      return;
    }

    if (!appConfig?.openAiToken.trim()) {
      const message = "AI sidebar には Config の OpenAI token が必要です。";
      setRepositoryAssistantConversations((current) => ({
        ...current,
        [activeRepository.path]: {
          ...getRepositoryAssistantConversationState(current, activeRepository.path),
          error: message,
        },
      }));
      setNotice(message);
      return;
    }

    const repoPath = activeRepository.path;
    const draft = activeRepositoryAssistantConversation.draft.trim();
    if (!draft || activeRepositoryAssistantConversation.pending) {
      return;
    }

    const userMessage = createRepositoryAssistantMessage("user", draft);
    const nextMessages = [...activeRepositoryAssistantConversation.messages, userMessage];

    setRepositoryAssistantConversations((current) => ({
      ...current,
      [repoPath]: {
        ...getRepositoryAssistantConversationState(current, repoPath),
        messages: nextMessages,
        draft: "",
        pending: true,
        error: null,
      },
    }));

    void api
      .chatWithRepositoryAssistant(repoPath, nextMessages, repositoryAssistantSettings)
      .then((response) => {
        setRepositoryAssistantConversations((current) => ({
          ...current,
          [repoPath]: {
            ...getRepositoryAssistantConversationState(current, repoPath),
            messages: [...nextMessages, response.message],
            pending: false,
            error: null,
          },
        }));
      })
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : "AI chat への問い合わせに失敗しました。";
        setRepositoryAssistantConversations((current) => ({
          ...current,
          [repoPath]: {
            ...getRepositoryAssistantConversationState(current, repoPath),
            messages: nextMessages,
            pending: false,
            error: message,
          },
        }));
        setNotice(message);
      });
  };

  return (
    <main className="app-shell">
      <header className="app-tabbar">
        <div className="app-tabbar__drag-region" data-tauri-drag-region />
        <div className="app-tabbar__content">
          <div className="app-tabbar__lane">
            {openRepositories.length > 0 ? (
              <div className="app-tab-toggle" aria-label="Open repositories">
                {openRepositories.map((repository) => {
                  const tabId = getRepositoryTabId(repository.path);
                  const isActive = activeTabId === tabId;
                  const branchLabel = repositoryBranchLabels[repository.path];
                  return (
                    <div
                      key={repository.path}
                      className={`app-tab-toggle__option ${isActive ? "is-active" : ""}`}
                    >
                      <button
                        type="button"
                        className="app-tab-toggle__trigger"
                        onClick={() => setActiveTabId(tabId)}
                        title={repository.path}
                        aria-pressed={isActive}
                      >
                        <FolderGit2 size={16} className="shrink-0" />
                        <span className="app-tab-toggle__text">
                          <span className="app-tab__label">{repository.name}</span>
                          {branchLabel ? (
                            <AppTabBranchBadge
                              label={branchLabel}
                              title={`現在のチェックアウトブランチ: ${branchLabel}`}
                            />
                          ) : null}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="app-tab__close"
                        aria-label={`${repository.name} タブを閉じる`}
                        title={`${repository.name} タブを閉じる`}
                        onClick={() => handleCloseRepository(repository)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <button
              type="button"
              className={`app-tab app-tab--utility app-tab--action ${isDashboardActive ? "is-active" : ""}`}
              aria-label="repository を追加"
              title="repository を追加"
              onClick={() => setActiveTabId(DASHBOARD_TAB_ID)}
            >
              <Plus size={16} />
            </button>
          </div>

          <div className="app-tabbar__actions">
            <button
              type="button"
              className="app-toolbar-button"
              aria-label="Command Palette"
              title="Command Palette (Cmd/Ctrl + P)"
              disabled={!activeRepository}
              onClick={handleOpenCommandPalette}
            >
              <Search size={16} />
              <span className="app-toolbar-button__label">Palette</span>
              <span className="app-toolbar-button__shortcut">Cmd + P</span>
            </button>
            <button
              type="button"
              className={`app-toolbar-button ${isRepositoryAssistantOpen ? "is-active" : ""}`}
              aria-label="AI sidebar"
              title="AI sidebar (Cmd/Ctrl + I)"
              disabled={!activeRepository}
              onClick={() => setRepositoryAssistantOpen((current) => !current)}
            >
              <Bot size={16} />
              <span className="app-toolbar-button__label">Assistant</span>
              <span className="app-toolbar-button__shortcut">Cmd + I</span>
            </button>
            <label
              className="app-theme-picker app-tab--utility"
              title={`Theme: ${activeThemeLabel}`}
            >
              <select
                className="app-theme-picker__select"
                aria-label="Application theme"
                value={appTheme}
                onChange={(event) => handleSelectAppTheme(normalizeAppTheme(event.target.value))}
              >
                {APP_THEME_OPTIONS.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {theme.label}
                  </option>
                ))}
              </select>
              <span className="app-theme-picker__chevron" aria-hidden="true">
                ▾
              </span>
            </label>
            {githubButtonUrl ? (
              <button
                type="button"
                className="app-tab app-tab--utility app-tab--icon"
                aria-label={`${githubButtonRepository?.name ?? "Repository"} を GitHub で開く`}
                title={`${githubButtonRepository?.name ?? "Repository"} を GitHub で開く`}
                onClick={() => {
                  void handleOpenGithubRepository();
                }}
              >
                <ExternalLink size={18} />
              </button>
            ) : null}
            <button
              type="button"
              className={`app-tab app-tab--utility app-tab--icon ${isConfigActive ? "is-active" : ""}`}
              aria-label="Config"
              title="Config (Cmd/Ctrl + ,)"
              onClick={handleOpenConfig}
            >
              <Cog size={18} />
            </button>
          </div>
        </div>
      </header>

      <div
        className={`app-content-shell ${
          isRepositoryAssistantOpen && activeRepository ? "is-assistant-open" : ""
        }`}
      >
        <div className="app-view-stack">
          <section className="h-full" hidden={!isDashboardActive} aria-hidden={!isDashboardActive}>
            <DashboardView
              repositories={repositories}
              query={query}
              loading={loadingRepositories}
              onQueryChange={setQuery}
              onSelectRepository={handleSelectRepository}
            />
          </section>

          {openRepositories.map((repository) => {
            const tabId = getRepositoryTabId(repository.path);
            const isActive = activeTabId === tabId;

            return (
              <section
                key={repository.path}
                className="h-full"
                hidden={!isActive}
                aria-hidden={!isActive}
              >
                <ControllerView
                  repository={repository}
                  appConfig={appConfig}
                  appThemeId={appTheme}
                  onOpenConfig={handleOpenConfig}
                  onSelectTheme={handleSelectAppTheme}
                  onNotify={setNotice}
                  onCurrentBranchChange={handleRepositoryBranchChange}
                  active={isActive}
                  repositoryGithubUrl={isActive ? githubButtonUrl : null}
                  commandPaletteOpenRequestId={commandPaletteOpenRequestId}
                />
              </section>
            );
          })}

          {isConfigActive || hasVisitedConfig ? (
            <section className="h-full" hidden={!isConfigActive} aria-hidden={!isConfigActive}>
              <ConfigView
                config={appConfig}
                onNotify={setNotice}
                onAiGenerationConfigChange={setAiGenerationConfig}
                onConfigSaved={(config) => {
                  setAppConfig(config);
                  setAiGenerationConfig(pickAiGenerationConfig(config));
                }}
              />
            </section>
          ) : null}
        </div>

        {activeRepository && activeRepositoryAssistantConversation ? (
          <RepositoryAssistantSidebar
            open={isRepositoryAssistantOpen}
            openAiToken={appConfig?.openAiToken ?? ""}
            settings={repositoryAssistantSettings}
            messages={activeRepositoryAssistantConversation.messages}
            draft={activeRepositoryAssistantConversation.draft}
            pending={activeRepositoryAssistantConversation.pending}
            error={
              appConfig?.openAiToken.trim()
                ? activeRepositoryAssistantConversation.error
                : "AI sidebar には Config の OpenAI token が必要です。"
            }
            onSettingsChange={handleRepositoryAssistantSettingsChange}
            onDraftChange={handleAssistantDraftChange}
            onSubmit={handleSubmitAssistantConversation}
            onClearConversation={handleClearAssistantConversation}
            onClose={() => setRepositoryAssistantOpen(false)}
          />
        ) : null}
      </div>

      {notice ? (
        <div className="fixed bottom-4 left-1/2 z-50 w-fit -translate-x-1/2 rounded-full bg-[#111827] px-4 py-2 text-sm text-white shadow-lg">
          {notice}
        </div>
      ) : null}
    </main>
  );
}
