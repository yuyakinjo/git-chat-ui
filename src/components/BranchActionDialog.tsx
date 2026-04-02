import { ArrowLeft, GitMerge, GitPullRequestArrow, X } from "lucide-react";
import { useEffect, type JSX } from "react";

export type BranchActionDialogStep = "select-action" | "confirm-push";

interface BranchActionDialogProps {
  sourceBranchName: string;
  targetBranchName: string;
  step: BranchActionDialogStep;
  busy: boolean;
  mergeDisabledReason?: string | null;
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
  mergeDisabledReason = null,
  onClose,
  onMerge,
  onPreparePullRequest,
  onConfirmPushAndCreatePullRequest,
  onBack,
}: BranchActionDialogProps): JSX.Element {
  const actionBadgeClassName =
    "inline-flex items-center rounded-full border border-black/10 bg-white/60 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-subtle";

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [busy, onClose]);

  return (
    <div
      className="absolute inset-0 z-40 bg-slate-950/55 p-3 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="branch action"
    >
      <section className="panel mx-auto flex max-h-[calc(100%-24px)] max-w-[560px] flex-col overflow-hidden p-4 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="section-title">Branch Action</div>
            {step === "confirm-push" ? (
              <>
                <div className="truncate text-base font-semibold text-ink">
                  {sourceBranchName} -&gt; {targetBranchName}
                </div>
                <div className="mt-1 text-sm text-ink-subtle">
                  source branch を push してから Pull Request を作成します。
                </div>
              </>
            ) : null}
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

        {step === "select-action" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
              <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-sm text-ink-soft">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-semibold text-ink">Merge</div>
                  <span className={actionBadgeClassName}>This Repo</span>
                  <span className={actionBadgeClassName}>Direct Update</span>
                </div>
                <div className="mt-3 leading-6">
                  <span className="font-medium text-ink">{sourceBranchName}</span> の変更を、この
                  repo の <span className="font-medium text-ink">{targetBranchName}</span>{" "}
                  に今すぐ取り込みます。
                </div>
                <div className="mt-1 text-sm leading-6 text-ink-subtle">
                  レビュー待ちや GitHub 上の PR は作らず、target branch を直接更新する操作です。
                </div>
                <div className="mt-3 branch-action-dialog__ref-flow">
                  <span className="branch-action-dialog__ref-pill">
                    <span className="branch-action-dialog__ref-label">base</span>
                    <span className="branch-action-dialog__ref-value" title={targetBranchName}>
                      {targetBranchName}
                    </span>
                  </span>
                  <span className="branch-action-dialog__ref-arrow" aria-hidden="true">
                    <ArrowLeft size={14} strokeWidth={2.15} />
                  </span>
                  <span className="branch-action-dialog__ref-pill">
                    <span className="branch-action-dialog__ref-label">head</span>
                    <span className="branch-action-dialog__ref-value" title={sourceBranchName}>
                      {sourceBranchName}
                    </span>
                  </span>
                </div>
                {mergeDisabledReason ? (
                  <div className="mt-3 rounded-xl border border-amber-300/70 bg-amber-50/85 p-3 text-sm text-amber-900">
                    <div className="font-semibold">Merge is unavailable here</div>
                    <div className="mt-1 leading-6">{mergeDisabledReason}</div>
                  </div>
                ) : null}
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="button button-primary inline-flex items-center gap-2"
                    onClick={onMerge}
                    disabled={busy || Boolean(mergeDisabledReason)}
                  >
                    <GitMerge size={14} aria-hidden="true" />
                    Merge
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-sm text-ink-soft">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-semibold text-ink">Pull Request</div>
                  <span className={actionBadgeClassName}>GitHub</span>
                  <span className={actionBadgeClassName}>Review Flow</span>
                </div>
                <div className="mt-3 leading-6">
                  GitHub 上に <span className="font-medium text-ink">{sourceBranchName}</span> から{" "}
                  <span className="font-medium text-ink">{targetBranchName}</span> 向けの Pull
                  Request を作成します。
                </div>
                <div className="mt-1 text-sm leading-6 text-ink-subtle">
                  レビューや CI を通してから merge したいときはこちらです。source branch が未 push
                  なら先に push します。
                </div>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="button button-secondary inline-flex items-center gap-2"
                    onClick={onPreparePullRequest}
                    disabled={busy}
                  >
                    <GitPullRequestArrow size={14} aria-hidden="true" />
                    Pull Request
                  </button>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 pt-3">
              <button
                type="button"
                className="button button-secondary"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-sm text-ink-soft">
                <div className="font-semibold text-ink">Push Required</div>
                <div className="mt-1 leading-6">
                  Pull Request は GitHub 上の提案なので、まず{" "}
                  <span className="font-medium text-ink">{sourceBranchName}</span> を remote に push
                  する必要があります。
                </div>
                <div className="mt-1 text-sm leading-6 text-ink-subtle">
                  push 後に <span className="font-medium text-ink">{targetBranchName}</span> 向けの
                  Pull Request を作成します。
                </div>
              </div>
            </div>
            <div className="mt-4 flex shrink-0 items-center justify-end gap-2">
              <button
                type="button"
                className="button button-secondary"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={onBack}
                disabled={busy}
              >
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
