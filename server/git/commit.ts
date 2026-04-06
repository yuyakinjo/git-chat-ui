import type { CommitDetail, CommitFileDiffDetail, CommitListItem } from "../types.js";

import { syncCurrentBranchUpstreamTrackingRef } from "./branch.js";
import { ensureRepoPath, parseCommitFileStats, runGit } from "./command.js";

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

  const ref = options.ref && options.ref.trim() ? options.ref : "HEAD";
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
    "log",
    "--decorate=short",
    "--date-order",
    "--date=iso-strict",
    `--skip=${options.offset}`,
    `-n`,
    String(options.limit),
    "--pretty=format:%H%x1f%P%x1f%an%x1f%ad%x1f%s%x1f%d%x1e",
    ref,
    ...compareRefs,
    "--",
  ];

  const output = await runGit(logArgs, options.repoPath);

  const records = output.split("\x1e").filter((record) => record.trim().length > 0);

  const commits: CommitListItem[] = records.flatMap((record) => {
    const [shaRaw, parentsRaw, authorRaw, dateRaw, subjectRaw, decorationRaw] =
      record.split("\x1f");
    const sha = shaRaw?.trim();

    if (!sha) {
      return [];
    }

    const parents = parentsRaw?.trim() ?? "";

    return [
      {
        sha,
        parentShas: parents
          ? parents
              .split(" ")
              .map((value) => value.trim())
              .filter(Boolean)
          : [],
        author: authorRaw?.trim() ?? "",
        date: dateRaw?.trim() ?? "",
        subject: subjectRaw?.trim() ?? "",
        decoration: decorationRaw?.trim() ?? "",
      },
    ];
  });

  return {
    commits,
    hasMore: commits.length === options.limit,
  };
}

export async function getCommitDetail(repoPath: string, sha: string): Promise<CommitDetail> {
  await ensureRepoPath(repoPath);

  const meta = await runGit(
    ["show", "-s", "--date=iso-strict", "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%B", sha],
    repoPath,
  );

  const [fullSha, parents, author, email, date, body] = meta.split("\x1f");

  const [fileStatsOutput, fileStatusOutput] = await Promise.all([
    runGit(["show", "--pretty=format:", "--numstat", sha], repoPath),
    runGit(["show", "--pretty=format:", "--name-status", sha], repoPath),
  ]);
  const files = parseCommitFileStats(fileStatsOutput, fileStatusOutput);

  const diff = await runGit(["show", "--pretty=format:", sha], repoPath);

  return {
    sha: fullSha,
    parentShas: parents ? parents.split(" ").filter(Boolean) : [],
    author,
    email,
    date,
    body,
    files,
    diff: diff.slice(0, 25000),
  };
}

export async function getCommitFileDiffDetail(
  repoPath: string,
  sha: string,
  file: string,
): Promise<CommitFileDiffDetail> {
  await ensureRepoPath(repoPath);

  const normalizedSha = sha.trim();
  const normalizedFile = file.trim();

  if (!normalizedSha) {
    throw new Error("sha is required.");
  }

  if (!normalizedFile) {
    throw new Error("file is required.");
  }

  const diff = await runGit(
    ["show", "--pretty=format:", normalizedSha, "--", normalizedFile],
    repoPath,
  );
  const isDiffTruncated = diff.length > 25000;

  return {
    sha: normalizedSha,
    file: normalizedFile,
    diff: diff.slice(0, 25000),
    isDiffTruncated,
  };
}

export async function commitChanges(
  repoPath: string,
  title: string,
  description: string,
): Promise<void> {
  await ensureRepoPath(repoPath);

  if (!title.trim()) {
    throw new Error("Commit title is required.");
  }

  if (description.trim()) {
    await runGit(["commit", "-m", title.trim(), "-m", description.trim()], repoPath);
    return;
  }

  await runGit(["commit", "-m", title.trim()], repoPath);
}

export async function pushChanges(repoPath: string): Promise<void> {
  await ensureRepoPath(repoPath);
  await runGit(["push"], repoPath);
  await syncCurrentBranchUpstreamTrackingRef(repoPath);
}
