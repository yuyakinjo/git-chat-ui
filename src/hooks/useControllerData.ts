import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../lib/api";
import {
  canCompareCurrentBranch,
  getBranchDiffBaseLabel,
  getBranchDiffButtonLabel,
  isCurrentBranchDiffDetail,
  resolveBranchDiffBaseBranch,
} from "../lib/branchDiff";
import { getCommitMessageFiles } from "../lib/commitMessage";
import {
  readCommitMessageDraftFromStorage,
  writeCommitMessageDraftToStorage,
  type CommitMessageDraftInput,
} from "../lib/commitMessageDrafts";
import { isHeadDecoration, resolveCompareRefs, resolveLogRef } from "../lib/controllerViewUtils";
import { describeGitError } from "../lib/errors";
import { getSelfMutationBlockedReason } from "../lib/repositoryMutationSafety";
import type {
  BranchDiffDetail,
  BranchResponse,
  CommitDetail,
  CommitGraphMode,
  CommitListItem,
  ConflictFileDetail,
  ConflictResolutionSide,
  ConflictSummary,
  PullStatus,
  RepositoryMutationSafety,
  StashDiffDetail,
  StashEntry,
  WorkingTreeDiffArea,
  WorkingTreeDiffDetail,
  WorkingTreeStatus,
} from "../types";
import type { UiError } from "../lib/errors";

export type { UseControllerDataParams, UseControllerDataResult } from "./useControllerDataTypes";
import type { UseControllerDataParams, UseControllerDataResult } from "./useControllerDataTypes";

function readInitialCommitMessageDraft(repoPath: string): {
  title: string;
  description: string;
} {
  if (typeof window === "undefined") {
    return {
      title: "",
      description: "",
    };
  }

  try {
    const draft = readCommitMessageDraftFromStorage(window.localStorage, repoPath);
    return {
      title: draft?.title ?? "",
      description: draft?.description ?? "",
    };
  } catch {
    return {
      title: "",
      description: "",
    };
  }
}

