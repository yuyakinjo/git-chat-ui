import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import { api } from "../lib/api";
import type { AppThemeId } from "../lib/appTheme";
import type { CommitDetail, CommitFileDiffDetail } from "../types";
import { CopyableShaButton } from "./CopyableShaButton";
import { SplitDiffViewer } from "./SplitDiffViewer";

interface CommitDiffOverlayProps {
  repoPath: string;
  appThemeId?: AppThemeId | null;
  detail: CommitDetail;
  filePath: string;
  onClose: () => void;
  onNotify: (message: string) => void;
}

export function CommitDiffOverlay({
  repoPath,
  appThemeId = null,
  detail,
  filePath,
  onClose,
  onNotify,
}: CommitDiffOverlayProps): JSX.Element {
  const title = detail.body.split("\n")[0] || "No title";
  const [activeFilePath, setActiveFilePath] = useState<string | null>(filePath);
  const [activeFileHasInlineDiff, setActiveFileHasInlineDiff] = useState<boolean | null>(null);
  const [fileDiffCache, setFileDiffCache] = useState<Record<string, CommitFileDiffDetail>>({});
  const [loadingFilePath, setLoadingFilePath] = useState<string | null>(null);
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const commitDiffFileRequestKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setActiveFilePath(filePath);
    setActiveFileHasInlineDiff(null);
  }, [filePath]);

  useEffect(() => {
    setActiveFilePath(filePath);
    setActiveFileHasInlineDiff(null);
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

  const activeFileDiff = activeFilePath ? (fileDiffCache[activeFilePath] ?? null) : null;
  const activeFileError = activeFilePath ? (fileErrors[activeFilePath] ?? null) : null;
  const commitDiffViewerDiff = activeFileDiff?.diff ?? detail.diff ?? "";
  const showActiveFileLoading =
    Boolean(activeFilePath) &&
    activeFileHasInlineDiff === false &&
    !activeFileDiff &&
    !activeFileError;

  useEffect(() => {
    if (!activeFilePath || activeFileHasInlineDiff !== false || activeFileDiff || activeFileError) {
      return;
    }

    const requestKey = `${detail.sha}\u0000${activeFilePath}`;
    commitDiffFileRequestKeyRef.current = requestKey;
    setLoadingFilePath(activeFilePath);

    void (async () => {
      try {
        const nextDetail = await api.getCommitFileDiffDetail(repoPath, detail.sha, activeFilePath);
        if (commitDiffFileRequestKeyRef.current !== requestKey) {
          return;
        }

        setFileDiffCache((current) => ({
          ...current,
          [activeFilePath]: nextDetail,
        }));
        setFileErrors((current) => {
          if (!(activeFilePath in current)) {
            return current;
          }

          const next = { ...current };
          delete next[activeFilePath];
          return next;
        });
      } catch {
        if (commitDiffFileRequestKeyRef.current !== requestKey) {
          return;
        }

        setFileErrors((current) => ({
          ...current,
          [activeFilePath]: "差分の取得に失敗しました。",
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
    activeFilePath,
    detail.sha,
    repoPath,
  ]);

  const handleActiveFileChange = useCallback(
    (nextFilePath: string | null, hasInlineDiff: boolean): void => {
      setActiveFilePath(nextFilePath);
      setActiveFileHasInlineDiff(hasInlineDiff);
    },
    [],
  );

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
          <SplitDiffViewer
            diff={commitDiffViewerDiff}
            appThemeId={appThemeId}
            files={detail.files}
            preferredFilePath={activeFilePath}
            showFileList={detail.files.length > 1}
            activeFileLoading={
              showActiveFileLoading ||
              (Boolean(activeFilePath) && loadingFilePath === activeFilePath)
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
