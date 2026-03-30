import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { CodexAppServerNotification, ListThreadsOptions } from './codexAppServer';
import {
  ensureThreadTaskDirectory,
  getThreadTaskPaths,
  type CodexThreadSummary
} from './codexTaskFolders';
import {
  ensureBackgroundThreadTaskWatcher,
  shouldSyncThreadTasksForNotification,
  watchThreadTaskDirectories,
  type ThreadTaskWatcherClient
} from './codexThreadTaskWatcher';

async function createRepoRoot(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'git-chat-ui-codex-task-watcher-'));
}

class FakeThreadTaskWatcherClient implements ThreadTaskWatcherClient {
  activeThreads: CodexThreadSummary[] = [];
  archivedThreads: CodexThreadSummary[] = [];
  private readonly closeListeners = new Set<(error?: Error) => void>();
  private readonly notificationListeners = new Set<(notification: CodexAppServerNotification) => void>();

  async listThreads(options: ListThreadsOptions): Promise<CodexThreadSummary[]> {
    return options.archived ? [...this.archivedThreads] : [...this.activeThreads];
  }

  onClose(listener: (error?: Error) => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  onNotification(listener: (notification: CodexAppServerNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  emitClose(error?: Error): void {
    for (const listener of this.closeListeners) {
      listener(error);
    }
  }

  emitNotification(notification: CodexAppServerNotification): void {
    for (const listener of this.notificationListeners) {
      listener(notification);
    }
  }
}

describe('shouldSyncThreadTasksForNotification', () => {
  test('returns true for thread lifecycle updates that affect local task folders', () => {
    expect(shouldSyncThreadTasksForNotification({ method: 'thread/started' })).toBe(true);
    expect(shouldSyncThreadTasksForNotification({ method: 'thread/archived' })).toBe(true);
    expect(shouldSyncThreadTasksForNotification({ method: 'thread/unarchived' })).toBe(true);
    expect(shouldSyncThreadTasksForNotification({ method: 'thread/closed' })).toBe(true);
    expect(shouldSyncThreadTasksForNotification({ method: 'thread/name/updated' })).toBe(true);
  });

  test('ignores high-frequency notifications that do not change task folder placement', () => {
    expect(shouldSyncThreadTasksForNotification({ method: 'thread/status/changed' })).toBe(false);
    expect(shouldSyncThreadTasksForNotification({ method: 'thread/tokenUsage/updated' })).toBe(false);
    expect(shouldSyncThreadTasksForNotification({ method: 'turn/started' })).toBe(false);
  });
});

describe('watchThreadTaskDirectories', () => {
  test('reuses a watcher with a fresh heartbeat instead of spawning a duplicate process', async () => {
    const repoRoot = await createRepoRoot();

    try {
      const runtimeDir = path.join(repoRoot, 'tasks', '.codex-task-sync');
      const statePath = path.join(runtimeDir, 'watcher.json');
      const logPath = path.join(runtimeDir, 'watcher.log');
      await fs.mkdir(runtimeDir, { recursive: true });
      await fs.writeFile(
        statePath,
        `${JSON.stringify(
          {
            pid: 99999,
            intervalSeconds: 15,
            logPath,
            startedAt: new Date().toISOString(),
            lastHeartbeatAt: new Date().toISOString()
          },
          null,
          2
        )}\n`,
        'utf8'
      );

      const result = await ensureBackgroundThreadTaskWatcher({
        repoRoot,
        intervalSeconds: 15,
        scriptPath: path.join(repoRoot, 'missing-script.ts')
      });

      expect(result.started).toBe(false);
      expect(result.pid).toBe(99999);
      expect(result.logPath).toBe(logPath);
      expect(result.statePath).toBe(statePath);
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  test('moves active task folders into tasks/archived after thread/archived notification', async () => {
    const repoRoot = await createRepoRoot();
    const thread: CodexThreadSummary = {
      id: 'thr_watch_archive',
      name: 'Archive via notification',
      preview: 'Move local task folder when Codex thread is archived',
      createdAt: 1_743_380_000,
      updatedAt: 1_743_380_120
    };

    try {
      await ensureThreadTaskDirectory(repoRoot, thread);

      const client = new FakeThreadTaskWatcherClient();
      client.activeThreads = [thread];

      const watchPromise = watchThreadTaskDirectories({
        client,
        repoRoot,
        intervalSeconds: 60,
        logger: {
          info() {},
          error() {}
        }
      });

      await Bun.sleep(25);

      client.activeThreads = [];
      client.archivedThreads = [thread];
      client.emitNotification({
        method: 'thread/archived',
        params: {
          threadId: thread.id
        }
      });

      const paths = getThreadTaskPaths(repoRoot);
      await waitFor(async () => {
        await fs.stat(path.join(paths.archivedRoot, thread.id, 'todo.md'));
      });

      await expect(fs.stat(path.join(paths.activeRoot, thread.id))).rejects.toThrow();

      client.emitClose();
      await watchPromise;
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});

async function waitFor(callback: () => Promise<void>, attempts = 25, delayMs = 20): Promise<void> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await callback();
      return;
    } catch (error) {
      lastError = error;
      await Bun.sleep(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Timed out waiting for watcher sync.');
}
