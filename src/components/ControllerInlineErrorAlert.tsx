import { AlertTriangle, Copy, X } from "lucide-react";
import type { JSX } from "react";

import type { UiError } from "../lib/errors";

interface ControllerInlineErrorAlertProps {
  error: UiError;
  onCopy: () => void;
  onClose: () => void;
}

export function ControllerInlineErrorAlert({
  error,
  onCopy,
  onClose,
}: ControllerInlineErrorAlertProps): JSX.Element {
  return (
    <section className="panel flex items-start justify-between gap-3 border border-red-500/25 bg-red-50/70 px-4 py-3">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 text-red-700" />
        <div>
          <div className="text-sm font-semibold text-red-800">{error.title}</div>
          <div className="text-xs text-red-700">{error.detail}</div>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="button button-secondary inline-flex items-center gap-1 px-2! py-1! text-[11px]"
          onClick={onCopy}
          aria-label="エラー内容をクリップボードにコピー"
          title="エラー内容をコピー"
        >
          <Copy size={12} aria-hidden="true" />
          <span>Copy</span>
        </button>
        <button
          type="button"
          className="rounded-md p-1 text-red-700 transition hover:bg-red-100"
          onClick={onClose}
          aria-label="close error"
        >
          <X size={14} />
        </button>
      </div>
    </section>
  );
}
