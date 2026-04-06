import { spawn } from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

import { type CodexAppServerNotification, type ListThreadsOptions } from "./codexAppServer";
import {
  type CodexThreadSummary,
  getThreadTaskPaths,
  syncThreadTaskDirectories,
  type SyncThreadTaskDirectoriesResult,
} from "./codexTaskFolders";

export const WATCH_DEFAULT_INTERVAL_SECONDS = 15;
export const LOCAL_ACTIVE_THREAD_MAX_AGE_HOURS = 72;

const THREAD_TASK_SYNC_NOTIFICATION_METHODS = new Set([
  "thread/started",
  "thread/archived",
  "thread/unarchived",
  "thread/closed",
  "thread/name/updated",
]);
const WATCHER_RUNTIME_DIRNAME = ".codex-task-sync";
const WATCHER_STATE_FILENAME = "watcher.json";
const WATCHER_LOG_FILENAME = "watcher.log";

interface ThreadTaskWatcherLogger {
  info(message: string): void;
  error(message: string): void;
}

export interface ThreadTaskWatcherClient {
  listThreads(options: ListThreadsOptions): Promise<CodexThreadSummary[]>;
  onClose(listener: (error?: Error) => void): () => void;
  onNotification(listener: (notification: CodexAppServerNotification) => void): () => void;
}

interface EnsureBackgroundThreadTaskWatcherOptions {
  intervalSeconds: number;
  repoRoot: string;
  scriptPath?: string;
}

interface WatchThreadTaskDirectoriesOptions {
  client: ThreadTaskWatcherClient;
  intervalSeconds: number;
  logger?: ThreadTaskWatcherLogger;
  repoRoot: string;
}

interface BackgroundThreadTaskWatcherState {
  intervalSeconds: number;
  lastHeartbeatAt?: string;
  logPath: string;
  pid: number;
  scriptMtimeMs?: number;
  scriptPath?: string;
  startedAt: string;
}

export interface EnsureBackgroundThreadTaskWatcherResult {
  logPath: string;
  pid: number;
  started: boolean;
  statePath: string;
}

interface WatcherRuntimePaths {
  logPath: string;
  runtimeDir: string;
  statePath: string;
}

interface WatcherScriptSignature {
  scriptMtimeMs?: number;
  scriptPath: string;
}

export async function runThreadTaskSync(
  client: ThreadTaskWatcherClient,
  repoRoot: string,
): Promise<SyncThreadTaskDirectoriesResult> {
  const [rawActiveThreads, archivedThreads] = await Promise.all([
    client.listThreads({ cwd: repoRoot, archived: false }),
    client.listThreads({ cwd: repoRoot, archived: true }),
  ]);
  const activeThreads = filterLocalActiveThreads(rawActiveThreads);

  return await syncThreadTaskDirectories({
    repoRoot,
    activeThreads,
    archivedThreads,
  });
}

export function filterLocalActiveThreads(
  threads: CodexThreadSummary[],
  options: {
    maxAgeHours?: number;
    nowMs?: number;
  } = {},
): CodexThreadSummary[] {
  const maxAgeHours = options.maxAgeHours ?? LOCAL_ACTIVE_THREAD_MAX_AGE_HOURS;
  if (maxAgeHours <= 0) {
    return [...threads];
  }

  const cutoffSeconds = Math.floor(
    ((options.nowMs ?? Date.now()) - maxAgeHours * 60 * 60 * 1000) / 1000,
  );

  return threads.filter((thread) => !thread.updatedAt || thread.updatedAt >= cutoffSeconds);
}

export function shouldSyncThreadTasksForNotification(
  notification: Pick<CodexAppServerNotification, "method">,
): boolean {
  return THREAD_TASK_SYNC_NOTIFICATION_METHODS.has(notification.method);
}

export function hasThreadTaskDirectoryChanges(result: SyncThreadTaskDirectoriesResult): boolean {
  return (
    result.createdActive.length > 0 ||
    result.movedToArchive.length > 0 ||
    result.orphanedToArchive.length > 0 ||
    result.restoredToActive.length > 0 ||
    result.unknownArchived.length > 0
  );
}

export function formatThreadTaskSyncSummary(
  repoRoot: string,
  result: SyncThreadTaskDirectoriesResult,
): string[] {
  const paths = getThreadTaskPaths(repoRoot);
  return [
    `active root: ${paths.activeRoot}`,
    `archived root: ${paths.archivedRoot}`,
    `created active: ${formatList(result.createdActive)}`,
    `moved to archive: ${formatList(result.movedToArchive)}`,
    `orphaned to archive: ${formatList(result.orphanedToArchive)}`,
    `restored to active: ${formatList(result.restoredToActive)}`,
    `unknown archived dirs: ${formatList(result.unknownArchived)}`,
  ];
}

