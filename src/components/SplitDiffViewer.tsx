import { useDeferredValue, useEffect, useMemo, useState, type JSX } from 'react';

import { parseUnifiedDiff, type ParsedDiffCell, type ParsedDiffFile, type ParsedDiffRow } from '../lib/diff';
import { buildIntralineSegments, type IntralineSegment } from '../lib/intralineDiff';

interface SplitDiffFileStat {
  file: string;
  additions: number;
  deletions: number;
}

interface SplitDiffViewerProps {
  diff: string;
  files?: SplitDiffFileStat[];
  isDiffTruncated?: boolean;
  preferredFilePath?: string | null;
  emptyMessage?: string;
  enableFileFilter?: boolean;
  fileFilterPlaceholder?: string;
}

type DiffDisplayMode = 'split' | 'after-only';

const fileKindLabel: Record<ParsedDiffFile['kind'], string> = {
  modified: 'Modified',
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed'
};

function matchesFilePath(
  file: Pick<ParsedDiffFile, 'displayPath' | 'newPath' | 'oldPath'>,
  targetPath: string | null | undefined
): boolean {
  if (!targetPath) {
    return false;
  }

  return file.displayPath === targetPath || file.newPath === targetPath || file.oldPath === targetPath;
}

function matchesFileQuery(
  file: Pick<ParsedDiffFile, 'displayPath' | 'newPath' | 'oldPath' | 'previousPath'>,
  query: string
): boolean {
  if (!query) {
    return true;
  }

  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [file.displayPath, file.newPath, file.oldPath, file.previousPath]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(normalizedQuery));
}

function summarizeFile(file: ParsedDiffFile, stats: SplitDiffFileStat[] | undefined): ParsedDiffFile & {
  additions: number;
  deletions: number;
} {
  const matched = stats?.find((item) => matchesFilePath(file, item.file));
  if (matched) {
    return {
      ...file,
      additions: matched.additions,
      deletions: matched.deletions
    };
  }

  let additions = 0;
  let deletions = 0;

  for (const hunk of file.hunks) {
    for (const row of hunk.rows) {
      if (row.left?.kind === 'delete') {
        deletions += 1;
      }

      if (row.right?.kind === 'add') {
        additions += 1;
      }
    }
  }

  return {
    ...file,
    additions,
    deletions
  };
}

function renderSegments(segments: IntralineSegment[] | null): JSX.Element {
  if (!segments || segments.length === 0) {
    return <>{' '}</>;
  }

  return (
    <>
      {segments.map((segment, index) => (
        <span
          key={`${segment.text}-${index}`}
          className={segment.emphasized ? 'diff-cell__chunk diff-cell__chunk--emphasis' : 'diff-cell__chunk'}
        >
          {segment.text || ' '}
        </span>
      ))}
    </>
  );
}

function renderCell(
  cell: ParsedDiffCell | null,
  side: 'left' | 'right',
  segments: IntralineSegment[] | null = null
): JSX.Element {
  if (!cell) {
    return <div className={`diff-cell diff-cell-empty diff-cell--${side}`} aria-hidden="true" />;
  }

  return (
    <div className={`diff-cell diff-cell--${cell.kind} diff-cell--${side}`}>
      <div className="diff-cell__line-number">{cell.lineNumber ?? ''}</div>
      <code className="diff-cell__content">{segments ? renderSegments(segments) : cell.content || ' '}</code>
    </div>
  );
}

function renderRow(row: ParsedDiffRow, index: number, displayMode: DiffDisplayMode): JSX.Element {
  const segments =
    row.kind === 'change' && row.left && row.right ? buildIntralineSegments(row.left.content, row.right.content) : null;

  return (
    <div
      key={`${row.kind}-${index}`}
      className={`diff-row diff-row--${row.kind} ${row.kind === 'context' ? 'is-context' : ''} ${
        displayMode === 'after-only' ? 'diff-row--after-only' : ''
      }`}
    >
      {displayMode === 'after-only' ? renderCell(row.right, 'right', segments?.right ?? null) : renderCell(row.left, 'left', segments?.left ?? null)}
      {displayMode === 'split' ? renderCell(row.right, 'right', segments?.right ?? null) : null}
    </div>
  );
}

