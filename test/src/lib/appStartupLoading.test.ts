import { afterEach, describe, expect, test } from "bun:test";

import {
  beginAppRepositoryLoad,
  createInitialAppStartupLoadState,
  getAppStartupLoadingMessage,
  isAppStartupLoadingVisible,
  settleAppStartupLoadState,
  syncAppStartupLoadState,
  type AppStartupLoadState,
} from "../../../src/lib/appStartupLoading";

const originalWindow = globalThis.window;

afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
    return;
  }

  Object.defineProperty(globalThis, "window", {
    value: originalWindow,
    configurable: true,
    writable: true,
  });
});

describe("appStartupLoading", () => {
  test("starts as ready during server rendering", () => {
    delete (globalThis as { window?: unknown }).window;

    expect(createInitialAppStartupLoadState()).toEqual({
      phase: "ready",
      pendingRepositoryPath: null,
    });
  });

  test("moves from session to controller when an active repository is being restored", () => {
    const initialState: AppStartupLoadState = {
      phase: "session",
      pendingRepositoryPath: null,
    };

    expect(
      syncAppStartupLoadState(initialState, {
        hasInitializedSession: true,
        activeRepositoryPath: "/tmp/repo",
      }),
    ).toEqual({
      phase: "controller",
      pendingRepositoryPath: "/tmp/repo",
    });
  });

  test("finishes startup immediately when no repository tab is restored", () => {
    const initialState: AppStartupLoadState = {
      phase: "session",
      pendingRepositoryPath: null,
    };

    expect(
      syncAppStartupLoadState(initialState, {
        hasInitializedSession: true,
        activeRepositoryPath: null,
      }),
    ).toEqual({
      phase: "ready",
      pendingRepositoryPath: null,
    });
  });

  test("settles only when the active startup repository finishes loading", () => {
    const initialState: AppStartupLoadState = {
      phase: "controller",
      pendingRepositoryPath: "/tmp/repo-a",
    };

    expect(
      settleAppStartupLoadState(initialState, {
        repoPath: "/tmp/repo-b",
        activeRepositoryPath: "/tmp/repo-a",
      }),
    ).toEqual(initialState);

    expect(
      settleAppStartupLoadState(initialState, {
        repoPath: "/tmp/repo-a",
        activeRepositoryPath: "/tmp/repo-a",
      }),
    ).toEqual({
      phase: "ready",
      pendingRepositoryPath: null,
    });
  });

  test("tracks repository loads triggered after startup separately from session restore", () => {
    expect(
      beginAppRepositoryLoad(
        {
          phase: "ready",
          pendingRepositoryPath: null,
        },
        "/tmp/repo-b",
      ),
    ).toEqual({
      phase: "repository",
      pendingRepositoryPath: "/tmp/repo-b",
    });
  });

  test("shows repository transition loading only while the pending repository is active", () => {
    const loadingState: AppStartupLoadState = {
      phase: "repository",
      pendingRepositoryPath: "/tmp/repo-a",
    };

    expect(isAppStartupLoadingVisible(loadingState, "/tmp/repo-a")).toBe(true);
    expect(isAppStartupLoadingVisible(loadingState, "/tmp/repo-b")).toBe(false);
    expect(isAppStartupLoadingVisible(loadingState, null)).toBe(false);
  });

  test("uses the current active repository as a fallback before controller tracking is installed", () => {
    expect(
      settleAppStartupLoadState(
        {
          phase: "session",
          pendingRepositoryPath: null,
        },
        {
          repoPath: "/tmp/repo",
          activeRepositoryPath: "/tmp/repo",
        },
      ),
    ).toEqual({
      phase: "ready",
      pendingRepositoryPath: null,
    });
  });

  test("describes each startup phase with a user-facing message", () => {
    expect(getAppStartupLoadingMessage("session")).toContain("復元");
    expect(getAppStartupLoadingMessage("controller")).toContain("Branch list");
    expect(getAppStartupLoadingMessage("repository")).toContain("選択したリポジトリ");
    expect(getAppStartupLoadingMessage("ready")).toBe("");
  });
});