export async function watchThreadTaskDirectories(
  options: WatchThreadTaskDirectoriesOptions,
): Promise<void> {
  const logger = options.logger ?? console;
  const initialResult = await runThreadTaskSync(options.client, options.repoRoot);
  await touchWatcherHeartbeat(options.repoRoot, options.intervalSeconds);
  logSyncSummary(logger, options.repoRoot, "startup", initialResult, true);

  let syncInFlight = false;
  let queuedTrigger: string | null = null;

  const scheduleSync = (trigger: string): void => {
    if (syncInFlight) {
      queuedTrigger = trigger;
      return;
    }

    syncInFlight = true;

    void (async () => {
      let nextTrigger: string | null = trigger;

      try {
        while (nextTrigger) {
          const currentTrigger = nextTrigger;
          queuedTrigger = null;
          const result = await runThreadTaskSync(options.client, options.repoRoot);
          await touchWatcherHeartbeat(options.repoRoot, options.intervalSeconds);
          logSyncSummary(logger, options.repoRoot, currentTrigger, result, false);
          nextTrigger = queuedTrigger;
        }
      } catch (error) {
        logger.error(
          `[codex-task-sync] sync failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        syncInFlight = false;
        if (queuedTrigger) {
          const pendingTrigger = queuedTrigger;
          queuedTrigger = null;
          scheduleSync(pendingTrigger);
        }
      }
    })();
  };

  const stopListening = options.client.onNotification((notification) => {
    if (!shouldSyncThreadTasksForNotification(notification)) {
      return;
    }

    scheduleSync(notification.method);
  });

  const timer = setInterval(() => {
    scheduleSync("interval");
  }, options.intervalSeconds * 1000);

  try {
    await new Promise<void>((resolve, reject) => {
      const stopCloseListener = options.client.onClose((error) => {
        stopCloseListener();
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  } finally {
    clearInterval(timer);
    stopListening();
  }
}

export async function ensureBackgroundThreadTaskWatcher(
  options: EnsureBackgroundThreadTaskWatcherOptions,
): Promise<EnsureBackgroundThreadTaskWatcherResult> {
  const runtimePaths = getWatcherRuntimePaths(options.repoRoot);
  await fsPromises.mkdir(runtimePaths.runtimeDir, { recursive: true });
  const scriptPath =
    options.scriptPath ?? path.join(options.repoRoot, "server", "codexThreadTasks.ts");
  const scriptSignature = await readWatcherScriptSignature(scriptPath);

  const existingState = await readWatcherState(runtimePaths.statePath);
  if (
    existingState &&
    shouldReuseWatcherState(existingState, {
      expectedIntervalSeconds: options.intervalSeconds,
      expectedScriptMtimeMs: scriptSignature.scriptMtimeMs,
      expectedScriptPath: scriptSignature.scriptPath,
    })
  ) {
    return {
      started: false,
      pid: existingState.pid,
      logPath: existingState.logPath,
      statePath: runtimePaths.statePath,
    };
  }

  if (existingState) {
    stopWatcherProcess(existingState.pid);
  }

  const logFile = fs.openSync(runtimePaths.logPath, "a");

  try {
    const child = spawn(
      process.execPath,
      [scriptPath, "watch", "--interval", String(options.intervalSeconds)],
      {
        cwd: options.repoRoot,
        detached: true,
        stdio: ["ignore", logFile, logFile],
      },
    );

    const pid = child.pid;
    if (!pid) {
      throw new Error("Failed to start Codex thread task watcher.");
    }

    child.unref();

    const state: BackgroundThreadTaskWatcherState = {
      pid,
      intervalSeconds: options.intervalSeconds,
      logPath: runtimePaths.logPath,
      lastHeartbeatAt: new Date().toISOString(),
      scriptMtimeMs: scriptSignature.scriptMtimeMs,
      scriptPath: scriptSignature.scriptPath,
      startedAt: new Date().toISOString(),
    };

    await fsPromises.writeFile(
      runtimePaths.statePath,
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8",
    );

    return {
      started: true,
      pid,
      logPath: runtimePaths.logPath,
      statePath: runtimePaths.statePath,
    };
  } finally {
    fs.closeSync(logFile);
  }
}

function getWatcherRuntimePaths(repoRoot: string): WatcherRuntimePaths {
  const { tasksRoot } = getThreadTaskPaths(repoRoot);
  const runtimeDir = path.join(tasksRoot, WATCHER_RUNTIME_DIRNAME);
  return {
    runtimeDir,
    statePath: path.join(runtimeDir, WATCHER_STATE_FILENAME),
    logPath: path.join(runtimeDir, WATCHER_LOG_FILENAME),
  };
}

async function readWatcherState(
  statePath: string,
): Promise<BackgroundThreadTaskWatcherState | null> {
  try {
    const raw = await fsPromises.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<BackgroundThreadTaskWatcherState>;
    if (typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid) || parsed.pid <= 0) {
      return null;
    }

    if (typeof parsed.logPath !== "string" || !parsed.logPath) {
      return null;
    }

    if (typeof parsed.intervalSeconds !== "number" || parsed.intervalSeconds <= 0) {
      return null;
    }

    return {
      pid: parsed.pid,
      logPath: parsed.logPath,
      intervalSeconds: parsed.intervalSeconds,
      lastHeartbeatAt:
        typeof parsed.lastHeartbeatAt === "string" ? parsed.lastHeartbeatAt : undefined,
      scriptMtimeMs:
        typeof parsed.scriptMtimeMs === "number" ? parsed.scriptMtimeMs : undefined,
      scriptPath: typeof parsed.scriptPath === "string" ? parsed.scriptPath : undefined,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function logSyncSummary(
  logger: ThreadTaskWatcherLogger,
  repoRoot: string,
  trigger: string,
  result: SyncThreadTaskDirectoriesResult,
  force: boolean,
): void {
  if (!force && !hasThreadTaskDirectoryChanges(result)) {
    return;
  }

  logger.info(`[codex-task-sync] ${trigger}`);
  for (const line of formatThreadTaskSyncSummary(repoRoot, result)) {
    logger.info(line);
  }
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "-";
}

function isWatcherStateFresh(state: BackgroundThreadTaskWatcherState): boolean {
  const lastSeenAt = Date.parse(state.lastHeartbeatAt ?? state.startedAt);
  if (Number.isNaN(lastSeenAt)) {
    return false;
  }

  const maxAgeMs = Math.max(state.intervalSeconds * 3000, 45_000);
  return Date.now() - lastSeenAt <= maxAgeMs;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EPERM"
    ) {
      return true;
    }

    return false;
  }
}

export function shouldReuseWatcherState(
  state: BackgroundThreadTaskWatcherState,
  options: {
    expectedIntervalSeconds: number;
    expectedScriptMtimeMs?: number;
    expectedScriptPath: string;
    isProcessAliveFn?: (pid: number) => boolean;
    nowMs?: number;
  },
): boolean {
  const lastSeenAt = Date.parse(state.lastHeartbeatAt ?? state.startedAt);
  if (Number.isNaN(lastSeenAt)) {
    return false;
  }

  const maxAgeMs = Math.max(state.intervalSeconds * 3000, 45_000);
  if ((options.nowMs ?? Date.now()) - lastSeenAt > maxAgeMs) {
    return false;
  }

  if (state.intervalSeconds !== options.expectedIntervalSeconds) {
    return false;
  }

  if (!(options.isProcessAliveFn ?? isProcessAlive)(state.pid)) {
    return false;
  }

  if (state.scriptPath !== options.expectedScriptPath) {
    return false;
  }

  if (state.scriptMtimeMs !== options.expectedScriptMtimeMs) {
    return false;
  }

  return true;
}

async function touchWatcherHeartbeat(repoRoot: string, intervalSeconds: number): Promise<void> {
  const runtimePaths = getWatcherRuntimePaths(repoRoot);
  await fsPromises.mkdir(runtimePaths.runtimeDir, { recursive: true });

  const existingState = await readWatcherState(runtimePaths.statePath);
  const now = new Date().toISOString();
  const nextState: BackgroundThreadTaskWatcherState = {
    pid: process.pid,
    intervalSeconds,
    logPath: existingState?.logPath ?? runtimePaths.logPath,
    lastHeartbeatAt: now,
    scriptMtimeMs: existingState?.scriptMtimeMs,
    scriptPath: existingState?.scriptPath,
    startedAt: existingState?.startedAt ?? now,
  };

  await fsPromises.writeFile(
    runtimePaths.statePath,
    `${JSON.stringify(nextState, null, 2)}\n`,
    "utf8",
  );
}

async function readWatcherScriptSignature(scriptPath: string): Promise<WatcherScriptSignature> {
  const resolvedScriptPath = path.resolve(scriptPath);

  try {
    const stats = await fsPromises.stat(resolvedScriptPath);
    return {
      scriptPath: resolvedScriptPath,
      scriptMtimeMs: stats.mtimeMs,
    };
  } catch {
    return {
      scriptPath: resolvedScriptPath,
    };
  }
}

function stopWatcherProcess(pid: number): void {
  try {
    process.kill(pid);
  } catch {
    // Ignore missing or already-exited watcher processes.
  }
}
