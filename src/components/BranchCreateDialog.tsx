import { GitBranch, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';

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
      className="absolute inset-0 z-40 bg-slate-950/55 p-3 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="create branch from branch"
    >
      <section className="panel mx-auto flex h-full max-h-[420px] max-w-[560px] flex-col overflow-hidden p-4 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="section-title">Create Branch</div>
            <div className="truncate text-base font-semibold text-ink">{baseBranchName}</div>
            <div className="mt-1 text-sm leading-6 text-ink-subtle">
              右クリックした local branch を base にして、新しい local branch を作成します。
            </div>
          </div>

          <button
            type="button"
            className="button button-secondary !px-3 !py-2"
            onClick={onClose}
            aria-label="close branch create dialog"
            disabled={busy}
          >
            <X size={14} />
            Close
          </button>
        </div>

        <form
          className="flex h-full flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!normalizedBranchName || busy) {
              return;
            }

            onCreate(normalizedBranchName);
          }}
        >
          <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-sm text-ink-soft">
            <div className="flex items-center gap-2 font-semibold text-ink">
              <GitBranch size={15} />
              <span>Base Branch</span>
            </div>
            <div className="mt-2 truncate text-base font-semibold text-ink">{baseBranchName}</div>
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
            <div className="mt-2 text-xs leading-5 text-ink-subtle">
              作成後に切り替えたい場合は、branch list から double-click してください。
            </div>
          </div>

          <div className="mt-auto flex items-center justify-end gap-2 pt-2">
            <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="button button-primary" disabled={busy || !normalizedBranchName}>
              <Plus size={14} />
              {busy ? 'Creating...' : 'Create Branch'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
