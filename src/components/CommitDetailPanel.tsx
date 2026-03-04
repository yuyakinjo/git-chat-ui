import { CalendarClock, FileCode2, User } from 'lucide-react';

import { formatRelativeDate, shortSha } from '../lib/format';
import type { CommitDetail } from '../types';

interface CommitDetailPanelProps {
  detail: CommitDetail | null;
  loading: boolean;
}

export function CommitDetailPanel({ detail, loading }: CommitDetailPanelProps): JSX.Element {
  return (
    <section className="panel flex min-h-0 flex-col p-3">
      <div className="mb-2 px-2">
        <div className="section-title">Commit Detail</div>
      </div>

      {loading ? <div className="p-4 text-sm text-ink-subtle">詳細を読み込み中...</div> : null}

      {!loading && !detail ? (
        <div className="p-4 text-sm text-ink-subtle">コミットをクリックすると詳細が表示されます。</div>
      ) : null}

      {detail ? (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-2">
          <div className="rounded-xl border border-black/10 bg-white/65 p-3">
            <div className="mb-2 text-sm font-semibold text-ink">{detail.body.split('\n')[0] || 'No title'}</div>
            <div className="space-y-1 text-xs text-ink-soft">
              <div className="flex items-center gap-2">
                <User size={12} />
                {detail.author} ({detail.email})
              </div>
              <div className="flex items-center gap-2">
                <CalendarClock size={12} />
                {formatRelativeDate(detail.date)}
              </div>
              <div className="flex items-center gap-2">
                <FileCode2 size={12} />
                {shortSha(detail.sha)}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              Changed Files
            </div>
            <div className="overflow-hidden rounded-xl border border-black/10 bg-white/65">
              {detail.files.length === 0 ? (
                <div className="p-3 text-xs text-ink-subtle">ファイル差分はありません。</div>
              ) : (
                detail.files.map((file) => (
                  <div
                    key={file.file}
                    className="grid grid-cols-[1fr_56px_56px] gap-2 border-b border-black/5 px-3 py-2 text-xs last:border-none"
                  >
                    <span className="truncate text-ink">{file.file}</span>
                    <span className="text-right text-[#157347]">+{file.additions}</span>
                    <span className="text-right text-[#b42318]">-{file.deletions}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">Diff</div>
            <pre className="max-h-56 overflow-auto rounded-xl border border-black/10 bg-[#111827] p-3 text-[11px] leading-5 text-[#e5e7eb]">
              {detail.diff || 'No diff'}
            </pre>
          </div>
        </div>
      ) : null}
    </section>
  );
}
