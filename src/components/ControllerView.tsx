import { AlertTriangle, ArrowLeft, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../lib/api';
import { describeGitError, type UiError } from '../lib/errors';
import { BranchTree } from './BranchTree';
import { CommitDetailPanel } from './CommitDetailPanel';
import { CommitGraph } from './CommitGraph';
import { GitOperationPanel } from './GitOperationPanel';
import type {
  AppConfig,
  Branch,
  BranchResponse,
  CommitDetail,
  CommitGraphMode,
  CommitListItem,
  Repository,
  StashEntry,
  WorkingTreeStatus
} from '../types';

interface ControllerViewProps {
  repository: Repository;
  appConfig: AppConfig | null;
  onBackToDashboard: () => void;
  onNotify: (message: string) => void;
}

function resolveDefaultBranchRef(branches: BranchResponse | null): string | undefined {
  if (!branches) {
    return undefined;
  }

  const localBranches = branches.local;
  const candidate =
    localBranches.find((branch) => branch.name === 'main') ??
    localBranches.find((branch) => branch.name === 'master') ??
    localBranches.find((branch) => branch.name === branches.current) ??
    localBranches[0];

  if (!candidate) {
    return undefined;
  }

  return candidate.fullRef || candidate.name;
}

function resolveLogRef(targetRef: string, branches: BranchResponse | null): string {
  const normalizedTarget = targetRef.trim();
  if (!branches || normalizedTarget !== 'HEAD') {
    return normalizedTarget || 'HEAD';
  }

  const currentLocal = branches.local.find((branch) => branch.name === branches.current);
  if (!currentLocal) {
    return 'HEAD';
  }

  return currentLocal.fullRef || currentLocal.name;
}

function resolveCompareRefs(targetRef: string, branches: BranchResponse | null): string[] {
  if (!branches) {
    return [];
  }

  const defaultRef = resolveDefaultBranchRef(branches);
  const refs = branches.local.map((branch) => branch.fullRef || branch.name);
  const ordered = defaultRef ? [defaultRef, ...refs.filter((ref) => ref !== defaultRef)] : refs;
  const deduped = [...new Set(ordered)];
  return deduped.filter((ref) => ref && ref !== targetRef);
}

function isHeadDecoration(decoration: string): boolean {
  const trimmed = decoration.trim();
  if (!trimmed) {
    return false;
  }

  const body =
    trimmed.startsWith('(') && trimmed.endsWith(')') ? trimmed.slice(1, Math.max(trimmed.length - 1, 1)) : trimmed;
  return body
    .split(',')
    .map((entry) => entry.trim())
    .some((entry) => entry === 'HEAD' || entry.startsWith('HEAD -> '));
}

export function ControllerView({
  repository,
  appConfig,
  onBackToDashboard,
  onNotify
}: ControllerViewProps): JSX.Element {
  const [branches, setBranches] = useState<BranchResponse | null>(null);
  const [selectedBranchForHover, setSelectedBranchForHover] = useState<Branch | null>(null);
  const [activeLogRef, setActiveLogRef] = useState<string>('HEAD');
  const [activeCompareRefs, setActiveCompareRefs] = useState<string[]>([]);
  const [pendingScrollCommitSha, setPendingScrollCommitSha] = useState<string | null>(null);

  const [commits, setCommits] = useState<CommitListItem[]>([]);
  const [hasMoreCommits, setHasMoreCommits] = useState(true);
  const [loadingCommits, setLoadingCommits] = useState(false);
  const [loadingMoreCommits, setLoadingMoreCommits] = useState(false);
  const [activeCommit, setActiveCommit] = useState<CommitListItem | null>(null);
  const [commitDetail, setCommitDetail] = useState<CommitDetail | null>(null);
  const [loadingCommitDetail, setLoadingCommitDetail] = useState(false);

  const [workingStatus, setWorkingStatus] = useState<WorkingTreeStatus | null>(null);
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [operationBusy, setOperationBusy] = useState(false);

  const [commitTitle, setCommitTitle] = useState('');
  const [commitDescription, setCommitDescription] = useState('');
  const [commitGraphMode, setCommitGraphMode] = useState<CommitGraphMode>('detailed');
  const [inlineError, setInlineError] = useState<UiError | null>(null);

  const [fingerprint, setFingerprint] = useState<string>('');
  const refreshLockRef = useRef(false);

  const repoPath = repository.path;

  const reportError = useCallback(
    (error: unknown, fallbackTitle: string): void => {
      const nextError = describeGitError(error, fallbackTitle);
      setInlineError(nextError);
      onNotify(nextError.title);
    },
    [onNotify]
  );

  const loadCommitDetail = useCallback(
    async (sha: string): Promise<void> => {
      setLoadingCommitDetail(true);
      try {
        const detail = await api.getCommitDetail(repoPath, sha);
        setCommitDetail(detail);
      } catch (error) {
        reportError(error, 'コミット詳細の取得に失敗しました。');
      } finally {
        setLoadingCommitDetail(false);
      }
    },
    [repoPath, reportError]
  );

  const loadCommits = useCallback(
    async (options: {
      append: boolean;
      offset: number;
      ref: string;
      compareRefs?: string[];
      focusCommitSha?: string;
    }): Promise<void> => {
      if (options.append) {
        setLoadingMoreCommits(true);
      } else {
        setLoadingCommits(true);
      }

      try {
        const normalizedRef = options.ref.trim() || 'HEAD';
        const normalizedCompareRefs = (options.compareRefs ?? [])
          .map((ref) => ref.trim())
          .filter((ref) => ref.length > 0 && ref !== normalizedRef);
        const compareRefArgs = normalizedCompareRefs.length > 0 ? normalizedCompareRefs : undefined;
        const fetchPage = async (offset: number) =>
          api.getCommits(repoPath, normalizedRef, offset, 50, compareRefArgs);

        const initial = await fetchPage(options.offset);
        let nextCommits = initial.commits;
        let nextHasMore = initial.hasMore;

        // If branch tip is not visible in the first page, keep fetching a few pages
        // so branch-click reliably jumps to the selected tip.
        const focusCommitSha = options.append ? '' : options.focusCommitSha?.trim() ?? '';
        if (focusCommitSha) {
          let pageGuard = 0;
          while (!nextCommits.some((commit) => commit.sha === focusCommitSha) && nextHasMore && pageGuard < 6) {
            const more = await fetchPage(options.offset + nextCommits.length);
            nextCommits = [...nextCommits, ...more.commits];
            nextHasMore = more.hasMore;
            pageGuard += 1;
          }
        }

        setCommits((current) => (options.append ? [...current, ...nextCommits] : nextCommits));
        setHasMoreCommits(nextHasMore);
        if (!options.append) {
          setActiveCompareRefs(normalizedCompareRefs);
        }

        if (!options.append && nextCommits.length > 0) {
          const focusedCommit = focusCommitSha
            ? nextCommits.find((commit) => commit.sha === focusCommitSha) ?? null
            : null;
          const nextActiveCommit = focusedCommit ?? nextCommits[0];

          setActiveCommit(nextActiveCommit);
          await loadCommitDetail(nextActiveCommit.sha);
        }
      } catch (error) {
        reportError(error, 'コミット一覧の取得に失敗しました。');
      } finally {
        setLoadingCommits(false);
        setLoadingMoreCommits(false);
      }
    },
    [loadCommitDetail, repoPath, reportError]
  );

  const loadWorkingState = useCallback(async (): Promise<void> => {
    try {
      const [statusResponse, stashResponse] = await Promise.all([
        api.getWorkingTreeStatus(repoPath),
        api.getStashes(repoPath)
      ]);

      setWorkingStatus(statusResponse);
      setStashes(stashResponse.stashes);
    } catch (error) {
      reportError(error, 'ワークツリー状態の取得に失敗しました。');
    }
  }, [repoPath, reportError]);

  const loadBranches = useCallback(async (): Promise<BranchResponse | null> => {
    try {
      const response = await api.getBranches(repoPath);
      setBranches(response);
      return response;
    } catch (error) {
      reportError(error, 'ブランチ情報の取得に失敗しました。');
      return null;
    }
  }, [repoPath, reportError]);

  const refreshAll = useCallback(
    async (refOverride?: string): Promise<void> => {
      if (refreshLockRef.current) {
        return;
      }

      refreshLockRef.current = true;

      try {
        const targetRef = refOverride ?? activeLogRef;
        const [nextBranches] = await Promise.all([loadBranches(), loadWorkingState()]);
        const branchContext = nextBranches ?? branches;
        const resolvedRef = resolveLogRef(targetRef, branchContext);
        const compareRefs = resolveCompareRefs(resolvedRef, branchContext);

        setActiveLogRef(resolvedRef);
        await loadCommits({ append: false, offset: 0, ref: resolvedRef, compareRefs });
        const fingerprintResponse = await api.getFingerprint(repoPath);
        setFingerprint(fingerprintResponse.fingerprint);
      } finally {
        refreshLockRef.current = false;
      }
    },
    [activeLogRef, branches, loadBranches, loadCommits, loadWorkingState, repoPath]
  );

  useEffect(() => {
    const defaultRef = 'HEAD';
    setActiveLogRef(defaultRef);
    setActiveCompareRefs([]);
    setSelectedBranchForHover(null);
    setPendingScrollCommitSha(null);
    setCommitTitle('');
    setCommitDescription('');
    setInlineError(null);
    void refreshAll(defaultRef);
  }, [refreshAll, repoPath]);

  useEffect(() => {
    setCommitGraphMode(appConfig?.commitGraphMode ?? 'detailed');
  }, [appConfig?.commitGraphMode]);

  useEffect(() => {
    let active = true;

    const timer = setInterval(async () => {
      if (!active || refreshLockRef.current) {
        return;
      }

      try {
        const response = await api.getFingerprint(repoPath);
        if (!active) {
          return;
        }

        if (response.fingerprint !== fingerprint) {
          await refreshAll();
        }
      } catch {
        // polling failure is non-fatal
      }
    }, 5000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [fingerprint, refreshAll, repoPath]);

  const handleCheckoutBranch = async (branch: Branch): Promise<void> => {
    setOperationBusy(true);
    const branchRefForLog = branch.fullRef || branch.name;

    try {
      await api.checkout(repoPath, branch.name);
      setActiveLogRef(branchRefForLog);
      setInlineError(null);
      onNotify(`${branch.name} に切り替えました。`);
      await refreshAll(branchRefForLog);
    } catch (error) {
      reportError(error, 'ブランチ切り替えに失敗しました。');
    } finally {
      setOperationBusy(false);
    }
  };

  const handleCheckoutCommit = async (commit: CommitListItem): Promise<void> => {
    setOperationBusy(true);

    try {
      await api.checkout(repoPath, commit.sha);
      setInlineError(null);
      onNotify(`${commit.sha.slice(0, 7)} にチェックアウトしました。`);
      await refreshAll();
    } catch (error) {
      reportError(error, 'コミットチェックアウトに失敗しました。');
    } finally {
      setOperationBusy(false);
    }
  };

  const mutateAndReload = async (task: () => Promise<void>): Promise<void> => {
    setOperationBusy(true);
    try {
      await task();
      setInlineError(null);
      const resolvedRef = resolveLogRef(activeLogRef, branches);
      const compareRefs = resolveCompareRefs(resolvedRef, branches);
      setActiveLogRef(resolvedRef);
      await Promise.all([
        loadWorkingState(),
        loadCommits({ append: false, offset: 0, ref: resolvedRef, compareRefs })
      ]);
    } catch (error) {
      reportError(error, 'Git 操作に失敗しました。');
    } finally {
      setOperationBusy(false);
    }
  };

  const currentBranchName = branches?.current ?? null;
  const highlightedCommitSha = selectedBranchForHover?.commit ?? null;
  const checkedOutCommitSha = useMemo(() => {
    if (branches?.current && branches.current !== 'HEAD') {
      const currentBranch = branches.local.find((branch) => branch.name === branches.current);
      if (currentBranch?.commit) {
        return currentBranch.commit;
      }
    }

    const detachedHeadCommit = commits.find((commit) => isHeadDecoration(commit.decoration));
    return detachedHeadCommit?.sha ?? null;
  }, [branches, commits]);

  const changedFilesForAi = useMemo(
    () => [
      ...(workingStatus?.staged.map((item) => item.file) ?? []),
      ...(workingStatus?.unstaged.map((item) => item.file) ?? [])
    ],
    [workingStatus]
  );

  const handleSelectBranch = (branch: Branch): void => {
    setSelectedBranchForHover(branch);
    setPendingScrollCommitSha(branch.commit);
    const branchRefForLog = branch.fullRef || branch.name;
    const compareRefs = resolveCompareRefs(branchRefForLog, branches);
    setActiveLogRef(branchRefForLog);
    void loadCommits({
      append: false,
      offset: 0,
      ref: branchRefForLog,
      compareRefs,
      focusCommitSha: branch.commit
    });
  };

  return (
    <section className="flex h-full flex-col gap-3">
      <header className="panel flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <button type="button" className="button button-secondary" onClick={onBackToDashboard}>
            <ArrowLeft size={14} />
            Dashboard
          </button>
          <div>
            <div className="text-sm font-semibold text-ink">{repository.name}</div>
            <div className="text-xs text-ink-subtle">{repository.path}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="badge">{currentBranchName ?? 'detached'}</span>
          <button
            type="button"
            className="button button-secondary"
            disabled={operationBusy}
            onClick={() => void refreshAll()}
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </header>

      {inlineError ? (
        <section className="panel flex items-start justify-between gap-3 border border-red-500/25 bg-red-50/70 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 text-red-700" />
            <div>
              <div className="text-sm font-semibold text-red-800">{inlineError.title}</div>
              <div className="text-xs text-red-700">{inlineError.detail}</div>
            </div>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-red-700 transition hover:bg-red-100"
            onClick={() => setInlineError(null)}
            aria-label="close error"
          >
            <X size={14} />
          </button>
        </section>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_360px] gap-3 max-[1380px]:grid-cols-[250px_minmax(0,1fr)] max-[1180px]:grid-cols-1">
        <BranchTree
          branches={branches}
          selectedBranchName={branches?.current ?? null}
          onSelectBranch={handleSelectBranch}
          onCheckoutBranch={(branch) => {
            void handleCheckoutBranch(branch);
          }}
        />

        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(260px,42%)] gap-3 max-[1180px]:grid-rows-[minmax(0,1fr)_minmax(220px,45%)]">
          <CommitGraph
            commits={commits}
            mode={commitGraphMode}
            activeCommitSha={activeCommit?.sha ?? null}
            highlightedCommitSha={highlightedCommitSha}
            checkedOutCommitSha={checkedOutCommitSha}
            scrollToCommitSha={pendingScrollCommitSha}
            onScrollToCommitHandled={(sha) => {
              setPendingScrollCommitSha((current) => (current === sha ? null : current));
            }}
            hasMore={hasMoreCommits}
            loading={loadingCommits}
            loadingMore={loadingMoreCommits}
            onSelectCommit={(commit) => {
              setActiveCommit(commit);
              void loadCommitDetail(commit.sha);
            }}
            onCheckoutCommit={(commit) => {
              void handleCheckoutCommit(commit);
            }}
            onLoadMore={() => {
              void loadCommits({
                append: true,
                offset: commits.length,
                ref: activeLogRef,
                compareRefs: activeCompareRefs
              });
            }}
          />

          <CommitDetailPanel detail={commitDetail} loading={loadingCommitDetail} />
        </div>

        <div className="max-[1380px]:col-span-2 max-[1180px]:col-span-1">
          <GitOperationPanel
            status={workingStatus}
            stashes={stashes}
            commitTitle={commitTitle}
            commitDescription={commitDescription}
            busy={operationBusy}
            onCommitTitleChange={setCommitTitle}
            onCommitDescriptionChange={setCommitDescription}
            onStageFile={(file) => {
              void mutateAndReload(async () => {
                await api.stageFile(repoPath, file);
              });
            }}
            onUnstageFile={(file) => {
              void mutateAndReload(async () => {
                await api.unstageFile(repoPath, file);
              });
            }}
            onStageAll={() => {
              void mutateAndReload(async () => {
                const files = workingStatus?.unstaged.map((item) => item.file) ?? [];
                for (const file of files) {
                  await api.stageFile(repoPath, file);
                }
              });
            }}
            onStashFile={(file) => {
              void mutateAndReload(async () => {
                await api.stashFile(repoPath, file);
              });
            }}
            onGenerateTitle={() => {
              void (async () => {
                setOperationBusy(true);
                try {
                  const response = await api.generateTitle(repoPath, changedFilesForAi);
                  setInlineError(null);
                  setCommitTitle(response.title);
                } catch (error) {
                  reportError(error, 'タイトル生成に失敗しました。');
                } finally {
                  setOperationBusy(false);
                }
              })();
            }}
            onCommit={() => {
              void mutateAndReload(async () => {
                await api.commit(repoPath, commitTitle, commitDescription);
                setCommitTitle('');
                setCommitDescription('');
              });
            }}
            onPush={() => {
              void mutateAndReload(async () => {
                await api.push(repoPath);
              });
            }}
          />
        </div>
      </div>
    </section>
  );
}
