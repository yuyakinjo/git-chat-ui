export type AppStartupLoadPhase = "session" | "controller" | "ready";

export interface AppStartupLoadState {
  phase: AppStartupLoadPhase;
  pendingRepositoryPath: string | null;
}

export function createInitialAppStartupLoadState(): AppStartupLoadState {
  if (typeof window === "undefined") {
    return {
      phase: "ready",
      pendingRepositoryPath: null,
    };
  }

  return {
    phase: "session",
    pendingRepositoryPath: null,
  };
}

export function syncAppStartupLoadState(
  current: AppStartupLoadState,
  options: {
    hasInitializedSession: boolean;
    activeRepositoryPath: string | null;
  },
): AppStartupLoadState {
  if (current.phase !== "session" || !options.hasInitializedSession) {
    return current;
  }

  if (!options.activeRepositoryPath) {
    return {
      phase: "ready",
      pendingRepositoryPath: null,
    };
  }

  return {
    phase: "controller",
    pendingRepositoryPath: options.activeRepositoryPath,
  };
}

export function settleAppStartupLoadState(
  current: AppStartupLoadState,
  options: {
    repoPath: string;
    activeRepositoryPath: string | null;
  },
): AppStartupLoadState {
  if (current.phase === "ready") {
    return current;
  }

  const expectedRepositoryPath = current.pendingRepositoryPath ?? options.activeRepositoryPath;
  if (!expectedRepositoryPath || expectedRepositoryPath !== options.repoPath) {
    return current;
  }

  return {
    phase: "ready",
    pendingRepositoryPath: null,
  };
}

export function getAppStartupLoadingMessage(phase: AppStartupLoadPhase): string {
  switch (phase) {
    case "session":
      return "前回開いていたリポジトリを復元しています。";
    case "controller":
      return "Branch list と初期状態を読み込んでいます。";
    case "ready":
    default:
      return "";
  }
}
