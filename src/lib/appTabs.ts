import type { Repository } from "../types";

import { DEFAULT_APP_THEME, normalizeAppTheme, type AppThemeId } from "./appTheme";

const REPOSITORY_TAB_PREFIX = "repository:";

export const DASHBOARD_TAB_ID = "dashboard";
export const CONFIG_TAB_ID = "config";

export type AppTabId = typeof DASHBOARD_TAB_ID | typeof CONFIG_TAB_ID | `repository:${string}`;

export interface PersistedAppSession {
  openRepositoryPaths: string[];
  activeTabId: AppTabId;
  appThemeId: AppThemeId;
}

function createDefaultPersistedAppSession(
  appThemeId: AppThemeId = DEFAULT_APP_THEME,
): PersistedAppSession {
  return {
    openRepositoryPaths: [],
    activeTabId: DASHBOARD_TAB_ID,
    appThemeId,
  };
}

function parsePersistedAppThemeId(value: unknown, fallbackThemeId: AppThemeId): AppThemeId {
  if (typeof value !== "string") {
    return fallbackThemeId;
  }

  const normalizedThemeId = normalizeAppTheme(value);
  if (normalizedThemeId === DEFAULT_APP_THEME && value !== DEFAULT_APP_THEME) {
    return fallbackThemeId;
  }

  return normalizedThemeId;
}

export function getRepositoryTabId(repoPath: string): AppTabId {
  return `${REPOSITORY_TAB_PREFIX}${repoPath}` as AppTabId;
}

export function isRepositoryTabId(tabId: string): tabId is `repository:${string}` {
  return tabId.startsWith(REPOSITORY_TAB_PREFIX);
}

export function getRepositoryTabPath(tabId: string): string | null {
  if (!isRepositoryTabId(tabId)) {
    return null;
  }

  return tabId.slice(REPOSITORY_TAB_PREFIX.length);
}

export function getRepositoryTabBranchLabel(branchName: string | null | undefined): string | null {
  const normalized = branchName?.trim();
  if (!normalized) {
    return null;
  }

  return normalized === "HEAD" ? "detached" : normalized;
}

function normalizeOpenRepositoryPaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const repoPath = item.trim();
    if (!repoPath || seen.has(repoPath)) {
      continue;
    }

    seen.add(repoPath);
    normalized.push(repoPath);
  }

  return normalized;
}

function resolveActiveTabIdFromPaths(
  openRepositoryPaths: string[],
  activeTabId: string | null | undefined,
): AppTabId {
  if (activeTabId === CONFIG_TAB_ID || activeTabId === DASHBOARD_TAB_ID) {
    return activeTabId;
  }

  const repoPath = activeTabId ? getRepositoryTabPath(activeTabId) : null;
  if (repoPath && openRepositoryPaths.includes(repoPath)) {
    return getRepositoryTabId(repoPath);
  }

  return openRepositoryPaths[0] ? getRepositoryTabId(openRepositoryPaths[0]) : DASHBOARD_TAB_ID;
}

export function createRepositoryStub(repoPath: string): Repository {
  const segments = repoPath.split(/[\\/]+/).filter(Boolean);
  return {
    name: segments.at(-1) ?? repoPath,
    path: repoPath,
  };
}

export function serializeAppSession(
  openRepositories: Repository[],
  activeTabId: AppTabId,
  appThemeId: AppThemeId,
): PersistedAppSession {
  const openRepositoryPaths = normalizeOpenRepositoryPaths(
    openRepositories.map((repository) => repository.path),
  );
  return {
    openRepositoryPaths,
    activeTabId: resolveActiveTabIdFromPaths(openRepositoryPaths, activeTabId),
    appThemeId: normalizeAppTheme(appThemeId),
  };
}

export function parsePersistedAppSession(
  rawValue: string | null,
  fallbackThemeId: AppThemeId = DEFAULT_APP_THEME,
): PersistedAppSession {
  const normalizedFallbackThemeId = normalizeAppTheme(fallbackThemeId);

  if (!rawValue) {
    return createDefaultPersistedAppSession(normalizedFallbackThemeId);
  }

  try {
    const parsed = JSON.parse(rawValue) as {
      openRepositoryPaths?: unknown;
      activeTabId?: unknown;
      appThemeId?: unknown;
    };
    const openRepositoryPaths = normalizeOpenRepositoryPaths(parsed.openRepositoryPaths);

    return {
      openRepositoryPaths,
      activeTabId: resolveActiveTabIdFromPaths(
        openRepositoryPaths,
        typeof parsed.activeTabId === "string" ? parsed.activeTabId : null,
      ),
      appThemeId: parsePersistedAppThemeId(parsed.appThemeId, normalizedFallbackThemeId),
    };
  } catch {
    return createDefaultPersistedAppSession(normalizedFallbackThemeId);
  }
}

export function resolveRestoredActiveTabId(
  repositories: Repository[],
  preferredActiveTabId: AppTabId,
): AppTabId {
  return resolveActiveTabIdFromPaths(
    repositories.map((repository) => repository.path),
    preferredActiveTabId,
  );
}

export function upsertRepositoryTab(
  repositories: Repository[],
  repository: Repository,
): Repository[] {
  const existingIndex = repositories.findIndex((item) => item.path === repository.path);
  if (existingIndex === -1) {
    return [...repositories, repository];
  }

  return repositories.map((item, index) => (index === existingIndex ? repository : item));
}

export function findRepositoryForTab(repositories: Repository[], tabId: string): Repository | null {
  const repoPath = getRepositoryTabPath(tabId);
  if (!repoPath) {
    return null;
  }

  return repositories.find((repository) => repository.path === repoPath) ?? null;
}

export function resolveGithubButtonRepository(
  repositories: Repository[],
  activeTabId: AppTabId,
  lastRepositoryPath: string | null,
): Repository | null {
  const activeRepository = findRepositoryForTab(repositories, activeTabId);
  if (activeRepository) {
    return activeRepository;
  }

  if (activeTabId !== CONFIG_TAB_ID || !lastRepositoryPath) {
    return null;
  }

  return repositories.find((repository) => repository.path === lastRepositoryPath) ?? null;
}

export function resolveConfigEscapeTabId(
  repositories: Repository[],
  lastRepositoryPath: string | null,
): AppTabId | null {
  if (!lastRepositoryPath) {
    return null;
  }

  return repositories.some((repository) => repository.path === lastRepositoryPath)
    ? getRepositoryTabId(lastRepositoryPath)
    : null;
}

export function closeRepositoryTab(
  repositories: Repository[],
  repoPath: string,
  activeTabId: AppTabId,
): {
  repositories: Repository[];
  activeTabId: AppTabId;
} {
  const targetIndex = repositories.findIndex((repository) => repository.path === repoPath);
  if (targetIndex === -1) {
    return {
      repositories,
      activeTabId,
    };
  }

  const nextRepositories = repositories.filter((repository) => repository.path !== repoPath);
  if (activeTabId !== getRepositoryTabId(repoPath)) {
    return {
      repositories: nextRepositories,
      activeTabId,
    };
  }

  const previousRepository = nextRepositories[targetIndex - 1] ?? null;
  return {
    repositories: nextRepositories,
    activeTabId: previousRepository
      ? getRepositoryTabId(previousRepository.path)
      : DASHBOARD_TAB_ID,
  };
}
