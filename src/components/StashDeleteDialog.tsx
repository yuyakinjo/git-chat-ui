import { Archive, Trash2, X } from "lucide-react";
import { useEffect, type JSX } from "react";

interface StashDeleteDialogProps {
  stashId: string;
  message: string;
  busy: boolean;
  onClose: () => void;
  onDelete: () => void;
}

export function StashDeleteDialog({
  stashId,
  message,
  busy,
  onClose,
  onDelete,
}: StashDeleteDialogProps): JSX.Element {
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

  const title = message.trim() || stashId;

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="stash delete confirmation"
    >
      <section className="panel flex w-full max-w-[520px] max-h-[calc(100vh-24px)] flex-col overflow-hidden p-4 shadow-2xl">
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="section-title">Delete Stash</div>
              <div className="break-all text-base font-semibold text-ink">{stashId}</div>
              <div className="mt-1 text-sm leading-6 text-ink-subtle">
                選択した stash entry を stack から削除します。working tree や branch
                は変更しません。
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

          <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-sm text-ink-soft">
            <div className="flex items-center gap-2 font-semibold text-ink">
              <Archive size={15} />
              <span>Target Stash</span>
            </div>
            <div className="mt-2 break-all text-base font-semibold text-ink">{title}</div>
            {title !== stashId ? (
              <div className="mt-1 text-xs leading-5 text-ink-subtle">{stashId}</div>
            ) : null}
          </div>

          <div className="mt-4 rounded-2xl border border-red-200/80 bg-red-50/85 p-4 text-sm text-red-900">
            <div className="flex items-center gap-2 font-semibold">
              <Trash2 size={15} />
              <span>この操作は取り消せません</span>
            </div>
            <div className="mt-2 leading-6">
              stash stack からこの entry を削除します。必要なら先に Apply / Pop や Rename
              を行ってください。
            </div>
          </div>
        </div>

        <div className="mt-4 flex shrink-0 items-center justify-end gap-2 border-t border-black/8 pt-4">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="button" className="button button-danger" onClick={onDelete} disabled={busy}>
            <Trash2 size={14} />
            {busy ? "Deleting..." : "Delete Stash"}
          </button>
        </div>
      </section>
    </div>
  );
}
