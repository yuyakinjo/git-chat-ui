import fs from "node:fs/promises";
import path from "node:path";

import type {
  ConflictContextType,
  ConflictFileDetail,
  ConflictFileVersion,
  ConflictOperation,
  ConflictResolutionSide,
  ConflictSummary,
  WorkingFile,
} from "../types.js";

import {
  ensureRepoPath,
  isUnmergedStatus,
  resolveWorkingTreeFilePath,
  runGit,
  runGitBuffer,
  statusLabel,
} from "./command.js";

interface MergeSession {
  id: string;
  repoPath: string;
  tempRootPath: string;
  worktreePath: string;
  sourceBranch: string;
  targetBranch: string;
  previousTargetSha: string;
}

interface ConflictContext {
  repoPath: string;
  worktreePath: string;
  contextType: ConflictContextType;
  operation: ConflictOperation;
  sessionId?: string;
  sourceBranch?: string;
  targetBranch?: string;
}

let nextMergeSessionId = 0;
const mergeSessions = new Map<string, MergeSession>();

function createMergeSessionId(): string {
  nextMergeSessionId += 1;
  return `merge-session-${Date.now()}-${nextMergeSessionId}`;
}

function parseStatusLine(line: string): WorkingFile | null {
  if (!line.trim()) {
    return null;
  }

  const x = line[0] ?? " ";
  const y = line[1] ?? " ";
  if (!isUnmergedStatus(x, y)) {
    return null;
  }

  const rawPath = line.slice(3).trim();
  const file = rawPath.includes(" -> ") ? (rawPath.split(" -> ").at(-1) ?? rawPath) : rawPath;
  if (!file) {
    return null;
  }

  return {
    file,
    x,
    y,
    statusLabel: statusLabel(x, y),
  };
}

async function listConflictFiles(worktreePath: string): Promise<WorkingFile[]> {
  const output = await runGit(["status", "--porcelain=v1", "-uall"], worktreePath);
  return output
    .split("\n")
    .map((line) => parseStatusLine(line))
    .filter((entry): entry is WorkingFile => Boolean(entry))
    .sort((left, right) => left.file.localeCompare(right.file));
}

function isMissingStageError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /does not exist \(neither on disk nor in the index\)/i.test(message) ||
    /exists on disk, but not in/i.test(message) ||
    /not at stage \d/i.test(message) ||
    /path .* does not have our version/i.test(message) ||
    /path .* does not have their version/i.test(message)
  );
}

function mapBufferToConflictVersion(buffer: Buffer | null): ConflictFileVersion {
  if (buffer === null) {
    return {
      isBinary: false,
      content: null,
    };
  }

  if (buffer.includes(0)) {
    return {
      isBinary: true,
      content: null,
    };
  }

  return {
    isBinary: false,
    content: buffer.toString("utf8").replace(/\r\n?/g, "\n"),
  };
}

async function readStageBuffer(
  worktreePath: string,
  stage: 1 | 2 | 3,
  file: string,
): Promise<Buffer | null> {
  try {
    return await runGitBuffer(["show", `:${stage}:${file}`], worktreePath);
  } catch (error) {
    if (isMissingStageError(error)) {
      return null;
    }

    throw error;
  }
}

