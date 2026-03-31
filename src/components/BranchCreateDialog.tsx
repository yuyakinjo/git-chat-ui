import { GitBranch, Plus, X } from 'lucide-react';
import { useEffect, useState, type JSX } from 'react';

interface BranchCreateDialogProps {
  baseBranchName: string;
  busy: boolean;
  onClose: () => void;
  onCreate: (newBranchName: string) => void;
}

export function BranchCreateDialog({
  baseBranchName,
  busy,
  onClose,
  onCreate
}: BranchCreateDialogProps): JSX.Element {
  const [branchName, setBranchName] = useState('');
  const normalizedBranchName = branchName.trim();

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

  return (
    <div
      className="absolute inset-0 z-40 flex items-start justify-center bg-slate-950/55 p-2 backdrop-blur-xs sm:p-3"
      role="dialog"
      aria-modal="true"
      aria-label="create branch from branch"
    >
      <section className="panel flex max-h-full min-h-0 w-full max-w-[560px] flex-col overflow-hidden p-3 shadow-2xl sm:p-4">
        <div className="mb-3 flex items-start justify-between gap-3 sm:mb-4 sm:gap-4">
          <div className="min-w-0">
            <div className="section-title">Create Branch</div>
            <div className="break-all text-base font-semibold text-ink">{baseBranchName}</div>
            <div className="mt-1 text-sm leading-6 text-ink-subtle">
              右クリックした local branch を base にして、新しい local branch を作成します。
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

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!normalizedBranchName || busy) {
              return;
            }

            onCreate(normalizedBranchName);
          }}
        >
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 sm:space-y-4">
            <div className="rounded-2xl border border-black/10 bg-white/70 p-3 text-sm text-ink-soft sm:p-4">
              <div className="flex items-center gap-2 font-semibold text-ink">
                <GitBranch size={15} />
                <span>Base Branch</span>
              </div>
              <div className="mt-2 break-all text-base font-semibold text-ink">{baseBranchName}</div>
              <div className="mt-2 leading-6">
                <span className="font-medium text-ink">{baseBranchName}</span> を起点に branch を作成します。作成後の
                checkout は行いません。
              </div>
            </div>

            <div>
              <label htmlFor="branch-create-name" className="text-sm font-semibold text-ink">
                New Branch Name
              </label>
              <input
                id="branch-create-name"
                className="input mt-2"
                value={branchName}
                onChange={(event) => setBranchName(event.currentTarget.value)}
                placeholder="feature/context-menu"
                autoFocus
                disabled={busy}
              />
              <div className="mt-1.5 text-xs leading-5 text-ink-subtle sm:mt-2">
                作成後に切り替えたい場合は、branch list から double-click してください。
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-end gap-2 pt-1 sm:mt-4 sm:pt-2">
            <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="submit"
              className="button button-primary inline-flex items-center gap-2"
              disabled={busy || !normalizedBranchName}
            >
              <Plus size={14} />
              {busy ? 'Creating...' : 'Create Branch'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
