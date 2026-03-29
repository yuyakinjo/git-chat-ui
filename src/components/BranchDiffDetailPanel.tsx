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
          <div className="section-title">Changed Files</div>
          <div className="text-xs text-ink-subtle">
            {targetLabel} と {baseLabel} の差分をファイル単位で表示
          </div>
        </div>
        <button
          type="button"
          className="button button-secondary !px-2 !py-1 text-[11px]"
          onClick={onBackToCommitDetail}
        >
          Back to Commit Detail
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
              {targetLabel} に含まれる {baseLabel} との差分ファイル一覧です
            </div>
            <div className="space-y-1 text-xs text-ink-soft">
              <div>Base Branch: {baseLabel}</div>
              <div>Target Branch: {targetLabel}</div>
              <div>Merge Base: {shortSha(detail.mergeBaseSha)}</div>
              <div>Changed Files: {detail.files.length}</div>
            </div>
          </div>

          <div className="min-h-0 flex flex-1 flex-col">
            <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              File List & Diff
            </div>
            <div className="min-h-0 flex-1">
              <SplitDiffViewer diff={detail.diff} files={detail.files} isDiffTruncated={detail.isDiffTruncated} />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
