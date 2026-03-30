import { Trash2, X } from 'lucide-react';
import { useEffect } from 'react';

interface BranchDeleteDialogProps {
  branchName: string;
  branchType: 'local' | 'remote';
  busy: boolean;
  onClose: () => void;
  onDelete: () => void;
}

export function BranchDeleteDialog({
  branchName,
  branchType,
  busy,
  onClose,
  onDelete
}: BranchDeleteDialogProps): JSX.Element {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [busy, onClose]);

  const isRemoteBranch = branchType === 'remote';

  return (
    <div
      className="absolute inset-0 z-40 bg-slate-950/55 p-3 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="branch delete confirmation"
    >
      <section className="panel mx-auto flex h-full max-h-[360px] max-w-[520px] flex-col overflow-hidden p-4 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="section-title">Delete Branch</div>
            <div className="truncate text-base font-semibold text-ink">{branchName}</div>
            <div className="mt-1 text-sm leading-6 text-ink-subtle">
              {isRemoteBranch
                ? 'remote branch を削除します。remote 上の参照を削除し、local の remote-tracking ref も prune します。'
                : 'local branch を削除します。未 merge の場合は Git が拒否するため、そのときは何も削除されません。'}
            </div>
          </div>

          <button
            type="button"
            className="button button-secondary inline-flex h-9 w-9 shrink-0 items-center justify-center !p-0"
            onClick={onClose}
            title="Close"
            aria-label="Close"
            disabled={busy}
          >
            <X size={14} />
          </button>
        </div>

        <div className="rounded-2xl border border-red-200/80 bg-red-50/85 p-4 text-sm text-red-900">
          <div className="flex items-center gap-2 font-semibold">
            <Trash2 size={15} />
            <span>この操作は取り消せません</span>
          </div>
          <div className="mt-2 leading-6">
            <span className="font-medium">{branchName}</span> を branch list から削除します。
            {isRemoteBranch
              ? ' 必要なら push して remote branch を作り直してください。'
              : ' 必要なら先に merge するか、別名で branch を作り直してください。'}
          </div>
        </div>

        <div className="mt-auto flex items-center justify-end gap-2 pt-4">
          <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="button button-danger" onClick={onDelete} disabled={busy}>
            <Trash2 size={14} />
            Delete Branch
          </button>
        </div>
      </section>
    </div>
  );
}
