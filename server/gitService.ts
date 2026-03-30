import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type {
  Branch,
  BranchDiffDetail,
  CommitDetail,
  CommitListItem,
  Repository,
  StashEntry,
  WorkingFile,
  WorkingTreeStatus
} from './types.js';

const execFileAsync = promisify(execFile);

const SKIP_DIRS = new Set([
  '.git',
  '.Trash',
  '.cache',
  '.npm',
  '.yarn',
  'Library',
  'node_modules'
]);

function statusLabel(code: string): string {
  switch (code) {
    case 'M':
      return 'Modified';
    case 'A':
      return 'Added';
    case 'D':
      return 'Deleted';
    case 'R':
      return 'Renamed';
    case 'C':
      return 'Copied';
    case 'U':
      return 'Updated';
    case '?':
      return 'Untracked';
    default:
      return 'Changed';
  }
}

async function runCommand(command: string, args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd,
      maxBuffer: 20 * 1024 * 1024
    });

    return stdout.trimEnd();
  } catch (error) {
    const typed = error as Error & { stderr?: string; stdout?: string };
    const stderr = typed.stderr?.trim();
    const stdout = typed.stdout?.trim();
    throw new Error(stderr || stdout || typed.message || `Failed to execute ${command} command.`);
  }
}

async function runGit(args: string[], repoPath: string): Promise<string> {
  return runCommand('git', args, repoPath);
}

async function runGh(args: string[], repoPath: string): Promise<string> {
  return runCommand('gh', args, repoPath);
}

async function ensureRepoPath(repoPath: string): Promise<void> {
  if (!path.isAbsolute(repoPath)) {
    throw new Error('Repository path must be absolute.');
  }

  const stat = await fs.stat(repoPath);
  if (!stat.isDirectory()) {
    throw new Error('Repository path is not a directory.');
  }

  await runGit(['rev-parse', '--is-inside-work-tree'], repoPath);
}

