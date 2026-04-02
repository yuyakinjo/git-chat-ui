import { ensureRepoPath, runGh, runGit } from "./command.js";
import {
  ensureBranchPair,
  ensureOriginRemote,
  isPushRequired,
  pushBranchToOrigin,
} from "./branch.js";

export function normalizeGithubRemoteUrl(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) {
    return null;
  }

  const sshMatch = trimmed.match(/^git@github\.com:(?<repo>[^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i);
  if (sshMatch?.groups?.repo) {
    return `https://github.com/${sshMatch.groups.repo}`;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.toLowerCase() !== "github.com") {
      return null;
    }

    const repoPath = parsed.pathname
      .replace(/^\/+/, "")
      .replace(/\/+$/, "")
      .replace(/\.git$/i, "");
    if (!/^[^/]+\/[^/]+$/.test(repoPath)) {
      return null;
    }

    return `https://github.com/${repoPath}`;
  } catch {
    return null;
  }
}

async function ensureGithubAuth(repoPath: string): Promise<void> {
  await runGh(["auth", "status", "-h", "github.com"], repoPath);
}

export async function getOpenPullRequestUrls(repoPath: string): Promise<Record<string, string>> {
  await ensureRepoPath(repoPath);

  try {
    const remoteUrl = await runGit(["remote", "get-url", "origin"], repoPath);
    if (!normalizeGithubRemoteUrl(remoteUrl)) {
      return {};
    }
  } catch {
    return {};
  }

  try {
    await ensureGithubAuth(repoPath);
  } catch {
    return {};
  }

  let output = "";

  try {
    output = await runGh(
      ["pr", "list", "--state", "open", "--limit", "200", "--json", "headRefName,url"],
      repoPath,
    );
  } catch {
    return {};
  }

  if (!output.trim()) {
    return {};
  }

  let parsed: Array<{ headRefName?: string; url?: string }> = [];

  try {
    parsed = JSON.parse(output) as Array<{ headRefName?: string; url?: string }>;
  } catch {
    return {};
  }

  const urls: Record<string, string> = {};

  for (const item of parsed) {
    const headRefName = item.headRefName?.trim();
    const url = item.url?.trim();
    if (!headRefName || !url || headRefName in urls) {
      continue;
    }

    urls[headRefName] = url;
  }

  return urls;
}

async function findExistingPullRequest(
  repoPath: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<string | null> {
  const output = await runGh(
    [
      "pr",
      "list",
      "--state",
      "open",
      "--head",
      sourceBranch,
      "--base",
      targetBranch,
      "--json",
      "url",
    ],
    repoPath,
  );

  if (!output.trim()) {
    return null;
  }

  const parsed = JSON.parse(output) as Array<{ url?: string }>;
  return parsed[0]?.url?.trim() || null;
}

function extractUrlFromText(text: string): string | null {
  return (
    text
      .split(/\s+/)
      .find((token) => /^https?:\/\//.test(token))
      ?.trim() ?? null
  );
}

export async function preparePullRequest(
  repoPath: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<{ pushRequired: boolean }> {
  await ensureRepoPath(repoPath);
  await ensureBranchPair(repoPath, sourceBranch, targetBranch);
  await ensureOriginRemote(repoPath);
  await ensureGithubAuth(repoPath);

  return {
    pushRequired: await isPushRequired(repoPath, sourceBranch),
  };
}

export async function createPullRequest(
  repoPath: string,
  sourceBranch: string,
  targetBranch: string,
  pushSourceBranch: boolean,
): Promise<{ url: string }> {
  await ensureRepoPath(repoPath);
  await ensureBranchPair(repoPath, sourceBranch, targetBranch);
  await ensureOriginRemote(repoPath);
  await ensureGithubAuth(repoPath);

  const pushRequired = await isPushRequired(repoPath, sourceBranch);
  if (pushRequired && !pushSourceBranch) {
    throw new Error("Source branch must be pushed before creating a pull request.");
  }

  if (pushSourceBranch) {
    await pushBranchToOrigin(repoPath, sourceBranch);
  }

  const existingUrl = await findExistingPullRequest(repoPath, sourceBranch, targetBranch);
  if (existingUrl) {
    throw new Error(`Pull request already exists: ${existingUrl}`);
  }

  const output = await runGh(
    ["pr", "create", "--base", targetBranch, "--head", sourceBranch, "--fill"],
    repoPath,
  );
  const url = extractUrlFromText(output);

  if (!url) {
    throw new Error("Pull request created but URL was not returned.");
  }

  return { url };
}
