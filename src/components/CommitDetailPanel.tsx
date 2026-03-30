import { CalendarClock, Expand, FileCode2, User } from 'lucide-react';

import { formatRelativeDate, shortSha } from '../lib/format';
import type { CommitDetail } from '../types';

interface CommitDetailPanelProps {
  detail: CommitDetail | null;
  loading: boolean;
  activeDiffFile: string | null;
  onOpenFileDiff: (file: string) => void;
  headerAccessory?: JSX.Element | null;
}

export function CommitDetailPanel({
  detail,
  loading,
  activeDiffFile,
  onOpenFileDiff,
  headerAccessory
}: CommitDetailPanelProps): JSX.Element {
  return (
    <section className="panel flex min-h-0 min-w-0 flex-col overflow-hidden p-3">
      <div className="mb-2 flex items-center justify-between gap-2 px-2">
        <div className="section-title">Commit Detail</div>
        {headerAccessory}
      </div>

      {loading ? <div className="p-4 text-sm text-ink-subtle">詳細を読み込み中...</div> : null}

      {!loading && !detail ? (
        <div className="p-4 text-sm text-ink-subtle">コミットをクリックすると詳細が表示されます。</div>
      ) : null}

      {detail ? (
        <div className="min-h-0 flex flex-1 flex-col gap-3 overflow-hidden px-2 pb-2">
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

          <div className="min-h-0 flex flex-1 flex-col">
            <div className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              <span>Changed Files</span>
              <span className="text-[11px] font-medium normal-case tracking-normal text-ink-soft">
                クリックすると diff dialog を開きます
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-black/10 bg-white/65 p-2">
              {detail.files.length === 0 ? (
                <div className="p-3 text-xs text-ink-subtle">ファイル差分はありません。</div>
              ) : (
                detail.files.map((file) => (
                  <button
                    key={file.file}
                    type="button"
                    className={`mb-1 flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition last:mb-0 ${
                      activeDiffFile === file.file
                        ? 'border-[#0f172a]/40 bg-[#0f172a] text-white'
                        : 'border-black/5 bg-white/80 text-ink hover:border-accent/25 hover:bg-accent-soft/50'
                    }`}
                    onClick={() => onOpenFileDiff(file.file)}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium">{file.file}</div>
                      <div className={`mt-1 flex items-center gap-2 text-[11px] ${activeDiffFile === file.file ? 'text-white/80' : 'text-ink-subtle'}`}>
                        <span className="text-[#157347]">+{file.additions}</span>
                        <span className="text-[#b42318]">-{file.deletions}</span>
                      </div>
                    </div>
                    <div className={`flex items-center gap-1 text-[11px] font-semibold ${activeDiffFile === file.file ? 'text-white' : 'text-accent'}`}>
                      <Expand size={12} />
                      Open Diff
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
