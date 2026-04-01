import { useEffect, useRef, useState, type JSX } from "react";
import { CalendarClock, Expand, FileCode2, User } from "lucide-react";

import { shouldSplitCommitDetailPanel } from "../lib/controllerPanelLayout";
import { formatRelativeDate, shortSha } from "../lib/format";
import type { CommitDetail, WorkingFile, WorkingTreeDiffArea } from "../types";

import { GitFilePathLabel, getWorkingFileStatusPresentation } from "./GitFilePresentation";

type WorkingTreeSelectionArea = WorkingTreeDiffArea | "conflicted";

interface WorkingTreeSelection {
  stagedCount: number;
  unstagedCount: number;
  conflictedCount: number;
  files: Array<
    Pick<WorkingFile, "file" | "statusLabel" | "x" | "y"> & { area: WorkingTreeSelectionArea }
  >;
}

interface CommitDetailPanelProps {
  detail: CommitDetail | null;
  loading: boolean;
  activeDiffFile: string | null;
  onOpenFileDiff: (file: string) => void;
  activeWorkingTreeDiff?: { file: string; area: WorkingTreeDiffArea } | null;
  onOpenWorkingTreeDiff?: (file: string, area: WorkingTreeDiffArea) => void;
  activeConflictFile?: string | null;
  onOpenConflict?: (file: string) => void;
  workingTreeSelection?: WorkingTreeSelection | null;
  headerAccessory?: JSX.Element | null;
}

