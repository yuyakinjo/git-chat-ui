import type {
  AppConfig,
  Branch,
  BranchDiffDetail,
  BranchResponse,
  CommitDetail,
  CommitGraphMode,
  CommitListItem,
  ConflictFileDetail,
  ConflictResolutionSide,
  ConflictSummary,
  PullStatus,
  StashDiffDetail,
  StashEntry,
  WorkingTreeDiffArea,
  WorkingTreeDiffDetail,
  WorkingTreeStatus,
} from "../types";
import type { UiError } from "../lib/errors";

export interface UseControllerDataParams {
  repoPath: string;
  appConfig: AppConfig | null;
  onNotify: (message: string) => void;
  onCurrentBranchChange: (repoPath: string, branchName: string | null) => void;
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
  conflictSummary: ConflictSummary | null;
  setConflictSummary: (summary: ConflictSummary | null) => void;
  showConflictViewer: boolean;
  setShowConflictViewer: (show: boolean) => void;
  focusedConflictFile: string | null;
  conflictFileDetail: ConflictFileDetail | null;
  loadingConflictFileDetail: boolean;
  focusedStash: StashEntry | null;
  stashDiffDetail: StashDiffDetail | null;
  loadingStashDiffDetail: boolean;

  workingStatus: WorkingTreeStatus | null;
  stashes: StashEntry[];
  pullStatus: PullStatus | null;

  operationBusy: boolean;
  setOperationBusy: (busy: boolean) => void;

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
  openConflictViewer: (options?: {
    file?: string | null;
    sessionId?: string | null;
    summary?: ConflictSummary | null;
  }) => Promise<void>;
  closeConflictViewer: () => void;
  resolveActiveConflict: (side: ConflictResolutionSide) => Promise<void>;
  completeActiveMergeSession: () => Promise<void>;
  abortActiveMergeSession: () => Promise<void>;
  loadStashDiffDetail: (stash: StashEntry) => Promise<void>;
  closeStashDiffOverlay: () => void;
  loadCommits: (options: {
    append: boolean;
    offset: number;
    ref: string;
    compareRefs?: string[];
    focusCommitSha?: string;
  }) => Promise<void>;
  loadWorkingState: () => Promise<void>;
  loadBranches: () => Promise<BranchResponse | null>;
  loadPullStatus: () => Promise<void>;
  refreshAll: (refOverride?: string) => Promise<void>;
  reloadAfterBranchMutation: (preferredBranchName?: string) => Promise<void>;
  mutateAndReload: (
    task: () => Promise<void>,
    options?: {
      reloadCommits?: boolean;
      onSuccess?: () => void | Promise<void>;
    },
  ) => Promise<void>;
}
