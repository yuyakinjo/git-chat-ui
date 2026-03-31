import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const SKIP_DIRS = new Set([
  ".git",
  ".Trash",
  ".cache",
  ".npm",
  ".yarn",
  "Library",
  "node_modules",
]);

export function statusLabel(code: string): string {
  switch (code) {
    case "M":
      return "Modified";
    case "A":
      return "Added";
    case "D":
      return "Deleted";
    case "R":
      return "Renamed";
    case "C":
      return "Copied";
    case "U":
      return "Updated";
    case "?":
      return "Untracked";
    default:
      return "Changed";
  }
}

export function parseCommitFileStats(
  output: string,
): Array<{ file: string; additions: number; deletions: number }> {
  return output
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const [additionsRaw, deletionsRaw, file] = line.split("\t");

      return {
        file,
        additions: Number.isNaN(Number(additionsRaw)) ? 0 : Number(additionsRaw),
        deletions: Number.isNaN(Number(deletionsRaw)) ? 0 : Number(deletionsRaw),
      };
    })
    .filter((entry) => Boolean(entry.file));
}

export function workingTreeDiffArgs(
  area: import("../types.js").WorkingTreeDiffArea,
  subcommand: "--numstat" | "",
): string[] {
  if (area === "staged") {
    return subcommand ? ["diff", "--cached", subcommand] : ["diff", "--cached"];
  }

  return subcommand ? ["diff", subcommand] : ["diff"];
}

export function resolveWorkingTreeFilePath(repoPath: string, file: string): string {
  const resolved = path.resolve(repoPath, file);
  const relative = path.relative(repoPath, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("file must stay within repository.");
  }

  return resolved;
}

export function resolveNewFileMode(mode: number): string {
  return mode & 0o111 ? "100755" : "100644";
}

export function normalizeTextFileContent(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

export function splitTextLines(content: string): { lines: string[]; hasTrailingNewline: boolean } {
  if (!content) {
    return { lines: [], hasTrailingNewline: false };
  }

  const normalized = normalizeTextFileContent(content);
  const hasTrailingNewline = normalized.endsWith("\n");
  const lines = normalized.split("\n");

  if (hasTrailingNewline) {
    lines.pop();
  }

  return {
    lines,
    hasTrailingNewline,
  };
}

export async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
      env: env ? { ...process.env, ...env } : process.env,
    });

    return stdout.trimEnd();
  } catch (error) {
    const typed = error as Error & { stderr?: string; stdout?: string };
    const stderr = typed.stderr?.trim();
    const stdout = typed.stdout?.trim();
    throw new Error(stderr || stdout || typed.message || `Failed to execute ${command} command.`, {
      cause: error,
    });
  }
}

export async function runGit(
  args: string[],
  repoPath: string,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  return runCommand("git", args, repoPath, env);
}

export async function runGh(args: string[], repoPath: string): Promise<string> {
  return runCommand("gh", args, repoPath);
}

export async function ensureRepoPath(repoPath: string): Promise<void> {
  if (!path.isAbsolute(repoPath)) {
    throw new Error("Repository path must be absolute.");
  }

  const stat = await fs.stat(repoPath);
  if (!stat.isDirectory()) {
    throw new Error("Repository path is not a directory.");
  }

  await runGit(["rev-parse", "--is-inside-work-tree"], repoPath);
}
