export type { AiProvider } from "../shared/ai.js";
export type { AppConfig, CommitGraphMode, WindowState } from "../shared/config.js";

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

export interface CommitListItem {
  sha: string;
  parentShas: string[];
  author: string;
  date: string;
  subject: string;
  decoration: string;
}

export interface CommitDetail {
  sha: string;
  parentShas: string[];
  author: string;
  email: string;
  date: string;
  body: string;
  files: Array<{
    file: string;
    additions: number;
    deletions: number;
  }>;
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
  files: Array<{
    file: string;
    additions: number;
    deletions: number;
  }>;
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

export interface WorkingFile {
  file: string;
  x: string;
  y: string;
  statusLabel: string;
}

export interface WorkingTreeStatus {
  staged: WorkingFile[];
  unstaged: WorkingFile[];
}


export type WorkingTreeDiffArea = "staged" | "unstaged";

export interface WorkingTreeDiffDetail {
  file: string;
  area: WorkingTreeDiffArea;
  files: Array<{
    file: string;
    additions: number;
    deletions: number;
  }>;
  diff: string;
  isDiffTruncated: boolean;
}

export interface StashDiffDetail {
  stashId: string;
  files: Array<{
    file: string;
    additions: number;
    deletions: number;
  }>;
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
  relativeDate: string;
  message: string;
  files: string[];
}