function sortRepositoriesByRecency(repositories: Repository[], recentMap: Map<string, string>): Repository[] {
  return repositories
    .map((repo) => ({
      ...repo,
      recentlyUsedAt: recentMap.get(repo.path)
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

    const hasGitDirectory = entries.some((entry) => entry.name === '.git' && entry.isDirectory());

    if (hasGitDirectory) {
      const repository: Repository = {
        name: path.basename(currentPath),
        path: currentPath
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

      if (entry.name.startsWith('.') && entry.name !== '.config') {
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

export async function getCurrentBranch(repoPath: string): Promise<string> {
  await ensureRepoPath(repoPath);
  return runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
}

export async function getBranches(repoPath: string): Promise<{
  current: string;
  local: Branch[];
  remote: Branch[];
}> {
  await ensureRepoPath(repoPath);

  const refs = await runGit(
    [
      'for-each-ref',
      '--format=%(refname)|%(refname:short)|%(objectname)',
      'refs/heads',
      'refs/remotes'
    ],
    repoPath
  );

  const local: Branch[] = [];
  const remote: Branch[] = [];

  for (const line of refs.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    const [fullRef, name, commit] = line.split('|');
    if (!fullRef || !name || !commit) {
      continue;
    }

    if (fullRef.startsWith('refs/heads/')) {
      local.push({
        name,
        fullRef,
        type: 'local',
        commit
      });
      continue;
    }

    if (name.endsWith('/HEAD')) {
      continue;
    }

    remote.push({
      name,
      fullRef,
      type: 'remote',
      commit
    });
  }

  const current = await getCurrentBranch(repoPath);

  return {
    current,
    local,
    remote
  };
}

export async function getCommits(options: {
  repoPath: string;
  ref?: string;
  compareRefs?: string[];
  limit: number;
  offset: number;
}): Promise<{
  commits: CommitListItem[];
  hasMore: boolean;
}> {
  await ensureRepoPath(options.repoPath);

  const ref = options.ref && options.ref.trim() ? options.ref : 'HEAD';
  const compareRefs: string[] = [];
  const seen = new Set<string>([ref]);
  for (const compareRef of options.compareRefs ?? []) {
    const normalized = compareRef.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    compareRefs.push(normalized);
    seen.add(normalized);
  }

  const logArgs = [
    'log',
    '--decorate=short',
    '--topo-order',
    '--date=iso-strict',
    `--skip=${options.offset}`,
    `-n`,
    String(options.limit),
    '--pretty=format:%H%x1f%P%x1f%an%x1f%ad%x1f%s%x1f%d%x1e',
    ref,
    ...compareRefs,
    '--'
  ];

  const output = await runGit(logArgs, options.repoPath);

  const records = output.split('\x1e').filter((record) => record.trim().length > 0);

  const commits: CommitListItem[] = records.flatMap((record) => {
    const [shaRaw, parentsRaw, authorRaw, dateRaw, subjectRaw, decorationRaw] = record.split('\x1f');
    const sha = shaRaw?.trim();

    if (!sha) {
      return [];
    }

    const parents = parentsRaw?.trim() ?? '';

    return [
      {
        sha,
        parentShas: parents
          ? parents
              .split(' ')
              .map((value) => value.trim())
              .filter(Boolean)
          : [],
        author: authorRaw?.trim() ?? '',
        date: dateRaw?.trim() ?? '',
        subject: subjectRaw?.trim() ?? '',
        decoration: decorationRaw?.trim() ?? ''
      }
    ];
  });

  return {
    commits,
    hasMore: commits.length === options.limit
  };
}

export async function getCommitDetail(repoPath: string, sha: string): Promise<CommitDetail> {
  await ensureRepoPath(repoPath);

  const meta = await runGit(
    ['show', '-s', '--date=iso-strict', '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%B', sha],
    repoPath
  );

  const [fullSha, parents, author, email, date, body] = meta.split('\x1f');

  const fileStatsOutput = await runGit(['show', '--pretty=format:', '--numstat', sha], repoPath);
  const files = fileStatsOutput
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [additionsRaw, deletionsRaw, file] = line.split('\t');

      return {
        file,
        additions: Number.isNaN(Number(additionsRaw)) ? 0 : Number(additionsRaw),
        deletions: Number.isNaN(Number(deletionsRaw)) ? 0 : Number(deletionsRaw)
      };
    });

  const diff = await runGit(['show', '--pretty=format:', sha], repoPath);

  return {
    sha: fullSha,
    parentShas: parents ? parents.split(' ').filter(Boolean) : [],
    author,
    email,
    date,
    body,
    files,
    diff: diff.slice(0, 25000)
  };
}

export async function getBranchDiffDetail(options: {
  repoPath: string;
  baseRef: string;
  targetRef: string;
}): Promise<BranchDiffDetail> {
  await ensureRepoPath(options.repoPath);

  const baseRef = options.baseRef.trim();
  const targetRef = options.targetRef.trim();

  if (!baseRef) {
    throw new Error('baseRef is required.');
  }

  if (!targetRef) {
    throw new Error('targetRef is required.');
  }

  const mergeBaseSha = await runGit(['merge-base', baseRef, targetRef], options.repoPath);
  const range = `${mergeBaseSha}..${targetRef}`;
  const fileStatsOutput = await runGit(['diff', '--numstat', range], options.repoPath);
  const files = fileStatsOutput
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [additionsRaw, deletionsRaw, file] = line.split('\t');

      return {
        file,
        additions: Number.isNaN(Number(additionsRaw)) ? 0 : Number(additionsRaw),
        deletions: Number.isNaN(Number(deletionsRaw)) ? 0 : Number(deletionsRaw)
      };
    });

  const diff = await runGit(['diff', range], options.repoPath);
  const isDiffTruncated = diff.length > 25000;

  return {
    baseRef,
    targetRef,
    mergeBaseSha,
    files,
    diff: diff.slice(0, 25000),
    isDiffTruncated
  };
}

export async function getWorkingTreeStatus(repoPath: string): Promise<WorkingTreeStatus> {
  await ensureRepoPath(repoPath);

  const statusOutput = await runGit(['status', '--porcelain=v1', '-uall'], repoPath);
  const staged: WorkingFile[] = [];
  const unstaged: WorkingFile[] = [];

  for (const line of statusOutput.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    const x = line[0] ?? ' ';
    const y = line[1] ?? ' ';
    const rawPath = line.slice(3).trim();
    const file = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) ?? rawPath : rawPath;

    const normalizedStatus = statusLabel(x !== ' ' && x !== '?' ? x : y);

    if (x !== ' ' && x !== '?') {
      staged.push({
        file,
        x,
        y,
        statusLabel: normalizedStatus
      });
    }

    if (y !== ' ' || x === '?') {
      unstaged.push({
        file,
        x,
        y,
        statusLabel: normalizedStatus
      });
    }
  }

  return {
    staged,
    unstaged
  };
}

export async function stageFile(repoPath: string, file: string): Promise<void> {
  await ensureRepoPath(repoPath);
  await runGit(['add', '--', file], repoPath);
}

export async function unstageFile(repoPath: string, file: string): Promise<void> {
  await ensureRepoPath(repoPath);

  try {
    await runGit(['restore', '--staged', '--', file], repoPath);
  } catch {
    await runGit(['reset', 'HEAD', '--', file], repoPath);
  }
}

export async function stashFile(repoPath: string, file: string): Promise<void> {
  await ensureRepoPath(repoPath);
  await runGit(['stash', 'push', '-m', `git-chat-ui: ${file}`, '--', file], repoPath);
}

export async function getStashes(repoPath: string): Promise<StashEntry[]> {
  await ensureRepoPath(repoPath);

  const output = await runGit(['stash', 'list', '--format=%gd%x1f%cr%x1f%s'], repoPath);

  const stashes = output
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [id, relativeDate, message] = line.split('\x1f');
      return {
        id,
        relativeDate,
        message,
        files: [] as string[]
      };
    });

  for (const stash of stashes) {
    try {
      const filesOutput = await runGit(['stash', 'show', '--name-only', '--format=', stash.id], repoPath);
      stash.files = filesOutput
        .split('\n')
        .map((file) => file.trim())
        .filter((file) => file.length > 0);
    } catch {
      stash.files = [];
    }
  }

  return stashes;
}

