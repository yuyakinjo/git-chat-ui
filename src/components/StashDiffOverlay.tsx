import { X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { api } from '../lib/api';
import { formatFileCountLabel } from '../lib/format';
import type { StashDiffDetail, StashDiffFileDetail, StashEntry } from '../types';
import { SplitDiffViewer } from './SplitDiffViewer';

interface StashDiffOverlayProps {
  repoPath: string;
  stash: StashEntry;
  detail: StashDiffDetail | null;
  loading: boolean;
  onClose: () => void;
}

export function StashDiffOverlay({ repoPath, stash, detail, loading, onClose }: StashDiffOverlayProps): JSX.Element {
  const title = stash.message.trim() || stash.id;
  const fileCountLabel = formatFileCountLabel(detail?.files.length ?? stash.files.length);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(detail?.files[0]?.file ?? stash.files[0] ?? null);
  const [activeFileHasInlineDiff, setActiveFileHasInlineDiff] = useState<boolean | null>(null);
  const [fileDiffCache, setFileDiffCache] = useState<Record<string, StashDiffFileDetail>>({});
  const [loadingFilePath, setLoadingFilePath] = useState<string | null>(null);
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const stashDiffFileRequestKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setActiveFilePath(detail?.files[0]?.file ?? stash.files[0] ?? null);
    setActiveFileHasInlineDiff(null);
    setFileDiffCache({});
    setLoadingFilePath(null);
    setFileErrors({});
    stashDiffFileRequestKeyRef.current = null;
  }, [detail?.stashId, stash.id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const activeFileDiff = activeFilePath ? fileDiffCache[activeFilePath] ?? null : null;
  const activeFileError = activeFilePath ? fileErrors[activeFilePath] ?? null : null;
  const stashDiffViewerDiff = activeFileDiff?.diff ?? detail?.diff ?? '';
  const stashDiffViewerTruncated = activeFileDiff?.isDiffTruncated ?? detail?.isDiffTruncated ?? false;
  const showActiveFileLoading =
    Boolean(activeFilePath) && activeFileHasInlineDiff === false && !activeFileDiff && !activeFileError;

  useEffect(() => {
    if (!detail?.stashId || !activeFilePath || activeFileHasInlineDiff !== false || activeFileDiff || activeFileError) {
      return;
    }

    const requestKey = `${detail.stashId}\u0000${activeFilePath}`;
    stashDiffFileRequestKeyRef.current = requestKey;
    setLoadingFilePath(activeFilePath);

    void (async () => {
      try {
        const nextDetail = await api.getStashDiffFileDetail(repoPath, detail.stashId, activeFilePath);
        if (stashDiffFileRequestKeyRef.current !== requestKey) {
          return;
        }

        setFileDiffCache((current) => ({
          ...current,
          [activeFilePath]: nextDetail
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
        if (stashDiffFileRequestKeyRef.current !== requestKey) {
          return;
        }

        setFileErrors((current) => ({
          ...current,
          [activeFilePath]: '差分の取得に失敗しました。'
        }));
      } finally {
        if (stashDiffFileRequestKeyRef.current === requestKey) {
          setLoadingFilePath(null);
        }
      }
    })();
  }, [activeFileDiff, activeFileError, activeFileHasInlineDiff, activeFilePath, detail?.stashId, repoPath]);

  const handleActiveFileChange = useCallback((nextFilePath: string | null, hasInlineDiff: boolean): void => {
    setActiveFilePath(nextFilePath);
    setActiveFileHasInlineDiff(hasInlineDiff);
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
              {stash.relativeDate ? <span>{stash.relativeDate}</span> : null}
              <span>{fileCountLabel}</span>
              {detail?.isDiffTruncated ? <span className="badge diff-overlay__meta-badge">Truncated</span> : null}
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

        {loading ? <div className="p-4 text-sm text-ink-subtle">stash 差分を読み込み中...</div> : null}

        {!loading && !detail ? <div className="p-4 text-sm text-ink-subtle">stash 差分を表示できませんでした。</div> : null}

        {detail ? (
          <div className="min-h-0 flex-1">
            <SplitDiffViewer
              diff={stashDiffViewerDiff}
              files={detail.files}
              isDiffTruncated={stashDiffViewerTruncated}
              preferredFilePath={activeFilePath}
              showFileList={detail.files.length > 1}
              enableFileFilter
              fileFilterPlaceholder="Filter stashed files by path"
              activeFileLoading={showActiveFileLoading || (Boolean(activeFilePath) && loadingFilePath === activeFilePath)}
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
