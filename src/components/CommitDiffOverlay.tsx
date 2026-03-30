import { X } from 'lucide-react';
import { useEffect } from 'react';

import { shortSha } from '../lib/format';
import type { CommitDetail } from '../types';
import { SplitDiffViewer } from './SplitDiffViewer';

interface CommitDiffOverlayProps {
  detail: CommitDetail;
  filePath: string;
  onClose: () => void;
}

export function CommitDiffOverlay({ detail, filePath, onClose }: CommitDiffOverlayProps): JSX.Element {
  const title = detail.body.split('\n')[0] || 'No title';

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
    <div className="absolute inset-0 z-40 bg-slate-950/55 p-3 backdrop-blur-sm">
      <section className="panel flex h-full min-h-0 flex-col overflow-hidden p-4 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="diff-overlay__title truncate text-base font-semibold">{title}</div>
            <div className="diff-overlay__meta mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className="badge diff-overlay__meta-badge">{shortSha(detail.sha)}</span>
              <span className="truncate">{filePath}</span>
              <span>{detail.files.length} files</span>
            </div>
          </div>

          <button
            type="button"
            className="button button-secondary !px-3 !py-2"
            onClick={onClose}
            aria-label="close focused diff view"
          >
            <X size={14} />
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1">
          <SplitDiffViewer diff={detail.diff} files={detail.files} preferredFilePath={filePath} />
        </div>
      </section>
    </div>
  );
}
