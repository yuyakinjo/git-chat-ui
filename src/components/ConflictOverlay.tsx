import { Check, FileWarning, GitMerge, ShieldOff, X } from "lucide-react";
import { useEffect, useMemo, useState, type JSX } from "react";

import type { ConflictCompareCell, ConflictCompareRow } from "../lib/conflictCompare";
import { buildConflictCompareRows } from "../lib/conflictCompare";
import type {
  ConflictFileDetail,
  ConflictFileVersion,
  ConflictSummary,
  ConflictResolutionSide,
} from "../types";

import { GitFilePathLabel } from "./GitFilePresentation";

type ConflictViewerTab = "compare" | "merged" | "base" | "ours" | "theirs";

interface ConflictOverlayProps {
  summary: ConflictSummary;
  activeFilePath: string | null;
  detail: ConflictFileDetail | null;
  loading: boolean;
  busy: boolean;
  onSelectFile: (file: string) => void;
  onResolve: (side: ConflictResolutionSide) => void;
  onCompleteMergeSession: () => void;
  onAbortMergeSession: () => void;
  onClose: () => void;
}

const tabLabels: Record<ConflictViewerTab, string> = {
  compare: "Compare",
  merged: "Merged",
  base: "Base",
  ours: "Ours",
  theirs: "Theirs",
};

function describeConflictVersion(version: ConflictFileVersion): string {
  if (version.isBinary) {
    return "Binary";
  }

  if (version.content === null) {
    return "Missing";
  }

  return "Text";
}

