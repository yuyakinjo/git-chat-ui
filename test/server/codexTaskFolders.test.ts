import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ensureThreadTaskDirectory,
  getThreadTaskPaths,
  syncThreadTaskDirectories,
  type CodexThreadSummary,
} from "../../server/codexTaskFolders";

async function createRepoRoot(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "git-chat-ui-codex-task-folders-"));
}

describe("ensureThreadTaskDirectory", () => {
  test("creates tasks/threads/<threadId>/todo.md and meta.json", async () => {
    const repoRoot = await createRepoRoot();
    const thread: CodexThreadSummary = {
      id: "thr_attach",
      name: "Investigate archive sync",
      preview: "Confirm thread/archive behavior",
      createdAt: 1_743_380_000,
      updatedAt: 1_743_380_120,
    };

    try {
      const result = await ensureThreadTaskDirectory(repoRoot, thread);
      const todo = await fs.readFile(result.todoPath, "utf8");
      const meta = JSON.parse(await fs.readFile(result.metaPath, "utf8")) as Record<string, string>;

      expect(result.created).toBe(true);
      expect(result.restoredFromArchive).toBe(false);
      expect(todo).toContain("Thread ID: thr_attach");
      expect(todo).toContain("Investigate archive sync");
      expect(meta.threadId).toBe("thr_attach");
      expect(meta.status).toBe("active");
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});

describe("syncThreadTaskDirectories", () => {
  test("moves archived threads into tasks/archived/<threadId>", async () => {
    const repoRoot = await createRepoRoot();
    const thread: CodexThreadSummary = {
      id: "thr_archive",
      name: "Archive me",
      preview: "Move to archived folder",
      createdAt: 1_743_380_000,
      updatedAt: 1_743_380_120,
    };

    try {
      await ensureThreadTaskDirectory(repoRoot, thread);

      const result = await syncThreadTaskDirectories({
        repoRoot,
        activeThreads: [],
        archivedThreads: [thread],
      });

      const paths = getThreadTaskPaths(repoRoot);
      expect(result.movedToArchive).toEqual(["thr_archive"]);
      expect(await fs.stat(path.join(paths.archivedRoot, "thr_archive", "todo.md"))).toBeDefined();
      await expect(fs.stat(path.join(paths.activeRoot, "thr_archive"))).rejects.toThrow();
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("restores active threads from tasks/archived/<threadId>", async () => {
    const repoRoot = await createRepoRoot();
    const thread: CodexThreadSummary = {
      id: "thr_restore",
      name: "Restore me",
      preview: "Move back to active folder",
      createdAt: 1_743_380_000,
      updatedAt: 1_743_380_120,
    };

    try {
      await ensureThreadTaskDirectory(repoRoot, thread);
      await syncThreadTaskDirectories({
        repoRoot,
        activeThreads: [],
        archivedThreads: [thread],
      });

      const result = await syncThreadTaskDirectories({
        repoRoot,
        activeThreads: [thread],
        archivedThreads: [],
      });

      const paths = getThreadTaskPaths(repoRoot);
      expect(result.restoredToActive).toEqual(["thr_restore"]);
      expect(await fs.stat(path.join(paths.activeRoot, "thr_restore", "todo.md"))).toBeDefined();
      await expect(fs.stat(path.join(paths.archivedRoot, "thr_restore"))).rejects.toThrow();
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("moves missing active thread directories into tasks/archived/<threadId>", async () => {
    const repoRoot = await createRepoRoot();
    const thread: CodexThreadSummary = {
      id: "thr_deleted",
      name: "Deleted in Codex",
      preview: "Should no longer stay active locally",
      createdAt: 1_743_380_000,
      updatedAt: 1_743_380_120,
    };

    try {
      await ensureThreadTaskDirectory(repoRoot, thread);

      const result = await syncThreadTaskDirectories({
        repoRoot,
        activeThreads: [],
        archivedThreads: [],
      });

      const paths = getThreadTaskPaths(repoRoot);
      const meta = JSON.parse(
        await fs.readFile(path.join(paths.archivedRoot, "thr_deleted", "meta.json"), "utf8"),
      ) as Record<string, string>;

      expect(result.movedToArchive).toEqual([]);
      expect(result.orphanedToArchive).toEqual(["thr_deleted"]);
      expect(meta.status).toBe("archived");
      expect(meta.title).toBe("Deleted in Codex");
      expect(await fs.stat(path.join(paths.archivedRoot, "thr_deleted", "todo.md"))).toBeDefined();
      await expect(fs.stat(path.join(paths.activeRoot, "thr_deleted"))).rejects.toThrow();
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});
