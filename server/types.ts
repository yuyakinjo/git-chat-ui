export type { AiProvider, OpenAiReasoningEffort } from "../shared/ai.js";
export type {
  AppConfig,
  CommitGraphStyle,
  CommitMergeAnimation,
  DiffViewerMode,
  WindowState,
} from "../shared/config.js";
export type {
  RepositoryAssistantAction,
  RepositoryAssistantActionExecutionResponse,
  RepositoryAssistantActionId,
  RepositoryAssistantActionProposal,
  RepositoryAssistantActionResult,
  RepositoryAssistantActionResultStatus,
  RepositoryAssistantActionRisk,
  RepositoryAssistantActionSpec,
  RepositoryAssistantActionStatus,
  RepositoryAssistantMessage,
  RepositoryAssistantMessageRole,
  RepositoryAssistantPolicies,
  RepositoryAssistantPolicy,
  RepositoryAssistantResponse,
  RepositoryAssistantSettings,
} from "../shared/repositoryAssistant.js";

export interface Repository {
  name: string;
  path: string;
  recentlyUsedAt?: string;
}

export interface Branch {
  name: string;
  fullRef: string;
  type: "local" | "remote";
  commit: string;
  isRemoteDefault?: boolean;
}

export interface BranchPullRequest {
  url: string;
  hasConflicts: boolean;
}

export interface BranchPullRequestsResponse {
  pullRequests: Record<string, BranchPullRequest>;
}

export interface CommitListItem {
  sha: string;
  parentShas: string[];
  author: string;
  date: string;
  subject: string;
  decoration: string;
}

export interface CommitResponse {
  commits: CommitListItem[];
  hasMore: boolean;
}

export interface CommitAuthorAvatarResponse {
  avatars: Record<string, string>;
}

export interface RepositoryAssistantUserProfile {
  login: string | null;
  avatarUrl: string | null;
}

export type DiffFileKind = "modified" | "added" | "deleted" | "renamed" | "changed";

export interface DiffFileStat {
  file: string;
  additions: number;
  deletions: number;
  kind?: DiffFileKind;
}

export interface CommitDetail {
  sha: string;
  parentShas: string[];
  author: string;
  email: string;
  date: string;
  body: string;
  files: DiffFileStat[];
  diff: string;
}

export interface CommitFileDiffDetail {
  sha: string;
  file: string;
  diff: string;
  isDiffTruncated: boolean;
}

export interface BranchDiffDetail {
  baseRef: string;
  targetRef: string;
  mergeBaseSha: string;
  files: DiffFileStat[];
  diff: string;
  isDiffTruncated: boolean;
}

export interface BranchDiffFileDetail {
  baseRef: string;
  targetRef: string;
  file: string;
  diff: string;
  isDiffTruncated: boolean;
}

export interface PullRequestPreparation {
  pushRequired: boolean;
}

export interface PullRequestResponse {
  url: string;
}

export type PullStatusState =
  | "detached"
  | "noUpstream"
  | "upToDate"
  | "behind"
  | "ahead"
  | "diverged";

export interface PullStatus {
  branchName: string | null;
  upstreamName: string | null;
  remoteName: string | null;
  remoteBranchName: string | null;
  aheadCount: number;
  behindCount: number;
  canPull: boolean;
  state: PullStatusState;
}

export type ConflictContextType = "repository" | "mergeSession";
export type ConflictOperation = "merge" | "pull" | "stashApply" | "stashPop" | "unknown";
export type ConflictResolutionSide = "merged" | "ours" | "theirs";

export interface WorkingFile {
  file: string;
  x: string;
  y: string;
  statusLabel: string;
}

export interface WorkingTreeStatus {
  conflicted: WorkingFile[];
  staged: WorkingFile[];
  unstaged: WorkingFile[];
}

export interface ConflictSummary {
  contextType: ConflictContextType;
  operation: ConflictOperation;
  sessionId?: string;
  sourceBranch?: string;
  targetBranch?: string;
  files: WorkingFile[];
}

export interface ConflictFileVersion {
  isBinary: boolean;
  content: string | null;
}

export interface ConflictFileDetail {
  file: string;
  x: string;
  y: string;
  statusLabel: string;
  merged: ConflictFileVersion;
  base: ConflictFileVersion;
  ours: ConflictFileVersion;
  theirs: ConflictFileVersion;
}

export type ConflictOperationResult =
  | { ok: true }
  | {
      ok: false;
      conflict: ConflictSummary;
    };

export type WorkingTreeDiffArea = "staged" | "unstaged";

export interface WorkingTreeDiffDetail {
  file: string;
  area: WorkingTreeDiffArea;
  files: DiffFileStat[];
  diff: string;
  isDiffTruncated: boolean;
}

export interface StashDiffDetail {
  stashId: string;
  files: DiffFileStat[];
  diff: string;
  isDiffTruncated: boolean;
}

export interface StashDiffFileDetail {
  stashId: string;
  file: string;
  diff: string;
  isDiffTruncated: boolean;
}

export interface StashEntry {
  id: string;
  sha: string;
  parentSha: string;
  date: string;
  message: string;
  files: string[];
}

export interface ControllerSnapshot {
  fingerprint: string;
  branches: {
    current: string;
    local: Branch[];
    remote: Branch[];
  };
  logRef: string;
  compareRefs: string[];
  commits: CommitResponse | null;
  workingTreeStatus: WorkingTreeStatus;
  stashes: StashEntry[];
  pullStatus: PullStatus;
}
