import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { StashDiffDetail, StashDiffFileDetail, StashEntry } from "../types.js";

import { ensureRepoPath, parseCommitFileStats, runGit } from "./command.js";

interface StashReflogEntry {
  newOid: string;
  committerName: string;
  committerEmail: string;
  timestamp: string;
  timezone: string;
  message: string;
}

function parseStashIndex(stashId: string): number {
  const match = /^stash@\{(\d+)\}$/.exec(stashId.trim());
  if (!match) {
    throw new Error("stashId must be in the form stash@{n}.");
  }

  return Number(match[1]);
}

function parseStashReflogLine(line: string): StashReflogEntry | null {
  const separatorIndex = line.indexOf("\t");
  if (separatorIndex < 0) {
    return null;
  }

  const metadata = line.slice(0, separatorIndex);
  const message = line.slice(separatorIndex + 1);
  const match = /^([0-9a-f]{40}) ([0-9a-f]{40}) (.+) <([^>]+)> (\d+) ([+-]\d{4})$/.exec(metadata);
  if (!match) {
    return null;
  }

  return {
    newOid: match[2],
    committerName: match[3],
    committerEmail: match[4],
    timestamp: match[5],
    timezone: match[6],
    message,
  };
}

async function resolveGitPath(repoPath: string, gitPath: string): Promise<string> {
  const resolved = await runGit(["rev-parse", "--git-path", gitPath], repoPath);
  return path.isAbsolute(resolved) ? resolved : path.resolve(repoPath, resolved);
}

async function clearStashRef(
  repoPath: string,
  stashLogPath: string,
  currentTopOid: string,
): Promise<void> {
  const refExists = await runGit(["show-ref", "--verify", "--quiet", "refs/stash"], repoPath)
    .then(() => true)
    .catch(() => false);

  if (refExists) {
    try {
      await runGit(["update-ref", "-d", "refs/stash", currentTopOid], repoPath);
    } catch {
      await runGit(["update-ref", "-d", "refs/stash"], repoPath);
    }
  }

  await fs.rm(stashLogPath, { force: true });
}

async function rebuildStashReflog(
  repoPath: string,
  stashLogPath: string,
  entries: StashReflogEntry[],
): Promise<void> {
  const currentTopOid = entries[entries.length - 1]?.newOid ?? "";
  await clearStashRef(repoPath, stashLogPath, currentTopOid);

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const previousEntry = index > 0 ? entries[index - 1] : null;
    const args = ["update-ref", "--create-reflog", "-m", entry.message, "refs/stash", entry.newOid];

    if (previousEntry) {
      args.push(previousEntry.newOid);
    }

    await runGit(args, repoPath, {
      GIT_COMMITTER_NAME: entry.committerName,
      GIT_COMMITTER_EMAIL: entry.committerEmail,
      GIT_COMMITTER_DATE: `${entry.timestamp} ${entry.timezone}`,
    });
  }
}

async function readStashReflogEntries(
  stashLogPath: string,
  stashIdForError: string,
): Promise<StashReflogEntry[]> {
  let stashLog: string;
  try {
    stashLog = await fs.readFile(stashLogPath, "utf8");
  } catch {
    throw new Error(`${stashIdForError} was not found.`);
  }

  return stashLog
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => parseStashReflogLine(line))
    .filter((entry): entry is StashReflogEntry => Boolean(entry));
}

async function removeTemporaryWorktree(
  repoPath: string,
  tempRootPath: string,
  worktreePath: string,
): Promise<void> {
  try {
    await runGit(["worktree", "remove", "--force", worktreePath], repoPath);
  } catch {
    // best-effort cleanup; remove the temporary root below even if git metadata cleanup fails
  }

  await fs.rm(tempRootPath, { recursive: true, force: true });
}

async function validateAppendFile(repoPath: string, file: string): Promise<string> {
  const normalizedFile = file.trim();
  if (!normalizedFile) {
    throw new Error("file is required.");
  }

  await runGit(["ls-files", "--error-unmatch", "--", normalizedFile], repoPath);
  return normalizedFile;
}

