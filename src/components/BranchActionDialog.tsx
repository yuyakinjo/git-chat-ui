import { X } from 'lucide-react';
import { useEffect } from 'react';

export type BranchActionDialogStep = 'select-action' | 'confirm-push';

interface BranchActionDialogProps {
  sourceBranchName: string;
  targetBranchName: string;
  step: BranchActionDialogStep;
  busy: boolean;
  onClose: () => void;
  onMerge: () => void;
  onPreparePullRequest: () => void;
  onConfirmPushAndCreatePullRequest: () => void;
  onBack: () => void;
}

export function BranchActionDialog({
  sourceBranchName,
  targetBranchName,
  step,
  busy,
  onClose,
  onMerge,
  onPreparePullRequest,
  onConfirmPushAndCreatePullRequest,
  onBack
}: BranchActionDialogProps): JSX.Element {
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
      aria-label="branch action"
    >
      <section className="panel mx-auto flex h-full max-h-[420px] max-w-[560px] flex-col overflow-hidden p-4 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="section-title">Branch Action</div>
            <div className="truncate text-base font-semibold text-ink">
              {sourceBranchName} -&gt; {targetBranchName}
            </div>
            <div className="mt-1 text-sm text-ink-subtle">
              {step === 'select-action'
                ? 'ドロップしたブランチに対して進める操作を選んでください。'
                : 'source branch を push してから Pull Request を作成します。'}
            </div>
          </div>

          <button
            type="button"
            className="button button-secondary !px-3 !py-2"
            onClick={onClose}
            aria-label="close branch action dialog"
            disabled={busy}
          >
            <X size={14} />
            Close
          </button>
        </div>

        {step === 'select-action' ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-sm text-ink-soft">
              <div className="font-semibold text-ink">Merge</div>
              <div className="mt-1">
                <span className="font-medium text-ink">{sourceBranchName}</span> を{' '}
                <span className="font-medium text-ink">{targetBranchName}</span> に取り込みます。
              </div>
            </div>
            <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-sm text-ink-soft">
              <div className="font-semibold text-ink">Pull Request</div>
              <div className="mt-1">
                head: <span className="font-medium text-ink">{sourceBranchName}</span> / base:{' '}
                <span className="font-medium text-ink">{targetBranchName}</span>
              </div>
            </div>
            <div className="mt-auto flex items-center justify-end gap-2">
              <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="button button-secondary" onClick={onPreparePullRequest} disabled={busy}>
                Pull Request
              </button>
              <button type="button" className="button button-primary" onClick={onMerge} disabled={busy}>
                Merge
              </button>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col justify-between gap-4">
            <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-sm text-ink-soft">
              <div className="font-semibold text-ink">Push Required</div>
              <div className="mt-1 leading-6">
                <span className="font-medium text-ink">{sourceBranchName}</span> は remote に未反映です。
                <br />
                push してから <span className="font-medium text-ink">{targetBranchName}</span> 向けの Pull Request を作成します。
              </div>
            </div>
            <div className="mt-auto flex items-center justify-end gap-2">
              <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="button button-secondary" onClick={onBack} disabled={busy}>
                Back
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={onConfirmPushAndCreatePullRequest}
                disabled={busy}
              >
                Push and Create PR
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
