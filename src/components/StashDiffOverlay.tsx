import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";

import { api } from "../lib/api";
import type { AppThemeId } from "../lib/appTheme";
import { hasInlineDiffForPath, parseUnifiedDiff } from "../lib/diff";
import { formatFileCountLabel, formatRelativeDate } from "../lib/format";
import type { StashDiffDetail, StashDiffFileDetail, StashEntry } from "../types";
import { SplitDiffViewer } from "./SplitDiffViewer";

interface StashDiffOverlayProps {
  repoPath: string;
  appThemeId?: AppThemeId | null;
  stash: StashEntry;
  detail: StashDiffDetail | null;
  loading: boolean;
  onClose: () => void;
}

export function StashDiffOverlay({
  repoPath,
  appThemeId = null,
  stash,
  detail,
  loading,
  onClose,
}: StashDiffOverlayProps): JSX.Element {
  const title = stash.message.trim() || stash.id;
  const fileCountLabel = formatFileCountLabel(detail?.files.length ?? stash.files.length);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(
    detail?.files[0]?.file ?? stash.files[0] ?? null,
  );
  const [fileDiffCache, setFileDiffCache] = useState<Record<string, StashDiffFileDetail>>({});
  const [loadingFilePath, setLoadingFilePath] = useState<string | null>(null);
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const stashDiffFileRequestKeyRef = useRef<string | null>(null);
  const aggregateParsedFiles = useMemo(() => parseUnifiedDiff(detail?.diff ?? ""), [detail?.diff]);
  const availableFilePaths = detail?.files.map((file) => file.file) ?? stash.files;
  const resolvedActiveFilePath =
    activeFilePath && availableFilePaths.includes(activeFilePath)
      ? activeFilePath
      : (detail?.files[0]?.file ?? stash.files[0] ?? null);
  const activeFileHasInlineDiff = hasInlineDiffForPath(
    aggregateParsedFiles,
    resolvedActiveFilePath,
  );

  /* oxlint-disable react-hooks/exhaustive-deps -- reset state only when stash identity changes, not when files array reference changes */
  useEffect(() => {
    setActiveFilePath(detail?.files[0]?.file ?? stash.files[0] ?? null);
    setFileDiffCache({});
    setLoadingFilePath(null);
    setFileErrors({});
    stashDiffFileRequestKeyRef.current = null;
  }, [detail?.stashId, stash.id]);
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
  const stashDiffViewerDiff = activeFileDiff?.diff ?? detail?.diff ?? "";
  const stashDiffViewerTruncated =
    activeFileDiff?.isDiffTruncated ?? detail?.isDiffTruncated ?? false;
  const showActiveFileLoading =
    Boolean(resolvedActiveFilePath) &&
    !activeFileHasInlineDiff &&
    !activeFileDiff &&
    !activeFileError;

  useEffect(() => {
    if (
      !detail?.stashId ||
      !resolvedActiveFilePath ||
      activeFileHasInlineDiff ||
      activeFileDiff ||
      activeFileError
    ) {
      return;
    }

    const requestKey = `${detail.stashId}\u0000${resolvedActiveFilePath}`;
    stashDiffFileRequestKeyRef.current = requestKey;
    setLoadingFilePath(resolvedActiveFilePath);

    void (async () => {
      try {
        const nextDetail = await api.getStashDiffFileDetail(
          repoPath,
          detail.stashId,
          resolvedActiveFilePath,
        );
        if (stashDiffFileRequestKeyRef.current !== requestKey) {
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
        if (stashDiffFileRequestKeyRef.current !== requestKey) {
          return;
        }

        setFileErrors((current) => ({
          ...current,
          [resolvedActiveFilePath]: "差分の取得に失敗しました。",
        }));
      } finally {
        if (stashDiffFileRequestKeyRef.current === requestKey) {
          setLoadingFilePath(null);
        }
      }
    })();
  }, [
    activeFileDiff,
    activeFileError,
    activeFileHasInlineDiff,
    detail?.stashId,
    repoPath,
    resolvedActiveFilePath,
  ]);

  const handleActiveFileChange = useCallback((nextFilePath: string | null): void => {
    setActiveFilePath(nextFilePath);
  }, []);

  return (
    <div
      className="absolute inset-0 z-40 bg-slate-950/55 p-3 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={`diffs in ${stash.id}`}
    >
      <section className="panel flex h-full min-h-0 flex-col overflow-hidden p-4 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="section-title">Stash Diff</div>
            <div className="truncate text-base font-semibold text-ink">{title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
              <span className="badge bg-black/5! text-ink-soft!">{stash.id}</span>
              {stash.date ? <span>{formatRelativeDate(stash.date)}</span> : null}
              <span>{fileCountLabel}</span>
              {detail?.isDiffTruncated ? (
                <span className="badge diff-overlay__meta-badge">Truncated</span>
              ) : null}
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
          <div className="p-4 text-sm text-ink-subtle">stash 差分を読み込み中...</div>
        ) : null}

        {!loading && !detail ? (
          <div className="p-4 text-sm text-ink-subtle">stash 差分を表示できませんでした。</div>
        ) : null}

        {detail ? (
          <div className="min-h-0 flex-1">
            <SplitDiffViewer
              diff={stashDiffViewerDiff}
              appThemeId={appThemeId}
              files={detail.files}
              isDiffTruncated={stashDiffViewerTruncated}
              preferredFilePath={resolvedActiveFilePath}
              showFileList={detail.files.length > 1}
              enableFileFilter
              fileFilterPlaceholder="Filter stashed files by path"
              activeFileLoading={
                showActiveFileLoading ||
                (Boolean(resolvedActiveFilePath) && loadingFilePath === resolvedActiveFilePath)
              }
              activeFileError={activeFileError}
              activeFileLoadingMessage="差分を読み込み中..."
              onActiveFileChange={handleActiveFileChange}
              emptyMessage="この stash の差分はありません。"
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
