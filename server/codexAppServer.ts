import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Writable, Readable } from "node:stream";
import readline from "node:readline";

import type { CodexThreadSummary } from "./codexTaskFolders";

interface JsonRpcSuccess<T> {
  id: number;
  result: T;
}

interface JsonRpcError {
  id: number;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

type JsonRpcMessage<T> = JsonRpcSuccess<T> | JsonRpcError | { method: string; params?: unknown };

export interface CodexAppServerNotification {
  method: string;
  params?: unknown;
}

interface ThreadListResponse {
  data: CodexThreadSummary[];
  nextCursor: string | null;
}

export interface ListThreadsOptions {
  archived?: boolean;
  cwd?: string;
  limit?: number;
  sortKey?: "created_at" | "updated_at";
  sourceKinds?: string[];
}

export class CodexAppServerClient {
  private readonly process: ChildProcessByStdio<Writable, Readable, Readable>;
  private readonly lines: readline.Interface;
  private readonly stderr: readline.Interface;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly notificationListeners = new Set<
    (notification: CodexAppServerNotification) => void
  >();
  private readonly closeListeners = new Set<(error?: Error) => void>();
  private readonly stderrBuffer: string[] = [];
  private nextId = 0;
  private initialized = false;
  private closing = false;
  private closed = false;
  private closeNotified = false;

  constructor(cwd: string) {
    this.process = spawn("codex", ["app-server"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.lines = readline.createInterface({ input: this.process.stdout });
    this.stderr = readline.createInterface({ input: this.process.stderr });

    this.lines.on("line", (line) => {
      const message = JSON.parse(line) as JsonRpcMessage<unknown>;
      if (!("id" in message)) {
        this.emitNotification({
          method: message.method,
          params: message.params,
        });
        return;
      }

      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }

      this.pending.delete(message.id);

      if ("error" in message) {
        pending.reject(new Error(message.error.message));
        return;
      }

      pending.resolve(message.result);
    });

    this.stderr.on("line", (line) => {
      this.stderrBuffer.push(line);
      if (this.stderrBuffer.length > 40) {
        this.stderrBuffer.shift();
      }
    });

    this.process.once("error", (error) => {
      this.handleProcessClose(error instanceof Error ? error : new Error(String(error)));
    });

    this.process.once("exit", (code, signal) => {
      const error = this.closing
        ? undefined
        : new Error(
            `codex app-server exited with ${
              code !== null ? `exit code ${code}` : `signal ${signal ?? "unknown"}`
            }${this.stderrBuffer.length > 0 ? `\n${this.stderrBuffer.join("\n")}` : ""}`,
          );
      this.handleProcessClose(error);
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.call("initialize", {
      clientInfo: {
        name: "git_chat_ui_task_sync",
        title: "Git Chat UI Task Sync",
        version: "0.1.0",
      },
    });
    this.notify("initialized", {});
    this.initialized = true;
  }

  async listThreads(options: ListThreadsOptions): Promise<CodexThreadSummary[]> {
    const threads: CodexThreadSummary[] = [];
    let cursor: string | null = null;

    do {
      const result: ThreadListResponse = await this.call<ThreadListResponse>("thread/list", {
        cursor,
        limit: options.limit ?? 100,
        sortKey: options.sortKey ?? "updated_at",
        archived: options.archived ?? false,
        cwd: options.cwd,
        sourceKinds: options.sourceKinds ?? ["appServer", "cli", "vscode"],
      });

      threads.push(...result.data);
      cursor = result.nextCursor;
    } while (cursor);

    return threads;
  }

  async readThread(threadId: string): Promise<CodexThreadSummary> {
    const result = await this.call<{ thread: CodexThreadSummary }>("thread/read", {
      threadId,
      includeTurns: false,
    });
    return result.thread;
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.call("thread/archive", { threadId });
  }

  onNotification(listener: (notification: CodexAppServerNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  onClose(listener: (error?: Error) => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    if (this.closed || this.closing) {
      return;
    }

    this.closing = true;
    this.lines.close();
    this.stderr.close();
    this.process.stdin.end();
    this.process.kill();
    await new Promise<void>((resolve) => {
      this.process.once("exit", () => resolve());
    });
  }

  private async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    const payload = { method, id, params };

    return await new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.process.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  private notify(method: string, params?: Record<string, unknown>): void {
    this.process.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  private emitNotification(notification: CodexAppServerNotification): void {
    for (const listener of this.notificationListeners) {
      listener(notification);
    }
  }

  private handleProcessClose(error?: Error): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.rejectAllPending(error ?? new Error("codex app-server closed."));
    this.emitClose(error);
  }

  private emitClose(error?: Error): void {
    if (this.closeNotified) {
      return;
    }

    this.closeNotified = true;
    for (const listener of this.closeListeners) {
      listener(error);
    }
  }

  private rejectAllPending(error: Error): void {
    for (const { reject } of this.pending.values()) {
      reject(error);
    }
    this.pending.clear();
  }
}
