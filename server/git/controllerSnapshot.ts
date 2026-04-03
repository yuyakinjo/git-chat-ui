import type { ControllerSnapshot } from "../types.js";

import { getBranches, getPullStatus } from "./branch.js";
import { getCommits } from "./commit.js";
import { getRepositoryFingerprint } from "./repository.js";
import { getStashes } from "./stash.js";
import { getWorkingTreeStatus } from "./workingTree.js";

const MAX_CONTROLLER_SNAPSHOT_CACHE_ENTRIES = 128;

export interface GetControllerSnapshotOptions {
  repoPath: string;
  ref?: string;
  compareRefs?: string[];
  offset?: number;
  limit?: number;
  includeCommits?: boolean;
}

interface ControllerSnapshotLoaderDependencies {
  getRepositoryFingerprint: typeof getRepositoryFingerprint;
  getBranches: typeof getBranches;
  getWorkingTreeStatus: typeof getWorkingTreeStatus;
  getStashes: typeof getStashes;
  getPullStatus: typeof getPullStatus;
  getCommits: typeof getCommits;
}

function getRemoteBranchShortName(branchName: string): string {
  const parts = branchName.trim().split("/").filter(Boolean);
  if (parts.length <= 1) {
    return branchName.trim();
  }

  return parts.slice(1).join("/");
}

function resolveDefaultBranchRef(branches: ControllerSnapshot["branches"]): string | undefined {
  const remoteDefault = branches.remote.find((branch) => branch.isRemoteDefault);
  const remoteDefaultLocalCandidate = remoteDefault
    ? branches.local.find((branch) => branch.name === getRemoteBranchShortName(remoteDefault.name))
    : undefined;
  const candidate =
    remoteDefaultLocalCandidate ??
    branches.local.find((branch) => branch.name === "main") ??
    branches.local.find((branch) => branch.name === "master") ??
    branches.local.find((branch) => branch.name === branches.current) ??
    branches.local[0];

  if (!candidate) {
    return undefined;
  }

  return candidate.fullRef || candidate.name;
}

function resolveSnapshotLogRef(
  requestedRef: string | undefined,
  branches: ControllerSnapshot["branches"],
): string {
  const normalizedRequestedRef = requestedRef?.trim() || "HEAD";
  if (normalizedRequestedRef !== "HEAD") {
    return normalizedRequestedRef;
  }

  const currentLocalBranch = branches.local.find((branch) => branch.name === branches.current);
  if (!currentLocalBranch) {
    return "HEAD";
  }

  return currentLocalBranch.fullRef || currentLocalBranch.name;
}

function normalizeExplicitCompareRefs(logRef: string, compareRefs: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>([logRef]);

  for (const compareRef of compareRefs) {
    const candidate = compareRef.trim();
    if (!candidate || seen.has(candidate)) {
      continue;
    }

    seen.add(candidate);
    normalized.push(candidate);
  }

  return normalized;
}

function buildAutomaticCompareRefs(
  logRef: string,
  branches: ControllerSnapshot["branches"],
): string[] {
  const defaultRef = resolveDefaultBranchRef(branches);
  const refs = branches.local.map((branch) => branch.fullRef || branch.name);
  const ordered = defaultRef ? [defaultRef, ...refs.filter((ref) => ref !== defaultRef)] : refs;
  const deduped = [...new Set(ordered)];

  return deduped.filter((ref) => ref && ref !== logRef);
}

function buildCacheKey(options: {
  repoPath: string;
  fingerprint: string;
  ref: string;
  compareRefsMode: "auto" | "explicit";
  compareRefs: string[];
  offset: number;
  limit: number;
  includeCommits: boolean;
}): string {
  return JSON.stringify(options);
}

function clampSnapshotLimit(limit: number | undefined): number {
  const resolvedLimit = Number.isFinite(limit) ? Math.trunc(limit ?? 50) : 50;
  return Math.min(Math.max(resolvedLimit, 1), 100);
}

function clampSnapshotOffset(offset: number | undefined): number {
  const resolvedOffset = Number.isFinite(offset) ? Math.trunc(offset ?? 0) : 0;
  return Math.max(resolvedOffset, 0);
}

function writeCacheEntry(
  cache: Map<string, ControllerSnapshot>,
  key: string,
  value: ControllerSnapshot,
): void {
  if (!cache.has(key) && cache.size >= MAX_CONTROLLER_SNAPSHOT_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey === "string") {
      cache.delete(oldestKey);
    }
  }

  cache.set(key, value);
}

export function createControllerSnapshotLoader(
  dependencies: ControllerSnapshotLoaderDependencies = {
    getRepositoryFingerprint,
    getBranches,
    getWorkingTreeStatus,
    getStashes,
    getPullStatus,
    getCommits,
  },
): (options: GetControllerSnapshotOptions) => Promise<ControllerSnapshot> {
  const cache = new Map<string, ControllerSnapshot>();

  return async function loadControllerSnapshot(
    options: GetControllerSnapshotOptions,
  ): Promise<ControllerSnapshot> {
    const requestedRef = options.ref?.trim() || "HEAD";
    const explicitCompareRefs = options.compareRefs
      ? normalizeExplicitCompareRefs(requestedRef, options.compareRefs)
      : [];
    const compareRefsMode = options.compareRefs === undefined ? "auto" : "explicit";
    const offset = clampSnapshotOffset(options.offset);
    const limit = clampSnapshotLimit(options.limit);
    const includeCommits = options.includeCommits !== false;
    const fingerprint = await dependencies.getRepositoryFingerprint(options.repoPath);
    const cacheKey = buildCacheKey({
      repoPath: options.repoPath,
      fingerprint,
      ref: requestedRef,
      compareRefsMode,
      compareRefs: explicitCompareRefs,
      offset,
      limit,
      includeCommits,
    });
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const [branches, workingTreeStatus, stashes, pullStatus] = await Promise.all([
      dependencies.getBranches(options.repoPath),
      dependencies.getWorkingTreeStatus(options.repoPath),
      dependencies.getStashes(options.repoPath),
      dependencies.getPullStatus(options.repoPath),
    ]);
    const logRef = resolveSnapshotLogRef(requestedRef, branches);
    const compareRefs =
      compareRefsMode === "explicit"
        ? normalizeExplicitCompareRefs(logRef, explicitCompareRefs)
        : buildAutomaticCompareRefs(logRef, branches);
    const commits = includeCommits
      ? await dependencies.getCommits({
          repoPath: options.repoPath,
          ref: logRef,
          compareRefs,
          offset,
          limit,
        })
      : null;
    const snapshot: ControllerSnapshot = {
      fingerprint,
      branches,
      logRef,
      compareRefs,
      commits,
      workingTreeStatus,
      stashes,
      pullStatus,
    };

    writeCacheEntry(cache, cacheKey, snapshot);
    return snapshot;
  };
}

export const getControllerSnapshot = createControllerSnapshotLoader();
