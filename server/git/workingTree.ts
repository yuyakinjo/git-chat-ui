import fs from "node:fs/promises";
import path from "node:path";

import type { WorkingFile, WorkingTreeStatus } from "../types.js";

import { ensureRepoPath, isUnmergedStatus, runGit, statusLabel } from "./command.js";

interface WorkingTreeFileStatusEntry {
  file: string;
  previousFile: string | null;
  x: string;
  y: string;
}

function isRenameOrCopyStatus(x: string, y: string): boolean {
  return x === "R" || x === "C" || y === "R" || y === "C";
}

function parseWorkingTreeStatusEntries(output: string): WorkingTreeFileStatusEntry[] {
  const entries: WorkingTreeFileStatusEntry[] = [];
  const fields = output.split("\0");

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!field) {
      continue;
    }

    const x = field[0] ?? " ";
    const y = field[1] ?? " ";
    const file = field.slice(3);
    if (!file) {
      continue;
    }

    let previousFile: string | null = null;
    if (isRenameOrCopyStatus(x, y)) {
      const previousField = fields[index + 1] ?? "";
      if (previousField) {
        previousFile = previousField;
        index += 1;
      }
    }

    entries.push({
      file,
      previousFile,
      x,
      y,
    });
  }

  return entries;
}

export async function getWorkingTreeStatus(repoPath: string): Promise<WorkingTreeStatus> {
  await ensureRepoPath(repoPath);

  const statusOutput = await runGit(["status", "--porcelain=v1", "-z", "-uall"], repoPath);
  const conflicted: WorkingFile[] = [];
  const staged: WorkingFile[] = [];
  const unstaged: WorkingFile[] = [];

  for (const entry of parseWorkingTreeStatusEntries(statusOutput)) {
    const { file, x, y } = entry;
    const normalizedStatus = statusLabel(x, y);

    if (isUnmergedStatus(x, y)) {
      conflicted.push({
        file,
        x,
        y,
        statusLabel: normalizedStatus,
      });
      continue;
    }

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
    conflicted,
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
  const output = await runGit(["status", "--porcelain=v1", "-z", "-uall", "--", file], repoPath);

  for (const entry of parseWorkingTreeStatusEntries(output)) {
    if (entry.file === file) {
      return entry;
    }
  }

  return null;
}

async function pathExistsInHead(repoPath: string, file: string): Promise<boolean> {
  try {
    const output = await runGit(
      ["ls-tree", "-r", "-z", "--name-only", "HEAD", "--", file],
      repoPath,
    );
    return output.split("\0").some((line) => line === file);
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

  const normalizedFile = file.trim();
  if (!normalizedFile) {
    throw new Error("file is required.");
  }

  const entry = await getWorkingTreeFileStatusEntry(repoPath, normalizedFile);
  const args = ["stash", "push"];
  if (entry?.x === "?" && entry.y === "?") {
    args.push("--include-untracked");
  }
  args.push("-m", `git-chat-ui: ${normalizedFile}`, "--", normalizedFile);

  await runGit(args, repoPath);
}

export async function stashAllChanges(repoPath: string): Promise<void> {
  await ensureRepoPath(repoPath);
  await runGit(
    ["stash", "push", "--include-untracked", "-m", "git-chat-ui: Working tree"],
    repoPath,
  );
}
