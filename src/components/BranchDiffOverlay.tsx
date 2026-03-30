import { X } from 'lucide-react';
import { useEffect } from 'react';

import { shortSha } from '../lib/format';
import type { BranchDiffDetail } from '../types';
import { SplitDiffViewer } from './SplitDiffViewer';

interface BranchDiffOverlayProps {
  detail: BranchDiffDetail | null;
  loading: boolean;
  baseBranchName: string | null;
  targetBranchName: string | null;
  onClose: () => void;
}

export function BranchDiffOverlay({
  detail,
  loading,
  baseBranchName,
  targetBranchName,
  onClose
}: BranchDiffOverlayProps): JSX.Element {
  const baseLabel = baseBranchName ?? detail?.baseRef ?? 'default';
  const targetLabel = targetBranchName ?? detail?.targetRef ?? 'current';

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
      className="absolute inset-0 z-40 bg-slate-950/55 p-3 backdrop-blur-sm"
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
              <span className="badge !bg-black/5 !text-ink-soft">Default branch diff</span>
              {detail ? <span className="badge !bg-black/5 !text-ink-soft">Merge base {shortSha(detail.mergeBaseSha)}</span> : null}
              {detail ? <span>{detail.files.length} files</span> : null}
            </div>
          </div>

          <button
            type="button"
            className="button button-secondary inline-flex h-9 w-9 shrink-0 items-center justify-center !p-0"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {loading ? <div className="p-4 text-sm text-ink-subtle">ブランチ差分を読み込み中...</div> : null}

        {!loading && !detail ? (
          <div className="p-4 text-sm text-ink-subtle">ブランチ差分を表示できませんでした。</div>
        ) : null}

        {detail ? (
          <div className="min-h-0 flex-1">
            <SplitDiffViewer
              diff={detail.diff}
              files={detail.files}
              isDiffTruncated={detail.isDiffTruncated}
              enableFileFilter
              fileFilterPlaceholder="Filter changed files by path"
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
