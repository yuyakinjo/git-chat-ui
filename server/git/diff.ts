import fs from "node:fs/promises";

import type {
  BranchDiffDetail,
  BranchDiffFileDetail,
  WorkingTreeDiffArea,
  WorkingTreeDiffDetail,
} from "../types.js";

import {
  ensureRepoPath,
  normalizeTextFileContent,
  parseCommitFileStats,
  resolveNewFileMode,
  resolveWorkingTreeFilePath,
  runGit,
  splitTextLines,
  workingTreeDiffArgs,
} from "./command.js";

function buildUntrackedTextDiff(file: string, content: string, mode: string): string {
  const { lines, hasTrailingNewline } = splitTextLines(content);
  const output = [
    `diff --git a/${file} b/${file}`,
    `new file mode ${mode}`,
    "--- /dev/null",
    `+++ b/${file}`,
  ];

  if (lines.length > 0) {
    output.push(`@@ -0,0 +1,${lines.length} @@`);
    for (const line of lines) {
      output.push(`+${line}`);
    }

    if (!hasTrailingNewline) {
      output.push("\\ No newline at end of file");
    }
  }

  return output.join("\n");
}

export async function listUntrackedFiles(repoPath: string, files: string[]): Promise<Set<string>> {
  const normalizedFiles = [
    ...new Set(files.map((value) => value.trim()).filter((value) => value.length > 0)),
  ];
  if (normalizedFiles.length === 0) {
    return new Set();
  }

  const output = await runGit(
    ["ls-files", "--others", "--exclude-standard", "--", ...normalizedFiles],
    repoPath,
  );
  return new Set(
    output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
}

export async function buildUntrackedFileDiffSnapshot(
  repoPath: string,
  file: string,
): Promise<{ fileStat: { file: string; additions: number; deletions: number }; diff: string }> {
  const absolutePath = resolveWorkingTreeFilePath(repoPath, file);
  const [metadata, buffer] = await Promise.all([fs.stat(absolutePath), fs.readFile(absolutePath)]);
  const mode = resolveNewFileMode(metadata.mode);

  if (buffer.includes(0)) {
    return {
      fileStat: { file, additions: 0, deletions: 0 },
      diff: [
        `diff --git a/${file} b/${file}`,
        `new file mode ${mode}`,
        "--- /dev/null",
        `+++ b/${file}`,
        `Binary files /dev/null and b/${file} differ`,
      ].join("\n"),
    };
  }

  const content = buffer.toString("utf8");
  const normalizedContent = normalizeTextFileContent(content);
  const { lines } = splitTextLines(normalizedContent);

  return {
    fileStat: {
      file,
      additions: lines.length,
      deletions: 0,
    },
    diff: buildUntrackedTextDiff(file, normalizedContent, mode),
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
    throw new Error("baseRef is required.");
  }

  if (!targetRef) {
    throw new Error("targetRef is required.");
  }

  const mergeBaseSha = await runGit(["merge-base", baseRef, targetRef], options.repoPath);
  const range = `${mergeBaseSha}..${targetRef}`;
  const fileStatsOutput = await runGit(["diff", "--numstat", range], options.repoPath);
  const files = parseCommitFileStats(fileStatsOutput);

  const diff = await runGit(["diff", range], options.repoPath);
  const isDiffTruncated = diff.length > 25000;

  return {
    baseRef,
    targetRef,
    mergeBaseSha,
    files,
    diff: diff.slice(0, 25000),
    isDiffTruncated,
  };
}

export async function getBranchDiffFileDetail(options: {
  repoPath: string;
  baseRef: string;
  targetRef: string;
  file: string;
}): Promise<BranchDiffFileDetail> {
  await ensureRepoPath(options.repoPath);

  const baseRef = options.baseRef.trim();
  const targetRef = options.targetRef.trim();
  const file = options.file.trim();

  if (!baseRef) {
    throw new Error("baseRef is required.");
  }

  if (!targetRef) {
    throw new Error("targetRef is required.");
  }

  if (!file) {
    throw new Error("file is required.");
  }

  const mergeBaseSha = await runGit(["merge-base", baseRef, targetRef], options.repoPath);
  const range = `${mergeBaseSha}..${targetRef}`;
  const diff = await runGit(["diff", range, "--", file], options.repoPath);
  const isDiffTruncated = diff.length > 25000;

  return {
    baseRef,
    targetRef,
    file,
    diff: diff.slice(0, 25000),
    isDiffTruncated,
  };
}

export async function getWorkingTreeDiffDetail(options: {
  repoPath: string;
  file: string;
  area: WorkingTreeDiffArea;
}): Promise<WorkingTreeDiffDetail> {
  await ensureRepoPath(options.repoPath);

  const file = options.file.trim();
  if (!file) {
    throw new Error("file is required.");
  }

  if (options.area !== "staged" && options.area !== "unstaged") {
    throw new Error("area must be staged or unstaged.");
  }

  const numstatArgs = [...workingTreeDiffArgs(options.area, "--numstat"), "--", file];
  const fileStatsOutput = await runGit(numstatArgs, options.repoPath);
  let files = parseCommitFileStats(fileStatsOutput);

  const diffArgs = [...workingTreeDiffArgs(options.area, ""), "--", file];
  let diff = await runGit(diffArgs, options.repoPath);

  if (options.area === "unstaged" && !diff.trim()) {
    const untrackedFiles = await listUntrackedFiles(options.repoPath, [file]);
    if (untrackedFiles.has(file)) {
      const fallback = await buildUntrackedFileDiffSnapshot(options.repoPath, file);
      files = [fallback.fileStat];
      diff = fallback.diff;
    }
  }

  const isDiffTruncated = diff.length > 25000;

  return {
    file,
    area: options.area,
    files,
    diff: diff.slice(0, 25000),
    isDiffTruncated,
  };
}

export async function getDiffSnippet(repoPath: string, files: string[]): Promise<string> {
  await ensureRepoPath(repoPath);

  const normalizedFiles = [
    ...new Set(files.map((value) => value.trim()).filter((value) => value.length > 0)),
  ];
  if (normalizedFiles.length === 0) {
    return "";
  }

  const [unstagedDiff, stagedDiff, untrackedFiles] = await Promise.all([
    runGit(["diff", "--", ...normalizedFiles], repoPath),
    runGit(["diff", "--cached", "--", ...normalizedFiles], repoPath),
    listUntrackedFiles(repoPath, normalizedFiles),
  ]);

  const untrackedDiffs = await Promise.all(
    normalizedFiles
      .filter((file) => untrackedFiles.has(file))
      .map(async (file) => (await buildUntrackedFileDiffSnapshot(repoPath, file)).diff),
  );

  return [unstagedDiff, stagedDiff, ...untrackedDiffs]
    .filter((section) => section.trim().length > 0)
    .join("\n")
    .slice(0, 4000);
}
