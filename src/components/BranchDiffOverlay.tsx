import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";

import { api } from "../lib/api";
import type { AppThemeId } from "../lib/appTheme";
import { hasInlineDiffForPath, parseUnifiedDiff } from "../lib/diff";
import type { BranchDiffDetail, BranchDiffFileDetail, DiffViewerMode } from "../types";
import { CopyableShaButton } from "./CopyableShaButton";
import { DiffViewer } from "./DiffViewer";

interface BranchDiffOverlayProps {
  repoPath: string;
  appThemeId?: AppThemeId | null;
  diffViewerMode?: DiffViewerMode;
  detail: BranchDiffDetail | null;
  loading: boolean;
  baseBranchName: string | null;
  targetBranchName: string | null;
  onClose: () => void;
  onNotify: (message: string) => void;
}

export function BranchDiffOverlay({
  repoPath,
  appThemeId = null,
  diffViewerMode = "builtin",
  detail,
  loading,
  baseBranchName,
  targetBranchName,
  onClose,
  onNotify,
}: BranchDiffOverlayProps): JSX.Element {
  const baseLabel = baseBranchName ?? detail?.baseRef ?? "default";
  const targetLabel = targetBranchName ?? detail?.targetRef ?? "current";
  const [activeFilePath, setActiveFilePath] = useState<string | null>(
    detail?.files[0]?.file ?? null,
  );
  const [fileDiffCache, setFileDiffCache] = useState<Record<string, BranchDiffFileDetail>>({});
  const [loadingFilePath, setLoadingFilePath] = useState<string | null>(null);
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const branchDiffFileRequestKeyRef = useRef<string | null>(null);
  const aggregateParsedFiles = useMemo(() => parseUnifiedDiff(detail?.diff ?? ""), [detail?.diff]);
  const resolvedActiveFilePath =
    activeFilePath && detail?.files.some((file) => file.file === activeFilePath)
      ? activeFilePath
      : (detail?.files[0]?.file ?? null);
  const activeFileHasInlineDiff = hasInlineDiffForPath(
    aggregateParsedFiles,
    resolvedActiveFilePath,
  );

  /* oxlint-disable react-hooks/exhaustive-deps -- reset state only when branch refs change, not when files array reference changes */
  useEffect(() => {
    setActiveFilePath(detail?.files[0]?.file ?? null);
    setFileDiffCache({});
    setLoadingFilePath(null);
    setFileErrors({});
    branchDiffFileRequestKeyRef.current = null;
  }, [detail?.baseRef, detail?.targetRef, detail?.mergeBaseSha]);
  /* oxlint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const activeFileDiff = resolvedActiveFilePath
    ? (fileDiffCache[resolvedActiveFilePath] ?? null)
    : null;
  const activeFileError = resolvedActiveFilePath
    ? (fileErrors[resolvedActiveFilePath] ?? null)
    : null;
  const branchDiffViewerDiff = activeFileDiff?.diff ?? detail?.diff ?? "";
  const branchDiffViewerTruncated =
    activeFileDiff?.isDiffTruncated ?? detail?.isDiffTruncated ?? false;
  const showActiveFileLoading =
    Boolean(resolvedActiveFilePath) &&
    !activeFileHasInlineDiff &&
    !activeFileDiff &&
    !activeFileError;

  useEffect(() => {
    if (
      !detail ||
      !resolvedActiveFilePath ||
      activeFileHasInlineDiff ||
      activeFileDiff ||
      activeFileError
    ) {
      return;
    }

    const requestKey = `${detail.baseRef}\u0000${detail.targetRef}\u0000${resolvedActiveFilePath}`;
    branchDiffFileRequestKeyRef.current = requestKey;
    setLoadingFilePath(resolvedActiveFilePath);

    void (async () => {
      try {
        const nextDetail = await api.getBranchDiffFileDetail(
          repoPath,
          detail.baseRef,
          detail.targetRef,
          resolvedActiveFilePath,
        );
        if (branchDiffFileRequestKeyRef.current !== requestKey) {
          return;
        }

        setFileDiffCache((current) => ({
          ...current,
          [resolvedActiveFilePath]: nextDetail,
        }));
        setFileErrors((current) => {
          if (!(resolvedActiveFilePath in current)) {
            return current;
          }

          const next = { ...current };
          delete next[resolvedActiveFilePath];
          return next;
        });
      } catch {
        if (branchDiffFileRequestKeyRef.current !== requestKey) {
          return;
        }

        setFileErrors((current) => ({
          ...current,
          [resolvedActiveFilePath]: "差分の取得に失敗しました。",
        }));
      } finally {
        if (branchDiffFileRequestKeyRef.current === requestKey) {
          setLoadingFilePath(null);
        }
      }
    })();
  }, [
    activeFileDiff,
    activeFileError,
    activeFileHasInlineDiff,
    detail,
    repoPath,
    resolvedActiveFilePath,
  ]);

  const handleActiveFileChange = useCallback((filePath: string | null): void => {
    setActiveFilePath(filePath);
  }, []);

  return (
    <div
      className="absolute inset-0 z-40 bg-slate-950/55 p-3 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={`diffs vs ${baseLabel}`}
    >
      <section className="panel flex h-full min-h-0 flex-col overflow-hidden p-4 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="section-title">Diffs</div>
            <div className="truncate text-base font-semibold text-ink">
              {targetLabel} vs {baseLabel}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
              <span className="badge bg-black/5! text-ink-soft!">Default branch diff</span>
              {detail ? (
                <CopyableShaButton
                  sha={detail.mergeBaseSha}
                  onNotify={onNotify}
                  prefix="Merge base"
                />
              ) : null}
              {detail ? <span>{detail.files.length} files</span> : null}
            </div>
          </div>

          <button
            type="button"
            className="button button-secondary inline-flex h-9 w-9 shrink-0 items-center justify-center p-0!"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {loading ? (
          <div className="p-4 text-sm text-ink-subtle">ブランチ差分を読み込み中...</div>
        ) : null}

        {!loading && !detail ? (
          <div className="p-4 text-sm text-ink-subtle">ブランチ差分を表示できませんでした。</div>
        ) : null}

        {detail ? (
          <div className="min-h-0 flex-1">
            <DiffViewer
              mode={diffViewerMode}
              diff={branchDiffViewerDiff}
              appThemeId={appThemeId}
              files={detail.files}
              isDiffTruncated={branchDiffViewerTruncated}
              preferredFilePath={resolvedActiveFilePath}
              enableFileFilter
              fileFilterPlaceholder="Filter changed files by path"
              activeFileLoading={
                showActiveFileLoading ||
                (Boolean(resolvedActiveFilePath) && loadingFilePath === resolvedActiveFilePath)
              }
              activeFileError={activeFileError}
              activeFileLoadingMessage="差分を読み込み中..."
              onActiveFileChange={handleActiveFileChange}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