function renderFileMeta(file: ParsedDiffFile): JSX.Element | null {
  const meta = file.meta.filter((line) => !line.startsWith('index ')).slice(0, 3);
  if (meta.length === 0 && !file.previousPath) {
    return null;
  }

  return (
    <div className="diff-file__meta">
      {file.previousPath ? <span>from {file.previousPath}</span> : null}
      {meta.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </div>
  );
}

export function SplitDiffViewer({
  diff,
  files: fileStats,
  isDiffTruncated = false,
  preferredFilePath = null,
  emptyMessage = 'No diff',
  enableFileFilter = false,
  fileFilterPlaceholder = 'Filter files by path'
}: SplitDiffViewerProps): JSX.Element {
  const parsedFiles = useMemo(() => parseUnifiedDiff(diff), [diff]);
  const files = useMemo(() => parsedFiles.map((file) => summarizeFile(file, fileStats)), [fileStats, parsedFiles]);
  const [fileFilterQuery, setFileFilterQuery] = useState('');
  const [activeFileKey, setActiveFileKey] = useState<string | null>(null);
  const deferredFileFilterQuery = useDeferredValue(fileFilterQuery);
  const visibleFiles = useMemo(() => {
    if (!enableFileFilter) {
      return files;
    }

    return files.filter((file) => matchesFileQuery(file, deferredFileFilterQuery));
  }, [deferredFileFilterQuery, enableFileFilter, files]);
  const isFiltering = enableFileFilter && deferredFileFilterQuery.trim().length > 0;

  useEffect(() => {
    setActiveFileKey((current) => {
      if (!visibleFiles.length) {
        return null;
      }

      const preferredFile = visibleFiles.find((file) => matchesFilePath(file, preferredFilePath));
      if (preferredFile) {
        return preferredFile.key;
      }

      if (current && visibleFiles.some((file) => file.key === current)) {
        return current;
      }

      return visibleFiles[0]?.key ?? null;
    });
  }, [preferredFilePath, visibleFiles]);

  if (!diff.trim()) {
    return <div className="diff-empty-state">{emptyMessage}</div>;
  }

  if (files.length === 0) {
    return (
      <pre className="diff-raw-view" aria-label="Raw diff fallback">
        {diff}
      </pre>
    );
  }

  const activeFile = visibleFiles.find((file) => file.key === activeFileKey) ?? visibleFiles[0] ?? null;
  const fileCountLabel = isFiltering ? `${visibleFiles.length}/${files.length}` : String(files.length);
  const activeFileDisplayMode: DiffDisplayMode = activeFile?.kind === 'added' ? 'after-only' : 'split';

  return (
    <div className="diff-workbench">
      <aside className="diff-workbench__sidebar">
        <div className="diff-workbench__sidebar-header">
          <div>
            <div className="diff-workbench__eyebrow">Diff View</div>
            <div className="diff-workbench__sidebar-title">Changed Files</div>
          </div>
          <span className="diff-workbench__file-count">{fileCountLabel}</span>
        </div>

        {enableFileFilter ? (
          <div className="diff-workbench__sidebar-controls">
            <input
              type="text"
              className="input diff-workbench__filter-input"
              value={fileFilterQuery}
              onChange={(event) => setFileFilterQuery(event.target.value)}
              placeholder={fileFilterPlaceholder}
              aria-label="Filter changed files by path"
            />
          </div>
        ) : null}

        <div className="diff-workbench__sidebar-list">
          {visibleFiles.length === 0 ? (
            <div className="diff-workbench__sidebar-empty">
              {`"${fileFilterQuery.trim()}" に一致する変更ファイルはありません。`}
            </div>
          ) : (
            visibleFiles.map((file) => (
              <button
                key={file.key}
                type="button"
                className={`diff-workbench__file-tab ${file.key === activeFile?.key ? 'is-active' : ''}`}
                onClick={() => setActiveFileKey(file.key)}
              >
                <div className="diff-workbench__file-tab-top">
                  <span className={`diff-file__badge diff-file__badge--${file.kind}`}>{fileKindLabel[file.kind]}</span>
                  <span className="diff-workbench__file-tab-stats">
                    <span className="diff-workbench__file-tab-add">+{file.additions}</span>
                    <span className="diff-workbench__file-tab-del">-{file.deletions}</span>
                  </span>
                </div>
                <div className="diff-workbench__file-tab-path">{file.displayPath}</div>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="diff-workbench__main">
        {activeFile ? (
          <>
            <header className="diff-file__header diff-workbench__header">
              <div className="diff-file__heading">
                <span className={`diff-file__badge diff-file__badge--${activeFile.kind}`}>{fileKindLabel[activeFile.kind]}</span>
                <span className="diff-file__path">{activeFile.displayPath}</span>
              </div>
              <div className="diff-workbench__header-side">
                <span className="diff-workbench__split-badge">
                  {activeFileDisplayMode === 'after-only' ? 'After Only' : 'Split View'}
                </span>
                <span className="diff-workbench__header-add">+{activeFile.additions}</span>
                <span className="diff-workbench__header-del">-{activeFile.deletions}</span>
                {isDiffTruncated ? <span className="diff-workbench__header-chip">Truncated</span> : null}
              </div>
              {renderFileMeta(activeFile)}
            </header>

            <div
              className={`diff-file__columns ${activeFileDisplayMode === 'after-only' ? 'diff-file__columns--after-only' : ''}`}
              aria-hidden="true"
            >
              {activeFileDisplayMode === 'split' ? <span>Before</span> : null}
              <span>After</span>
            </div>

            <div className="diff-workbench__body">
              {activeFile.hunks.length === 0 ? (
                <div className="diff-empty-state">Text diff unavailable for this file.</div>
              ) : (
                activeFile.hunks.map((hunk) => (
                  <section key={`${activeFile.key}:${hunk.header}`} className="diff-hunk">
                    <div className="diff-hunk__header">{hunk.header}</div>
                    <div className="diff-hunk__body">{hunk.rows.map((row, index) => renderRow(row, index, activeFileDisplayMode))}</div>
                  </section>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="diff-workbench__body">
            <div className="diff-empty-state">一致する変更ファイルがありません。</div>
          </div>
        )}
      </section>
    </div>
  );
}