export async function checkoutRef(repoPath: string, ref: string): Promise<void> {
  await ensureRepoPath(repoPath);
  await runGit(['checkout', ref], repoPath);
}

async function ensureLocalBranch(repoPath: string, branchName: string): Promise<void> {
  if (!branchName.trim()) {
    throw new Error('branchName is required.');
  }

  await runGit(['rev-parse', '--verify', `refs/heads/${branchName}`], repoPath);
}

async function ensureBranchPair(repoPath: string, sourceBranch: string, targetBranch: string): Promise<void> {
  if (!sourceBranch.trim() || !targetBranch.trim()) {
    throw new Error('sourceBranch and targetBranch are required.');
  }

  if (sourceBranch === targetBranch) {
    throw new Error('sourceBranch and targetBranch must be different.');
  }

  await Promise.all([ensureLocalBranch(repoPath, sourceBranch), ensureLocalBranch(repoPath, targetBranch)]);
}

async function ensureOriginRemote(repoPath: string): Promise<void> {
  await runGit(['remote', 'get-url', 'origin'], repoPath);
}

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
    if (parsed.hostname.toLowerCase() !== 'github.com') {
      return null;
    }

    const repoPath = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/i, '');
    if (!/^[^/]+\/[^/]+$/.test(repoPath)) {
      return null;
    }

    return `https://github.com/${repoPath}`;
  } catch {
    return null;
  }
}

async function ensureGithubAuth(repoPath: string): Promise<void> {
  await runGh(['auth', 'status', '-h', 'github.com'], repoPath);
}

async function getBranchUpstream(repoPath: string, branchName: string): Promise<string | null> {
  try {
    const upstream = await runGit(['rev-parse', '--abbrev-ref', `${branchName}@{upstream}`], repoPath);
    return upstream.trim() || null;
  } catch {
    return null;
  }
}