async function readMergedBuffer(worktreePath: string, file: string): Promise<Buffer | null> {
  const absolutePath = resolveWorkingTreeFilePath(worktreePath, file);

  try {
    return await fs.readFile(absolutePath);
  } catch (error) {
    const typed = error as NodeJS.ErrnoException;
    if (typed.code === "ENOENT") {
      return null;
    }

    throw error;
  }
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

async function detectRepositoryConflictOperation(worktreePath: string): Promise<ConflictOperation> {
  try {
    const mergeHeadPath = await runGit(["rev-parse", "--git-path", "MERGE_HEAD"], worktreePath);
    await fs.access(path.isAbsolute(mergeHeadPath) ? mergeHeadPath : path.join(worktreePath, mergeHeadPath));
    return "merge";
  } catch {
    return "unknown";
  }
}

async function resolveConflictContext(
  repoPath: string,
  sessionId?: string | null,
): Promise<ConflictContext> {
  await ensureRepoPath(repoPath);

  const normalizedSessionId = sessionId?.trim() ?? "";
  if (!normalizedSessionId) {
    return {
      repoPath,
      worktreePath: repoPath,
      contextType: "repository",
      operation: await detectRepositoryConflictOperation(repoPath),
    };
  }

  const session = mergeSessions.get(normalizedSessionId);
  if (!session) {
    throw new Error(`Merge session '${normalizedSessionId}' was not found.`);
  }

  if (session.repoPath !== repoPath) {
    throw new Error(`Merge session '${normalizedSessionId}' does not belong to this repository.`);
  }

  return {
    repoPath: session.repoPath,
    worktreePath: session.worktreePath,
    contextType: "mergeSession",
    operation: "merge",
    sessionId: session.id,
    sourceBranch: session.sourceBranch,
    targetBranch: session.targetBranch,
  };
}

async function getConflictFileStatus(worktreePath: string, file: string): Promise<WorkingFile | null> {
  const output = await runGit(["status", "--porcelain=v1", "-uall", "--", file], worktreePath);

  for (const line of output.split("\n")) {
    const parsed = parseStatusLine(line);
    if (parsed?.file === file) {
      return parsed;
    }
  }

  return null;
}

async function stageConflictResolution(
  worktreePath: string,
  file: string,
  side: ConflictResolutionSide,
): Promise<void> {
  const stage = side === "ours" ? 2 : 3;
  const stageBuffer = await readStageBuffer(worktreePath, stage, file);

  if (stageBuffer !== null) {
    await runGit(["checkout", `--${side}`, "--", file], worktreePath);
    await runGit(["add", "--", file], worktreePath);
    return;
  }

  const absolutePath = resolveWorkingTreeFilePath(worktreePath, file);
  await fs.rm(absolutePath, { recursive: true, force: true });
  await runGit(["add", "--", file], worktreePath);
}

export function registerMergeSession(input: Omit<MergeSession, "id">): MergeSession {
  const session: MergeSession = {
    ...input,
    id: createMergeSessionId(),
  };
  mergeSessions.set(session.id, session);
  return session;
}

export function hasMergeSession(sessionId: string): boolean {
  return mergeSessions.has(sessionId);
}

export async function getConflictSummary(
  repoPath: string,
  sessionId?: string | null,
): Promise<ConflictSummary> {
  return getConflictSummaryForContext({ repoPath, sessionId });
}

export async function getConflictSummaryForContext(options: {
  repoPath: string;
  sessionId?: string | null;
  operation?: ConflictOperation;
  sourceBranch?: string;
  targetBranch?: string;
}): Promise<ConflictSummary> {
  const context = await resolveConflictContext(options.repoPath, options.sessionId);

  return {
    contextType: context.contextType,
    operation: options.operation ?? context.operation,
    sessionId: context.sessionId,
    sourceBranch: options.sourceBranch ?? context.sourceBranch,
    targetBranch: options.targetBranch ?? context.targetBranch,
    files: await listConflictFiles(context.worktreePath),
  };
}

export async function getConflictFileDetail(
  repoPath: string,
  file: string,
  sessionId?: string | null,
): Promise<ConflictFileDetail> {
  const normalizedFile = file.trim();
  if (!normalizedFile) {
    throw new Error("file is required.");
  }

  const context = await resolveConflictContext(repoPath, sessionId);
  const status = await getConflictFileStatus(context.worktreePath, normalizedFile);
  if (!status) {
    throw new Error(`'${normalizedFile}' is not a conflicted file.`);
  }

  const [mergedBuffer, baseBuffer, oursBuffer, theirsBuffer] = await Promise.all([
    readMergedBuffer(context.worktreePath, normalizedFile),
    readStageBuffer(context.worktreePath, 1, normalizedFile),
    readStageBuffer(context.worktreePath, 2, normalizedFile),
    readStageBuffer(context.worktreePath, 3, normalizedFile),
  ]);

  return {
    file: normalizedFile,
    x: status.x,
    y: status.y,
    statusLabel: status.statusLabel,
    merged: mapBufferToConflictVersion(mergedBuffer),
    base: mapBufferToConflictVersion(baseBuffer),
    ours: mapBufferToConflictVersion(oursBuffer),
    theirs: mapBufferToConflictVersion(theirsBuffer),
  };
}

export async function resolveConflictVersion(options: {
  repoPath: string;
  file: string;
  side: ConflictResolutionSide;
  sessionId?: string | null;
}): Promise<void> {
  const normalizedFile = options.file.trim();
  if (!normalizedFile) {
    throw new Error("file is required.");
  }

  const context = await resolveConflictContext(options.repoPath, options.sessionId);
  const status = await getConflictFileStatus(context.worktreePath, normalizedFile);
  if (!status) {
    throw new Error(`'${normalizedFile}' is not a conflicted file.`);
  }

  await stageConflictResolution(context.worktreePath, normalizedFile, options.side);
}

export async function completeMergeSession(repoPath: string, sessionId: string): Promise<void> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    throw new Error("sessionId is required.");
  }

  const session = mergeSessions.get(normalizedSessionId);
  if (!session) {
    throw new Error(`Merge session '${normalizedSessionId}' was not found.`);
  }

  if (session.repoPath !== repoPath) {
    throw new Error(`Merge session '${normalizedSessionId}' does not belong to this repository.`);
  }

  const remainingConflicts = await listConflictFiles(session.worktreePath);
  if (remainingConflicts.length > 0) {
    throw new Error("Resolve all conflicted files before completing the merge session.");
  }

  let operationError: unknown = null;

  try {
    await runGit(["commit", "--no-edit"], session.worktreePath);
    const mergedTargetSha = await runGit(["rev-parse", "HEAD"], session.worktreePath);

    if (mergedTargetSha !== session.previousTargetSha) {
      await runGit(
        [
          "update-ref",
          "-m",
          `branch action merge ${session.sourceBranch} into ${session.targetBranch}`,
          `refs/heads/${session.targetBranch}`,
          mergedTargetSha,
          session.previousTargetSha,
        ],
        session.repoPath,
      );
    }
  } catch (error) {
    operationError = error;
  }

  try {
    await removeTemporaryWorktree(session.repoPath, session.tempRootPath, session.worktreePath);
  } catch (cleanupError) {
    if (!operationError) {
      operationError = cleanupError;
    }
  } finally {
    mergeSessions.delete(normalizedSessionId);
  }

  if (operationError) {
    throw operationError;
  }
}

export async function abortMergeSession(repoPath: string, sessionId: string): Promise<void> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    throw new Error("sessionId is required.");
  }

  const session = mergeSessions.get(normalizedSessionId);
  if (!session) {
    throw new Error(`Merge session '${normalizedSessionId}' was not found.`);
  }

  if (session.repoPath !== repoPath) {
    throw new Error(`Merge session '${normalizedSessionId}' does not belong to this repository.`);
  }

  try {
    await runGit(["merge", "--abort"], session.worktreePath);
  } catch {
    // best-effort abort before cleanup
  }

  await removeTemporaryWorktree(session.repoPath, session.tempRootPath, session.worktreePath);
  mergeSessions.delete(normalizedSessionId);
}