function renderVersionContent(version: ConflictFileVersion, label: string): JSX.Element {
  if (version.isBinary) {
    return (
      <div className="flex h-full min-h-[220px] items-center justify-center px-6 text-center text-sm text-ink-subtle">
        {label} は binary file です。
      </div>
    );
  }

  if (version.content === null) {
    return (
      <div className="flex h-full min-h-[220px] items-center justify-center px-6 text-center text-sm text-ink-subtle">
        {label} は存在しません。
      </div>
    );
  }

  const numberedLines = version.content.split("\n").map((line, lineIndex) => ({
    line,
    lineNumber: lineIndex + 1,
    key: `${label}-${lineIndex + 1}-${line}`,
  }));

  return (
    <div className="overflow-auto rounded-2xl border border-black/10 bg-black/3">
      <div className="min-w-full font-[ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace] text-[12px] leading-6">
        {numberedLines.map((item) => (
          <div
            key={item.key}
            className="grid grid-cols-[56px_minmax(0,1fr)] border-b border-black/5 last:border-b-0"
          >
            <div className="select-none border-r border-black/5 px-3 py-1 text-right text-ink-subtle">
              {item.lineNumber}
            </div>
            <pre className="m-0 overflow-x-auto px-3 py-1 whitespace-pre-wrap break-words text-ink">
              {item.line || " "}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderCompareSegments(cell: ConflictCompareCell): JSX.Element {
  if (!cell.content) {
    return <> </>;
  }

  if (!cell.segments || cell.segments.length === 0) {
    return <>{cell.content}</>;
  }

  return (
    <>
      {(() => {
        let offset = 0;

        return cell.segments.map((segment) => {
          const key = `${cell.lineNumber ?? "missing"}-${offset}-${segment.emphasized ? "1" : "0"}`;
          offset += segment.text.length;

          return (
            <span
              key={key}
              className={
                segment.emphasized ? "diff-cell__chunk diff-cell__chunk--emphasis" : undefined
              }
            >
              {segment.text || " "}
            </span>
          );
        });
      })()}
    </>
  );
}

function renderCompareCell(
  cell: ConflictCompareCell | null,
  side: "left" | "right",
  fallbackLabel: string,
): JSX.Element {
  if (!cell) {
    return (
      <div className={`diff-cell diff-cell-empty diff-cell--${side}`} aria-label={fallbackLabel} />
    );
  }

  return (
    <div className={`diff-cell diff-cell--${cell.kind} diff-cell--${side}`}>
      <div className="diff-cell__line-number">{cell.lineNumber ?? ""}</div>
      <code className="diff-cell__content">{renderCompareSegments(cell)}</code>
    </div>
  );
}

function renderInlineCompare(compare: ReturnType<typeof buildConflictCompareRows>): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="rounded-2xl border border-black/10 bg-black/3 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              Ours
            </div>
            <span className="badge bg-black/5! text-ink-soft!">{compare.leftLineCount} lines</span>
          </div>
          <div className="mt-1 text-sm text-ink">現在の checkout 側の内容です。</div>
          <div className="mt-1 text-xs text-ink-subtle">削除・変更された行を赤系で示します。</div>
        </div>

        <div className="rounded-2xl border border-black/10 bg-black/3 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              Theirs
            </div>
            <span className="badge bg-black/5! text-ink-soft!">{compare.rightLineCount} lines</span>
          </div>
          <div className="mt-1 text-sm text-ink">取り込み元の内容です。</div>
          <div className="mt-1 text-xs text-ink-subtle">追加・変更された行を緑系で示します。</div>
        </div>

        <div className="rounded-2xl border border-black/10 bg-[#eef6ff] px-4 py-3 text-left">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#0f4c81]">
            Highlight
          </div>
          <div className="mt-1 text-sm font-semibold text-[#0f4c81]">
            {compare.changedRows} changed row{compare.changedRows === 1 ? "" : "s"}
          </div>
          <div className="mt-1 text-xs text-[#3f5f7b]">
            行背景と行内ハイライトで差分位置を示します。
          </div>
        </div>
      </div>

      <div className="diff-workbench diff-workbench--single-file conflict-compare">
        <section className="diff-workbench__main">
          <div className="diff-file__columns" aria-hidden="true">
            <span>Ours</span>
            <span>Theirs</span>
          </div>
          <div className="diff-workbench__body">
            {compare.rows.length > 0 ? (
              compare.rows.map((row: ConflictCompareRow) => (
                <div
                  key={`${row.kind}-${row.left?.lineNumber ?? "none"}-${row.right?.lineNumber ?? "none"}-${row.left?.content ?? ""}-${row.right?.content ?? ""}`}
                  className={`diff-row diff-row--${row.kind}`}
                >
                  {renderCompareCell(row.left, "left", "Missing in ours")}
                  {renderCompareCell(row.right, "right", "Missing in theirs")}
                </div>
              ))
            ) : (
              <div className="flex min-h-[180px] items-center justify-center px-6 text-sm text-ink-subtle">
                Ours と Theirs に textual difference はありません。
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function renderComparePane(options: {
  label: string;
  version: ConflictFileVersion;
  hint: string;
}): JSX.Element {
  const { label, version, hint } = options;

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-black/10 bg-white/70">
      <div className="flex items-start justify-between gap-3 border-b border-black/8 px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink">{label}</div>
          <div className="text-xs text-ink-subtle">{hint}</div>
        </div>
        <span className="badge bg-black/5! text-ink-soft!">{describeConflictVersion(version)}</span>
      </div>
      <div className="min-h-0 flex-1 p-3">{renderVersionContent(version, label)}</div>
    </section>
  );
}

export function ConflictOverlay({
  summary,
  activeFilePath,
  detail,
  loading,
  busy,
  onSelectFile,
  onResolve,
  onCompleteMergeSession,
  onAbortMergeSession,
  onClose,
}: ConflictOverlayProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<ConflictViewerTab>("compare");
  const activeFileCount = summary.files.length;
  const isMergeSession = summary.contextType === "mergeSession";
  const activeVersion = detail && activeTab !== "compare" ? detail[activeTab] : null;
  const canCompleteMergeSession = isMergeSession && activeFileCount === 0;
  const canRenderInlineCompare = useMemo(
    () => Boolean(detail && !detail.ours.isBinary && !detail.theirs.isBinary),
    [detail],
  );
  const inlineCompare = useMemo(
    () => (detail ? buildConflictCompareRows(detail.ours.content, detail.theirs.content) : null),
    [detail],
  );

  useEffect(() => {
    setActiveTab("compare");
  }, [activeFilePath]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [busy, onClose]);

  return (
    <div
      className="absolute inset-0 z-40 bg-slate-950/55 p-3 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="conflict viewer"
    >
      <section className="panel flex h-full min-h-0 flex-col overflow-hidden p-4 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="section-title">Conflict Viewer</div>
            <div className="truncate text-base font-semibold text-ink">
              {activeFilePath ?? "Conflicted files"}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
              <span className="badge bg-[#ffe2e0]! text-[#b42318]!">Conflict</span>
              <span className="badge bg-black/5! text-ink-soft!">
                {summary.operation === "unknown" ? "Unmerged state" : summary.operation}
              </span>
              {summary.sourceBranch && summary.targetBranch ? (
                <span>
                  {summary.sourceBranch} -&gt; {summary.targetBranch}
                </span>
              ) : null}
              <span>{activeFileCount} files</span>
            </div>
          </div>
          <button
            type="button"
            className="button button-secondary inline-flex h-9 w-9 shrink-0 items-center justify-center p-0!"
            onClick={onClose}
            title="Close"
            aria-label="Close"
            disabled={busy}
          >
            <X size={14} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(240px,320px)_minmax(0,1fr)] gap-4 max-[980px]:grid-cols-1">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-black/10 bg-white/60">
            <div className="border-b border-black/8 px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              Files
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {summary.files.length === 0 ? (
                <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 px-4 text-center text-sm text-ink-subtle">
                  <Check size={18} />
                  <div>未解消の conflict はありません。</div>
                  {isMergeSession ? (
                    <div>Complete Merge で target branch を更新できます。</div>
                  ) : (
                    <div>必要なら通常の Git 操作を続けてください。</div>
                  )}
                </div>
              ) : (
                summary.files.map((file) => (
                  <button
                    key={file.file}
                    type="button"
                    className={`commit-detail-panel__file-button mb-1 flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition last:mb-0 ${
                      activeFilePath === file.file ? "is-active text-white" : ""
                    }`}
                    onClick={() => onSelectFile(file.file)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium">
                        <GitFilePathLabel path={file.file} />
                      </div>
                    </div>
                    <div
                      className={`text-[11px] font-semibold ${
                        activeFilePath === file.file ? "text-white" : "text-ink-subtle"
                      }`}
                    >
                      {file.statusLabel}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-black/10 bg-white/60 p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {(Object.keys(tabLabels) as ConflictViewerTab[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={`button ${activeTab === tab ? "button-primary" : "button-secondary"}`}
                    onClick={() => setActiveTab(tab)}
                    disabled={loading || !detail}
                  >
                    {tabLabels[tab]}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => onResolve("ours")}
                  disabled={busy || loading || !activeFilePath}
                >
                  Take Ours
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => onResolve("theirs")}
                  disabled={busy || loading || !activeFilePath}
                >
                  Take Theirs
                </button>
                <button
                  type="button"
                  className="button button-secondary inline-flex items-center gap-2"
                  onClick={() => onResolve("merged")}
                  disabled={busy || loading || !activeFilePath}
                >
                  <Check size={14} />
                  Mark Resolved
                </button>
                {isMergeSession ? (
                  <>
                    <button
                      type="button"
                      className="button button-secondary inline-flex items-center gap-2"
                      onClick={onAbortMergeSession}
                      disabled={busy}
                    >
                      <ShieldOff size={14} />
                      Abort Merge
                    </button>
                    <button
                      type="button"
                      className="button button-primary inline-flex items-center gap-2"
                      onClick={onCompleteMergeSession}
                      disabled={busy || !canCompleteMergeSession}
                    >
                      <GitMerge size={14} />
                      Complete Merge
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            {detail ? (
              <div className="mb-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
                  <span className="badge bg-[#ffe2e0]! text-[#b42318]!">{detail.statusLabel}</span>
                  <span>{tabLabels[activeTab]}</span>
                </div>
                <div className="text-xs text-ink-subtle">
                  Compare で Ours / Theirs を見比べるか、外部 editor で調整した current file
                  をそのまま採用するときは Mark Resolved を使います。
                </div>
              </div>
            ) : null}

            {loading ? (
              <div className="flex flex-1 items-center justify-center text-sm text-ink-subtle">
                読み込み中...
              </div>
            ) : detail && activeTab === "compare" ? (
              canRenderInlineCompare && inlineCompare ? (
                renderInlineCompare(inlineCompare)
              ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="rounded-2xl border border-black/10 bg-black/3 px-4 py-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                        Current File
                      </div>
                      <div className="mt-1 text-sm text-ink">
                        Merged タブで現在の working tree 内容を確認できます。
                      </div>
                      <div className="mt-1 text-xs text-ink-subtle">
                        外部 editor で解消後は Mark Resolved で stage します。
                      </div>
                    </div>
                    <div className="rounded-2xl border border-black/10 bg-black/3 px-4 py-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                        Base
                      </div>
                      <div className="mt-1 text-sm text-ink">
                        Base タブで共通祖先を確認しながら取り込み先を判断できます。
                      </div>
                    </div>
                  </div>

                  <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-2">
                    {renderComparePane({
                      label: "Ours",
                      version: detail.ours,
                      hint: "現在の checkout 側を優先して採用します。",
                    })}
                    {renderComparePane({
                      label: "Theirs",
                      version: detail.theirs,
                      hint: "取り込み元の変更を優先して採用します。",
                    })}
                  </div>
                </div>
              )
            ) : detail && activeVersion ? (
              renderVersionContent(activeVersion, tabLabels[activeTab])
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-ink-subtle">
                <FileWarning size={18} />
                <div>
                  {activeFilePath
                    ? "この conflict の内容を表示できませんでした。"
                    : "左側から conflicted file を選択してください。"}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
