import fs from 'node:fs/promises';
import path from 'node:path';

export type ThreadTaskStatus = 'active' | 'archived';

export interface CodexThreadSummary {
  id: string;
  name?: string | null;
  preview?: string | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface ThreadTaskMetadata {
  threadId: string;
  title: string;
  preview: string;
  cwd: string;
  status: ThreadTaskStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  syncedAt: string;
}

export interface EnsureThreadTaskDirectoryResult {
  created: boolean;
  restoredFromArchive: boolean;
  threadDir: string;
  todoPath: string;
  metaPath: string;
}

export interface SyncThreadTaskDirectoriesResult {
  movedToArchive: string[];
  orphanedToArchive: string[];
  restoredToActive: string[];
  unknownArchived: string[];
}

export interface SyncThreadTaskDirectoriesOptions {
  repoRoot: string;
  activeThreads: CodexThreadSummary[];
  archivedThreads: CodexThreadSummary[];
}

interface ThreadTaskPaths {
  tasksRoot: string;
  activeRoot: string;
  archivedRoot: string;
}

export function getThreadTaskPaths(repoRoot: string): ThreadTaskPaths {
  const tasksRoot = path.join(repoRoot, 'tasks');
  return {
    tasksRoot,
    activeRoot: path.join(tasksRoot, 'threads'),
    archivedRoot: path.join(tasksRoot, 'archived')
  };
}

export async function ensureThreadTaskDirectory(
  repoRoot: string,
  thread: CodexThreadSummary
): Promise<EnsureThreadTaskDirectoryResult> {
  const paths = getThreadTaskPaths(repoRoot);
  const activeThreadDir = path.join(paths.activeRoot, thread.id);
  const archivedThreadDir = path.join(paths.archivedRoot, thread.id);
  const restoredFromArchive = await directoryExists(archivedThreadDir) && !(await directoryExists(activeThreadDir));

  if (restoredFromArchive) {
    await moveThreadDirectory(archivedThreadDir, activeThreadDir);
  }

  await fs.mkdir(activeThreadDir, { recursive: true });

  const todoPath = path.join(activeThreadDir, 'todo.md');
  const metaPath = path.join(activeThreadDir, 'meta.json');
  const created = !(await fileExists(todoPath)) && !(await fileExists(metaPath));

  await writeMetaFile(metaPath, buildMetadata(repoRoot, thread, 'active'));

  if (!(await fileExists(todoPath))) {
    await fs.writeFile(todoPath, buildTodoTemplate(thread), 'utf8');
  }

  return {
    created,
    restoredFromArchive,
    threadDir: activeThreadDir,
    todoPath,
    metaPath
  };
}

export async function syncThreadTaskDirectories(
  options: SyncThreadTaskDirectoriesOptions
): Promise<SyncThreadTaskDirectoriesResult> {
  const paths = getThreadTaskPaths(options.repoRoot);
  await fs.mkdir(paths.activeRoot, { recursive: true });
  await fs.mkdir(paths.archivedRoot, { recursive: true });

  const activeById = new Map(options.activeThreads.map((thread) => [thread.id, thread] as const));
  const archivedById = new Map(options.archivedThreads.map((thread) => [thread.id, thread] as const));
  const activeDirs = await listDirectoryNames(paths.activeRoot);
  const archivedDirs = await listDirectoryNames(paths.archivedRoot);
  const result: SyncThreadTaskDirectoriesResult = {
    movedToArchive: [],
    orphanedToArchive: [],
    restoredToActive: [],
    unknownArchived: []
  };

  for (const threadId of activeDirs) {
    const activeThread = activeById.get(threadId);
    const archivedThread = archivedById.get(threadId);
    const activeDir = path.join(paths.activeRoot, threadId);
    const activeMetaPath = path.join(activeDir, 'meta.json');
    const activeTodoPath = path.join(activeDir, 'todo.md');

    if (archivedThread) {
      const archivedDir = path.join(paths.archivedRoot, threadId);
      await moveThreadDirectory(activeDir, archivedDir);
      await writeMetaFile(path.join(archivedDir, 'meta.json'), buildMetadata(options.repoRoot, archivedThread, 'archived'));
      await ensureTodoFile(path.join(archivedDir, 'todo.md'), archivedThread);
      result.movedToArchive.push(threadId);
      continue;
    }

    if (activeThread) {
      await writeMetaFile(activeMetaPath, buildMetadata(options.repoRoot, activeThread, 'active'));
      await ensureTodoFile(activeTodoPath, activeThread);
      continue;
    }

    const archivedDir = path.join(paths.archivedRoot, threadId);
    await moveThreadDirectory(activeDir, archivedDir);
    await writeArchivedFallbackMeta(path.join(archivedDir, 'meta.json'), options.repoRoot, threadId);
    await ensureArchivedFallbackTodo(path.join(archivedDir, 'todo.md'), path.join(archivedDir, 'meta.json'), threadId);
    result.orphanedToArchive.push(threadId);
  }

  for (const threadId of archivedDirs) {
    const archivedThread = archivedById.get(threadId);
    const activeThread = activeById.get(threadId);
    const archivedDir = path.join(paths.archivedRoot, threadId);
    const archivedMetaPath = path.join(archivedDir, 'meta.json');
    const archivedTodoPath = path.join(archivedDir, 'todo.md');

    if (activeThread) {
      const activeDir = path.join(paths.activeRoot, threadId);
      await moveThreadDirectory(archivedDir, activeDir);
      await writeMetaFile(path.join(activeDir, 'meta.json'), buildMetadata(options.repoRoot, activeThread, 'active'));
      await ensureTodoFile(path.join(activeDir, 'todo.md'), activeThread);
      result.restoredToActive.push(threadId);
      continue;
    }

    if (archivedThread) {
      await writeMetaFile(archivedMetaPath, buildMetadata(options.repoRoot, archivedThread, 'archived'));
      await ensureTodoFile(archivedTodoPath, archivedThread);
      continue;
    }

    result.unknownArchived.push(threadId);
  }

  return result;
}

function buildMetadata(
  repoRoot: string,
  thread: CodexThreadSummary,
  status: ThreadTaskStatus
): ThreadTaskMetadata {
  const now = new Date().toISOString();
  const createdAt = toIsoString(thread.createdAt) ?? now;
  const updatedAt = toIsoString(thread.updatedAt) ?? createdAt;

  return {
    threadId: thread.id,
    title: getThreadTitle(thread),
    preview: thread.preview?.trim() ?? '',
    cwd: repoRoot,
    status,
    createdAt,
    updatedAt,
    archivedAt: status === 'archived' ? now : undefined,
    syncedAt: now
  };
}

function buildTodoTemplate(thread: CodexThreadSummary): string {
  return [
    '# TODO',
    '',
    `- Thread ID: ${thread.id}`,
    `- Title: ${getThreadTitle(thread)}`,
    `- Preview: ${thread.preview?.trim() || '-'}`,
    `- Created: ${toIsoString(thread.createdAt) ?? new Date().toISOString()}`,
    '',
    '## Plan',
    '',
    '- [ ] ',
    '',
    '## Review',
    '',
    '- '
  ].join('\n');
}

async function writeArchivedFallbackMeta(metaPath: string, repoRoot: string, threadId: string): Promise<void> {
  const existing = await readThreadTaskMetadata(metaPath);
  const now = new Date().toISOString();
  const createdAt = normalizeIsoString(existing?.createdAt) ?? now;
  const updatedAt = normalizeIsoString(existing?.updatedAt) ?? createdAt;
  const title = normalizeText(existing?.title) || normalizeText(existing?.preview) || 'Untitled thread';

  await writeMetaFile(metaPath, {
    threadId,
    title,
    preview: normalizeText(existing?.preview) ?? '',
    cwd: normalizeText(existing?.cwd) || repoRoot,
    status: 'archived',
    createdAt,
    updatedAt,
    archivedAt: now,
    syncedAt: now
  });
}

function getThreadTitle(thread: CodexThreadSummary): string {
  const title = thread.name?.trim();
  if (title) {
    return title;
  }

  const preview = thread.preview?.trim();
  if (preview) {
    return preview;
  }

  return 'Untitled thread';
}

function toIsoString(timestamp?: number): string | null {
  if (!timestamp) {
    return null;
  }

  return new Date(timestamp * 1000).toISOString();
}

async function writeMetaFile(metaPath: string, metadata: ThreadTaskMetadata): Promise<void> {
  await fs.writeFile(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

async function ensureTodoFile(todoPath: string, thread: CodexThreadSummary): Promise<void> {
  if (await fileExists(todoPath)) {
    return;
  }

  await fs.writeFile(todoPath, buildTodoTemplate(thread), 'utf8');
}

async function ensureArchivedFallbackTodo(todoPath: string, metaPath: string, threadId: string): Promise<void> {
  if (await fileExists(todoPath)) {
    return;
  }

  const metadata = await readThreadTaskMetadata(metaPath);
  await fs.writeFile(todoPath, buildTodoTemplate(buildSummaryFromMetadata(threadId, metadata)), 'utf8');
}

async function listDirectoryNames(root: string): Promise<string[]> {
  if (!(await directoryExists(root))) {
    return [];
  }

  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function moveThreadDirectory(sourceDir: string, targetDir: string): Promise<void> {
  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  await fs.cp(sourceDir, targetDir, { recursive: true, force: true });
  await fs.rm(sourceDir, { recursive: true, force: true });
}

function buildSummaryFromMetadata(
  threadId: string,
  metadata: Partial<ThreadTaskMetadata> | null
): CodexThreadSummary {
  return {
    id: threadId,
    name: normalizeText(metadata?.title) ?? undefined,
    preview: normalizeText(metadata?.preview) ?? undefined,
    createdAt: toUnixTimestamp(metadata?.createdAt),
    updatedAt: toUnixTimestamp(metadata?.updatedAt)
  };
}

async function readThreadTaskMetadata(metaPath: string): Promise<Partial<ThreadTaskMetadata> | null> {
  if (!(await fileExists(metaPath))) {
    return null;
  }

  try {
    return JSON.parse(await fs.readFile(metaPath, 'utf8')) as Partial<ThreadTaskMetadata>;
  } catch {
    return null;
  }
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeIsoString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function toUnixTimestamp(value: unknown): number | undefined {
  const normalized = normalizeIsoString(value);
  if (!normalized) {
    return undefined;
  }

  return Math.floor(Date.parse(normalized) / 1000);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function directoryExists(directoryPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(directoryPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}