async function collectAppendFilePatches(
  repoPath: string,
  file: string,
): Promise<{ stagedPatch: string; unstagedPatch: string }> {
  const stagedPatch = await runGit(["diff", "--binary", "--cached", "--", file], repoPath);
  const unstagedPatch = await runGit(["diff", "--binary", "--", file], repoPath);

  if (!stagedPatch.trim() && !unstagedPatch.trim()) {
    throw new Error(`No staged or unstaged changes were found for '${file}'.`);
  }

  return { stagedPatch, unstagedPatch };
}

async function applyPatchFile(
  worktreePath: string,
  tempRootPath: string,
  name: string,
  patch: string,
  options?: { index?: boolean },
): Promise<void> {
  if (!patch.trim()) {
    return;
  }

  const patchPath = path.join(tempRootPath, name);
  await fs.writeFile(patchPath, `${patch}\n`, "utf8");

  const args = ["apply"];
  if (options?.index) {
    args.push("--index");
  }
  args.push("--binary", "--whitespace=nowarn", patchPath);
  await runGit(args, worktreePath);
}

async function createReplacementStashCommit(options: {
  repoPath: string;
  stashId: string;
  stashMessage: string;
  stagedPatch: string;
  unstagedPatch: string;
}): Promise<string> {
  const { repoPath, stashId, stashMessage, stagedPatch, unstagedPatch } = options;
  const tempRootPath = await fs.mkdtemp(path.join(os.tmpdir(), "git-chat-ui-stash-append-"));
  const worktreePath = path.join(tempRootPath, "worktree");

  let replacementOid = "";
  let operationError: unknown = null;

  try {
    await runGit(["worktree", "add", "--detach", worktreePath, "HEAD"], repoPath);
    await runGit(["stash", "apply", "--index", stashId], worktreePath);
    await applyPatchFile(worktreePath, tempRootPath, "staged.patch", stagedPatch, {
      index: true,
    });
    await applyPatchFile(worktreePath, tempRootPath, "unstaged.patch", unstagedPatch);

    replacementOid = (await runGit(["stash", "create", stashMessage], worktreePath)).trim();
    if (!replacementOid) {
      throw new Error("Failed to create replacement stash.");
    }
  } catch (error) {
    operationError = error;
  }

  try {
    await removeTemporaryWorktree(repoPath, tempRootPath, worktreePath);
  } catch (cleanupError) {
    if (!operationError) {
      operationError = cleanupError;
    }
  }

  if (operationError) {
    throw operationError;
  }

  return replacementOid;
}

export async function getStashes(repoPath: string): Promise<StashEntry[]> {
  await ensureRepoPath(repoPath);

  const output = await runGit(["stash", "list", "--format=%gd%x1f%cr%x1f%gs"], repoPath);

  const stashes = output
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const [id, relativeDate, message] = line.split("\x1f");
      return {
        id,
        relativeDate,
        message,
        files: [] as string[],
      };
    });

  for (const stash of stashes) {
    try {
      const filesOutput = await runGit(
        ["stash", "show", "--name-only", "--format=", stash.id],
        repoPath,
      );
      stash.files = filesOutput
        .split("\n")
        .map((file) => file.trim())
        .filter((file) => file.length > 0);
    } catch {
      stash.files = [];
    }
  }

  return stashes;
}

export async function getStashDiffDetail(
  repoPath: string,
  stashId: string,
): Promise<StashDiffDetail> {
  await ensureRepoPath(repoPath);

  const normalizedStashId = stashId.trim();
  parseStashIndex(normalizedStashId);

  const fileStatsOutput = await runGit(
    ["stash", "show", "--numstat", "--format=", normalizedStashId],
    repoPath,
  );
  const files = parseCommitFileStats(fileStatsOutput);

  const diff = await runGit(["stash", "show", "--patch", "--format=", normalizedStashId], repoPath);
  const isDiffTruncated = diff.length > 25000;

  return {
    stashId: normalizedStashId,
    files,
    diff: diff.slice(0, 25000),
    isDiffTruncated,
  };
}