export function CommitDetailPanel({
  detail,
  loading,
  activeDiffFile,
  onOpenFileDiff,
  activeWorkingTreeDiff = null,
  onOpenWorkingTreeDiff,
  activeConflictFile = null,
  onOpenConflict,
  workingTreeSelection = null,
  headerAccessory,
}: CommitDetailPanelProps): JSX.Element {
  const rootRef = useRef<HTMLElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const selectionMode = workingTreeSelection ? "working-tree" : detail ? "commit" : "empty";
  const canOpenWorkingTreeDiff = selectionMode === "working-tree" && Boolean(onOpenWorkingTreeDiff);
  const canOpenConflict = selectionMode === "working-tree" && Boolean(onOpenConflict);
  const isSplitLayout = shouldSplitCommitDetailPanel(containerWidth);

  useEffect(() => {
    const rootNode = rootRef.current;
    if (!rootNode) {
      return;
    }

    const updateWidth = (): void => {
      setContainerWidth(rootNode.clientWidth);
    };

    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => {
        window.removeEventListener("resize", updateWidth);
      };
    }

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(rootNode);

    return () => {
      observer.disconnect();
    };
  }, []);

  const renderWorkingTreeFileSummary = (
    file: Pick<WorkingFile, "file" | "statusLabel" | "x" | "y"> & { area: WorkingTreeSelectionArea },
    isActive: boolean,
  ): JSX.Element => {
    const statusPresentation = getWorkingFileStatusPresentation(file);

    return (
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`git-file-card__status-icon git-file-card__status-icon--${statusPresentation.tone}`}
          aria-hidden="true"
          title={statusPresentation.label}
        >
          {statusPresentation.icon}
        </span>
        <div
          className={`commit-detail-panel__file-meta flex flex-none flex-wrap items-center gap-2 text-[11px] ${
            isActive ? "text-white/80" : ""
          }`}
        >
          <span
            className={`badge ${
              file.area === "staged"
                ? "bg-[#ecfdf3]! text-[#157347]!"
                : file.area === "unstaged"
                  ? "bg-[#fff4d6]! text-[#a15c00]!"
                  : "bg-[#ffe2e0]! text-[#b42318]!"
            }`}
          >
            {file.area === "staged"
              ? "Staged"
              : file.area === "unstaged"
                ? "Unstaged"
                : "Conflicted"}
          </span>
        </div>
        <div
          className={`commit-detail-panel__file-name min-w-0 flex-1 text-xs font-medium ${isActive ? "text-white" : ""}`}
        >
          <GitFilePathLabel path={file.file} />
        </div>
      </div>
    );
  };
  const summaryCard =
    selectionMode === "commit" && detail ? (
      <div className="commit-detail-panel__card rounded-xl p-3">
        <div className="commit-detail-panel__card-title mb-2 text-sm font-semibold">
          {detail.body.split("\n")[0] || "No title"}
        </div>
        <div className="commit-detail-panel__card-meta space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <User size={12} />
            {detail.author} ({detail.email})
          </div>
          <div className="flex items-center gap-2">
            <CalendarClock size={12} />
            {formatRelativeDate(detail.date)}
          </div>
          <div className="flex items-center gap-2">
            <FileCode2 size={12} />
            {shortSha(detail.sha)}
          </div>
        </div>
      </div>
    ) : selectionMode === "working-tree" && workingTreeSelection ? (
      <div className="commit-detail-panel__card rounded-xl p-3">
        <div className="commit-detail-panel__card-title mb-2 text-sm font-semibold">
          Working Tree Changes
        </div>
        <div className="commit-detail-panel__card-meta flex flex-wrap items-center gap-2 text-xs">
          <span className="badge bg-[#fff4d6]! text-[#a15c00]!">WIP</span>
          {workingTreeSelection.stagedCount > 0 ? (
            <span>{workingTreeSelection.stagedCount} staged</span>
          ) : null}
          {workingTreeSelection.unstagedCount > 0 ? (
            <span>{workingTreeSelection.unstagedCount} unstaged</span>
          ) : null}
          {workingTreeSelection.conflictedCount > 0 ? (
            <span>{workingTreeSelection.conflictedCount} conflicted</span>
          ) : null}
        </div>
      </div>
    ) : null;

  return (
    <section ref={rootRef} className="panel flex min-h-0 min-w-0 flex-col overflow-hidden p-3">
      <div className="mb-2 flex items-center justify-between gap-2 px-2">
        <div className="section-title">Commit Detail</div>
        {headerAccessory}
      </div>

      {loading && selectionMode !== "working-tree" ? (
        <div className="commit-detail-panel__muted p-4 text-sm">詳細を読み込み中...</div>
      ) : null}

      {!loading && selectionMode === "empty" ? (
        <div className="commit-detail-panel__muted p-4 text-sm">
          コミットをクリックすると詳細が表示されます。
        </div>
      ) : null}

      {selectionMode !== "empty" ? (
        <div
          className={`commit-detail-panel__content px-2 pb-2 ${isSplitLayout ? "commit-detail-panel__content--split" : ""}`}
        >
          <div className="commit-detail-panel__summary">
            <div className="commit-detail-panel__section-header mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.08em]">
              <span>Overview</span>
            </div>
            {summaryCard}
          </div>

          <div className="commit-detail-panel__files" data-controller-panel-drag-ignore="true">
            <div className="commit-detail-panel__section-header mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.08em]">
              <span>Changed Files</span>
              {selectionMode !== "commit" && !canOpenWorkingTreeDiff && !canOpenConflict ? (
                <span className="commit-detail-panel__files-note text-[11px] font-medium normal-case tracking-normal">
                  WIP 選択中の変更ファイル一覧です
                </span>
              ) : null}
            </div>
            <div className="commit-detail-panel__files-body min-h-0 flex-1 overflow-y-auto rounded-xl p-2">
              {selectionMode === "commit" && detail ? (
                detail.files.length === 0 ? (
                  <div className="commit-detail-panel__muted p-3 text-xs">
                    ファイル差分はありません。
                  </div>
                ) : (
                  detail.files.map((file) => (
                    <button
                      key={file.file}
                      type="button"
                      className={`commit-detail-panel__file-button mb-1 flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition last:mb-0 ${
                        activeDiffFile === file.file ? "is-active text-white" : ""
                      }`}
                      onClick={() => onOpenFileDiff(file.file)}
                    >
                      <div className="min-w-0">
                        <div className="commit-detail-panel__file-name truncate text-xs font-medium">
                          {file.file}
                        </div>
                        <div
                          className={`commit-detail-panel__file-meta mt-1 flex items-center gap-2 text-[11px] ${activeDiffFile === file.file ? "text-white/80" : ""}`}
                        >
                          <span className="text-[#157347]">+{file.additions}</span>
                          <span className="text-[#b42318]">-{file.deletions}</span>
                        </div>
                      </div>
                      <div
                        className={`commit-detail-panel__file-action flex items-center gap-1 text-[11px] font-semibold ${
                          activeDiffFile === file.file ? "text-white" : ""
                        }`}
                      >
                        <Expand size={12} />
                        Open Diff
                      </div>
                    </button>
                  ))
                )
              ) : workingTreeSelection && workingTreeSelection.files.length > 0 ? (
                workingTreeSelection.files.map((file) => {
                  if (file.area === "conflicted" && onOpenConflict) {
                    return (
                      <button
                        key={`${file.area}:${file.file}`}
                        type="button"
                        className={`commit-detail-panel__file-button mb-1 flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition last:mb-0 ${
                          activeConflictFile === file.file ? "is-active text-white" : ""
                        }`}
                        onClick={() => onOpenConflict(file.file)}
                      >
                        {renderWorkingTreeFileSummary(file, activeConflictFile === file.file)}
                        <div
                          className={`commit-detail-panel__file-action flex items-center gap-1 text-[11px] font-semibold ${
                            activeConflictFile === file.file ? "text-white" : ""
                          }`}
                        >
                          <Expand size={12} />
                          Open Conflict
                        </div>
                      </button>
                    );
                  }

                  if (file.area !== "conflicted" && onOpenWorkingTreeDiff) {
                    const area = file.area as WorkingTreeDiffArea;
                    const isActive =
                      activeWorkingTreeDiff?.file === file.file &&
                      activeWorkingTreeDiff.area === area;

                    return (
                      <button
                        key={`${file.area}:${file.file}`}
                        type="button"
                        className={`commit-detail-panel__file-button mb-1 flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition last:mb-0 ${
                          isActive ? "is-active text-white" : ""
                        }`}
                        onClick={() => onOpenWorkingTreeDiff(file.file, area)}
                      >
                        {renderWorkingTreeFileSummary(file, isActive)}
                        <div
                          className={`commit-detail-panel__file-action flex items-center gap-1 text-[11px] font-semibold ${
                            isActive ? "text-white" : ""
                          }`}
                        >
                          <Expand size={12} />
                          Open Diff
                        </div>
                      </button>
                    );
                  }

                  return (
                    <div
                      key={`${file.area}:${file.file}`}
                      className="commit-detail-panel__file-button mb-1 flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 last:mb-0"
                    >
                      {renderWorkingTreeFileSummary(file, false)}
                    </div>
                  );
                })
              ) : (
                <div className="commit-detail-panel__muted p-3 text-xs">
                  未コミットの変更はありません。
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
