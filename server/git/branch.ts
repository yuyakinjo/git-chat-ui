import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Branch, ConflictOperationResult, PullStatus, PullStatusState } from "../types.js";

import { ensureRepoPath, runGit } from "./command.js";
import { getConflictSummaryForContext, registerMergeSession } from "./conflict.js";

export async function getCurrentBranch(repoPath: string): Promise<string> {
  await ensureRepoPath(repoPath);
  return runGit(["rev-parse", "--abbrev-ref", "HEAD"], repoPath);
}

async function localBranchExists(repoPath: string, branchName: string): Promise<boolean> {
  try {
    await runGit(["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], repoPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureLocalBranch(repoPath: string, branchName: string): Promise<void> {
  if (!branchName.trim()) {
    throw new Error("branchName is required.");
  }

  await runGit(["rev-parse", "--verify", `refs/heads/${branchName}`], repoPath);
}

async function getBranchHeadSha(repoPath: string, branchName: string): Promise<string> {
  return runGit(["rev-parse", "--verify", `refs/heads/${branchName}`], repoPath);
}

export async function ensureBranchPair(
  repoPath: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<void> {
  if (!sourceBranch.trim() || !targetBranch.trim()) {
    throw new Error("sourceBranch and targetBranch are required.");
  }

  if (sourceBranch === targetBranch) {
    throw new Error("sourceBranch and targetBranch must be different.");
  }

  await Promise.all([
    ensureLocalBranch(repoPath, sourceBranch),
    ensureLocalBranch(repoPath, targetBranch),
  ]);
}

export async function ensureOriginRemote(repoPath: string): Promise<void> {
  await runGit(["remote", "get-url", "origin"], repoPath);
}

function parseCommitCount(output: string): number {
  const parsed = Number.parseInt(output.trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolvePullStatusState(aheadCount: number, behindCount: number): PullStatusState {
  if (behindCount > 0 && aheadCount === 0) {
    return "behind";
  }

  if (aheadCount > 0 && behindCount === 0) {
    return "ahead";
  }

  if (aheadCount > 0 && behindCount > 0) {
    return "diverged";
  }

  return "upToDate";
}

function parseRemoteBranchName(branchName: string): {
  remoteName: string;
  remoteBranchName: string;
} {
  const parts = branchName.trim().split("/").filter(Boolean);
  const remoteName = parts[0];
  const remoteBranchName = parts.slice(1).join("/");

  if (!remoteName || !remoteBranchName) {
    throw new Error("branchName must include remote and branch name.");
  }

  return {
    remoteName,
    remoteBranchName,
  };
}

async function getLocalDefaultBranchName(repoPath: string): Promise<string | null> {
  const refs = await runGit(["for-each-ref", "--format=%(refname:short)", "refs/heads"], repoPath);
  const localBranches = refs
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const currentBranch = await getCurrentBranch(repoPath);
  const candidate =
    localBranches.find((branch) => branch === "main") ??
    localBranches.find((branch) => branch === "master") ??
    localBranches.find((branch) => branch === currentBranch) ??
    localBranches[0];

  return candidate ?? null;
}

async function getRemoteDefaultBranchName(
  repoPath: string,
  remoteName: string,
): Promise<string | null> {
  try {
    const reference = await runGit(
      ["symbolic-ref", "--quiet", "--short", `refs/remotes/${remoteName}/HEAD`],
      repoPath,
    );
    const normalized = reference.trim();
    if (normalized.startsWith(`${remoteName}/`)) {
      return normalized.slice(remoteName.length + 1);
    }
  } catch {
    // fall back to local default branch heuristic
  }

  return getLocalDefaultBranchName(repoPath);
}

async function validateCreateBranchInput(
  repoPath: string,
  baseBranch: string,
  newBranch: string,
): Promise<string> {
  await ensureRepoPath(repoPath);
  await ensureLocalBranch(repoPath, baseBranch);

  const normalizedNewBranch = newBranch.trim();
  if (!normalizedNewBranch) {
    throw new Error("newBranch is required.");
  }

  if (normalizedNewBranch === baseBranch) {
    throw new Error("newBranch must be different from baseBranch.");
  }

  await runGit(["check-ref-format", "--branch", normalizedNewBranch], repoPath);

  if (await localBranchExists(repoPath, normalizedNewBranch)) {
    throw new Error(`Local branch '${normalizedNewBranch}' already exists.`);
  }

  return normalizedNewBranch;
}

async function ensureDeletableLocalBranch(repoPath: string, branchName: string): Promise<void> {
  await ensureRepoPath(repoPath);
  await ensureLocalBranch(repoPath, branchName);

  const currentBranch = await getCurrentBranch(repoPath);
  if (currentBranch === branchName) {
    throw new Error(`Cannot delete branch '${branchName}' checked out at '${repoPath}'`);
  }
}

async function ensureDeletableRemoteBranch(
  repoPath: string,
  branchName: string,
): Promise<{ remoteName: string; remoteBranchName: string }> {
  await ensureRepoPath(repoPath);
  const { remoteName, remoteBranchName } = parseRemoteBranchName(branchName);
  await runGit(["rev-parse", "--verify", `refs/remotes/${branchName}`], repoPath);

  const defaultBranchName = await getRemoteDefaultBranchName(repoPath, remoteName);
  if (defaultBranchName && remoteBranchName === defaultBranchName) {
    throw new Error(
      `Default branch '${defaultBranchName}' on remote '${remoteName}' cannot be deleted.`,
    );
  }

  return {
    remoteName,
    remoteBranchName,
  };
}

export async function getBranches(repoPath: string): Promise<{
  current: string;
  local: Branch[];
  remote: Branch[];
}> {
  await ensureRepoPath(repoPath);

  const refs = await runGit(
    [
      "for-each-ref",
      "--format=%(refname)|%(refname:short)|%(objectname)|%(symref:short)",
      "refs/heads",
      "refs/remotes",
    ],
    repoPath,
  );

  const local: Branch[] = [];
  const remoteEntries: Array<{
    name: string;
    fullRef: string;
    commit: string;
    remoteName: string;
    remoteBranchName: string;
  }> = [];
  const remoteDefaultBranchNames = new Map<string, string>();

  for (const line of refs.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    const [fullRef, name, commit, symref = ""] = line.split("|");
    if (!fullRef || !name || !commit) {
      continue;
    }

    if (fullRef.startsWith("refs/heads/")) {
      local.push({
        name,
        fullRef,
        type: "local",
        commit,
      });
      continue;
    }

    if (fullRef.endsWith("/HEAD") || name.endsWith("/HEAD")) {
      if (symref) {
        try {
          const { remoteName, remoteBranchName } = parseRemoteBranchName(symref);
          remoteDefaultBranchNames.set(remoteName, remoteBranchName);
        } catch {
          // ignore malformed symbolic refs
        }
      }
      continue;
    }

    try {
      const { remoteName, remoteBranchName } = parseRemoteBranchName(name);
      remoteEntries.push({
        name,
        fullRef,
        commit,
        remoteName,
        remoteBranchName,
      });
    } catch {
      // ignore malformed remote refs
    }
  }

  for (const remoteName of new Set(remoteEntries.map((entry) => entry.remoteName))) {
    if (remoteDefaultBranchNames.has(remoteName)) {
      continue;
    }

    const defaultBranchName = await getRemoteDefaultBranchName(repoPath, remoteName);
    if (defaultBranchName) {
      remoteDefaultBranchNames.set(remoteName, defaultBranchName);
    }
  }

  const remote: Branch[] = remoteEntries.map(
    ({ name, fullRef, commit, remoteName, remoteBranchName }) => ({
      name,
      fullRef,
      type: "remote",
      commit,
      isRemoteDefault: remoteDefaultBranchNames.get(remoteName) === remoteBranchName || undefined,
    }),
  );

  const current = await getCurrentBranch(repoPath);

  return {
    current,
    local,
    remote,
  };
}

export async function checkoutRef(repoPath: string, ref: string): Promise<void> {
  await ensureRepoPath(repoPath);
  await runGit(["checkout", ref], repoPath);
}

export async function getPullStatus(repoPath: string): Promise<PullStatus> {
  await ensureRepoPath(repoPath);

  const branchName = await getCurrentBranch(repoPath);
  if (!branchName.trim() || branchName === "HEAD") {
    return {
      branchName: null,
      upstreamName: null,
      remoteName: null,
      remoteBranchName: null,
      aheadCount: 0,
      behindCount: 0,
      canPull: false,
      state: "detached",
    };
  }

  const upstreamName = await getBranchUpstream(repoPath, branchName);
  if (!upstreamName) {
    return {
      branchName,
      upstreamName: null,
      remoteName: null,
      remoteBranchName: null,
      aheadCount: 0,
      behindCount: 0,
      canPull: false,
      state: "noUpstream",
    };
  }

  const [aheadCountOutput, behindCountOutput] = await Promise.all([
    runGit(["rev-list", "--count", `${upstreamName}..${branchName}`], repoPath),
    runGit(["rev-list", "--count", `${branchName}..${upstreamName}`], repoPath),
  ]);
  const aheadCount = parseCommitCount(aheadCountOutput);
  const behindCount = parseCommitCount(behindCountOutput);
  const state = resolvePullStatusState(aheadCount, behindCount);

  let remoteName: string | null = null;
  let remoteBranchName: string | null = null;
  try {
    ({ remoteName, remoteBranchName } = parseRemoteBranchName(upstreamName));
  } catch {
    // upstream may not be a remote-tracking ref; keep the short name only
  }

  return {
    branchName,
    upstreamName,
    remoteName,
    remoteBranchName,
    aheadCount,
    behindCount,
    canPull: state === "behind",
    state,
  };
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

async function mergeBranchWithoutCheckout(
  repoPath: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<ConflictOperationResult> {
  const tempRootPath = await fs.mkdtemp(path.join(os.tmpdir(), "git-chat-ui-merge-"));
  const worktreePath = path.join(tempRootPath, "worktree");
  const targetBranchRef = `refs/heads/${targetBranch}`;
  const previousTargetSha = await getBranchHeadSha(repoPath, targetBranch);
  let keepWorktree = false;

  try {
    await runGit(["worktree", "add", "--detach", worktreePath, targetBranch], repoPath);
    await runGit(["merge", sourceBranch], worktreePath);

    const mergedTargetSha = await runGit(["rev-parse", "HEAD"], worktreePath);
    if (mergedTargetSha !== previousTargetSha) {
      await runGit(
        [
          "update-ref",
          "-m",
          `branch action merge ${sourceBranch} into ${targetBranch}`,
          targetBranchRef,
          mergedTargetSha,
          previousTargetSha,
        ],
        repoPath,
      );
    }

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/merge conflict|conflict/i.test(message)) {
      keepWorktree = true;
      const session = registerMergeSession({
        repoPath,
        tempRootPath,
        worktreePath,
        sourceBranch,
        targetBranch,
        previousTargetSha,
      });
      return {
        ok: false,
        conflict: await getConflictSummaryForContext({
          repoPath,
          sessionId: session.id,
          operation: "merge",
          sourceBranch,
          targetBranch,
        }),
      };
    }

    throw error;
  } finally {
    if (!keepWorktree) {
      await removeTemporaryWorktree(repoPath, tempRootPath, worktreePath);
    }
  }
}

export async function mergeBranches(
  repoPath: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<ConflictOperationResult> {
  await ensureRepoPath(repoPath);
  await ensureBranchPair(repoPath, sourceBranch, targetBranch);

  const currentBranch = await getCurrentBranch(repoPath);
  if (currentBranch === targetBranch) {
    try {
      await runGit(["merge", sourceBranch], repoPath);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/merge conflict|conflict/i.test(message)) {
        return {
          ok: false,
          conflict: await getConflictSummaryForContext({
            repoPath,
            operation: "merge",
            sourceBranch,
            targetBranch,
          }),
        };
      }

      throw error;
    }
  }

  return mergeBranchWithoutCheckout(repoPath, sourceBranch, targetBranch);
}

export async function createBranch(
  repoPath: string,
  baseBranch: string,
  newBranch: string,
): Promise<void> {
  const normalizedNewBranch = await validateCreateBranchInput(repoPath, baseBranch, newBranch);
  await runGit(["checkout", "-b", normalizedNewBranch, baseBranch], repoPath);
}

export async function deleteBranch(
  repoPath: string,
  branchName: string,
  branchType: "local" | "remote",
  forceDelete = false,
): Promise<void> {
  if (branchType === "remote") {
    const { remoteName, remoteBranchName } = await ensureDeletableRemoteBranch(
      repoPath,
      branchName,
    );
    await runGit(["push", remoteName, "--delete", remoteBranchName], repoPath);
    await runGit(["fetch", remoteName, "--prune"], repoPath);
    return;
  }

  await ensureDeletableLocalBranch(repoPath, branchName);
  await runGit(["branch", forceDelete ? "-D" : "-d", branchName], repoPath);
}

export async function getBranchUpstream(
  repoPath: string,
  branchName: string,
): Promise<string | null> {
  try {
    const upstream = await runGit(
      ["rev-parse", "--abbrev-ref", `${branchName}@{upstream}`],
      repoPath,
    );
    return upstream.trim() || null;
  } catch {
    return null;
  }
}

export async function isPushRequired(repoPath: string, branchName: string): Promise<boolean> {
  const upstream = await getBranchUpstream(repoPath, branchName);
  if (!upstream) {
    return true;
  }

  const aheadCount = await runGit(["rev-list", "--count", `${upstream}..${branchName}`], repoPath);
  return Number(aheadCount) > 0;
}

async function syncUpstreamTrackingRefToBranchHead(
  repoPath: string,
  branchName: string,
): Promise<void> {
  const upstream = await getBranchUpstream(repoPath, branchName);
  if (!upstream) {
    return;
  }

  try {
    parseRemoteBranchName(upstream);
  } catch {
    return;
  }

  const head = await getBranchHeadSha(repoPath, branchName);
  await runGit(
    ["update-ref", "-m", `sync tracking ref for ${branchName}`, `refs/remotes/${upstream}`, head],
    repoPath,
  );
}

export async function syncCurrentBranchUpstreamTrackingRef(repoPath: string): Promise<void> {
  await ensureRepoPath(repoPath);

  const branchName = await getCurrentBranch(repoPath);
  if (!branchName.trim() || branchName === "HEAD") {
    return;
  }

  await syncUpstreamTrackingRefToBranchHead(repoPath, branchName);
}

export async function pullCurrentBranch(repoPath: string): Promise<void> {
  await ensureRepoPath(repoPath);

  const branchName = await getCurrentBranch(repoPath);
  if (!branchName.trim() || branchName === "HEAD") {
    throw new Error("Cannot pull while HEAD is detached.");
  }

  const upstream = await getBranchUpstream(repoPath, branchName);
  if (!upstream) {
    throw new Error(`Current branch '${branchName}' has no upstream branch.`);
  }

  await runGit(["pull", "--ff-only"], repoPath, {
    GIT_TERMINAL_PROMPT: "0",
  });
}

export async function pushBranchToOrigin(repoPath: string, branchName: string): Promise<void> {
  const upstream = await getBranchUpstream(repoPath, branchName);

  if (upstream) {
    await runGit(["push", "origin", branchName], repoPath);
  } else {
    await runGit(["push", "-u", "origin", branchName], repoPath);
  }

  await syncUpstreamTrackingRefToBranchHead(repoPath, branchName);
}
