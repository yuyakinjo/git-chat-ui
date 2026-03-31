import { X } from 'lucide-react';
import { useEffect, type JSX } from 'react';

import { formatFileCountLabel } from '../lib/format';
import type { StashDiffDetail, StashEntry } from '../types';
import { SplitDiffViewer } from './SplitDiffViewer';

interface StashDiffOverlayProps {
  stash: StashEntry;
  detail: StashDiffDetail | null;
  loading: boolean;
  onClose: () => void;
}

export function StashDiffOverlay({ stash, detail, loading, onClose }: StashDiffOverlayProps): JSX.Element {
  const title = stash.message.trim() || stash.id;
  const fileCountLabel = formatFileCountLabel(detail?.files.length ?? stash.files.length);

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
              diff={detail.diff}
              files={detail.files}
              isDiffTruncated={detail.isDiffTruncated}
              enableFileFilter
              fileFilterPlaceholder="Filter stashed files by path"
              emptyMessage="この stash の差分はありません。"
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
