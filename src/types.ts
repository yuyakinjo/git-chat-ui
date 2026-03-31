export type CommitGraphMode = 'simple' | 'detailed';
export type AiProvider = 'openAi' | 'claudeCode';

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
  isRemoteDefault?: boolean;
}

export interface BranchResponse {
  current: string;
  local: Branch[];
  remote: Branch[];
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

export type WorkingTreeDiffArea = 'staged' | 'unstaged';

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

export interface PullRequestPreparation {
  pushRequired: boolean;
}

export interface PullRequestResponse {
  url: string;
}

export interface RepositoryMutationSafety {
  isSelfRepository: boolean;
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

export interface StashEntry {
  id: string;
  relativeDate: string;
  message: string;
  files: string[];
}

export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

export interface AppConfig {
  openAiToken: string;
  openAiModel: string;
  claudeCodeToken: string;
  selectedAiProvider: AiProvider;
  commitTitlePrompt: string;
  commitGraphMode: CommitGraphMode;
  repositoryScanDepth: number;
  recentlyUsed: Array<{
    path: string;
    usedAt: string;
  }>;
  windowState?: WindowState | null;
}

export type AiGenerationConfig = Pick<
  AppConfig,
  'openAiToken' | 'openAiModel' | 'claudeCodeToken' | 'selectedAiProvider' | 'commitTitlePrompt'
>;

export interface GeneratedCommitMessage {
  title: string;
  description: string;
}

export interface TokenValidationResult {
  valid: boolean;
}

export interface OpenAiModelsResponse {
  models: string[];
}
