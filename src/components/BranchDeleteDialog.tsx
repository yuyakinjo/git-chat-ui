import { Trash2, X } from 'lucide-react';
import { useEffect, type JSX } from 'react';

interface BranchDeleteDialogProps {
  branchName: string;
  branchType: 'local' | 'remote';
  busy: boolean;
  forceDelete: boolean;
  onClose: () => void;
  onForceDeleteChange: (forceDelete: boolean) => void;
  onDelete: () => void;
}

export function BranchDeleteDialog({
  branchName,
  branchType,
  busy,
  forceDelete,
  onClose,
  onForceDeleteChange,
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
      className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="branch delete confirmation"
    >
      <section className="panel flex w-full max-w-[520px] max-h-[calc(100vh-24px)] flex-col overflow-hidden p-4 shadow-2xl">
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="section-title">Delete Branch</div>
              <div className="truncate text-base font-semibold text-ink">{branchName}</div>
              <div className="mt-1 text-sm leading-6 text-ink-subtle">
                {isRemoteBranch
                  ? 'remote branch を削除します。remote 上の参照を削除し、local の remote-tracking ref も prune します。'
                  : 'local branch を削除します。通常は safe delete を行い、未 merge の場合は Git が拒否します。'}
              </div>
            </div>

            <button
              type="button"
              className="button button-secondary inline-flex h-9 w-9 shrink-0 items-center justify-center p-0!"
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
                : forceDelete
                  ? ' squash / rebase 後の掃除など、本当に履歴ごと消して問題ない場合だけ force delete を使ってください。'
                  : ' 必要なら先に merge するか、squash / rebase 後なら force delete を選んでください。'}
            </div>
          </div>

          {!isRemoteBranch ? (
            <label className="mt-4 flex items-start gap-3 rounded-2xl border border-black/8 bg-black/2 p-3 text-sm text-ink">
              <input
                type="checkbox"
                checked={forceDelete}
                disabled={busy}
                onChange={(event) => onForceDeleteChange(event.target.checked)}
              />
              <span className="leading-6">
                <span className="font-medium">Force delete を使う</span>
                {' '}
                squash merge や rebase merge のあとに `git branch -d` が拒否する branch を消したいときだけ有効にします。
              </span>
            </label>
          ) : null}
        </div>

        <div className="mt-4 flex shrink-0 items-center justify-end gap-2 border-t border-black/8 pt-4">
          <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="button button-danger" onClick={onDelete} disabled={busy}>
            <Trash2 size={14} />
            {forceDelete && !isRemoteBranch ? 'Force Delete Branch' : 'Delete Branch'}
          </button>
        </div>
      </section>
    </div>
  );
}
