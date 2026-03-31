import {
  CONFIG_TAB_ID,
  DASHBOARD_TAB_ID,
  getRepositoryTabId,
  parsePersistedAppSession,
  type AppTabId,
  type PersistedAppSession,
} from "./appTabs";
import { normalizeAppTheme } from "./appTheme";
import type { AiGenerationConfig, AppConfig } from "../types";

const APP_SESSION_STORAGE_KEY = "git-chat-ui.app-session";
const APP_THEME_STORAGE_KEY = "git-chat-ui.app-theme";

export { APP_SESSION_STORAGE_KEY, APP_THEME_STORAGE_KEY };

export function getInitialPersistedAppSession(): PersistedAppSession {
  if (typeof window === "undefined") {
    return parsePersistedAppSession(null);
  }

  try {
    const fallbackThemeId = normalizeAppTheme(window.localStorage.getItem(APP_THEME_STORAGE_KEY));
    return parsePersistedAppSession(
      window.localStorage.getItem(APP_SESSION_STORAGE_KEY),
      fallbackThemeId,
    );
  } catch {
    return parsePersistedAppSession(null);
  }
}

export function getInitialLaunchState(search: string): {
  repoPath: string | null;
  activeTabIdOverride: AppTabId | null;
} {
  const params = new URLSearchParams(search);
  const screen = params.get("screen")?.trim();
  const repoPath = params.get("repoPath")?.trim() || null;

  if (screen === CONFIG_TAB_ID) {
    return {
      repoPath,
      activeTabIdOverride: CONFIG_TAB_ID,
    };
  }

  if (screen === DASHBOARD_TAB_ID) {
    return {
      repoPath,
      activeTabIdOverride: DASHBOARD_TAB_ID,
    };
  }

  if (repoPath) {
    return {
      repoPath,
      activeTabIdOverride: getRepositoryTabId(repoPath),
    };
  }

  return {
    repoPath: null,
    activeTabIdOverride: null,
  };
}

export function pickAiGenerationConfig(config: AppConfig): AiGenerationConfig {
  return {
    openAiToken: config.openAiToken,
    openAiModel: config.openAiModel,
    claudeCodeToken: config.claudeCodeToken,
    selectedAiProvider: config.selectedAiProvider,
    commitTitlePrompt: config.commitTitlePrompt,
  };
}
