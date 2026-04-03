import { Pencil, X } from "lucide-react";
import { useEffect, useState, type JSX } from "react";

interface StashRenameDialogProps {
  stashId: string;
  initialMessage: string;
  busy: boolean;
  onClose: () => void;
  onRename: (message: string) => void;
}

export function StashRenameDialog({
  stashId,
  initialMessage,
  busy,
  onClose,
  onRename,
}: StashRenameDialogProps): JSX.Element {
  const [message, setMessage] = useState(initialMessage);
  const normalizedMessage = message.trim();

  useEffect(() => {
    setMessage(initialMessage);
  }, [initialMessage, stashId]);

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
      className="absolute inset-0 z-40 flex items-start justify-center bg-slate-950/55 p-2 backdrop-blur-xs sm:p-3"
      role="dialog"
      aria-modal="true"
      aria-label="rename stash"
    >
      <section className="panel flex max-h-full min-h-0 w-full max-w-[560px] flex-col overflow-hidden p-3 shadow-2xl sm:p-4">
        <div className="mb-3 flex items-start justify-between gap-3 sm:mb-4 sm:gap-4">
          <div className="min-w-0">
            <div className="section-title">Rename Stash</div>
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
            if (!normalizedMessage || busy) {
              return;
            }

            onRename(normalizedMessage);
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div>
              <label htmlFor="stash-rename-message" className="text-sm font-semibold text-ink">
                Stash Message
              </label>
              <input
                id="stash-rename-message"
                className="input mt-2"
                value={message}
                onChange={(event) => setMessage(event.currentTarget.value)}
                placeholder="WIP on feature/context-menu"
                autoFocus
                disabled={busy}
              />
            </div>
          </div>

          <div className="mt-3 flex items-center justify-end gap-2 pt-1 sm:mt-4 sm:pt-2">
            <button
              type="button"
              className="button button-secondary"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button button-primary inline-flex items-center gap-2"
              disabled={busy || !normalizedMessage}
            >
              <Pencil size={14} />
              {busy ? "Renaming..." : "Rename Stash"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
