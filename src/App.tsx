import { Cog, ExternalLink, FolderGit2, Palette, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type JSX } from "react";

import { ConfigView } from "./components/ConfigView";
import { ControllerView } from "./components/ControllerView";
import { DashboardView } from "./components/DashboardView";
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
import type { AiGenerationConfig, AppConfig, Repository } from "./types";

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
  const activeThemeLabel = getAppThemeLabel(appTheme);
  const isTauriDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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
        JSON.stringify(serializeAppSession(openRepositories, activeTabId, appTheme)),
      );
    } catch {
      // Ignore storage failures and keep the in-memory session.
    }
  }, [activeTabId, appTheme, hasInitializedSession, openRepositories]);

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
                            <span
                              className="app-tab__branch"
                              title={`現在のチェックアウトブランチ: ${branchLabel}`}
                            >
                              {branchLabel}
                            </span>
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
            <label
              className="app-theme-picker app-tab--utility"
              title={`Theme: ${activeThemeLabel}`}
            >
              <Palette size={15} className="app-theme-picker__icon" />
              <select
                className="app-theme-picker__select"
                aria-label="Application theme"
                value={appTheme}
                onChange={(event) => setAppTheme(normalizeAppTheme(event.target.value))}
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
              title="Config"
              onClick={() => setActiveTabId(CONFIG_TAB_ID)}
            >
              <Cog size={18} />
            </button>
          </div>
        </div>
      </header>

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
                onNotify={setNotice}
                onCurrentBranchChange={handleRepositoryBranchChange}
                active={isActive}
                repositoryGithubUrl={isActive ? githubButtonUrl : null}
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

      {notice ? (
        <div className="fixed bottom-4 left-1/2 z-50 w-fit -translate-x-1/2 rounded-full bg-[#111827] px-4 py-2 text-sm text-white shadow-lg">
          {notice}
        </div>
      ) : null}
    </main>
  );
}
