import { RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, type JSX } from "react";

import type { WorkingTreeDiscardTarget } from "../lib/workingTreeDiscard";

interface WorkingTreeDiscardDialogProps {
  target: WorkingTreeDiscardTarget;
  busy: boolean;
  onClose: () => void;
  onDiscard: () => void;
}

export function WorkingTreeDiscardDialog({
  target,
  busy,
  onClose,
  onDiscard,
}: WorkingTreeDiscardDialogProps): JSX.Element {
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

  const deletesPath = target.mode === "delete";

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="working tree discard confirmation"
    >
      <section className="panel flex w-full max-w-[520px] max-h-[calc(100vh-24px)] flex-col overflow-hidden p-4 shadow-2xl">
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="section-title">Discard Changes</div>
              <div className="break-all text-base font-semibold text-ink">{target.file}</div>
              <div className="mt-1 text-sm leading-6 text-ink-subtle">
                staged / unstaged のローカル変更を破棄します。
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
              {deletesPath ? <Trash2 size={15} /> : <RotateCcw size={15} />}
              <span>この操作は取り消せません</span>
            </div>
            <div className="mt-2 leading-6">
              {deletesPath
                ? "このパスは HEAD に存在しないため、取り消すとファイルまたはディレクトリ自体が削除されます。"
                : "このパスを HEAD の状態に戻します。partial stage された変更も含め、対象ファイルの staged / unstaged 変更をまとめて破棄します。"}
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
          <button
            type="button"
            className="button button-danger inline-flex items-center gap-2"
            onClick={onDiscard}
            disabled={busy}
          >
            <RotateCcw size={14} />
            {busy ? "Discarding..." : "Discard Changes"}
          </button>
        </div>
      </section>
    </div>
  );
}
