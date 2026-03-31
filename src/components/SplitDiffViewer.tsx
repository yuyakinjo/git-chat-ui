import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type JSX,
} from "react";

import {
  parseUnifiedDiff,
  type ParsedDiffCell,
  type ParsedDiffFile,
  type ParsedDiffRow,
} from "../lib/diff";
import { useDiffSyntaxTokenMap } from "../hooks/useDiffSyntaxTokenMap";
import { canUseDiffSyntaxWorker } from "../lib/diffSyntaxWorkerClient";
import {
  buildDiffSyntaxDisplayTokens,
  buildDiffSyntaxTokens,
  getDiffSyntaxCacheKey,
  resolveDiffSyntaxLanguage,
  resolveDiffSyntaxTheme,
  type DiffSyntaxDisplayToken,
  type DiffSyntaxLanguage,
  type DiffSyntaxTheme,
  type DiffSyntaxToken,
  type DiffSyntaxWorkerRequestItem,
} from "../lib/diffSyntax";
import { buildIntralineSegments, type IntralineSegment } from "../lib/intralineDiff";

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
  showFileList?: boolean;
  emptyMessage?: string;
  enableFileFilter?: boolean;
  fileFilterPlaceholder?: string;
  activeFileLoading?: boolean;
  activeFileError?: string | null;
  activeFileLoadingMessage?: string;
  onActiveFileChange?: (filePath: string | null, hasInlineDiff: boolean) => void;
}

type DiffDisplayMode = "split" | "after-only";
type SplitDiffFileKind = ParsedDiffFile["kind"] | "changed";
type SplitDiffDisplayFile = Omit<ParsedDiffFile, "kind"> & {
  kind: SplitDiffFileKind;
  additions: number;
  deletions: number;
};

const fileKindLabel: Record<SplitDiffFileKind, string> = {
  modified: "Modified",
  added: "Added",
  deleted: "Deleted",
  renamed: "Renamed",
  changed: "Changed",
};

function matchesFilePath(
  file: Pick<ParsedDiffFile, "displayPath" | "newPath" | "oldPath">,
  targetPath: string | null | undefined,
): boolean {
  if (!targetPath) {
    return false;
  }

  return (
    file.displayPath === targetPath || file.newPath === targetPath || file.oldPath === targetPath
  );
}

