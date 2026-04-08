import {
  CONFIG_TAB_ID,
  DASHBOARD_TAB_ID,
  getRepositoryTabId,
  parsePersistedAppSession,
  type AppTabId,
  type PersistedAppSession,
} from "./appTabs";
import { normalizeAppTheme } from "./appTheme";
import type { AiGenerationConfig, AppConfig, RepositoryAssistantUserProfile } from "../types";

const APP_SESSION_STORAGE_KEY = "git-chat-ui.app-session";
const APP_THEME_STORAGE_KEY = "git-chat-ui.app-theme";
const ASSISTANT_USER_PROFILES_STORAGE_KEY = "git-chat-ui.assistant-user-profiles";

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

function isRepositoryAssistantUserProfile(
  value: unknown,
): value is RepositoryAssistantUserProfile {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    (typeof candidate.login === "string" || candidate.login === null) &&
    (typeof candidate.avatarUrl === "string" || candidate.avatarUrl === null)
  );
}

export function loadPersistedAssistantUserProfiles(): Record<
  string,
  RepositoryAssistantUserProfile
> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(ASSISTANT_USER_PROFILES_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }

    const result: Record<string, RepositoryAssistantUserProfile> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isRepositoryAssistantUserProfile(value)) {
        result[key] = value;
      }
    }

    return result;
  } catch {
    return {};
  }
}

export function persistAssistantUserProfiles(
  profiles: Record<string, RepositoryAssistantUserProfile>,
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(ASSISTANT_USER_PROFILES_STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    // Ignore storage failures.
  }
}