export function useControllerData({
  repoPath,
  appConfig,
  onNotify,
  onCurrentBranchChange,
}: UseControllerDataParams): UseControllerDataResult {
  const initialCommitMessageDraft = useMemo(
    () => readInitialCommitMessageDraft(repoPath),
    [repoPath],
  );
  const [branches, setBranches] = useState<BranchResponse | null>(null);
  const [activeLogRef, setActiveLogRef] = useState<string>("HEAD");
  const [activeCompareRefs, setActiveCompareRefs] = useState<string[]>([]);

  const [commits, setCommits] = useState<CommitListItem[]>([]);
  const [commitAuthorAvatars, setCommitAuthorAvatars] = useState<Record<string, string>>({});
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
  const [workingTreeDiffDetail, setWorkingTreeDiffDetail] = useState<WorkingTreeDiffDetail | null>(
    null,
  );
  const [loadingWorkingTreeDiffDetail, setLoadingWorkingTreeDiffDetail] = useState(false);
  const [conflictSummary, setConflictSummary] = useState<ConflictSummary | null>(null);
  const [showConflictViewer, setShowConflictViewer] = useState(false);
  const [focusedConflictFile, setFocusedConflictFile] = useState<string | null>(null);
  const [conflictFileDetail, setConflictFileDetail] = useState<ConflictFileDetail | null>(null);
  const [loadingConflictFileDetail, setLoadingConflictFileDetail] = useState(false);
  const [focusedStash, setFocusedStash] = useState<StashEntry | null>(null);
  const [stashDiffDetail, setStashDiffDetail] = useState<StashDiffDetail | null>(null);
  const [loadingStashDiffDetail, setLoadingStashDiffDetail] = useState(false);

  const [workingStatus, setWorkingStatus] = useState<WorkingTreeStatus | null>(null);
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [pullStatus, setPullStatus] = useState<PullStatus | null>(null);
  const [operationBusy, setOperationBusy] = useState(false);

  const [commitTitle, setCommitTitleState] = useState(initialCommitMessageDraft.title);
  const [commitDescription, setCommitDescriptionState] = useState(
    initialCommitMessageDraft.description,
  );
  const [commitGraphMode, setCommitGraphMode] = useState<CommitGraphMode>("detailed");
  const [inlineError, setInlineError] = useState<UiError | null>(null);

  const [fingerprint, setFingerprint] = useState<string>("");
  const [repositoryMutationSafety, setRepositoryMutationSafety] =
    useState<RepositoryMutationSafety>({
      isSelfRepository: false,
    });
  const refreshLockRef = useRef(false);
  const currentRepoPathRef = useRef(repoPath);
  const commitMessageDraftRef = useRef<CommitMessageDraftInput>(initialCommitMessageDraft);
  const commitAvatarRemotePrefetchDoneRef = useRef(false);
  const workingTreeDiffRequestKeyRef = useRef<string | null>(null);
  const conflictFileRequestKeyRef = useRef<string | null>(null);
  const stashDiffRequestKeyRef = useRef<string | null>(null);

  const currentBranchName = branches?.current ?? null;
  const currentLocalBranch = useMemo(
    () => branches?.local.find((branch) => branch.name === branches?.current) ?? null,
    [branches],
  );
  const branchDiffBaseBranch = useMemo(() => resolveBranchDiffBaseBranch(branches), [branches]);
  const branchDiffBaseLabel = getBranchDiffBaseLabel(branchDiffBaseBranch);
  const showBranchDiffButton = canCompareCurrentBranch(currentLocalBranch, branchDiffBaseBranch);
  const branchDiffMatchesCurrentBranch = isCurrentBranchDiffDetail(
    branchDiffDetail,
    branchDiffBaseBranch,
    currentLocalBranch,
  );
  const branchDiffButtonLabel = getBranchDiffButtonLabel(branchDiffBaseLabel);
  const selfMutationBlockedReason = getSelfMutationBlockedReason(
    import.meta.env.DEV,
    repositoryMutationSafety,
  );

  const checkedOutCommitSha = useMemo(() => {
    if (branches?.current && branches.current !== "HEAD") {
      const currentBranch = branches.local.find((branch) => branch.name === branches.current);
      if (currentBranch?.commit) {
        return currentBranch.commit;
      }
    }

    const detachedHeadCommit = commits.find((commit) => isHeadDecoration(commit.decoration));
    return detachedHeadCommit?.sha ?? null;
  }, [branches, commits]);

  const commitMessageFiles = useMemo(() => getCommitMessageFiles(workingStatus), [workingStatus]);

  useEffect(() => {
    currentRepoPathRef.current = repoPath;
  }, [repoPath]);

  const persistCommitMessageDraft = useCallback(
    (draft: CommitMessageDraftInput): void => {
      if (typeof window === "undefined") {
        return;
      }

      try {
        writeCommitMessageDraftToStorage(window.localStorage, repoPath, draft);
      } catch {
        // Ignore storage failures and keep the in-memory draft.
      }
    },
    [repoPath],
  );

  const applyCommitMessageDraft = useCallback(
    (
      draft: CommitMessageDraftInput,
      options: {
        persist?: boolean;
      } = {},
    ): void => {
      commitMessageDraftRef.current = draft;
      setCommitTitleState(draft.title);
      setCommitDescriptionState(draft.description);

      if (options.persist === false) {
        return;
      }

      persistCommitMessageDraft(draft);
    },
    [persistCommitMessageDraft],
  );

  const setCommitTitle = useCallback(
    (title: string): void => {
      applyCommitMessageDraft({
        title,
        description: commitMessageDraftRef.current.description,
      });
    },
    [applyCommitMessageDraft],
  );

  const setCommitDescription = useCallback(
    (description: string): void => {
      applyCommitMessageDraft({
        title: commitMessageDraftRef.current.title,
        description,
      });
    },
    [applyCommitMessageDraft],
  );

  const clearCommitMessageDraft = useCallback((): void => {
    applyCommitMessageDraft({
      title: "",
      description: "",
    });
  }, [applyCommitMessageDraft]);

  const reportError = useCallback(
    (error: unknown, fallbackTitle: string): void => {
      const nextError = describeGitError(error, fallbackTitle);
      setInlineError(nextError);
      onNotify(nextError.title);
    },
    [onNotify],
  );

  const reportBlockedMutation = useCallback(
    (title: string, detail?: string): boolean => {
      if (!selfMutationBlockedReason) {
        return false;
      }

      const nextError: UiError = {
        title,
        detail: detail ?? selfMutationBlockedReason,
      };
      setInlineError(nextError);
      onNotify(title);
      return true;
    },
    [onNotify, selfMutationBlockedReason],
  );

  const loadCommitDetail = useCallback(
    async (sha: string): Promise<void> => {
      setLoadingCommitDetail(true);
      try {
        const detail = await api.getCommitDetail(repoPath, sha);
        setCommitDetail(detail);
      } catch (error) {
        reportError(error, "コミット詳細の取得に失敗しました。");
      } finally {
        setLoadingCommitDetail(false);
      }
    },
    [repoPath, reportError],
  );

  const hydrateCommitAuthorAvatars = useCallback(
    async (
      nextCommits: CommitListItem[],
      ref: string,
      options: {
        allowRemoteFetch: boolean;
      },
    ): Promise<void> => {
      const shas = nextCommits.map((commit) => commit.sha.trim()).filter(Boolean);
      if (shas.length === 0) {
        return;
      }

      try {
        const response = await api.getCommitAuthorAvatars(
          repoPath,
          ref,
          shas,
          options.allowRemoteFetch,
        );

        if (currentRepoPathRef.current !== repoPath) {
          return;
        }

        if (Object.keys(response.avatars).length === 0) {
          return;
        }

        setCommitAuthorAvatars((current) => ({
          ...current,
          ...response.avatars,
        }));
      } catch {
        // Avatar hydration is best-effort and should not block the graph.
      }
    },
    [repoPath],
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
        currentLocalBranch.fullRef || currentLocalBranch.name,
      );
      setBranchDiffDetail(detail);
    } catch (error) {
      reportError(error, "ブランチ差分の取得に失敗しました。");
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

  const clearConflictState = useCallback((): void => {
    conflictFileRequestKeyRef.current = null;
    setConflictSummary(null);
    setShowConflictViewer(false);
    setFocusedConflictFile(null);
    setConflictFileDetail(null);
    setLoadingConflictFileDetail(false);
  }, []);

  const closeConflictViewer = useCallback((): void => {
    setShowConflictViewer(false);
  }, []);

  const closeStashDiffOverlay = useCallback((): void => {
    stashDiffRequestKeyRef.current = null;
    setFocusedStash(null);
    setStashDiffDetail(null);
    setLoadingStashDiffDetail(false);
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
        reportError(error, "作業ツリー差分の取得に失敗しました。");
      } finally {
        if (workingTreeDiffRequestKeyRef.current === requestKey) {
          setLoadingWorkingTreeDiffDetail(false);
        }
      }
    },
    [repoPath, reportError],
  );

  const loadWorkingState = useCallback(async (): Promise<void> => {
    try {
      const [statusResponse, stashResponse] = await Promise.all([
        api.getWorkingTreeStatus(repoPath),
        api.getStashes(repoPath),
      ]);

      setWorkingStatus(statusResponse);
      setStashes(stashResponse.stashes);
    } catch (error) {
      reportError(error, "ワークツリー状態の取得に失敗しました。");
    }
  }, [repoPath, reportError]);

  const loadConflictFile = useCallback(
    async (file: string, summary: ConflictSummary): Promise<void> => {
      const normalizedFile = file.trim();
      if (!normalizedFile) {
        conflictFileRequestKeyRef.current = null;
        setFocusedConflictFile(null);
        setConflictFileDetail(null);
        setLoadingConflictFileDetail(false);
        return;
      }

      const requestKey = `${summary.sessionId ?? "repository"}:${normalizedFile}`;
      conflictFileRequestKeyRef.current = requestKey;
      setFocusedConflictFile(normalizedFile);
      setConflictFileDetail(null);
      setLoadingConflictFileDetail(true);

      try {
        const detail = await api.getConflictFileDetail(repoPath, normalizedFile, summary.sessionId);
        if (conflictFileRequestKeyRef.current !== requestKey) {
          return;
        }

        setConflictFileDetail(detail);
      } catch (error) {
        if (conflictFileRequestKeyRef.current !== requestKey) {
          return;
        }

        setConflictFileDetail(null);
        reportError(error, "conflict 詳細の取得に失敗しました。");
      } finally {
        if (conflictFileRequestKeyRef.current === requestKey) {
          setLoadingConflictFileDetail(false);
        }
      }
    },
    [repoPath, reportError],
  );

  const openConflictViewer = useCallback(
    async (
      options: {
        file?: string | null;
        sessionId?: string | null;
        summary?: ConflictSummary | null;
      } = {},
    ): Promise<void> => {
      const nextSummary =
        options.summary ?? (await api.getConflictSummary(repoPath, options.sessionId ?? null));
      const preferredFile =
        options.file?.trim() ||
        (focusedConflictFile &&
        nextSummary.files.some((entry) => entry.file === focusedConflictFile)
          ? focusedConflictFile
          : nextSummary.files[0]?.file) ||
        null;

      setShowBranchDiff(false);
      setFocusedCommitDiffFile(null);
      closeWorkingTreeDiffOverlay();
      closeStashDiffOverlay();
      setConflictSummary(nextSummary);
      setShowConflictViewer(true);

      if (preferredFile) {
        await loadConflictFile(preferredFile, nextSummary);
        return;
      }

      conflictFileRequestKeyRef.current = null;
      setFocusedConflictFile(null);
      setConflictFileDetail(null);
      setLoadingConflictFileDetail(false);
    },
    [
      closeStashDiffOverlay,
      closeWorkingTreeDiffOverlay,
      focusedConflictFile,
      loadConflictFile,
      repoPath,
    ],
  );

  const resolveActiveConflict = useCallback(
    async (side: ConflictResolutionSide): Promise<void> => {
      const summary = conflictSummary;
      const file = focusedConflictFile?.trim() ?? "";
      if (!summary || !file) {
        return;
      }

      setOperationBusy(true);

      try {
        await api.resolveConflictVersion(repoPath, file, side, summary.sessionId ?? null);
        await loadWorkingState();

        const nextSummary = await api.getConflictSummary(repoPath, summary.sessionId ?? null);
        setConflictSummary(nextSummary);
        setInlineError(null);

        const nextFile =
          nextSummary.files.find((entry) => entry.file === file)?.file ??
          nextSummary.files[0]?.file ??
          null;

        if (nextFile) {
          await loadConflictFile(nextFile, nextSummary);
        } else {
          conflictFileRequestKeyRef.current = null;
          setFocusedConflictFile(null);
          setConflictFileDetail(null);
          setLoadingConflictFileDetail(false);
        }
      } catch (error) {
        reportError(error, "conflict の解消に失敗しました。");
      } finally {
        setOperationBusy(false);
      }
    },
    [
      conflictSummary,
      focusedConflictFile,
      loadConflictFile,
      loadWorkingState,
      repoPath,
      reportError,
    ],
  );

  const loadStashDiffDetail = useCallback(
    async (stash: StashEntry): Promise<void> => {
      const stashId = stash.id.trim();
      if (!stashId) {
        return;
      }

      const requestKey = stashId;
      stashDiffRequestKeyRef.current = requestKey;
      setShowBranchDiff(false);
      setFocusedCommitDiffFile(null);
      closeWorkingTreeDiffOverlay();
      setFocusedStash(stash);
      setStashDiffDetail(null);
      setLoadingStashDiffDetail(true);

      try {
        const detail = await api.getStashDiffDetail(repoPath, stashId);
        if (stashDiffRequestKeyRef.current !== requestKey) {
          return;
        }

        setStashDiffDetail(detail);
      } catch (error) {
        if (stashDiffRequestKeyRef.current !== requestKey) {
          return;
        }

        setStashDiffDetail(null);
        reportError(error, "stash 差分の取得に失敗しました。");
      } finally {
        if (stashDiffRequestKeyRef.current === requestKey) {
          setLoadingStashDiffDetail(false);
        }
      }
    },
    [closeWorkingTreeDiffOverlay, repoPath, reportError],
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
        const normalizedRef = options.ref.trim() || "HEAD";
        const normalizedCompareRefs = (options.compareRefs ?? [])
          .map((ref) => ref.trim())
          .filter((ref) => ref.length > 0 && ref !== normalizedRef);
        const compareRefArgs = normalizedCompareRefs.length > 0 ? normalizedCompareRefs : undefined;
        const fetchPage = async (offset: number) =>
          api.getCommits(repoPath, normalizedRef, offset, 50, compareRefArgs);

        const initial = await fetchPage(options.offset);
        let nextCommits = initial.commits;
        let nextHasMore = initial.hasMore;

        const focusCommitSha = options.append ? "" : (options.focusCommitSha?.trim() ?? "");
        if (focusCommitSha) {
          let pageGuard = 0;
          while (
            !nextCommits.some((commit) => commit.sha === focusCommitSha) &&
            nextHasMore &&
            pageGuard < 6
          ) {
            const more = await fetchPage(options.offset + nextCommits.length);
            nextCommits = nextCommits.concat(more.commits);
            nextHasMore = more.hasMore;
            pageGuard += 1;
          }
        }

        setCommits((current) => (options.append ? [...current, ...nextCommits] : nextCommits));
        setHasMoreCommits(nextHasMore);
        if (!options.append) {
          setActiveCompareRefs(normalizedCompareRefs);
        }

        const allowRemoteFetch = !commitAvatarRemotePrefetchDoneRef.current && !options.append;
        if (allowRemoteFetch) {
          commitAvatarRemotePrefetchDoneRef.current = true;
        }
        void hydrateCommitAuthorAvatars(nextCommits, normalizedRef, {
          allowRemoteFetch,
        });

        if (!options.append && nextCommits.length > 0) {
          const focusedCommit = focusCommitSha
            ? (nextCommits.find((commit) => commit.sha === focusCommitSha) ?? null)
            : null;
          const nextActiveCommit = focusedCommit ?? nextCommits[0];

          setIsWipSelected(false);
          setActiveCommit(nextActiveCommit);
          await loadCommitDetail(nextActiveCommit.sha);
        }
      } catch (error) {
        reportError(error, "コミット一覧の取得に失敗しました。");
      } finally {
        setLoadingCommits(false);
        setLoadingMoreCommits(false);
      }
    },
    [hydrateCommitAuthorAvatars, loadCommitDetail, repoPath, reportError],
  );

  const loadBranches = useCallback(async (): Promise<BranchResponse | null> => {
    try {
      const response = await api.getBranches(repoPath);
      setBranches(response);
      return response;
    } catch (error) {
      reportError(error, "ブランチ情報の取得に失敗しました。");
      return null;
    }
  }, [repoPath, reportError]);

  const loadPullStatus = useCallback(async (): Promise<void> => {
    try {
      const response = await api.getPullStatus(repoPath);
      setPullStatus(response);
    } catch (error) {
      setPullStatus(null);
      reportError(error, "pull 状態の取得に失敗しました。");
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
        const [nextBranches] = await Promise.all([
          loadBranches(),
          loadWorkingState(),
          loadPullStatus(),
        ]);
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
    [activeLogRef, branches, loadBranches, loadCommits, loadPullStatus, loadWorkingState, repoPath],
  );

  const reloadAfterBranchMutation = useCallback(
    async (preferredBranchName?: string): Promise<void> => {
      const [nextBranches] = await Promise.all([
        loadBranches(),
        loadWorkingState(),
        loadPullStatus(),
      ]);
      const branchContext = nextBranches ?? branches;
      const preferredBranch = preferredBranchName
        ? (branchContext?.local.find((branch) => branch.name === preferredBranchName) ?? null)
        : null;
      const currentBranch =
        branchContext?.local.find((branch) => branch.name === branchContext.current) ?? null;
      const resolvedBranch = preferredBranch ?? currentBranch;
      const resolvedRef =
        resolvedBranch?.fullRef ||
        resolvedBranch?.name ||
        resolveLogRef(activeLogRef, branchContext);
      const compareRefs = resolveCompareRefs(resolvedRef, branchContext);

      setActiveLogRef(resolvedRef);
      await loadCommits({ append: false, offset: 0, ref: resolvedRef, compareRefs });

      const fingerprintResponse = await api.getFingerprint(repoPath);
      setFingerprint(fingerprintResponse.fingerprint);
    },
    [activeLogRef, branches, loadBranches, loadCommits, loadPullStatus, loadWorkingState, repoPath],
  );

  const completeActiveMergeSession = useCallback(async (): Promise<void> => {
    const summary = conflictSummary;
    const sessionId = summary?.sessionId?.trim() ?? "";
    if (!summary || !sessionId) {
      return;
    }

    setOperationBusy(true);

    try {
      await api.completeMergeSession(repoPath, sessionId);
      clearConflictState();
      setInlineError(null);
      onNotify(
        `${summary.sourceBranch ?? "source"} を ${summary.targetBranch ?? "target"} に merge しました。`,
      );
      await reloadAfterBranchMutation(summary.targetBranch);
    } catch (error) {
      reportError(error, "merge session の完了に失敗しました。");
    } finally {
      setOperationBusy(false);
    }
  }, [
    clearConflictState,
    conflictSummary,
    onNotify,
    reloadAfterBranchMutation,
    repoPath,
    reportError,
  ]);

  const abortActiveMergeSession = useCallback(async (): Promise<void> => {
    const summary = conflictSummary;
    const sessionId = summary?.sessionId?.trim() ?? "";
    if (!summary || !sessionId) {
      return;
    }

    setOperationBusy(true);

    try {
      await api.abortMergeSession(repoPath, sessionId);
      clearConflictState();
      setInlineError(null);
      onNotify("merge session を破棄しました。");
      await reloadAfterBranchMutation();
    } catch (error) {
      reportError(error, "merge session の破棄に失敗しました。");
    } finally {
      setOperationBusy(false);
    }
  }, [
    clearConflictState,
    conflictSummary,
    onNotify,
    reloadAfterBranchMutation,
    repoPath,
    reportError,
  ]);

  const mutateAndReload = useCallback(
    async (
      task: () => Promise<void>,
      options: {
        reloadCommits?: boolean;
        onSuccess?: () => void | Promise<void>;
      } = {},
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
            loadPullStatus(),
            loadCommits({ append: false, offset: 0, ref: resolvedRef, compareRefs }),
          ]);
        } else {
          await Promise.all([loadWorkingState(), loadPullStatus()]);
        }

        const fingerprintResponse = await api.getFingerprint(repoPath);
        setFingerprint(fingerprintResponse.fingerprint);
        await options.onSuccess?.();
      } catch (error) {
        reportError(error, "Git 操作に失敗しました。");
      } finally {
        setOperationBusy(false);
      }
    },
    [activeLogRef, branches, loadCommits, loadPullStatus, loadWorkingState, repoPath, reportError],
  );

  // Notify parent when current branch changes
  useEffect(() => {
    onCurrentBranchChange(repoPath, currentBranchName);
  }, [currentBranchName, onCurrentBranchChange, repoPath]);

  // Init/reset on repo change
  /* oxlint-disable react-hooks/exhaustive-deps -- depend on draft field values, not the object reference */
  useEffect(() => {
    const defaultRef = "HEAD";
    setActiveLogRef(defaultRef);
    setActiveCompareRefs([]);
    setActiveCommit(null);
    setIsWipSelected(false);
    setCommitAuthorAvatars({});
    setCommitDetail(null);
    applyCommitMessageDraft(initialCommitMessageDraft, { persist: false });
    setBranchDiffDetail(null);
    setShowBranchDiff(false);
    setFocusedCommitDiffFile(null);
    clearConflictState();
    closeWorkingTreeDiffOverlay();
    closeStashDiffOverlay();
    setPullStatus(null);
    setInlineError(null);
    commitAvatarRemotePrefetchDoneRef.current = false;
    void refreshAll(defaultRef);
  }, [
    clearConflictState,
    closeStashDiffOverlay,
    closeWorkingTreeDiffOverlay,
    applyCommitMessageDraft,
    initialCommitMessageDraft.description,
    initialCommitMessageDraft.title,
    refreshAll,
    repoPath,
  ]);
  /* oxlint-enable react-hooks/exhaustive-deps */

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

    const changedFileCount =
      (workingStatus?.staged.length ?? 0) +
      (workingStatus?.unstaged.length ?? 0) +
      (workingStatus?.conflicted.length ?? 0);
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
      focusedWorkingTreeDiff.area === "staged"
        ? (workingStatus?.staged ?? [])
        : (workingStatus?.unstaged ?? []);

    if (!visibleFiles.some((item) => item.file === focusedWorkingTreeDiff.file)) {
      closeWorkingTreeDiffOverlay();
    }
  }, [closeWorkingTreeDiffOverlay, focusedWorkingTreeDiff, workingStatus]);

  useEffect(() => {
    if (!conflictSummary || conflictSummary.contextType === "mergeSession" || showConflictViewer) {
      return;
    }

    if ((workingStatus?.conflicted.length ?? 0) === 0) {
      clearConflictState();
    }
  }, [clearConflictState, conflictSummary, showConflictViewer, workingStatus]);

  useEffect(() => {
    if (!focusedStash) {
      return;
    }

    const nextStash = stashes.find((stash) => stash.id === focusedStash.id) ?? null;
    if (!nextStash) {
      closeStashDiffOverlay();
      return;
    }

    if (nextStash !== focusedStash) {
      setFocusedStash(nextStash);
    }
  }, [closeStashDiffOverlay, focusedStash, stashes]);

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
    setCommitGraphMode(appConfig?.commitGraphMode ?? "detailed");
  }, [appConfig?.commitGraphMode]);

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
    commitAuthorAvatars,
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
    conflictSummary,
    setConflictSummary,
    showConflictViewer,
    setShowConflictViewer,
    focusedConflictFile,
    conflictFileDetail,
    loadingConflictFileDetail,
    focusedStash,
    stashDiffDetail,
    loadingStashDiffDetail,

    workingStatus,
    stashes,

    operationBusy,
    setOperationBusy,

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
    pullStatus,

    reportError,
    reportBlockedMutation,
    loadCommitDetail,
    loadBranchDiffDetail,
    loadWorkingTreeDiffDetail,
    closeWorkingTreeDiffOverlay,
    openConflictViewer,
    closeConflictViewer,
    resolveActiveConflict,
    completeActiveMergeSession,
    abortActiveMergeSession,
    loadStashDiffDetail,
    closeStashDiffOverlay,
    loadCommits,
    loadWorkingState,
    loadBranches,
    loadPullStatus,
    refreshAll,
    reloadAfterBranchMutation,
    mutateAndReload,
  };
}
