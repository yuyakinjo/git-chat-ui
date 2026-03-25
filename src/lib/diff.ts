export type DiffCellKind = 'context' | 'add' | 'delete';
export type ParsedDiffRowKind = 'context' | 'change' | 'add' | 'delete';
export type ParsedDiffFileKind = 'modified' | 'added' | 'deleted' | 'renamed';

export interface ParsedDiffCell {
  kind: DiffCellKind;
  lineNumber: number | null;
  content: string;
}

export interface ParsedDiffRow {
  kind: ParsedDiffRowKind;
  left: ParsedDiffCell | null;
  right: ParsedDiffCell | null;
}

export interface ParsedDiffHunk {
  header: string;
  oldStart: number;
  newStart: number;
  rows: ParsedDiffRow[];
}

export interface ParsedDiffFile {
  key: string;
  kind: ParsedDiffFileKind;
  oldPath: string | null;
  newPath: string | null;
  displayPath: string;
  previousPath: string | null;
  meta: string[];
  hunks: ParsedDiffHunk[];
}

interface WorkingHunk {
  header: string;
  oldStart: number;
  newStart: number;
  oldLine: number;
  newLine: number;
  rows: ParsedDiffRow[];
  pendingDeletes: ParsedDiffCell[];
  pendingAdds: ParsedDiffCell[];
}

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function normalizeDiffPath(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = unquote(value.trim());
  if (!normalized || normalized === '/dev/null') {
    return null;
  }

  if (normalized.startsWith('a/') || normalized.startsWith('b/')) {
    return normalized.slice(2);
  }

  return normalized;
}

function resolveFileKind(oldPath: string | null, newPath: string | null): ParsedDiffFileKind {
  if (!oldPath && newPath) {
    return 'added';
  }

  if (oldPath && !newPath) {
    return 'deleted';
  }

  if (oldPath && newPath && oldPath !== newPath) {
    return 'renamed';
  }

  return 'modified';
}

function resolveDisplayPath(oldPath: string | null, newPath: string | null): string {
  return newPath ?? oldPath ?? 'Unknown file';
}

function createWorkingFile(keyIndex: number, oldPath: string | null, newPath: string | null): ParsedDiffFile {
  return {
    key: `${keyIndex}:${newPath ?? oldPath ?? 'unknown'}`,
    kind: resolveFileKind(oldPath, newPath),
    oldPath,
    newPath,
    displayPath: resolveDisplayPath(oldPath, newPath),
    previousPath: null,
    meta: [],
    hunks: []
  };
}

function finalizeFile(file: ParsedDiffFile): ParsedDiffFile {
  const kind = resolveFileKind(file.oldPath, file.newPath);

  return {
    ...file,
    kind,
    displayPath: resolveDisplayPath(file.oldPath, file.newPath),
    previousPath: kind === 'renamed' ? file.oldPath : null
  };
}

function parseDiffGitHeader(line: string): { oldPath: string | null; newPath: string | null } | null {
  if (!line.startsWith('diff --git ')) {
    return null;
  }

  const body = line.slice('diff --git '.length).trim();
  const newPathIndex = body.lastIndexOf(' b/');
  if (newPathIndex === -1) {
    return { oldPath: null, newPath: null };
  }

  const oldToken = body.slice(0, newPathIndex).trim();
  const newToken = body.slice(newPathIndex + 1).trim();

  return {
    oldPath: normalizeDiffPath(oldToken),
    newPath: normalizeDiffPath(newToken)
  };
}

function parsePatchPath(line: string, prefix: string): string | null {
  return normalizeDiffPath(line.slice(prefix.length).trim());
}

function parseHunkHeader(line: string): { header: string; oldStart: number; newStart: number } | null {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
  if (!match) {
    return null;
  }

  return {
    header: line.trim(),
    oldStart: Number(match[1]),
    newStart: Number(match[2])
  };
}

function appendMarkerToLatestCell(hunk: WorkingHunk, marker: string): void {
  const suffix = ` [${marker}]`;

  const latestAdd = hunk.pendingAdds.at(-1);
  if (latestAdd) {
    latestAdd.content += suffix;
    return;
  }

  const latestDelete = hunk.pendingDeletes.at(-1);
  if (latestDelete) {
    latestDelete.content += suffix;
    return;
  }

  const latestRow = hunk.rows.at(-1);
  if (!latestRow) {
    return;
  }

  if (latestRow.right) {
    latestRow.right.content += suffix;
    return;
  }

  if (latestRow.left) {
    latestRow.left.content += suffix;
  }
}

