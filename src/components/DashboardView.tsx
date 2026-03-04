import { FolderGit2, Search } from 'lucide-react';

import { compactPath } from '../lib/format';
import type { Repository } from '../types';

interface DashboardViewProps {
  repositories: Repository[];
  query: string;
  loading: boolean;
  onQueryChange: (query: string) => void;
  onSelectRepository: (repository: Repository) => void;
}

function RepositoryRow(props: {
  repository: Repository;
  label?: string;
  onSelectRepository: (repository: Repository) => void;
}): JSX.Element {
  const { repository, label, onSelectRepository } = props;

  return (
    <button
      type="button"
      className="list-item w-full text-left"
      onClick={() => onSelectRepository(repository)}
    >
      <span className="rounded-lg bg-accent-soft p-2 text-accent">
        <FolderGit2 size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-ink">{repository.name}</div>
        <div className="truncate text-[12px] text-ink-subtle">{compactPath(repository.path)}</div>
      </div>
      {label ? <span className="badge">{label}</span> : null}
    </button>
  );
}

export function DashboardView({
  repositories,
  query,
  loading,
  onQueryChange,
  onSelectRepository
}: DashboardViewProps): JSX.Element {
  const recentlyUsed = repositories.filter((repository) => Boolean(repository.recentlyUsedAt));
  const rest = repositories.filter((repository) => !repository.recentlyUsedAt);

  return (
    <section className="panel mx-auto flex h-full w-full max-w-3xl flex-col p-6">
      <div className="mb-6 space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Git Chat UI</h1>
        <p className="text-sm text-ink-soft">
          Git リポジトリを選択して、ブランチ・コミット・ステージング操作を GUI で実行します。
        </p>
      </div>

      <label className="mb-4 flex items-center gap-2 rounded-2xl border border-black/10 bg-white/70 px-3 py-2">
        <Search size={16} className="text-ink-subtle" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          className="w-full border-none bg-transparent text-sm text-ink outline-none"
          placeholder="リポジトリ名で検索"
        />
      </label>

      <div className="mb-2 flex items-center justify-between">
        <div className="section-title">Repositories</div>
        {loading ? <span className="text-xs text-ink-subtle">Scanning $HOME...</span> : null}
      </div>

      <div className="min-h-0 max-h-[372px] overflow-y-auto rounded-2xl border border-black/10 bg-white/60 p-2">
        {recentlyUsed.length > 0 ? (
          <div className="mb-4 space-y-1">
            <div className="px-2 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              Recently used
            </div>
            {recentlyUsed.map((repository) => (
              <RepositoryRow
                key={repository.path}
                repository={repository}
                label="Recent"
                onSelectRepository={onSelectRepository}
              />
            ))}
          </div>
        ) : null}

        <div className="space-y-1">
          {rest.slice(0, 5).map((repository) => (
            <RepositoryRow
              key={repository.path}
              repository={repository}
              onSelectRepository={onSelectRepository}
            />
          ))}
          {rest.slice(5).map((repository) => (
            <RepositoryRow
              key={repository.path}
              repository={repository}
              onSelectRepository={onSelectRepository}
            />
          ))}
        </div>

        {!loading && repositories.length === 0 ? (
          <div className="rounded-xl bg-black/5 p-5 text-sm text-ink-subtle">
            対象リポジトリが見つかりません。`$HOME` 配下に `.git` を含むディレクトリがあるか確認してください。
          </div>
        ) : null}
      </div>
    </section>
  );
}