async function isPushRequired(repoPath: string, branchName: string): Promise<boolean> {
  const upstream = await getBranchUpstream(repoPath, branchName);
  if (!upstream) {
    return true;
  }

  const aheadCount = await runGit(['rev-list', '--count', `${upstream}..${branchName}`], repoPath);
  return Number(aheadCount) > 0;
}

async function pushBranchToOrigin(repoPath: string, branchName: string): Promise<void> {
  const upstream = await getBranchUpstream(repoPath, branchName);

  if (upstream) {
    await runGit(['push', 'origin', branchName], repoPath);
    return;
  }

  await runGit(['push', '-u', 'origin', branchName], repoPath);
}

async function findExistingPullRequest(repoPath: string, sourceBranch: string, targetBranch: string): Promise<string | null> {
  const output = await runGh(
    ['pr', 'list', '--state', 'open', '--head', sourceBranch, '--base', targetBranch, '--json', 'url'],
    repoPath
  );

  if (!output.trim()) {
    return null;
  }

  const parsed = JSON.parse(output) as Array<{ url?: string }>;
  return parsed[0]?.url?.trim() || null;
}

function extractUrlFromText(text: string): string | null {
  return text
    .split(/\s+/)
    .find((token) => /^https?:\/\//.test(token))
    ?.trim() ?? null;
}

async function ensureDeletableLocalBranch(repoPath: string, branchName: string): Promise<void> {
  await ensureRepoPath(repoPath);
  await ensureLocalBranch(repoPath, branchName);

  const currentBranch = await getCurrentBranch(repoPath);
  if (currentBranch === branchName) {
    throw new Error(`Cannot delete branch '${branchName}' checked out at '${repoPath}'`);
  }
}

function parseRemoteBranchName(branchName: string): { remoteName: string; remoteBranchName: string } {
  const parts = branchName.trim().split('/').filter(Boolean);
  const remoteName = parts[0];
  const remoteBranchName = parts.slice(1).join('/');

  if (!remoteName || !remoteBranchName) {
    throw new Error('branchName must include remote and branch name.');
  }

  return {
    remoteName,
    remoteBranchName
  };
}

async function getLocalDefaultBranchName(repoPath: string): Promise<string | null> {
  const branches = await getBranches(repoPath);
  const localBranches = branches.local;
  const candidate =
    localBranches.find((branch) => branch.name === 'main') ??
    localBranches.find((branch) => branch.name === 'master') ??
    localBranches.find((branch) => branch.name === branches.current) ??
    localBranches[0];

  return candidate?.name ?? null;
}

async function getRemoteDefaultBranchName(repoPath: string, remoteName: string): Promise<string | null> {
  try {
    const reference = await runGit(['symbolic-ref', '--quiet', '--short', `refs/remotes/${remoteName}/HEAD`], repoPath);
    const normalized = reference.trim();
    if (normalized.startsWith(`${remoteName}/`)) {
      return normalized.slice(remoteName.length + 1);
    }
  } catch {
    // fall back to local default branch heuristic
  }

  return getLocalDefaultBranchName(repoPath);
}

async function ensureDeletableRemoteBranch(
  repoPath: string,
  branchName: string
): Promise<{ remoteName: string; remoteBranchName: string }> {
  await ensureRepoPath(repoPath);
  const { remoteName, remoteBranchName } = parseRemoteBranchName(branchName);
  await runGit(['rev-parse', '--verify', `refs/remotes/${branchName}`], repoPath);

  const defaultBranchName = await getRemoteDefaultBranchName(repoPath, remoteName);
  if (defaultBranchName && remoteBranchName === defaultBranchName) {
    throw new Error(`Default branch '${defaultBranchName}' on remote '${remoteName}' cannot be deleted.`);
  }

  return {
    remoteName,
    remoteBranchName
  };
}

export async function mergeBranches(repoPath: string, sourceBranch: string, targetBranch: string): Promise<void> {
  await ensureRepoPath(repoPath);
  await ensureBranchPair(repoPath, sourceBranch, targetBranch);

  const currentBranch = await getCurrentBranch(repoPath);
  if (currentBranch !== targetBranch) {
    await runGit(['checkout', targetBranch], repoPath);
  }

  await runGit(['merge', sourceBranch], repoPath);
}

export async function deleteBranch(repoPath: string, branchName: string, branchType: 'local' | 'remote'): Promise<void> {
  if (branchType === 'remote') {
    const { remoteName, remoteBranchName } = await ensureDeletableRemoteBranch(repoPath, branchName);
    await runGit(['push', remoteName, '--delete', remoteBranchName], repoPath);
    await runGit(['fetch', remoteName, '--prune'], repoPath);
    return;
  }

  await ensureDeletableLocalBranch(repoPath, branchName);
  await runGit(['branch', '-d', branchName], repoPath);
}

export async function preparePullRequest(
  repoPath: string,
  sourceBranch: string,
  targetBranch: string
): Promise<{ pushRequired: boolean }> {
  await ensureRepoPath(repoPath);
  await ensureBranchPair(repoPath, sourceBranch, targetBranch);
  await ensureOriginRemote(repoPath);
  await ensureGithubAuth(repoPath);

  return {
    pushRequired: await isPushRequired(repoPath, sourceBranch)
  };
}

export async function createPullRequest(
  repoPath: string,
  sourceBranch: string,
  targetBranch: string,
  pushSourceBranch: boolean
): Promise<{ url: string }> {
  await ensureRepoPath(repoPath);
  await ensureBranchPair(repoPath, sourceBranch, targetBranch);
  await ensureOriginRemote(repoPath);
  await ensureGithubAuth(repoPath);

  const pushRequired = await isPushRequired(repoPath, sourceBranch);
  if (pushRequired && !pushSourceBranch) {
    throw new Error('Source branch must be pushed before creating a pull request.');
  }

  if (pushSourceBranch) {
    await pushBranchToOrigin(repoPath, sourceBranch);
  }

  const existingUrl = await findExistingPullRequest(repoPath, sourceBranch, targetBranch);
  if (existingUrl) {
    throw new Error(`Pull request already exists: ${existingUrl}`);
  }

  const output = await runGh(
    ['pr', 'create', '--base', targetBranch, '--head', sourceBranch, '--fill'],
    repoPath
  );
  const url = extractUrlFromText(output);

  if (!url) {
    throw new Error('Pull request created but URL was not returned.');
  }

  return { url };
}

export async function getRepositoryGithubUrl(repoPath: string): Promise<string | null> {
  await ensureRepoPath(repoPath);

  try {
    const remoteUrl = await runGit(['remote', 'get-url', 'origin'], repoPath);
    return normalizeGithubRemoteUrl(remoteUrl);
  } catch {
    return null;
  }
}

export async function commitChanges(repoPath: string, title: string, description: string): Promise<void> {
  await ensureRepoPath(repoPath);

  if (!title.trim()) {
    throw new Error('Commit title is required.');
  }

  if (description.trim()) {
    await runGit(['commit', '-m', title.trim(), '-m', description.trim()], repoPath);
    return;
  }

  await runGit(['commit', '-m', title.trim()], repoPath);
}

export async function pushChanges(repoPath: string): Promise<void> {
  await ensureRepoPath(repoPath);
  await runGit(['push'], repoPath);
}

export async function getDiffSnippet(repoPath: string, files: string[]): Promise<string> {
  await ensureRepoPath(repoPath);

  if (files.length === 0) {
    return '';
  }

  const unstagedDiff = await runGit(['diff', '--', ...files], repoPath);
  const stagedDiff = await runGit(['diff', '--cached', '--', ...files], repoPath);

  return `${unstagedDiff}\n${stagedDiff}`.slice(0, 4000);
}

export async function getRepositoryFingerprint(repoPath: string): Promise<string> {
  await ensureRepoPath(repoPath);

  const head = await runGit(['rev-parse', 'HEAD'], repoPath);
  const status = await runGit(['status', '--porcelain=v1'], repoPath);

  return createHash('sha1').update(`${head}\n${status}`).digest('hex');
}
