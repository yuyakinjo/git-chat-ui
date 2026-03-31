import { X } from 'lucide-react';
import { useEffect, type JSX } from 'react';

import type { WorkingTreeDiffArea, WorkingTreeDiffDetail } from '../types';
import { SplitDiffViewer } from './SplitDiffViewer';

interface WorkingTreeDiffOverlayProps {
  detail: WorkingTreeDiffDetail | null;
  loading: boolean;
  filePath: string | null;
  area: WorkingTreeDiffArea | null;
  onClose: () => void;
}

export function WorkingTreeDiffOverlay({
  detail,
  loading,
  filePath,
  area,
  onClose
}: WorkingTreeDiffOverlayProps): JSX.Element {
  const resolvedFilePath = filePath ?? detail?.file ?? '';
  const areaLabel = area === 'staged' ? 'Staged' : 'Unstaged';

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
      aria-label={`${areaLabel.toLowerCase()} working tree diff`}
    >
      <section className="panel flex h-full min-h-0 flex-col overflow-hidden p-4 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="diff-overlay__title truncate text-base font-semibold">{resolvedFilePath || 'Changed file'}</div>
            <div className="diff-overlay__meta mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className="badge bg-[#fff4d6]! text-[#a15c00]!">WIP</span>
              <span className={`badge ${area === 'staged' ? 'bg-[#ecfdf3]! text-[#157347]!' : 'bg-[#fff4d6]! text-[#a15c00]!'}`}>
                {areaLabel}
              </span>
              {detail ? <span>{detail.files.length} files</span> : null}
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

        {loading ? <div className="diff-overlay__muted p-4 text-sm">差分を読み込み中...</div> : null}

        {!loading && !detail ? <div className="diff-overlay__muted p-4 text-sm">差分を表示できませんでした。</div> : null}

        {detail ? (
          <div className="min-h-0 flex-1">
            <SplitDiffViewer
              diff={detail.diff}
              files={detail.files}
              isDiffTruncated={detail.isDiffTruncated}
              preferredFilePath={detail.file}
              showFileList={false}
              emptyMessage="このファイルの差分はありません。"
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
