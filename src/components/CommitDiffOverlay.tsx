import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";

import { api } from "../lib/api";
import type { AppThemeId } from "../lib/appTheme";
import { hasInlineDiffForPath, parseUnifiedDiff } from "../lib/diff";
import type { CommitDetail, CommitFileDiffDetail, DiffViewerMode } from "../types";
import { CopyableShaButton } from "./CopyableShaButton";
import { DiffViewer } from "./DiffViewer";

interface CommitDiffOverlayProps {
  repoPath: string;
  appThemeId?: AppThemeId | null;
  diffViewerMode?: DiffViewerMode;
  detail: CommitDetail;
  filePath: string;
  onClose: () => void;
  onNotify: (message: string) => void;
}

export function CommitDiffOverlay({
  repoPath,
  appThemeId = null,
  diffViewerMode = "builtin",
  detail,
  filePath,
  onClose,
  onNotify,
}: CommitDiffOverlayProps): JSX.Element {
  const title = detail.body.split("\n")[0] || "No title";
  const [activeFilePath, setActiveFilePath] = useState<string | null>(filePath);
  const [fileDiffCache, setFileDiffCache] = useState<Record<string, CommitFileDiffDetail>>({});
  const [loadingFilePath, setLoadingFilePath] = useState<string | null>(null);
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const commitDiffFileRequestKeyRef = useRef<string | null>(null);
  const aggregateParsedFiles = useMemo(() => parseUnifiedDiff(detail.diff), [detail.diff]);
  const resolvedActiveFilePath =
    activeFilePath && detail.files.some((file) => file.file === activeFilePath)
      ? activeFilePath
      : filePath;
  const activeFileHasInlineDiff = hasInlineDiffForPath(
    aggregateParsedFiles,
    resolvedActiveFilePath,
  );

  useEffect(() => {
    setActiveFilePath(filePath);
  }, [filePath]);

  useEffect(() => {
    setActiveFilePath(filePath);
    setFileDiffCache({});
    setLoadingFilePath(null);
    setFileErrors({});
    commitDiffFileRequestKeyRef.current = null;
  }, [detail.sha, filePath]);

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
  const commitDiffViewerDiff = activeFileDiff?.diff ?? detail.diff ?? "";
  const showActiveFileLoading =
    Boolean(resolvedActiveFilePath) &&
    !activeFileHasInlineDiff &&
    !activeFileDiff &&
    !activeFileError;

  useEffect(() => {
    if (!resolvedActiveFilePath || activeFileHasInlineDiff || activeFileDiff || activeFileError) {
      return;
    }

    const requestKey = `${detail.sha}\u0000${resolvedActiveFilePath}`;
    commitDiffFileRequestKeyRef.current = requestKey;
    setLoadingFilePath(resolvedActiveFilePath);

    void (async () => {
      try {
        const nextDetail = await api.getCommitFileDiffDetail(
          repoPath,
          detail.sha,
          resolvedActiveFilePath,
        );
        if (commitDiffFileRequestKeyRef.current !== requestKey) {
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
        if (commitDiffFileRequestKeyRef.current !== requestKey) {
          return;
        }

        setFileErrors((current) => ({
          ...current,
          [resolvedActiveFilePath]: "差分の取得に失敗しました。",
        }));
      } finally {
        if (commitDiffFileRequestKeyRef.current === requestKey) {
          setLoadingFilePath(null);
        }
      }
    })();
  }, [
    activeFileDiff,
    activeFileError,
    activeFileHasInlineDiff,
    detail.sha,
    repoPath,
    resolvedActiveFilePath,
  ]);

  const handleActiveFileChange = useCallback((nextFilePath: string | null): void => {
    setActiveFilePath(nextFilePath);
  }, []);

  return (
    <div className="absolute inset-0 z-40 bg-slate-950/55 p-3 backdrop-blur-xs">
      <section className="panel flex h-full min-h-0 flex-col overflow-hidden p-4 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="diff-overlay__title truncate text-base font-semibold">{title}</div>
            <div className="diff-overlay__meta mt-1 flex flex-wrap items-center gap-2 text-xs">
              <CopyableShaButton sha={detail.sha} onNotify={onNotify} />
              <span className="truncate">{filePath}</span>
              <span>{detail.files.length} files</span>
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

        <div className="min-h-0 flex-1">
          <DiffViewer
            mode={diffViewerMode}
            diff={commitDiffViewerDiff}
            appThemeId={appThemeId}
            files={detail.files}
            preferredFilePath={resolvedActiveFilePath}
            showFileList={detail.files.length > 1}
            activeFileLoading={
              showActiveFileLoading ||
              (Boolean(resolvedActiveFilePath) && loadingFilePath === resolvedActiveFilePath)
            }
            activeFileError={activeFileError}
            activeFileLoadingMessage="差分を読み込み中..."
            onActiveFileChange={handleActiveFileChange}
          />
        </div>
      </section>
    </div>
  );
}
