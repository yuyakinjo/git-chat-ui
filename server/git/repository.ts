import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Repository } from "../types.js";

import { getBranchUpstream, getCurrentBranch } from "./branch.js";
import { ensureRepoPath, runGit, SKIP_DIRS } from "./command.js";
import { normalizeGithubRemoteUrl } from "./pullRequest.js";

function sortRepositoriesByRecency(
  repositories: Repository[],
  recentMap: Map<string, string>,
): Repository[] {
  return repositories
    .map((repo) => ({
      ...repo,
      recentlyUsedAt: recentMap.get(repo.path),
    }))
    .sort((left, right) => {
      if (left.recentlyUsedAt && right.recentlyUsedAt) {
        return right.recentlyUsedAt.localeCompare(left.recentlyUsedAt);
      }

      if (left.recentlyUsedAt) {
        return -1;
      }

      if (right.recentlyUsedAt) {
        return 1;
      }

      return left.name.localeCompare(right.name);
    });
}

export async function discoverRepositories(options: {
  query?: string;
  recentMap: Map<string, string>;
  maxDepth: number;
}): Promise<Repository[]> {
  const query = options.query?.trim().toLowerCase();
  const home = os.homedir();
  const discovered: Repository[] = [];
  const seen = new Set<string>();
  const maxDepth = Math.max(1, Math.min(Math.round(options.maxDepth), 8));
  const maxRepos = 300;

  async function walk(currentPath: string, depth: number): Promise<void> {
    if (depth > maxDepth || discovered.length >= maxRepos) {
      return;
    }

    let entries: Dirent[];

    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    const hasGitDirectory = entries.some((entry) => entry.name === ".git" && entry.isDirectory());

    if (hasGitDirectory) {
      const repository: Repository = {
        name: path.basename(currentPath),
        path: currentPath,
      };

      const lowercaseName = repository.name.toLowerCase();
      if ((!query || lowercaseName.includes(query)) && !seen.has(repository.path)) {
        discovered.push(repository);
        seen.add(repository.path);
      }
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.name.startsWith(".") && entry.name !== ".config") {
        continue;
      }

      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }

      const nextPath = path.join(currentPath, entry.name);
      if (SKIP_DIRS.has(path.relative(home, nextPath))) {
        continue;
      }

      await walk(nextPath, depth + 1);
      if (discovered.length >= maxRepos) {
        return;
      }
    }
  }

  await walk(home, 0);

  return sortRepositoriesByRecency(discovered, options.recentMap);
}

export async function resolveRepositories(repoPaths: string[]): Promise<Repository[]> {
  const resolved: Repository[] = [];
  const seen = new Set<string>();

  for (const candidate of repoPaths) {
    if (typeof candidate !== "string") {
      continue;
    }

    const inputPath = candidate.trim();
    if (!inputPath) {
      continue;
    }

    const repoPath = await fs.realpath(inputPath).catch(() => path.resolve(inputPath));
    if (seen.has(repoPath)) {
      continue;
    }

    try {
      await ensureRepoPath(repoPath);
    } catch {
      continue;
    }

    seen.add(repoPath);
    resolved.push({
      name: path.basename(repoPath),
      path: repoPath,
    });
  }

  return resolved;
}

export async function getRepositoryGithubUrl(repoPath: string): Promise<string | null> {
  await ensureRepoPath(repoPath);

  try {
    const remoteUrl = await runGit(["remote", "get-url", "origin"], repoPath);
    return normalizeGithubRemoteUrl(remoteUrl);
  } catch {
    return null;
  }
}

export async function getRepositoryFingerprint(repoPath: string): Promise<string> {
  await ensureRepoPath(repoPath);

  const [head, currentBranch, status, stashList] = await Promise.all([
    runGit(["rev-parse", "HEAD"], repoPath),
    getCurrentBranch(repoPath),
    runGit(["status", "--porcelain=v1", "-uall"], repoPath),
    runGit(["stash", "list", "--format=%gd%x1f%H%x1f%gs"], repoPath),
  ]);
  const upstreamName =
    currentBranch && currentBranch !== "HEAD"
      ? await getBranchUpstream(repoPath, currentBranch)
      : null;
  const upstreamHead = upstreamName
    ? await runGit(["rev-parse", "--verify", upstreamName], repoPath).catch(() => "")
    : "";

  return createHash("sha1")
    .update(
      `${head}\n${currentBranch}\n${upstreamName ?? ""}\n${upstreamHead}\n${status}\n${stashList}`,
    )
    .digest("hex");
}