function matchesFileQuery(
  file: Pick<ParsedDiffFile, "displayPath" | "newPath" | "oldPath" | "previousPath">,
  query: string,
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

function summarizeFile(
  file: ParsedDiffFile,
  stats: SplitDiffFileStat[] | undefined,
): SplitDiffDisplayFile {
  const matched = stats?.find((item) => matchesFilePath(file, item.file));
  if (matched) {
    return {
      ...file,
      additions: matched.additions,
      deletions: matched.deletions,
    };
  }

  let additions = 0;
  let deletions = 0;

  for (const hunk of file.hunks) {
    for (const row of hunk.rows) {
      if (row.left?.kind === "delete") {
        deletions += 1;
      }

      if (row.right?.kind === "add") {
        additions += 1;
      }
    }
  }

  return {
    ...file,
    additions,
    deletions,
  };
}

function createStatOnlyFile(stat: SplitDiffFileStat): SplitDiffDisplayFile {
  return {
    key: stat.file,
    kind: "changed",
    oldPath: stat.file,
    newPath: stat.file,
    displayPath: stat.file,
    previousPath: null,
    meta: [],
    hunks: [],
    additions: stat.additions,
    deletions: stat.deletions,
  };
}

function buildDisplayFiles(
  parsedFiles: ParsedDiffFile[],
  stats: SplitDiffFileStat[] | undefined,
): SplitDiffDisplayFile[] {
  const summarizedParsed = parsedFiles.map((file) => summarizeFile(file, stats));
  if (!stats?.length) {
    return summarizedParsed;
  }

  const unmatchedParsedFiles = [...summarizedParsed];
  const orderedFiles = stats.map((stat) => {
    const matchedIndex = unmatchedParsedFiles.findIndex((file) => matchesFilePath(file, stat.file));
    if (matchedIndex === -1) {
      return createStatOnlyFile(stat);
    }

    const [matchedFile] = unmatchedParsedFiles.splice(matchedIndex, 1);
    return matchedFile;
  });

  return [...orderedFiles, ...unmatchedParsedFiles];
}

const FONT_STYLE_ITALIC = 1;
const FONT_STYLE_BOLD = 2;
const FONT_STYLE_UNDERLINE = 4;
const FONT_STYLE_STRIKETHROUGH = 8;

function buildTokenStyle(token: DiffSyntaxDisplayToken): CSSProperties | undefined {
  const textDecorations: string[] = [];
  const style: CSSProperties = {};

  if (token.color) {
    style.color = token.color;
  }

  if (token.bgColor) {
    style.backgroundColor = token.bgColor;
  }

  if (token.fontStyle) {
    if (token.fontStyle & FONT_STYLE_ITALIC) {
      style.fontStyle = "italic";
    }

    if (token.fontStyle & FONT_STYLE_BOLD) {
      style.fontWeight = 700;
    }

    if (token.fontStyle & FONT_STYLE_UNDERLINE) {
      textDecorations.push("underline");
    }

    if (token.fontStyle & FONT_STYLE_STRIKETHROUGH) {
      textDecorations.push("line-through");
    }
  }

  if (textDecorations.length > 0) {
    style.textDecoration = textDecorations.join(" ");
  }

  return Object.keys(style).length > 0 ? style : undefined;
}

function renderContent(
  content: string,
  language: DiffSyntaxLanguage | null,
  theme: DiffSyntaxTheme,
  segments: IntralineSegment[] | null,
  baseTokens: DiffSyntaxToken[] | null,
  preferAsyncHighlighting: boolean,
): JSX.Element {
  if (!content) {
    return <> </>;
  }

  if (!language && (!segments || segments.length === 0)) {
    return <>{content}</>;
  }

  const tokens = baseTokens
    ? buildDiffSyntaxDisplayTokens(baseTokens, content, segments)
    : language && !preferAsyncHighlighting
      ? buildDiffSyntaxTokens(content, language, segments, theme)
      : buildDiffSyntaxDisplayTokens([{ content }], content, segments);
  if (tokens.length === 0) {
    return <> </>;
  }

  const groups: Array<{ emphasized: boolean; tokens: DiffSyntaxDisplayToken[] }> = [];
  for (const token of tokens) {
    const previous = groups.at(-1);
    if (previous && previous.emphasized === token.emphasized) {
      previous.tokens.push(token);
      continue;
    }

    groups.push({
      emphasized: token.emphasized,
      tokens: [token],
    });
  }

  return (
    <>
      {/* oxlint-disable react/no-array-index-key -- tokens have no stable unique ID */}
      {groups.map((group, groupIndex) => (
        <span
          key={`${group.emphasized ? "emphasis" : "plain"}-${groupIndex}`}
          className={
            group.emphasized ? "diff-cell__chunk diff-cell__chunk--emphasis" : "diff-cell__chunk"
          }
        >
          {group.tokens.map((token, tokenIndex) => (
            <span
              key={`${groupIndex}-${tokenIndex}-${token.content}`}
              className={token.color || token.bgColor || token.fontStyle ? "diff-token" : undefined}
              style={buildTokenStyle(token)}
            >
              {token.content || " "}
            </span>
          ))}
        </span>
      ))}
    </>
  );
}

function renderCell(
  cell: ParsedDiffCell | null,
  side: "left" | "right",
  language: DiffSyntaxLanguage | null,
  theme: DiffSyntaxTheme,
  baseTokens: DiffSyntaxToken[] | null,
  preferAsyncHighlighting: boolean,
  segments: IntralineSegment[] | null = null,
): JSX.Element {
  if (!cell) {
    return <div className={`diff-cell diff-cell-empty diff-cell--${side}`} aria-hidden="true" />;
  }

  return (
    <div className={`diff-cell diff-cell--${cell.kind} diff-cell--${side}`}>
      <div className="diff-cell__line-number">{cell.lineNumber ?? ""}</div>
      <code className="diff-cell__content">
        {renderContent(
          cell.content,
          language,
          theme,
          segments,
          baseTokens,
          preferAsyncHighlighting,
        )}
      </code>
    </div>
  );
}

function renderRow(
  row: ParsedDiffRow,
  index: number,
  displayMode: DiffDisplayMode,
  language: DiffSyntaxLanguage | null,
  theme: DiffSyntaxTheme,
  syntaxTokenMap: Record<string, DiffSyntaxToken[]>,
  preferAsyncHighlighting: boolean,
): JSX.Element {
  const segments =
    row.kind === "change" && row.left && row.right
      ? buildIntralineSegments(row.left.content, row.right.content)
      : null;
  const leftTokens =
    language && row.left
      ? (syntaxTokenMap[getDiffSyntaxCacheKey(theme, language, row.left.content)] ?? null)
      : null;
  const rightTokens =
    language && row.right
      ? (syntaxTokenMap[getDiffSyntaxCacheKey(theme, language, row.right.content)] ?? null)
      : null;

  return (
    <div
      key={`${row.kind}-${index}`}
      className={`diff-row diff-row--${row.kind} ${row.kind === "context" ? "is-context" : ""} ${
        displayMode === "after-only" ? "diff-row--after-only" : ""
      }`}
    >
      {displayMode === "after-only"
        ? renderCell(
            row.right,
            "right",
            language,
            theme,
            rightTokens,
            preferAsyncHighlighting,
            segments?.right ?? null,
          )
        : renderCell(
            row.left,
            "left",
            language,
            theme,
            leftTokens,
            preferAsyncHighlighting,
            segments?.left ?? null,
          )}
      {displayMode === "split"
        ? renderCell(
            row.right,
            "right",
            language,
            theme,
            rightTokens,
            preferAsyncHighlighting,
            segments?.right ?? null,
          )
        : null}
    </div>
  );
}

function collectSyntaxHighlightRequests(
  file: Pick<SplitDiffDisplayFile, "hunks"> | null,
  language: DiffSyntaxLanguage | null,
  theme: DiffSyntaxTheme,
): DiffSyntaxWorkerRequestItem[] {
  if (!file || !language) {
    return [];
  }

  const requests = new Map<string, DiffSyntaxWorkerRequestItem>();
  for (const hunk of file.hunks) {
    for (const row of hunk.rows) {
      const cells = [row.left, row.right];
      for (const cell of cells) {
        if (!cell || !cell.content) {
          continue;
        }

        const cacheKey = getDiffSyntaxCacheKey(theme, language, cell.content);
        requests.set(cacheKey, {
          cacheKey,
          content: cell.content,
          language,
          theme,
        });
      }
    }
  }

  return [...requests.values()];
}

function renderFileMeta(
  file: Pick<SplitDiffDisplayFile, "meta" | "previousPath">,
): JSX.Element | null {
  const meta = file.meta.filter((line) => !line.startsWith("index ")).slice(0, 3);
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
  showFileList = true,
  emptyMessage = "No diff",
  enableFileFilter = false,
  fileFilterPlaceholder = "Filter files by path",
  activeFileLoading = false,
  activeFileError = null,
  activeFileLoadingMessage = "Loading diff...",
  onActiveFileChange,
}: SplitDiffViewerProps): JSX.Element {
  const parsedFiles = useMemo(() => parseUnifiedDiff(diff), [diff]);
  const files = useMemo(() => buildDisplayFiles(parsedFiles, fileStats), [fileStats, parsedFiles]);
  const [fileFilterQuery, setFileFilterQuery] = useState("");
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

  const preferredFile =
    visibleFiles.find((file) => matchesFilePath(file, preferredFilePath)) ?? null;
  const activeFile =
    visibleFiles.find((file) => file.key === activeFileKey) ??
    preferredFile ??
    visibleFiles[0] ??
    null;

  useEffect(() => {
    if (!onActiveFileChange) {
      return;
    }

    onActiveFileChange(activeFile?.displayPath ?? null, Boolean(activeFile?.hunks.length));
  }, [activeFile, onActiveFileChange]);

  const activeFileLanguage = resolveDiffSyntaxLanguage(
    activeFile?.newPath ?? activeFile?.oldPath ?? activeFile?.displayPath ?? null,
  );
  const activeDiffSyntaxTheme = resolveDiffSyntaxTheme(
    typeof document === "undefined" ? null : document.body.dataset.theme,
  );
  const preferAsyncSyntaxHighlighting = activeFileLanguage !== null && canUseDiffSyntaxWorker();
  const syntaxHighlightRequests = useMemo(
    () =>
      preferAsyncSyntaxHighlighting
        ? collectSyntaxHighlightRequests(activeFile, activeFileLanguage, activeDiffSyntaxTheme)
        : [],
    [activeDiffSyntaxTheme, activeFile, activeFileLanguage, preferAsyncSyntaxHighlighting],
  );
  const syntaxTokenMap = useDiffSyntaxTokenMap(syntaxHighlightRequests);

  if (!diff.trim()) {
    return <div className="diff-empty-state">{emptyMessage}</div>;
  }

  if (parsedFiles.length === 0 && files.length === 0) {
    return (
      <pre className="diff-raw-view" aria-label="Raw diff fallback">
        {diff}
      </pre>
    );
  }

  const fileCountLabel = isFiltering
    ? `${visibleFiles.length}/${files.length}`
    : String(files.length);
  const activeFileDisplayMode: DiffDisplayMode =
    activeFile?.kind === "added" ? "after-only" : "split";

  return (
    <div className={`diff-workbench ${showFileList ? "" : "diff-workbench--single-file"}`}>
      {showFileList ? (
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
                  className={`diff-workbench__file-tab ${file.key === activeFile?.key ? "is-active" : ""}`}
                  onClick={() => setActiveFileKey(file.key)}
                >
                  <div className="diff-workbench__file-tab-top">
                    <span className={`diff-file__badge diff-file__badge--${file.kind}`}>
                      {fileKindLabel[file.kind]}
                    </span>
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
      ) : null}

      <section className="diff-workbench__main">
        {activeFile ? (
          <>
            <header className="diff-file__header diff-workbench__header">
              <div className="diff-file__heading">
                <span className={`diff-file__badge diff-file__badge--${activeFile.kind}`}>
                  {fileKindLabel[activeFile.kind]}
                </span>
                <span className="diff-file__path">{activeFile.displayPath}</span>
              </div>
              <div className="diff-workbench__header-side">
                <span className="diff-workbench__split-badge">
                  {activeFileDisplayMode === "after-only" ? "After Only" : "Split View"}
                </span>
                <span className="diff-workbench__header-add">+{activeFile.additions}</span>
                <span className="diff-workbench__header-del">-{activeFile.deletions}</span>
                {isDiffTruncated ? (
                  <span className="diff-workbench__header-chip">Truncated</span>
                ) : null}
              </div>
              {renderFileMeta(activeFile)}
            </header>

            <div
              className={`diff-file__columns ${activeFileDisplayMode === "after-only" ? "diff-file__columns--after-only" : ""}`}
              aria-hidden="true"
            >
              {activeFileDisplayMode === "split" ? <span>Before</span> : null}
              <span>After</span>
            </div>

            <div className="diff-workbench__body">
              {activeFile.hunks.length === 0 && activeFileLoading ? (
                <div className="diff-empty-state">{activeFileLoadingMessage}</div>
              ) : activeFile.hunks.length === 0 && activeFileError ? (
                <div className="diff-empty-state">{activeFileError}</div>
              ) : activeFile.hunks.length === 0 ? (
                <div className="diff-empty-state">Text diff unavailable for this file.</div>
              ) : (
                activeFile.hunks.map((hunk) => (
                  <section key={`${activeFile.key}:${hunk.header}`} className="diff-hunk">
                    <div className="diff-hunk__header">{hunk.header}</div>
                    <div className="diff-hunk__body">
                      {hunk.rows.map((row, index) =>
                        renderRow(
                          row,
                          index,
                          activeFileDisplayMode,
                          activeFileLanguage,
                          activeDiffSyntaxTheme,
                          syntaxTokenMap,
                          preferAsyncSyntaxHighlighting,
                        ),
                      )}
                    </div>
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
