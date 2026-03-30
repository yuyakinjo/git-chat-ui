import { AlertTriangle, GripVertical, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../lib/api';
import { getBranchDeleteDisabledReason, getBranchDeleteTargetName } from '../lib/branchDelete';
import {
  canCompareCurrentBranch,
  getBranchDiffButtonLabel,
  isCurrentBranchDiffDetail
} from '../lib/branchDiff';
import {
  canSwapControllerPanel,
  DEFAULT_CONTROLLER_PANEL_ORDER,
  isControllerPanelId,
  normalizeControllerPanelOrder,
  swapControllerPanels,
  type ControllerPanelId
} from '../lib/controllerPanelOrder';
import { describeGitError, type UiError } from '../lib/errors';
import { BranchActionDialog, type BranchActionDialogStep } from './BranchActionDialog';
import { BranchDeleteDialog } from './BranchDeleteDialog';
import { BranchDiffOverlay } from './BranchDiffOverlay';
import { BranchTree } from './BranchTree';
import { CommitDetailPanel } from './CommitDetailPanel';
import { CommitDiffOverlay } from './CommitDiffOverlay';
import { CommitGraph } from './CommitGraph';
import { GitOperationPanel } from './GitOperationPanel';
import type {
  AppConfig,
  Branch,
  BranchDiffDetail,
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
  onNotify: (message: string) => void;
}

function resolveDefaultBranch(branches: BranchResponse | null): Branch | undefined {
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

  return candidate;
}

function resolveDefaultBranchRef(branches: BranchResponse | null): string | undefined {
  const candidate = resolveDefaultBranch(branches);
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

const CONTROLLER_PANEL_ORDER_STORAGE_KEY = 'git-chat-ui.controller-panel-order';
const PANEL_DRAG_THRESHOLD_PX = 6;
const controllerPanelLabels: Record<ControllerPanelId, string> = {
  commitGraph: 'Commit Graph',
  gitOperations: 'Git Operations',
  commitDetail: 'Commit Detail'
};

export function ControllerView({ repository, appConfig, onNotify }: ControllerViewProps): JSX.Element {
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
  const [branchDiffDetail, setBranchDiffDetail] = useState<BranchDiffDetail | null>(null);
  const [loadingBranchDiffDetail, setLoadingBranchDiffDetail] = useState(false);
  const [showBranchDiff, setShowBranchDiff] = useState(false);
  const [focusedCommitDiffFile, setFocusedCommitDiffFile] = useState<string | null>(null);
  const [branchAction, setBranchAction] = useState<{
    source: Branch;
    target: Branch;
    step: BranchActionDialogStep;
  } | null>(null);
  const [branchDeleteTarget, setBranchDeleteTarget] = useState<Branch | null>(null);

  const [workingStatus, setWorkingStatus] = useState<WorkingTreeStatus | null>(null);
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [operationBusy, setOperationBusy] = useState(false);

  const [commitTitle, setCommitTitle] = useState('');
  const [commitDescription, setCommitDescription] = useState('');
  const [commitGraphMode, setCommitGraphMode] = useState<CommitGraphMode>('detailed');
  const [inlineError, setInlineError] = useState<UiError | null>(null);
  const [panelOrder, setPanelOrder] = useState<ControllerPanelId[]>(() => {
    if (typeof window === 'undefined') {
      return [...DEFAULT_CONTROLLER_PANEL_ORDER];
    }

    try {
      const raw = window.localStorage.getItem(CONTROLLER_PANEL_ORDER_STORAGE_KEY);
      if (!raw) {
        return [...DEFAULT_CONTROLLER_PANEL_ORDER];
      }

      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? normalizeControllerPanelOrder(parsed.filter((value): value is string => typeof value === 'string'))
        : [...DEFAULT_CONTROLLER_PANEL_ORDER];
    } catch {
      return [...DEFAULT_CONTROLLER_PANEL_ORDER];
    }
  });
  const [draggedPanelId, setDraggedPanelId] = useState<ControllerPanelId | null>(null);
  const [dropTargetPanelId, setDropTargetPanelId] = useState<ControllerPanelId | null>(null);
  const [panelDragPreviewPosition, setPanelDragPreviewPosition] = useState<{ x: number; y: number } | null>(null);

  const [fingerprint, setFingerprint] = useState<string>('');
  const [repositoryMutationSafety, setRepositoryMutationSafety] = useState<{ isSelfRepository: boolean }>({
    isSelfRepository: false
  });
  const refreshLockRef = useRef(false);
  const panelDragPointerRef = useRef<{
    panelId: ControllerPanelId;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const draggedPanelIdRef = useRef<ControllerPanelId | null>(null);
  const dropTargetPanelIdRef = useRef<ControllerPanelId | null>(null);

  const repoPath = repository.path;
  const currentBranchName = branches?.current ?? null;
  const currentLocalBranch = useMemo(
    () => branches?.local.find((branch) => branch.name === branches?.current) ?? null,
    [branches]
  );
  const defaultBranch = useMemo(() => resolveDefaultBranch(branches) ?? null, [branches]);
  const defaultBranchName = defaultBranch?.name ?? null;
  const showBranchDiffButton = canCompareCurrentBranch(currentLocalBranch, defaultBranch);
  const branchDiffMatchesCurrentBranch = isCurrentBranchDiffDetail(branchDiffDetail, defaultBranch, currentLocalBranch);
  const branchDiffButtonLabel = getBranchDiffButtonLabel(defaultBranch?.name ?? null);
  const selfMutationBlockedReason =
    import.meta.env.DEV && repositoryMutationSafety.isSelfRepository
      ? '開発モードでアプリ自身のリポジトリに checkout / merge を行うと、dev server や tauri dev が再起動して UI が落ちるため、この操作は無効です。clone した repo かビルド済みアプリで実行してください。'
      : null;
  const panelDragHint = draggedPanelId
    ? dropTargetPanelId
      ? `${controllerPanelLabels[dropTargetPanelId]} にドロップして位置を入れ替え`
      : '別のパネルにドロップして位置を入れ替え'
    : '右上の handle をドラッグしてパネル位置を入れ替えます。';

  const updateDraggedPanelId = useCallback((value: ControllerPanelId | null): void => {
    draggedPanelIdRef.current = value;
    setDraggedPanelId(value);
  }, []);

  const updateDropTargetPanelId = useCallback((value: ControllerPanelId | null): void => {
    dropTargetPanelIdRef.current = value;
    setDropTargetPanelId(value);
  }, []);

  const clearPanelDragState = useCallback((): void => {
    panelDragPointerRef.current = null;
    updateDraggedPanelId(null);
    updateDropTargetPanelId(null);
    setPanelDragPreviewPosition(null);
  }, [updateDraggedPanelId, updateDropTargetPanelId]);

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
    if (!currentLocalBranch || !defaultBranch || currentLocalBranch.name === defaultBranch.name) {
      setBranchDiffDetail(null);
      return;
    }

    setBranchDiffDetail(null);
    setLoadingBranchDiffDetail(true);
    try {
      const detail = await api.getBranchDiffDetail(
        repoPath,
        defaultBranch.fullRef || defaultBranch.name,
        currentLocalBranch.fullRef || currentLocalBranch.name
      );
      setBranchDiffDetail(detail);
    } catch (error) {
      reportError(error, 'ブランチ差分の取得に失敗しました。');
    } finally {
      setLoadingBranchDiffDetail(false);
    }
  }, [currentLocalBranch, defaultBranch, repoPath, reportError]);

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

  useEffect(() => {
    const defaultRef = 'HEAD';
    setActiveLogRef(defaultRef);
    setActiveCompareRefs([]);
    setSelectedBranchForHover(null);
    setPendingScrollCommitSha(null);
    setCommitTitle('');
    setCommitDescription('');
    setBranchDiffDetail(null);
    setShowBranchDiff(false);
    setFocusedCommitDiffFile(null);
    setBranchAction(null);
    setBranchDeleteTarget(null);
    setInlineError(null);
    void refreshAll(defaultRef);
  }, [refreshAll, repoPath]);

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

  useEffect(() => {
    setFocusedCommitDiffFile(null);
  }, [activeCommit?.sha]);

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

  useEffect(() => {
    setCommitGraphMode(appConfig?.commitGraphMode ?? 'detailed');
  }, [appConfig?.commitGraphMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(CONTROLLER_PANEL_ORDER_STORAGE_KEY, JSON.stringify(panelOrder));
  }, [panelOrder]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.body.classList.toggle('is-controller-panel-dragging', Boolean(draggedPanelId));
    return () => {
      document.body.classList.remove('is-controller-panel-dragging');
    };
  }, [draggedPanelId]);

  useEffect(() => {
    clearPanelDragState();
  }, [clearPanelDragState, repoPath]);

  useEffect(() => {
    if (!operationBusy) {
      return;
    }

    clearPanelDragState();
  }, [clearPanelDragState, operationBusy]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent): void => {
      const dragPointer = panelDragPointerRef.current;
      if (!dragPointer || dragPointer.pointerId !== event.pointerId) {
        return;
      }

      const offsetX = event.clientX - dragPointer.startX;
      const offsetY = event.clientY - dragPointer.startY;
      const distance = Math.hypot(offsetX, offsetY);

      if (!draggedPanelIdRef.current && distance < PANEL_DRAG_THRESHOLD_PX) {
        return;
      }

      if (!draggedPanelIdRef.current) {
        updateDraggedPanelId(dragPointer.panelId);
      }

      setPanelDragPreviewPosition({
        x: event.clientX,
        y: event.clientY
      });

      const element = document.elementFromPoint(event.clientX, event.clientY);
      const targetId = element
        ?.closest<HTMLElement>('[data-controller-panel-drop-id]')
        ?.dataset.controllerPanelDropId;

      if (
        targetId &&
        isControllerPanelId(targetId) &&
        canSwapControllerPanel({
          busy: operationBusy,
          sourceId: dragPointer.panelId,
          targetId
        })
      ) {
        updateDropTargetPanelId(targetId);
        return;
      }

      updateDropTargetPanelId(null);
    };

    const handlePointerUp = (event: PointerEvent): void => {
      const dragPointer = panelDragPointerRef.current;
      if (!dragPointer || dragPointer.pointerId !== event.pointerId) {
        return;
      }

      const sourceId = dragPointer.panelId;
      const targetId = dropTargetPanelIdRef.current;
      const didDrag = draggedPanelIdRef.current === sourceId;

      if (
        didDrag &&
        targetId &&
        canSwapControllerPanel({
          busy: operationBusy,
          sourceId,
          targetId
        })
      ) {
        setPanelOrder((current) => swapControllerPanels(current, sourceId, targetId));
      }

      clearPanelDragState();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [clearPanelDragState, operationBusy, updateDraggedPanelId, updateDropTargetPanelId]);

  useEffect(() => {
    if (!focusedCommitDiffFile) {
      return;
    }

    if (!commitDetail || !commitDetail.files.some((file) => file.file === focusedCommitDiffFile)) {
      setFocusedCommitDiffFile(null);
    }
  }, [commitDetail, focusedCommitDiffFile]);

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

  const handleCheckoutBranch = async (branch: Branch): Promise<void> => {
    if (reportBlockedMutation('開発中のアプリ自身の repo は checkout できません')) {
      return;
    }

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
    if (reportBlockedMutation('開発中のアプリ自身の repo は checkout できません')) {
      return;
    }

    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        `このコミット ${commit.sha.slice(0, 7)} に checkout しますか？\n\nDetached HEAD になります。開いている作業内容によっては画面が再読み込みされたり不安定になる場合があります。`
      )
    ) {
      return;
    }

    setOperationBusy(true);

    try {
      setSelectedBranchForHover(null);
      setPendingScrollCommitSha(null);
      setShowBranchDiff(false);
      setActiveCompareRefs([]);
      setActiveLogRef('HEAD');
      await api.checkout(repoPath, commit.sha);
      setInlineError(null);
      onNotify(`${commit.sha.slice(0, 7)} にチェックアウトしました。`);
      await refreshAll('HEAD');
    } catch (error) {
      reportError(error, 'コミットチェックアウトに失敗しました。');
    } finally {
      setOperationBusy(false);
    }
  };

  const mutateAndReload = async (
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
  };

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
  const selectedCommitDetail = useMemo(
    () => (commitDetail && activeCommit && commitDetail.sha === activeCommit.sha ? commitDetail : null),
    [activeCommit, commitDetail]
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

  const handleCheckoutBranchRef = (refName: string): void => {
    const target = [...(branches?.local ?? []), ...(branches?.remote ?? [])].find((branch) => branch.name === refName);
    if (!target) {
      onNotify(`${refName} を checkout できませんでした。`);
      return;
    }

    void handleCheckoutBranch(target);
  };

  const handleBranchDrop = (sourceBranch: Branch, targetBranch: Branch): void => {
    if (operationBusy || sourceBranch.name === targetBranch.name) {
      return;
    }

    setBranchDeleteTarget(null);
    setShowBranchDiff(false);
    setFocusedCommitDiffFile(null);
    setBranchAction({
      source: sourceBranch,
      target: targetBranch,
      step: 'select-action'
    });
  };

  const handleRequestDeleteBranch = (branch: Branch): void => {
    const disabledReason = getBranchDeleteDisabledReason(branch, branches?.current ?? null, defaultBranchName);
    if (disabledReason) {
      const nextError: UiError = {
        title: 'このブランチは削除できません',
        detail: disabledReason
      };
      setInlineError(nextError);
      onNotify(nextError.title);
      return;
    }

    setBranchAction(null);
    setShowBranchDiff(false);
    setFocusedCommitDiffFile(null);
    setBranchDeleteTarget(branch);
  };

  const handleMergeBranchAction = async (): Promise<void> => {
    const currentAction = branchAction;
    if (!currentAction) {
      return;
    }

    if (reportBlockedMutation('開発中のアプリ自身の repo は merge できません')) {
      return;
    }

    setOperationBusy(true);
    let primaryError = false;

    try {
      await api.mergeBranches(repoPath, currentAction.source.name, currentAction.target.name);
      setInlineError(null);
      setBranchAction(null);
      onNotify(`${currentAction.source.name} を ${currentAction.target.name} に merge しました。`);
    } catch (error) {
      primaryError = true;
      reportError(error, 'ブランチマージに失敗しました。');
    } finally {
      try {
        await reloadAfterBranchMutation(currentAction.target.name);
      } catch (refreshError) {
        if (!primaryError) {
          reportError(refreshError, '画面の更新に失敗しました。');
        }
      } finally {
        setOperationBusy(false);
      }
    }
  };

  const handleDeleteBranch = async (): Promise<void> => {
    const currentTarget = branchDeleteTarget;
    if (!currentTarget) {
      return;
    }

    const disabledReason = getBranchDeleteDisabledReason(currentTarget, branches?.current ?? null, defaultBranchName);
    if (disabledReason) {
      const nextError: UiError = {
        title: 'このブランチは削除できません',
        detail: disabledReason
      };
      setBranchDeleteTarget(null);
      setInlineError(nextError);
      onNotify(nextError.title);
      return;
    }

    setOperationBusy(true);

    try {
      await api.deleteBranch(repoPath, currentTarget.name, currentTarget.type);
      setBranchDeleteTarget(null);
      setBranchAction(null);
      setSelectedBranchForHover(null);
      setPendingScrollCommitSha(null);
      setShowBranchDiff(false);
      setFocusedCommitDiffFile(null);
      setInlineError(null);
      onNotify(`${getBranchDeleteTargetName(currentTarget)} を削除しました。`);
      await reloadAfterBranchMutation();
    } catch (error) {
      setBranchDeleteTarget(null);
      reportError(error, 'ブランチ削除に失敗しました。');
    } finally {
      setOperationBusy(false);
    }
  };

  const handleCreatePullRequest = async (pushSourceBranch: boolean): Promise<void> => {
    const currentAction = branchAction;
    if (!currentAction) {
      return;
    }

    setOperationBusy(true);

    try {
      const response = await api.createPullRequest(
        repoPath,
        currentAction.source.name,
        currentAction.target.name,
        pushSourceBranch
      );
      setInlineError(null);
      setBranchAction(null);
      onNotify(`Pull Request を作成しました: ${response.url}`);
      await refreshAll();
    } catch (error) {
      reportError(error, 'Pull Request の作成に失敗しました。');
    } finally {
      setOperationBusy(false);
    }
  };

  const handlePreparePullRequest = async (): Promise<void> => {
    const currentAction = branchAction;
    if (!currentAction) {
      return;
    }

    setOperationBusy(true);
    let shouldCreateImmediately = false;

    try {
      const response = await api.preparePullRequest(repoPath, currentAction.source.name, currentAction.target.name);
      setInlineError(null);

      if (response.pushRequired) {
        setBranchAction((current) =>
          current &&
          current.source.name === currentAction.source.name &&
          current.target.name === currentAction.target.name
            ? { ...current, step: 'confirm-push' }
            : current
        );
        return;
      }

      shouldCreateImmediately = true;
    } catch (error) {
      reportError(error, 'Pull Request の準備に失敗しました。');
      return;
    } finally {
      setOperationBusy(false);
    }

    if (shouldCreateImmediately) {
      void handleCreatePullRequest(false);
    }
  };

  const handlePanelHandlePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    panelId: ControllerPanelId
  ): void => {
    if (event.button !== 0 || operationBusy) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    panelDragPointerRef.current = {
      panelId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY
    };
    updateDropTargetPanelId(null);
  };

  const renderPanelHandle = (panelId: ControllerPanelId): JSX.Element => (
    <button
      type="button"
      className="controller-panel-slot__handle"
      aria-label={`${controllerPanelLabels[panelId]} をドラッグして位置を入れ替え`}
      title={`${controllerPanelLabels[panelId]} をドラッグして位置を入れ替え`}
      disabled={operationBusy}
      onPointerDown={(event) => handlePanelHandlePointerDown(event, panelId)}
    >
      <GripVertical size={13} />
    </button>
  );

  const commitGraphPanel = (
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
      busy={operationBusy}
      wipStagedCount={workingStatus?.staged.length ?? 0}
      wipUnstagedCount={workingStatus?.unstaged.length ?? 0}
      onSelectWip={() => {
        setActiveCommit(null);
        setCommitDetail(null);
        setShowBranchDiff(false);
      }}
      onSelectCommit={(commit) => {
        setActiveCommit(commit);
        void loadCommitDetail(commit.sha);
      }}
      onCheckoutCommit={(commit) => {
        void handleCheckoutCommit(commit);
      }}
      onCheckoutBranchRef={handleCheckoutBranchRef}
      onLoadMore={() => {
        void loadCommits({
          append: true,
          offset: commits.length,
          ref: activeLogRef,
          compareRefs: activeCompareRefs
        });
      }}
      headerAccessory={renderPanelHandle('commitGraph')}
    />
  );

  const gitOperationPanel = (
    <GitOperationPanel
      status={workingStatus}
      stashes={stashes}
      commitTitle={commitTitle}
      commitDescription={commitDescription}
      busy={operationBusy}
      onCommitTitleChange={setCommitTitle}
      onCommitDescriptionChange={setCommitDescription}
      onStageFile={(file) => {
        void mutateAndReload(
          async () => {
            await api.stageFile(repoPath, file);
          },
          { reloadCommits: false }
        );
      }}
      onUnstageFile={(file) => {
        void mutateAndReload(
          async () => {
            await api.unstageFile(repoPath, file);
          },
          { reloadCommits: false }
        );
      }}
      onStageAll={() => {
        void mutateAndReload(
          async () => {
            const files = workingStatus?.unstaged.map((item) => item.file) ?? [];
            for (const file of files) {
              await api.stageFile(repoPath, file);
            }
          },
          { reloadCommits: false }
        );
      }}
      onUnstageAll={() => {
        void mutateAndReload(
          async () => {
            const files = workingStatus?.staged.map((item) => item.file) ?? [];
            for (const file of files) {
              await api.unstageFile(repoPath, file);
            }
          },
          { reloadCommits: false }
        );
      }}
      onStashFile={(file) => {
        void mutateAndReload(
          async () => {
            await api.stashFile(repoPath, file);
          },
          { reloadCommits: false }
        );
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
      headerAccessory={renderPanelHandle('gitOperations')}
    />
  );

  const commitDetailPanel = (
    <CommitDetailPanel
      detail={commitDetail}
      loading={loadingCommitDetail}
      activeDiffFile={focusedCommitDiffFile}
      onOpenFileDiff={(file) => {
        setFocusedCommitDiffFile(file);
      }}
      headerAccessory={renderPanelHandle('commitDetail')}
    />
  );

  const panelContentById: Record<ControllerPanelId, JSX.Element> = {
    commitGraph: commitGraphPanel,
    gitOperations: gitOperationPanel,
    commitDetail: commitDetailPanel
  };

  return (
    <section className="relative flex h-full flex-col gap-3">
      <header className="panel flex items-center justify-between px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-ink">{repository.name}</div>
          <div className="text-xs text-ink-subtle">{repository.path}</div>
        </div>

        <div className="flex items-center gap-2">
          <span className="badge">{currentBranchName ?? 'detached'}</span>
          {showBranchDiffButton ? (
            <button
              type="button"
              className={`button ${showBranchDiff ? 'button-primary' : 'button-secondary'}`}
              disabled={loadingBranchDiffDetail}
              onClick={() => {
                setFocusedCommitDiffFile(null);
                setShowBranchDiff((current) => !current);
              }}
            >
              {showBranchDiff ? 'Close Diffs' : branchDiffButtonLabel}
            </button>
          ) : null}
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

      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] gap-3 max-[1380px]:grid-cols-[250px_minmax(0,1fr)] max-[1180px]:grid-cols-1">
        <BranchTree
          branches={branches}
          selectedBranchName={branches?.current ?? null}
          defaultBranchName={defaultBranchName}
          busy={operationBusy}
          onSelectBranch={handleSelectBranch}
          onCheckoutBranch={(branch) => {
            void handleCheckoutBranch(branch);
          }}
          onBranchDrop={handleBranchDrop}
          onRequestDeleteBranch={handleRequestDeleteBranch}
        />

        <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1.35fr)_minmax(260px,1fr)_minmax(240px,0.95fr)] gap-3 max-[1180px]:grid-rows-[minmax(280px,1.2fr)_minmax(240px,1fr)_minmax(220px,0.95fr)]">
          {panelOrder.map((panelId) => {
            const isDragActive = draggedPanelId !== null;
            const isDropTarget = dropTargetPanelId === panelId;
            const isDragSource = draggedPanelId === panelId;
            const isDropCandidate =
              isDragActive &&
              canSwapControllerPanel({
                busy: operationBusy,
                sourceId: draggedPanelId,
                targetId: panelId
              });

            return (
              <div
                key={panelId}
                data-controller-panel-drop-id={panelId}
                className={`controller-panel-slot min-h-0 ${isDropCandidate ? 'is-drop-candidate' : ''} ${isDropTarget ? 'is-drop-target' : ''} ${isDragSource ? 'is-drag-source' : ''}`}
              >
                <div className="controller-panel-slot__content">{panelContentById[panelId]}</div>

                {isDropTarget && draggedPanelId ? (
                  <div className="controller-panel-drop-split">
                    <div className="controller-panel-drop-split__pane controller-panel-drop-split__pane--source">
                      <div className="controller-panel-drop-split__eyebrow">From</div>
                      <div className="controller-panel-drop-split__title">{controllerPanelLabels[draggedPanelId]}</div>
                    </div>
                    <div className="controller-panel-drop-split__flow" aria-hidden="true">
                      <span className="controller-panel-drop-split__arrow">→</span>
                    </div>
                    <div className="controller-panel-drop-split__pane controller-panel-drop-split__pane--target">
                      <div className="controller-panel-drop-split__eyebrow">Swap</div>
                      <div className="controller-panel-drop-split__title">{controllerPanelLabels[panelId]}</div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {draggedPanelId && panelDragPreviewPosition ? (
        <div
          className="controller-panel-drag-preview"
          style={{
            left: `${panelDragPreviewPosition.x + 18}px`,
            top: `${panelDragPreviewPosition.y + 18}px`
          }}
        >
          <div className="controller-panel-drag-preview__title">
            <GripVertical size={13} />
            <span>{controllerPanelLabels[draggedPanelId]}</span>
          </div>
          <div className="controller-panel-drag-preview__hint">{panelDragHint}</div>
        </div>
      ) : null}

      {selectedCommitDetail && focusedCommitDiffFile ? (
        <CommitDiffOverlay
          detail={selectedCommitDetail}
          filePath={focusedCommitDiffFile}
          onClose={() => setFocusedCommitDiffFile(null)}
        />
      ) : null}

      {showBranchDiff ? (
        <BranchDiffOverlay
          detail={branchDiffMatchesCurrentBranch ? branchDiffDetail : null}
          loading={loadingBranchDiffDetail}
          baseBranchName={defaultBranch?.name ?? null}
          targetBranchName={currentLocalBranch?.name ?? null}
          onClose={() => setShowBranchDiff(false)}
        />
      ) : null}

      {branchAction ? (
        <BranchActionDialog
          sourceBranchName={branchAction.source.name}
          targetBranchName={branchAction.target.name}
          step={branchAction.step}
          busy={operationBusy}
          mergeDisabledReason={branchAction.step === 'select-action' ? selfMutationBlockedReason : null}
          onClose={() => setBranchAction(null)}
          onMerge={() => {
            void handleMergeBranchAction();
          }}
          onPreparePullRequest={() => {
            void handlePreparePullRequest();
          }}
          onConfirmPushAndCreatePullRequest={() => {
            void handleCreatePullRequest(true);
          }}
          onBack={() => {
            setBranchAction((current) => (current ? { ...current, step: 'select-action' } : current));
          }}
        />
      ) : null}

      {branchDeleteTarget ? (
        <BranchDeleteDialog
          branchName={branchDeleteTarget.name}
          branchType={branchDeleteTarget.type}
          busy={operationBusy}
          onClose={() => setBranchDeleteTarget(null)}
          onDelete={() => {
            void handleDeleteBranch();
          }}
        />
      ) : null}
    </section>
  );
}
