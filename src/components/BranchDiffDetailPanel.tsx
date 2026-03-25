import { shortSha } from '../lib/format';
import type { BranchDiffDetail } from '../types';
import { SplitDiffViewer } from './SplitDiffViewer';

interface BranchDiffDetailPanelProps {
  detail: BranchDiffDetail | null;
  loading: boolean;
  baseBranchName: string | null;
  targetBranchName: string | null;
  onBackToCommitDetail: () => void;
}

export function BranchDiffDetailPanel({
  detail,
  loading,
  baseBranchName,
  targetBranchName,
  onBackToCommitDetail
}: BranchDiffDetailPanelProps): JSX.Element {
  const baseLabel = baseBranchName ?? detail?.baseRef ?? 'default';
  const targetLabel = targetBranchName ?? detail?.targetRef ?? 'current';

  return (
    <section className="panel flex min-h-0 min-w-0 flex-col overflow-hidden p-3">
      <div className="mb-2 flex items-center justify-between px-2">
        <div>
          <div className="section-title">Branch Diff</div>
          <div className="text-xs text-ink-subtle">
            {targetLabel} と {baseLabel} の差分
          </div>
        </div>
        <button
          type="button"
          className="button button-secondary !px-2 !py-1 text-[11px]"
          onClick={onBackToCommitDetail}
        >
          Commit Detail
        </button>
      </div>

      {loading ? <div className="p-4 text-sm text-ink-subtle">ブランチ差分を読み込み中...</div> : null}

      {!loading && !detail ? (
        <div className="p-4 text-sm text-ink-subtle">ブランチ差分を表示できませんでした。</div>
      ) : null}

      {detail ? (
        <div className="min-h-0 flex flex-1 flex-col gap-3 overflow-hidden px-2 pb-2">
          <div className="rounded-xl border border-black/10 bg-white/65 p-3">
            <div className="mb-2 text-sm font-semibold text-ink">
              {targetLabel} にのみ含まれる変更を表示しています
            </div>
            <div className="space-y-1 text-xs text-ink-soft">
              <div>Base Branch: {baseLabel}</div>
              <div>Target Branch: {targetLabel}</div>
              <div>Merge Base: {shortSha(detail.mergeBaseSha)}</div>
              <div>Changed Files: {detail.files.length}</div>
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              Changed Files
            </div>
            <div className="max-h-36 overflow-y-auto rounded-xl border border-black/10 bg-white/65">
              {detail.files.length === 0 ? (
                <div className="p-3 text-xs text-ink-subtle">差分ファイルはありません。</div>
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

          <div className="min-h-0 flex flex-1 flex-col">
            <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">Diff</div>
            <div className="min-h-0 flex-1">
              <SplitDiffViewer diff={detail.diff} files={detail.files} isDiffTruncated={detail.isDiffTruncated} />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
