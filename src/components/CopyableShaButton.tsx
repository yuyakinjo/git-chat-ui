import { Copy } from 'lucide-react';
import type { JSX } from 'react';

import { copyTextToClipboard } from '../lib/clipboard';
import { shortSha } from '../lib/format';

interface CopyableShaButtonProps {
  sha: string;
  onNotify: (message: string) => void;
  prefix?: string;
}

export function CopyableShaButton({ sha, onNotify, prefix }: CopyableShaButtonProps): JSX.Element {
  const handleCopy = (): void => {
    void copyTextToClipboard(sha)
      .then(() => {
        onNotify(`${shortSha(sha)} をコピーしました。`);
      })
      .catch(() => {
        onNotify('SHA のコピーに失敗しました。');
      });
  };

  return (
    <button
      type="button"
      className="badge diff-overlay__meta-badge inline-flex cursor-pointer items-center gap-1 border border-transparent transition hover:opacity-80 focus-visible:border-black/10 focus-visible:outline-none"
      onClick={handleCopy}
      title={`${sha} をコピー`}
      aria-label={`${prefix ? `${prefix} ` : ''}${sha} をクリップボードにコピー`}
    >
      {prefix ? <span>{prefix}</span> : null}
      <span>{shortSha(sha)}</span>
      <Copy size={11} aria-hidden="true" />
    </button>
  );
}
