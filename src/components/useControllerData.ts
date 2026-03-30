import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../lib/api';
import {
  canCompareCurrentBranch,
  getBranchDiffBaseLabel,
  getBranchDiffButtonLabel,
  isCurrentBranchDiffDetail,
  resolveBranchDiffBaseBranch
} from '../lib/branchDiff';
import { getCommitMessageFiles } from '../lib/commitMessage';
import { readCommitMessageDraftFromStorage, writeCommitMessageDraftToStorage } from '../lib/commitMessageDrafts';
import {
  isHeadDecoration,
  resolveCompareRefs,
  resolveLogRef
} from '../lib/controllerViewUtils';
import { describeGitError, type UiError } from '../lib/errors';
import { getSelfMutationBlockedReason } from '../lib/repositoryMutationSafety';
import type {
  AppConfig,
  Branch,
  BranchDiffDetail,
  BranchResponse,
  CommitDetail,
  CommitGraphMode,
  CommitListItem,
  RepositoryMutationSafety,
  StashEntry,
  WorkingTreeDiffArea,
  WorkingTreeDiffDetail,
  WorkingTreeStatus
} from '../types';

interface UseControllerDataParams {
  repoPath: string;
  appConfig: AppConfig | null;
  onNotify: (message: string) => void;
  onCurrentBranchChange: (repoPath: string, branchName: string | null) => void;
}

function readInitialCommitMessageDraft(repoPath: string): {
  title: string;
  description: string;
} {
  if (typeof window === 'undefined') {
    return {
      title: '',
      description: ''
    };
  }

  try {
    const draft = readCommitMessageDraftFromStorage(window.localStorage, repoPath);
    return {
      title: draft?.title ?? '',
      description: draft?.description ?? ''
    };
  } catch {
    return {
      title: '',
      description: ''
    };
  }
}

export interface UseControllerDataResult {
  branches: BranchResponse | null;
  currentBranchName: string | null;
  currentLocalBranch: Branch | null;
  branchDiffBaseBranch: Branch | null;
  branchDiffBaseLabel: string | null;
  showBranchDiffButton: boolean;
  branchDiffMatchesCurrentBranch: boolean;
  branchDiffButtonLabel: string;
  selfMutationBlockedReason: string | null;

  activeLogRef: string;
  setActiveLogRef: (ref: string) => void;
  activeCompareRefs: string[];
  setActiveCompareRefs: (refs: string[]) => void;

  commits: CommitListItem[];
  hasMoreCommits: boolean;
  loadingCommits: boolean;
  loadingMoreCommits: boolean;

  activeCommit: CommitListItem | null;
  setActiveCommit: (commit: CommitListItem | null) => void;
  isWipSelected: boolean;
  setIsWipSelected: (wip: boolean) => void;

  commitDetail: CommitDetail | null;
  setCommitDetail: (detail: CommitDetail | null) => void;
  loadingCommitDetail: boolean;

  branchDiffDetail: BranchDiffDetail | null;
  setBranchDiffDetail: (detail: BranchDiffDetail | null) => void;
  loadingBranchDiffDetail: boolean;
  showBranchDiff: boolean;
  setShowBranchDiff: (show: boolean) => void;

  focusedCommitDiffFile: string | null;
  setFocusedCommitDiffFile: (file: string | null) => void;

  focusedWorkingTreeDiff: { file: string; area: WorkingTreeDiffArea } | null;
  workingTreeDiffDetail: WorkingTreeDiffDetail | null;
  loadingWorkingTreeDiffDetail: boolean;

  workingStatus: WorkingTreeStatus | null;
  stashes: StashEntry[];

  operationBusy: boolean;
  setOperationBusy: (busy: boolean) => void;
  generatingCommitMessage: boolean;
  setGeneratingCommitMessage: (generating: boolean) => void;

  commitTitle: string;
  setCommitTitle: (title: string) => void;
  commitDescription: string;
  setCommitDescription: (desc: string) => void;
  clearCommitMessageDraft: () => void;