export async function getStashDiffFileDetail(
  repoPath: string,
  stashId: string,
  file: string,
): Promise<StashDiffFileDetail> {
  await ensureRepoPath(repoPath);

  const normalizedStashId = stashId.trim();
  const normalizedFile = file.trim();
  parseStashIndex(normalizedStashId);

  if (!normalizedFile) {
    throw new Error("file is required.");
  }

  const diff = await runGit(
    ["diff", `${normalizedStashId}^1`, normalizedStashId, "--", normalizedFile],
    repoPath,
  );
  const isDiffTruncated = diff.length > 25000;

  return {
    stashId: normalizedStashId,
    file: normalizedFile,
    diff: diff.slice(0, 25000),
    isDiffTruncated,
  };
}

export async function renameStash(
  repoPath: string,
  stashId: string,
  message: string,
): Promise<void> {
  await ensureRepoPath(repoPath);

  const normalizedStashId = stashId.trim();
  const normalizedMessage = message.trim();

  if (!normalizedMessage) {
    throw new Error("message is required.");
  }

  const targetIndexFromHead = parseStashIndex(normalizedStashId);
  const stashLogPath = await resolveGitPath(repoPath, "logs/refs/stash");
  const entries = await readStashReflogEntries(stashLogPath, normalizedStashId);

  if (entries.length === 0 || targetIndexFromHead >= entries.length) {
    throw new Error(`${normalizedStashId} was not found.`);
  }

  const targetLogIndex = entries.length - 1 - targetIndexFromHead;
  const renamedEntries = entries.map((entry, index) =>
    index === targetLogIndex
      ? {
          ...entry,
          message: normalizedMessage,
        }
      : entry,
  );

  try {
    await rebuildStashReflog(repoPath, stashLogPath, renamedEntries);
  } catch (error) {
    try {
      await rebuildStashReflog(repoPath, stashLogPath, entries);
    } catch {
      // If restore also fails, surface the original error because it is more actionable.
    }

    throw error;
  }
}

export async function appendFileToStash(
  repoPath: string,
  stashId: string,
  file: string,
): Promise<void> {
  await ensureRepoPath(repoPath);

  const normalizedStashId = stashId.trim();
  const normalizedFile = await validateAppendFile(repoPath, file);
  const targetIndexFromHead = parseStashIndex(normalizedStashId);
  const stashLogPath = await resolveGitPath(repoPath, "logs/refs/stash");
  const entries = await readStashReflogEntries(stashLogPath, normalizedStashId);

  if (entries.length === 0 || targetIndexFromHead >= entries.length) {
    throw new Error(`${normalizedStashId} was not found.`);
  }

  const targetLogIndex = entries.length - 1 - targetIndexFromHead;
  const targetEntry = entries[targetLogIndex];
  const { stagedPatch, unstagedPatch } = await collectAppendFilePatches(repoPath, normalizedFile);
  const replacementOid = await createReplacementStashCommit({
    repoPath,
    stashId: normalizedStashId,
    stashMessage: targetEntry.message,
    stagedPatch,
    unstagedPatch,
  });
  const updatedEntries = entries.map((entry, index) =>
    index === targetLogIndex
      ? {
          ...entry,
          newOid: replacementOid,
        }
      : entry,
  );

  try {
    await rebuildStashReflog(repoPath, stashLogPath, updatedEntries);
  } catch (error) {
    try {
      await rebuildStashReflog(repoPath, stashLogPath, entries);
    } catch {
      // If restore also fails, surface the original error because it is more actionable.
    }

    throw error;
  }
}

export async function applyStash(repoPath: string, stashId: string): Promise<void> {
  await ensureRepoPath(repoPath);

  const normalizedStashId = stashId.trim();
  parseStashIndex(normalizedStashId);
  await runGit(["stash", "apply", normalizedStashId], repoPath);
}

export async function popStash(repoPath: string, stashId: string): Promise<void> {
  await ensureRepoPath(repoPath);

  const normalizedStashId = stashId.trim();
  parseStashIndex(normalizedStashId);
  await runGit(["stash", "pop", normalizedStashId], repoPath);
}
