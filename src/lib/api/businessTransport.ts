import type {
  AiGenerationConfig,
  AppConfig,
  BranchDiffDetail,
  BranchDiffFileDetail,
  BranchPullRequestsResponse,
  BranchResponse,
  CommitAuthorAvatarResponse,
  CommitDetail,
  CommitFileDiffDetail,
  CommitResponse,
  ConflictFileDetail,
  ConflictOperationResult,
  ConflictResolutionSide,
  ConflictSummary,
  GeneratedCommitMessage,
  OpenAiModelsResponse,
  PullStatus,
  PullRequestPreparation,
  PullRequestResponse,
  Repository,
  RepositoryMutationSafety,
  StashDiffDetail,
  StashDiffFileDetail,
  StashEntry,
  TokenValidationResult,
  WorkingTreeDiffArea,
  WorkingTreeDiffDetail,
  WorkingTreeStatus,
} from "../../types";

export interface BusinessTransport {
  health(): Promise<{ ok: boolean }>;
  getRepositories(query: string): Promise<{ repositories: Repository[] }>;
  resolveRepositories(repoPaths: string[]): Promise<{ repositories: Repository[] }>;
  markRecentRepository(repoPath: string): Promise<{ ok: boolean }>;
  getRepositoryGithubUrl(repoPath: string): Promise<{ url: string | null }>;
  getRepositoryMutationSafety(repoPath: string): Promise<RepositoryMutationSafety>;
  getBranches(repoPath: string): Promise<BranchResponse>;
  getBranchPullRequests(repoPath: string): Promise<BranchPullRequestsResponse>;
  getCommits(
    repoPath: string,
    ref: string | undefined,
    offset: number,
    limit?: number,
    compareRefs?: string[],
  ): Promise<CommitResponse>;
  getCommitAuthorAvatars(
    repoPath: string,
    ref: string | undefined,
    shas: string[],
    allowRemoteFetch?: boolean,
  ): Promise<CommitAuthorAvatarResponse>;
  getCommitDetail(repoPath: string, sha: string): Promise<CommitDetail>;
  getCommitFileDiffDetail(
    repoPath: string,
    sha: string,
    file: string,
  ): Promise<CommitFileDiffDetail>;
  getBranchDiffDetail(
    repoPath: string,
    baseRef: string,
    targetRef: string,
  ): Promise<BranchDiffDetail>;
  getBranchDiffFileDetail(
    repoPath: string,
    baseRef: string,
    targetRef: string,
    file: string,
  ): Promise<BranchDiffFileDetail>;
  getWorkingTreeStatus(repoPath: string): Promise<WorkingTreeStatus>;
  getConflictSummary(repoPath: string, sessionId?: string | null): Promise<ConflictSummary>;
  getConflictFileDetail(
    repoPath: string,
    file: string,
    sessionId?: string | null,
  ): Promise<ConflictFileDetail>;
  resolveConflictVersion(
    repoPath: string,
    file: string,
    side: ConflictResolutionSide,
    sessionId?: string | null,
  ): Promise<{ ok: boolean }>;
  completeMergeSession(repoPath: string, sessionId: string): Promise<{ ok: boolean }>;
  abortMergeSession(repoPath: string, sessionId: string): Promise<{ ok: boolean }>;
  getWorkingTreeDiffDetail(
    repoPath: string,
    file: string,
    area: WorkingTreeDiffArea,
  ): Promise<WorkingTreeDiffDetail>;
  stageFile(repoPath: string, file: string): Promise<{ ok: boolean }>;
  unstageFile(repoPath: string, file: string): Promise<{ ok: boolean }>;
  discardFile(repoPath: string, file: string): Promise<{ ok: boolean }>;
  stashFile(repoPath: string, file: string): Promise<{ ok: boolean }>;
  appendFileToStash(repoPath: string, stashId: string, file: string): Promise<{ ok: boolean }>;
  getStashes(repoPath: string): Promise<{ stashes: StashEntry[] }>;
  getStashDiffDetail(repoPath: string, stashId: string): Promise<StashDiffDetail>;
  getStashDiffFileDetail(
    repoPath: string,
    stashId: string,
    file: string,
  ): Promise<StashDiffFileDetail>;
  renameStash(repoPath: string, stashId: string, message: string): Promise<{ ok: boolean }>;
  deleteStash(repoPath: string, stashId: string): Promise<{ ok: boolean }>;
  applyStash(repoPath: string, stashId: string): Promise<ConflictOperationResult>;
  popStash(repoPath: string, stashId: string): Promise<ConflictOperationResult>;
  checkout(repoPath: string, ref: string): Promise<{ ok: boolean }>;
  mergeBranches(
    repoPath: string,
    sourceBranch: string,
    targetBranch: string,
  ): Promise<ConflictOperationResult>;
  getPullStatus(repoPath: string, branchName?: string): Promise<PullStatus>;
  pull(repoPath: string, branchName?: string): Promise<{ ok: boolean }>;
  createBranch(repoPath: string, baseBranch: string, newBranch: string): Promise<{ ok: boolean }>;
  deleteBranch(
    repoPath: string,
    branchName: string,
    branchType: "local" | "remote",
    forceDelete?: boolean,
  ): Promise<{ ok: boolean }>;
  preparePullRequest(
    repoPath: string,
    sourceBranch: string,
    targetBranch: string,
  ): Promise<PullRequestPreparation>;
  createPullRequest(
    repoPath: string,
    sourceBranch: string,
    targetBranch: string,
    pushSourceBranch: boolean,
  ): Promise<PullRequestResponse>;
  commit(repoPath: string, title: string, description: string): Promise<{ ok: boolean }>;
  push(repoPath: string): Promise<{ ok: boolean }>;
  getFingerprint(repoPath: string): Promise<{ fingerprint: string }>;
  getConfig(): Promise<AppConfig>;
  saveConfig(config: Partial<AppConfig>): Promise<{ ok: boolean; config?: AppConfig }>;
  validateClaudeCodeToken(token: string): Promise<TokenValidationResult>;
  validateOpenAiToken(token: string): Promise<TokenValidationResult>;
  getOpenAiModels(token: string): Promise<OpenAiModelsResponse>;
  generateCommitMessage(
    repoPath: string,
    changedFiles: string[],
    input?: Partial<AiGenerationConfig>,
  ): Promise<GeneratedCommitMessage>;
}