  commitGraphMode: CommitGraphMode;
  inlineError: UiError | null;
  setInlineError: (error: UiError | null) => void;

  checkedOutCommitSha: string | null;
  commitMessageFiles: string[];

  reportError: (error: unknown, fallbackTitle: string) => void;
  reportBlockedMutation: (title: string) => boolean;
  loadCommitDetail: (sha: string) => Promise<void>;
  loadBranchDiffDetail: () => Promise<void>;
  loadWorkingTreeDiffDetail: (file: string, area: WorkingTreeDiffArea) => Promise<void>;
  closeWorkingTreeDiffOverlay: () => void;
  loadCommits: (options: {
    append: boolean;
    offset: number;
    ref: string;
    compareRefs?: string[];
    focusCommitSha?: string;
  }) => Promise<void>;
  loadWorkingState: () => Promise<void>;
  loadBranches: () => Promise<BranchResponse | null>;
  refreshAll: (refOverride?: string) => Promise<void>;
  reloadAfterBranchMutation: (preferredBranchName?: string) => Promise<void>;
  mutateAndReload: (
    task: () => Promise<void>,
    options?: { reloadCommits?: boolean }
  ) => Promise<void>;
}

export function useControllerData({
  repoPath,
  appConfig,
  onNotify,
  onCurrentBranchChange
}: UseControllerDataParams): UseControllerDataResult {
  const initialCommitMessageDraft = useMemo(() => readInitialCommitMessageDraft(repoPath), [repoPath]);
  const [branches, setBranches] = useState<BranchResponse | null>(null);
  const [activeLogRef, setActiveLogRef] = useState<string>('HEAD');
  const [activeCompareRefs, setActiveCompareRefs] = useState<string[]>([]);

  const [commits, setCommits] = useState<CommitListItem[]>([]);
  const [hasMoreCommits, setHasMoreCommits] = useState(true);
  const [loadingCommits, setLoadingCommits] = useState(false);
  const [loadingMoreCommits, setLoadingMoreCommits] = useState(false);
  const [activeCommit, setActiveCommit] = useState<CommitListItem | null>(null);
  const [isWipSelected, setIsWipSelected] = useState(false);
  const [commitDetail, setCommitDetail] = useState<CommitDetail | null>(null);
  const [loadingCommitDetail, setLoadingCommitDetail] = useState(false);
  const [branchDiffDetail, setBranchDiffDetail] = useState<BranchDiffDetail | null>(null);
  const [loadingBranchDiffDetail, setLoadingBranchDiffDetail] = useState(false);
  const [showBranchDiff, setShowBranchDiff] = useState(false);
  const [focusedCommitDiffFile, setFocusedCommitDiffFile] = useState<string | null>(null);
  const [focusedWorkingTreeDiff, setFocusedWorkingTreeDiff] = useState<{
    file: string;
    area: WorkingTreeDiffArea;
  } | null>(null);
  const [workingTreeDiffDetail, setWorkingTreeDiffDetail] = useState<WorkingTreeDiffDetail | null>(null);
  const [loadingWorkingTreeDiffDetail, setLoadingWorkingTreeDiffDetail] = useState(false);

  const [workingStatus, setWorkingStatus] = useState<WorkingTreeStatus | null>(null);
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [operationBusy, setOperationBusy] = useState(false);
  const [generatingCommitMessage, setGeneratingCommitMessage] = useState(false);

  const [commitTitle, setCommitTitle] = useState(initialCommitMessageDraft.title);
  const [commitDescription, setCommitDescription] = useState(initialCommitMessageDraft.description);
  const [commitGraphMode, setCommitGraphMode] = useState<CommitGraphMode>('detailed');
  const [inlineError, setInlineError] = useState<UiError | null>(null);

  const [fingerprint, setFingerprint] = useState<string>('');
  const [repositoryMutationSafety, setRepositoryMutationSafety] = useState<RepositoryMutationSafety>({
    isSelfRepository: false
  });
  const refreshLockRef = useRef(false);
  const workingTreeDiffRequestKeyRef = useRef<string | null>(null);

  const currentBranchName = branches?.current ?? null;
  const currentLocalBranch = useMemo(
    () => branches?.local.find((branch) => branch.name === branches?.current) ?? null,
    [branches]
  );
  const branchDiffBaseBranch = useMemo(() => resolveBranchDiffBaseBranch(branches), [branches]);
  const branchDiffBaseLabel = getBranchDiffBaseLabel(branchDiffBaseBranch);
  const showBranchDiffButton = canCompareCurrentBranch(currentLocalBranch, branchDiffBaseBranch);
  const branchDiffMatchesCurrentBranch = isCurrentBranchDiffDetail(branchDiffDetail, branchDiffBaseBranch, currentLocalBranch);
  const branchDiffButtonLabel = getBranchDiffButtonLabel(branchDiffBaseLabel);
  const selfMutationBlockedReason = getSelfMutationBlockedReason(import.meta.env.DEV, repositoryMutationSafety);

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

  const commitMessageFiles = useMemo(() => getCommitMessageFiles(workingStatus), [workingStatus]);

  const clearCommitMessageDraft = useCallback((): void => {
    setCommitTitle('');
    setCommitDescription('');
  }, []);

  const reportError = useCallback(
    (error: unknown, fallbackTitle: string): void => {
      const nextError = describeGitError(error, fallbackTitle);
      setInlineError(nextError);
      onNotify(nextError.title);
    },
    [onNotify]
  );

  const reportBlockedMutation = useCallback(
    (title: string): boolean => {
      if (!selfMutationBlockedReason) {
        return false;
      }

      const nextError: UiError = {
        title,
        detail: selfMutationBlockedReason
      };
      setInlineError(nextError);
      onNotify(title);
      return true;
    },
    [onNotify, selfMutationBlockedReason]
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

  const loadBranchDiffDetail = useCallback(async (): Promise<void> => {
    if (!currentLocalBranch || !branchDiffBaseBranch) {
      setBranchDiffDetail(null);
      return;
    }

    setBranchDiffDetail(null);
    setLoadingBranchDiffDetail(true);
    try {
      const detail = await api.getBranchDiffDetail(
        repoPath,
        branchDiffBaseBranch.fullRef || branchDiffBaseBranch.name,
        currentLocalBranch.fullRef || currentLocalBranch.name
      );
      setBranchDiffDetail(detail);
    } catch (error) {
      reportError(error, 'ブランチ差分の取得に失敗しました。');
    } finally {
      setLoadingBranchDiffDetail(false);
    }
  }, [branchDiffBaseBranch, currentLocalBranch, repoPath, reportError]);

  const closeWorkingTreeDiffOverlay = useCallback((): void => {
    workingTreeDiffRequestKeyRef.current = null;
    setFocusedWorkingTreeDiff(null);
    setWorkingTreeDiffDetail(null);
    setLoadingWorkingTreeDiffDetail(false);
  }, []);

  const loadWorkingTreeDiffDetail = useCallback(
    async (file: string, area: WorkingTreeDiffArea): Promise<void> => {
      const normalizedFile = file.trim();
      if (!normalizedFile) {
        return;
      }

      const requestKey = `${area}:${normalizedFile}`;
      workingTreeDiffRequestKeyRef.current = requestKey;
      setFocusedWorkingTreeDiff({ file: normalizedFile, area });
      setWorkingTreeDiffDetail(null);
      setLoadingWorkingTreeDiffDetail(true);

      try {
        const detail = await api.getWorkingTreeDiffDetail(repoPath, normalizedFile, area);
        if (workingTreeDiffRequestKeyRef.current !== requestKey) {
          return;
        }

        setWorkingTreeDiffDetail(detail);
      } catch (error) {
        if (workingTreeDiffRequestKeyRef.current !== requestKey) {
          return;
        }

        setWorkingTreeDiffDetail(null);
        reportError(error, '作業ツリー差分の取得に失敗しました。');
      } finally {
        if (workingTreeDiffRequestKeyRef.current === requestKey) {
          setLoadingWorkingTreeDiffDetail(false);
        }
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

          setIsWipSelected(false);
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

  const reloadAfterBranchMutation = useCallback(
    async (preferredBranchName?: string): Promise<void> => {
      const [nextBranches] = await Promise.all([loadBranches(), loadWorkingState()]);
      const branchContext = nextBranches ?? branches;
      const preferredBranch =
        preferredBranchName
          ? branchContext?.local.find((branch) => branch.name === preferredBranchName) ?? null
          : null;
      const currentBranch =
        branchContext?.local.find((branch) => branch.name === branchContext.current) ?? null;
      const resolvedBranch = preferredBranch ?? currentBranch;
      const resolvedRef = resolvedBranch?.fullRef || resolvedBranch?.name || resolveLogRef(activeLogRef, branchContext);
      const compareRefs = resolveCompareRefs(resolvedRef, branchContext);

      setActiveLogRef(resolvedRef);
      await loadCommits({ append: false, offset: 0, ref: resolvedRef, compareRefs });

      const fingerprintResponse = await api.getFingerprint(repoPath);
      setFingerprint(fingerprintResponse.fingerprint);
    },
    [activeLogRef, branches, loadBranches, loadCommits, loadWorkingState, repoPath]
  );

  const mutateAndReload = useCallback(
    async (
      task: () => Promise<void>,
      options: { reloadCommits?: boolean } = {}
    ): Promise<void> => {
      setOperationBusy(true);
      try {
        await task();
        setInlineError(null);
        const shouldReloadCommits = options.reloadCommits ?? true;

        if (shouldReloadCommits) {
          const resolvedRef = resolveLogRef(activeLogRef, branches);
          const compareRefs = resolveCompareRefs(resolvedRef, branches);
          setActiveLogRef(resolvedRef);
          await Promise.all([
            loadWorkingState(),
            loadCommits({ append: false, offset: 0, ref: resolvedRef, compareRefs })
          ]);
        } else {
          await loadWorkingState();
        }

        const fingerprintResponse = await api.getFingerprint(repoPath);
        setFingerprint(fingerprintResponse.fingerprint);
      } catch (error) {
        reportError(error, 'Git 操作に失敗しました。');
      } finally {
        setOperationBusy(false);
      }
    },
    [activeLogRef, branches, loadCommits, loadWorkingState, repoPath, reportError]
  );

  // Notify parent when current branch changes
  useEffect(() => {
    onCurrentBranchChange(repoPath, currentBranchName);
  }, [currentBranchName, onCurrentBranchChange, repoPath]);

  // Init/reset on repo change
  useEffect(() => {
    const defaultRef = 'HEAD';
    setActiveLogRef(defaultRef);
    setActiveCompareRefs([]);
    setActiveCommit(null);
    setIsWipSelected(false);
    setCommitDetail(null);
    setCommitTitle(initialCommitMessageDraft.title);
    setCommitDescription(initialCommitMessageDraft.description);
    setBranchDiffDetail(null);
    setShowBranchDiff(false);
    setFocusedCommitDiffFile(null);
    closeWorkingTreeDiffOverlay();
    setInlineError(null);
    void refreshAll(defaultRef);
  }, [closeWorkingTreeDiffOverlay, initialCommitMessageDraft.description, initialCommitMessageDraft.title, refreshAll, repoPath]);

  // Load mutation safety
  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const response = await api.getRepositoryMutationSafety(repoPath);
        if (active) {
          setRepositoryMutationSafety(response);
        }
      } catch {
        if (active) {
          setRepositoryMutationSafety({ isSelfRepository: false });
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [repoPath]);

  // Clear focused diff when active commit changes
  useEffect(() => {
    setFocusedCommitDiffFile(null);
  }, [activeCommit?.sha]);

  // Handle WIP selection change
  useEffect(() => {
    if (!isWipSelected) {
      closeWorkingTreeDiffOverlay();
      return;
    }

    const changedFileCount = (workingStatus?.staged.length ?? 0) + (workingStatus?.unstaged.length ?? 0);
    if (changedFileCount === 0) {
      setIsWipSelected(false);
    }
  }, [closeWorkingTreeDiffOverlay, isWipSelected, workingStatus]);

  // Close overlay if file disappears
  useEffect(() => {
    if (!focusedWorkingTreeDiff) {
      return;
    }

    const visibleFiles =
      focusedWorkingTreeDiff.area === 'staged' ? workingStatus?.staged ?? [] : workingStatus?.unstaged ?? [];

    if (!visibleFiles.some((item) => item.file === focusedWorkingTreeDiff.file)) {
      closeWorkingTreeDiffOverlay();
    }
  }, [closeWorkingTreeDiffOverlay, focusedWorkingTreeDiff, workingStatus]);

  // Load branch diff when toggled
  useEffect(() => {
    if (!showBranchDiffButton) {
      setShowBranchDiff(false);
      setBranchDiffDetail(null);
      return;
    }

    if (showBranchDiff) {
      void loadBranchDiffDetail();
    }
  }, [loadBranchDiffDetail, showBranchDiff, showBranchDiffButton]);

  // Sync graph mode from appConfig
  useEffect(() => {
    setCommitGraphMode(appConfig?.commitGraphMode ?? 'detailed');
  }, [appConfig?.commitGraphMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      writeCommitMessageDraftToStorage(window.localStorage, repoPath, {
        title: commitTitle,
        description: commitDescription
      });
    } catch {
      // Ignore storage failures and keep the in-memory draft.
    }
  }, [commitDescription, commitTitle, repoPath]);

  // Validate focused diff file exists
  useEffect(() => {
    if (!focusedCommitDiffFile) {
      return;
    }

    if (!commitDetail || !commitDetail.files.some((file) => file.file === focusedCommitDiffFile)) {
      setFocusedCommitDiffFile(null);
    }
  }, [commitDetail, focusedCommitDiffFile]);

  // Fingerprint polling for auto-refresh
  useEffect(() => {
    let active = true;

    const timer = setInterval(async () => {
      if (!active || refreshLockRef.current || operationBusy) {
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
  }, [fingerprint, operationBusy, refreshAll, repoPath]);

  return {
    branches,
    currentBranchName,
    currentLocalBranch,
    branchDiffBaseBranch,
    branchDiffBaseLabel,
    showBranchDiffButton,
    branchDiffMatchesCurrentBranch,
    branchDiffButtonLabel,
    selfMutationBlockedReason,

    activeLogRef,
    setActiveLogRef,
    activeCompareRefs,
    setActiveCompareRefs,

    commits,
    hasMoreCommits,
    loadingCommits,
    loadingMoreCommits,

    activeCommit,
    setActiveCommit,
    isWipSelected,
    setIsWipSelected,

    commitDetail,
    setCommitDetail,
    loadingCommitDetail,

    branchDiffDetail,
    setBranchDiffDetail,
    loadingBranchDiffDetail,
    showBranchDiff,
    setShowBranchDiff,

    focusedCommitDiffFile,
    setFocusedCommitDiffFile,

    focusedWorkingTreeDiff,
    workingTreeDiffDetail,
    loadingWorkingTreeDiffDetail,

    workingStatus,
    stashes,

    operationBusy,
    setOperationBusy,
    generatingCommitMessage,
    setGeneratingCommitMessage,

    commitTitle,
    setCommitTitle,
    commitDescription,
    setCommitDescription,
    clearCommitMessageDraft,

    commitGraphMode,
    inlineError,
    setInlineError,

    checkedOutCommitSha,
    commitMessageFiles,

    reportError,
    reportBlockedMutation,
    loadCommitDetail,
    loadBranchDiffDetail,
    loadWorkingTreeDiffDetail,
    closeWorkingTreeDiffOverlay,
    loadCommits,
    loadWorkingState,
    loadBranches,
    refreshAll,
    reloadAfterBranchMutation,
    mutateAndReload
  };
}