function flushPendingRows(hunk: WorkingHunk): void {
  const rowCount = Math.max(hunk.pendingDeletes.length, hunk.pendingAdds.length);
  if (rowCount === 0) {
    return;
  }

  for (let index = 0; index < rowCount; index += 1) {
    const left = hunk.pendingDeletes[index] ?? null;
    const right = hunk.pendingAdds[index] ?? null;

    let kind: ParsedDiffRowKind = 'context';
    if (left && right) {
      kind = 'change';
    } else if (left) {
      kind = 'delete';
    } else if (right) {
      kind = 'add';
    }

    hunk.rows.push({ kind, left, right });
  }

  hunk.pendingDeletes = [];
  hunk.pendingAdds = [];
}

function pushContextRow(hunk: WorkingHunk, content: string): void {
  flushPendingRows(hunk);
  hunk.rows.push({
    kind: 'context',
    left: {
      kind: 'context',
      lineNumber: hunk.oldLine,
      content
    },
    right: {
      kind: 'context',
      lineNumber: hunk.newLine,
      content
    }
  });
  hunk.oldLine += 1;
  hunk.newLine += 1;
}

function pushDeleteRow(hunk: WorkingHunk, content: string): void {
  hunk.pendingDeletes.push({
    kind: 'delete',
    lineNumber: hunk.oldLine,
    content
  });
  hunk.oldLine += 1;
}

function pushAddRow(hunk: WorkingHunk, content: string): void {
  hunk.pendingAdds.push({
    kind: 'add',
    lineNumber: hunk.newLine,
    content
  });
  hunk.newLine += 1;
}

function finalizeHunk(file: ParsedDiffFile, hunk: WorkingHunk | null): void {
  if (!hunk) {
    return;
  }

  flushPendingRows(hunk);
  file.hunks.push({
    header: hunk.header,
    oldStart: hunk.oldStart,
    newStart: hunk.newStart,
    rows: hunk.rows
  });
}

export function parseUnifiedDiff(diff: string): ParsedDiffFile[] {
  const normalized = diff.replace(/\r\n?/g, '\n').trimEnd();
  if (!normalized) {
    return [];
  }

  const files: ParsedDiffFile[] = [];
  const lines = normalized.split('\n');

  let fileIndex = 0;
  let currentFile: ParsedDiffFile | null = null;
  let currentHunk: WorkingHunk | null = null;

  const ensureCurrentFile = (): ParsedDiffFile => {
    if (!currentFile) {
      currentFile = createWorkingFile(fileIndex, null, null);
      fileIndex += 1;
    }

    return currentFile;
  };

  const flushCurrentFile = (): void => {
    if (!currentFile) {
      return;
    }

    finalizeHunk(currentFile, currentHunk);
    currentHunk = null;
    files.push(finalizeFile(currentFile));
    currentFile = null;
  };

  for (const line of lines) {
    const parsedHeader = parseDiffGitHeader(line);
    if (parsedHeader) {
      flushCurrentFile();
      currentFile = createWorkingFile(fileIndex, parsedHeader.oldPath, parsedHeader.newPath);
      fileIndex += 1;
      continue;
    }

    const file = ensureCurrentFile();
    const parsedHunkHeader = parseHunkHeader(line);
    if (parsedHunkHeader) {
      finalizeHunk(file, currentHunk);
      currentHunk = {
        header: parsedHunkHeader.header,
        oldStart: parsedHunkHeader.oldStart,
        newStart: parsedHunkHeader.newStart,
        oldLine: parsedHunkHeader.oldStart,
        newLine: parsedHunkHeader.newStart,
        rows: [],
        pendingDeletes: [],
        pendingAdds: []
      };
      continue;
    }

    if (currentHunk) {
      if (line.startsWith('\\ ')) {
        appendMarkerToLatestCell(currentHunk, line.slice(2).trim());
        continue;
      }

      if (line.startsWith('+')) {
        pushAddRow(currentHunk, line.slice(1));
        continue;
      }

      if (line.startsWith('-')) {
        pushDeleteRow(currentHunk, line.slice(1));
        continue;
      }

      if (line.startsWith(' ')) {
        pushContextRow(currentHunk, line.slice(1));
        continue;
      }
    }

    if (line.startsWith('--- ')) {
      file.oldPath = parsePatchPath(line, '--- ');
      continue;
    }

    if (line.startsWith('+++ ')) {
      file.newPath = parsePatchPath(line, '+++ ');
      continue;
    }

    if (line.startsWith('rename from ')) {
      file.oldPath = normalizeDiffPath(line.slice('rename from '.length).trim());
      file.meta.push(line.trim());
      continue;
    }

    if (line.startsWith('rename to ')) {
      file.newPath = normalizeDiffPath(line.slice('rename to '.length).trim());
      file.meta.push(line.trim());
      continue;
    }

    if (line.trim()) {
      file.meta.push(line.trim());
    }
  }

  flushCurrentFile();
  return files;
}
