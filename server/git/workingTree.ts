import fs from "node:fs/promises";
import path from "node:path";

import type { WorkingFile, WorkingTreeStatus } from "../types.js";

import { ensureRepoPath, runGit, statusLabel } from "./command.js";

interface WorkingTreeFileStatusEntry {
  file: string;
  previousFile: string | null;
  x: string;
  y: string;
}

export async function getWorkingTreeStatus(repoPath: string): Promise<WorkingTreeStatus> {
  await ensureRepoPath(repoPath);

  const statusOutput = await runGit(["status", "--porcelain=v1", "-uall"], repoPath);
  const staged: WorkingFile[] = [];
  const unstaged: WorkingFile[] = [];

  for (const line of statusOutput.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    const rawPath = line.slice(3).trim();
    const file = rawPath.includes(" -> ") ? (rawPath.split(" -> ").at(-1) ?? rawPath) : rawPath;

    const normalizedStatus = statusLabel(x !== " " && x !== "?" ? x : y);

    if (x !== " " && x !== "?") {
      staged.push({
        file,
        x,
        y,
        statusLabel: normalizedStatus,
      });
    }

    if (y !== " " || x === "?") {
      unstaged.push({
        file,
        x,
        y,
        statusLabel: normalizedStatus,
      });
    }
  }

  return {
    staged,
    unstaged,
  };
}

export async function stageFile(repoPath: string, file: string): Promise<void> {
  await ensureRepoPath(repoPath);
  await runGit(["add", "--", file], repoPath);
}

export async function unstageFile(repoPath: string, file: string): Promise<void> {
  await ensureRepoPath(repoPath);

  try {
    await runGit(["restore", "--staged", "--", file], repoPath);
  } catch {
    await runGit(["reset", "HEAD", "--", file], repoPath);
  }
}

async function getWorkingTreeFileStatusEntry(
  repoPath: string,
  file: string,
): Promise<WorkingTreeFileStatusEntry | null> {
  const output = await runGit(["status", "--porcelain=v1", "-uall", "--", file], repoPath);

  for (const line of output.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    const rawPath = line.slice(3).trim();
    const previousFile = rawPath.includes(" -> ") ? (rawPath.split(" -> ").at(0) ?? null) : null;
    const normalizedFile = rawPath.includes(" -> ")
      ? (rawPath.split(" -> ").at(-1) ?? rawPath)
      : rawPath;

    if (normalizedFile === file) {
      return {
        file: normalizedFile,
        previousFile,
        x,
        y,
      };
    }
  }

  return null;
}

async function pathExistsInHead(repoPath: string, file: string): Promise<boolean> {
  try {
    const output = await runGit(["ls-tree", "-r", "--name-only", "HEAD", "--", file], repoPath);
    return output.split("\n").some((line) => line.trim() === file);
  } catch {
    return false;
  }
}

async function restorePathsFromHead(
  repoPath: string,
  files: string[],
  headPaths: string[],
): Promise<void> {
  const restoreArgs = ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...files];

  try {
    await runGit(restoreArgs, repoPath);
  } catch {
    await runGit(["reset", "HEAD", "--", ...files], repoPath);

    if (headPaths.length > 0) {
      await runGit(["checkout", "--", ...headPaths], repoPath);
    }

    const removedPaths = files.filter((candidate) => !headPaths.includes(candidate));
    for (const removedPath of removedPaths) {
      await fs.rm(path.join(repoPath, removedPath), { recursive: true, force: true });
    }
  }
}

async function removePathsFromIndexAndWorkingTree(
  repoPath: string,
  files: string[],
): Promise<void> {
  await runGit(["rm", "--cached", "--force", "--", ...files], repoPath);

  for (const file of files) {
    await fs.rm(path.join(repoPath, file), { recursive: true, force: true });
  }
}

export async function discardFile(repoPath: string, file: string): Promise<void> {
  await ensureRepoPath(repoPath);

  const normalizedFile = file.trim();
  if (!normalizedFile) {
    throw new Error("file is required.");
  }

  const entry = await getWorkingTreeFileStatusEntry(repoPath, normalizedFile);
  if (!entry) {
    return;
  }

  if (entry.x === "?" && entry.y === "?") {
    await fs.rm(path.join(repoPath, entry.file), { recursive: true, force: true });
    return;
  }

  const restorePaths = entry.previousFile ? [entry.previousFile, entry.file] : [entry.file];
  const headPaths = (
    await Promise.all(
      restorePaths.map(async (candidate) =>
        (await pathExistsInHead(repoPath, candidate)) ? candidate : null,
      ),
    )
  ).filter((candidate): candidate is string => candidate !== null);

  if (headPaths.length > 0) {
    await restorePathsFromHead(repoPath, restorePaths, headPaths);
    return;
  }

  await removePathsFromIndexAndWorkingTree(repoPath, [entry.file]);
}

export async function stashFile(repoPath: string, file: string): Promise<void> {
  await ensureRepoPath(repoPath);
  await runGit(["stash", "push", "-m", `git-chat-ui: ${file}`, "--", file], repoPath);
}
