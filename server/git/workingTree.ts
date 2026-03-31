import type { WorkingFile, WorkingTreeStatus } from "../types.js";

import { ensureRepoPath, runGit, statusLabel } from "./command.js";

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

export async function stashFile(repoPath: string, file: string): Promise<void> {
  await ensureRepoPath(repoPath);
  await runGit(["stash", "push", "-m", `git-chat-ui: ${file}`, "--", file], repoPath);
}
