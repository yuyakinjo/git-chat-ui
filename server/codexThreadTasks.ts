/* oxlint-disable no-console -- CLI tool that outputs to stdout/stderr */
import path from "node:path";

import { CodexAppServerClient } from "./codexAppServer";
import { ensureThreadTaskDirectory, type CodexThreadSummary } from "./codexTaskFolders";
import {
  ensureBackgroundThreadTaskWatcher,
  formatThreadTaskSyncSummary,
  runThreadTaskSync,
  WATCH_DEFAULT_INTERVAL_SECONDS,
  watchThreadTaskDirectories,
} from "./codexThreadTaskWatcher";

type Command = "list" | "attach" | "attach-latest" | "archive" | "sync" | "watch";

interface ParsedArgs {
  command: Command;
  flags: Map<string, string>;
}

async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const repoRoot = path.resolve(parsed.flags.get("cwd") ?? process.cwd());

  switch (parsed.command) {
    case "list":
      await withClient(repoRoot, async (client) => {
        const threads = await client.listThreads({
          archived: parsed.flags.get("archived") === "true",
          cwd: repoRoot,
        });
        printThreadList(threads);
      });
      return;

    case "attach":
      await withClient(repoRoot, async (client) => {
        const threadId = requireFlag(parsed.flags, "thread-id");
        const thread = await client.readThread(threadId);
        const result = await ensureThreadTaskDirectory(repoRoot, thread);
        console.log(`${result.created ? "created" : "updated"} ${result.threadDir}`);
        await maybeEnsureWatcher(repoRoot, parsed.flags);
      });
      return;

    case "attach-latest":
      await withClient(repoRoot, async (client) => {
        const threads = await client.listThreads({
          cwd: repoRoot,
          archived: false,
          limit: 1,
          sortKey: "updated_at",
        });
        const thread = threads[0];
        if (!thread) {
          throw new Error(`No active Codex threads found for ${repoRoot}`);
        }

        const result = await ensureThreadTaskDirectory(repoRoot, thread);
        console.log(`${result.created ? "created" : "updated"} ${result.threadDir}`);
        await maybeEnsureWatcher(repoRoot, parsed.flags);
      });
      return;

    case "archive":
      await withClient(repoRoot, async (client) => {
        const threadId = requireFlag(parsed.flags, "thread-id");
        await client.archiveThread(threadId);
        const syncResult = await runThreadTaskSync(client, repoRoot);
        console.log(`archived ${threadId}`);
        printSyncSummary(repoRoot, syncResult);
      });
      return;

    case "sync":
      await withClient(repoRoot, async (client) => {
        const syncResult = await runThreadTaskSync(client, repoRoot);
        printSyncSummary(repoRoot, syncResult);
      });
      return;

    case "watch": {
      const intervalSeconds = parseIntervalSeconds(parsed.flags);

      await withClient(repoRoot, async (client) => {
        console.log(`watching Codex thread tasks in ${repoRoot} every ${intervalSeconds}s`);
        await watchThreadTaskDirectories({
          client,
          repoRoot,
          intervalSeconds,
        });
      });
      return;
    }
  }
}

async function withClient(
  repoRoot: string,
  callback: (client: CodexAppServerClient) => Promise<void>,
): Promise<void> {
  const client = new CodexAppServerClient(repoRoot);

  try {
    await client.initialize();
    await callback(client);
  } finally {
    await client.close();
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;

  if (!isCommand(command)) {
    throw new Error(usage());
  }

  const flags = new Map<string, string>();

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}\n\n${usage()}`);
    }

    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, "true");
      continue;
    }

    flags.set(key, next);
    index += 1;
  }

  return { command, flags };
}

function isCommand(value: string | undefined): value is Command {
  return (
    value === "list" ||
    value === "attach" ||
    value === "attach-latest" ||
    value === "archive" ||
    value === "sync" ||
    value === "watch"
  );
}

function requireFlag(flags: Map<string, string>, key: string): string {
  const value = flags.get(key);
  if (!value || value === "true") {
    throw new Error(`--${key} is required`);
  }
  return value;
}

function printThreadList(threads: CodexThreadSummary[]): void {
  if (threads.length === 0) {
    console.log("No threads found.");
    return;
  }

  for (const thread of threads) {
    const title = thread.name?.trim() || thread.preview?.trim() || "Untitled thread";
    const updatedAt = thread.updatedAt
      ? new Date(thread.updatedAt * 1000).toISOString()
      : "unknown";
    console.log(`${thread.id}\t${updatedAt}\t${title}`);
  }
}

async function maybeEnsureWatcher(repoRoot: string, flags: Map<string, string>): Promise<void> {
  if (flags.get("watch") === "false") {
    return;
  }

  const watchResult = await ensureBackgroundThreadTaskWatcher({
    repoRoot,
    intervalSeconds: parseIntervalSeconds(flags),
  });
  console.log(
    `${watchResult.started ? "started" : "reused"} watcher ${watchResult.pid} (${watchResult.logPath})`,
  );
}

function printSyncSummary(
  repoRoot: string,
  result: Awaited<ReturnType<typeof runThreadTaskSync>>,
): void {
  for (const line of formatThreadTaskSyncSummary(repoRoot, result)) {
    console.log(line);
  }
}

function parseIntervalSeconds(flags: Map<string, string>): number {
  const intervalSeconds = Number(flags.get("interval") ?? WATCH_DEFAULT_INTERVAL_SECONDS);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    throw new Error("interval must be a positive number");
  }

  return intervalSeconds;
}

function usage(): string {
  return [
    "Usage: bun server/codexThreadTasks.ts <command> [flags]",
    "",
    "Commands:",
    "  list [--archived]",
    "  attach --thread-id <threadId>",
    "  attach-latest",
    "  archive --thread-id <threadId>",
    "  sync",
    "  watch [--interval <seconds>]",
  ].join("\n");
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
