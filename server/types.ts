export type CommitGraphMode = 'simple' | 'detailed';

export interface Repository {
  name: string;
  path: string;
  recentlyUsedAt?: string;
}

export interface Branch {
  name: string;
  fullRef: string;
  type: 'local' | 'remote';
  commit: string;
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

export interface AppConfig {
  openAiToken: string;
  claudeCodeToken: string;
  commitGraphMode: CommitGraphMode;
  repositoryScanDepth: number;
  recentlyUsed: Array<{
    path: string;
    usedAt: string;
  }>;
}

export interface StashEntry {
  id: string;
  relativeDate: string;
  message: string;
  files: string[];
}
