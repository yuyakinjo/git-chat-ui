import type { NativeWindowAppearance } from "./appTheme";
import type {
  AiGenerationConfig,
  AppConfig,
  BranchDiffDetail,
  BranchDiffFileDetail,
  BranchResponse,
  CommitDetail,
  CommitFileDiffDetail,
  CommitResponse,
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
} from "../types";
import { type BusinessTransport } from "./api/businessTransport";
import { createHttpBusinessTransport } from "./api/httpBusinessTransport";
import { createTauriBusinessTransport } from "./api/tauriBusinessTransport";
import { getPlatformShell } from "./platformShell";
import { isTauriRuntime } from "./tauriRuntime";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4141/api";

const httpBusinessTransport = createHttpBusinessTransport(API_BASE_URL);
const tauriBusinessTransport = createTauriBusinessTransport();

function getBusinessTransport(): BusinessTransport {
  return isTauriRuntime() ? tauriBusinessTransport : httpBusinessTransport;
}

export const api = {
  health(): Promise<{ ok: boolean }> {
    return getBusinessTransport().health();
  },

  getRepositories(query: string): Promise<{ repositories: Repository[] }> {
    return getBusinessTransport().getRepositories(query);
  },

  resolveRepositories(repoPaths: string[]): Promise<{ repositories: Repository[] }> {
    return getBusinessTransport().resolveRepositories(repoPaths);
  },

  markRecentRepository(repoPath: string): Promise<{ ok: boolean }> {
    return getBusinessTransport().markRecentRepository(repoPath);
  },

  getRepositoryGithubUrl(repoPath: string): Promise<{ url: string | null }> {
    return getBusinessTransport().getRepositoryGithubUrl(repoPath);
  },

  getRepositoryMutationSafety(repoPath: string): Promise<RepositoryMutationSafety> {
    return getBusinessTransport().getRepositoryMutationSafety(repoPath);
  },

  async openExternalUrl(url: string): Promise<void> {
    await getPlatformShell().openExternalUrl(url);
  },

  async syncWindowAppearance(appearance: NativeWindowAppearance): Promise<void> {
    await getPlatformShell().syncWindowAppearance(appearance);
  },

  getBranches(repoPath: string): Promise<BranchResponse> {
    return getBusinessTransport().getBranches(repoPath);
  },

  getCommits(
    repoPath: string,
    ref: string | undefined,
    offset: number,
    limit = 50,
    compareRefs?: string[],
  ): Promise<CommitResponse> {
    return getBusinessTransport().getCommits(repoPath, ref, offset, limit, compareRefs);
  },

  getCommitDetail(repoPath: string, sha: string): Promise<CommitDetail> {
    return getBusinessTransport().getCommitDetail(repoPath, sha);
  },

  getCommitFileDiffDetail(
    repoPath: string,
    sha: string,
    file: string,
  ): Promise<CommitFileDiffDetail> {
    return getBusinessTransport().getCommitFileDiffDetail(repoPath, sha, file);
  },

  getBranchDiffDetail(
    repoPath: string,
    baseRef: string,
    targetRef: string,
  ): Promise<BranchDiffDetail> {
    return getBusinessTransport().getBranchDiffDetail(repoPath, baseRef, targetRef);
  },

  getBranchDiffFileDetail(
    repoPath: string,
    baseRef: string,
    targetRef: string,
    file: string,
  ): Promise<BranchDiffFileDetail> {
    return getBusinessTransport().getBranchDiffFileDetail(repoPath, baseRef, targetRef, file);
  },

  getWorkingTreeStatus(repoPath: string): Promise<WorkingTreeStatus> {
    return getBusinessTransport().getWorkingTreeStatus(repoPath);
  },

  getWorkingTreeDiffDetail(
    repoPath: string,
    file: string,
    area: WorkingTreeDiffArea,
  ): Promise<WorkingTreeDiffDetail> {
    return getBusinessTransport().getWorkingTreeDiffDetail(repoPath, file, area);
  },

  stageFile(repoPath: string, file: string): Promise<{ ok: boolean }> {
    return getBusinessTransport().stageFile(repoPath, file);
  },

  unstageFile(repoPath: string, file: string): Promise<{ ok: boolean }> {
    return getBusinessTransport().unstageFile(repoPath, file);
  },

  discardFile(repoPath: string, file: string): Promise<{ ok: boolean }> {
    return getBusinessTransport().discardFile(repoPath, file);
  },

  stashFile(repoPath: string, file: string): Promise<{ ok: boolean }> {
    return getBusinessTransport().stashFile(repoPath, file);
  },

  appendFileToStash(repoPath: string, stashId: string, file: string): Promise<{ ok: boolean }> {
    return getBusinessTransport().appendFileToStash(repoPath, stashId, file);
  },

  getStashes(repoPath: string): Promise<{ stashes: StashEntry[] }> {
    return getBusinessTransport().getStashes(repoPath);
  },

  getStashDiffDetail(repoPath: string, stashId: string): Promise<StashDiffDetail> {
    return getBusinessTransport().getStashDiffDetail(repoPath, stashId);
  },

  getStashDiffFileDetail(
    repoPath: string,
    stashId: string,
    file: string,
  ): Promise<StashDiffFileDetail> {
    return getBusinessTransport().getStashDiffFileDetail(repoPath, stashId, file);
  },

  renameStash(repoPath: string, stashId: string, message: string): Promise<{ ok: boolean }> {
    return getBusinessTransport().renameStash(repoPath, stashId, message);
  },

  applyStash(repoPath: string, stashId: string): Promise<{ ok: boolean }> {
    return getBusinessTransport().applyStash(repoPath, stashId);
  },

  popStash(repoPath: string, stashId: string): Promise<{ ok: boolean }> {
    return getBusinessTransport().popStash(repoPath, stashId);
  },

  checkout(repoPath: string, ref: string): Promise<{ ok: boolean }> {
    return getBusinessTransport().checkout(repoPath, ref);
  },

  mergeBranches(
    repoPath: string,
    sourceBranch: string,
    targetBranch: string,
  ): Promise<{ ok: boolean }> {
    return getBusinessTransport().mergeBranches(repoPath, sourceBranch, targetBranch);
  },

  getPullStatus(repoPath: string): Promise<PullStatus> {
    return getBusinessTransport().getPullStatus(repoPath);
  },

  pull(repoPath: string): Promise<{ ok: boolean }> {
    return getBusinessTransport().pull(repoPath);
  },

  createBranch(repoPath: string, baseBranch: string, newBranch: string): Promise<{ ok: boolean }> {
    return getBusinessTransport().createBranch(repoPath, baseBranch, newBranch);
  },

  deleteBranch(
    repoPath: string,
    branchName: string,
    branchType: "local" | "remote",
    forceDelete = false,
  ): Promise<{ ok: boolean }> {
    return getBusinessTransport().deleteBranch(repoPath, branchName, branchType, forceDelete);
  },

  preparePullRequest(
    repoPath: string,
    sourceBranch: string,
    targetBranch: string,
  ): Promise<PullRequestPreparation> {
    return getBusinessTransport().preparePullRequest(repoPath, sourceBranch, targetBranch);
  },

  createPullRequest(
    repoPath: string,
    sourceBranch: string,
    targetBranch: string,
    pushSourceBranch: boolean,
  ): Promise<PullRequestResponse> {
    return getBusinessTransport().createPullRequest(
      repoPath,
      sourceBranch,
      targetBranch,
      pushSourceBranch,
    );
  },

  commit(repoPath: string, title: string, description: string): Promise<{ ok: boolean }> {
    return getBusinessTransport().commit(repoPath, title, description);
  },

  push(repoPath: string): Promise<{ ok: boolean }> {
    return getBusinessTransport().push(repoPath);
  },

  getFingerprint(repoPath: string): Promise<{ fingerprint: string }> {
    return getBusinessTransport().getFingerprint(repoPath);
  },

  getConfig(): Promise<AppConfig> {
    return getBusinessTransport().getConfig();
  },

  saveConfig(config: Partial<AppConfig>): Promise<{ ok: boolean; config?: AppConfig }> {
    return getBusinessTransport().saveConfig(config);
  },

  validateClaudeCodeToken(token: string): Promise<TokenValidationResult> {
    return getBusinessTransport().validateClaudeCodeToken(token);
  },

  validateOpenAiToken(token: string): Promise<TokenValidationResult> {
    return getBusinessTransport().validateOpenAiToken(token);
  },

  getOpenAiModels(token: string): Promise<OpenAiModelsResponse> {
    return getBusinessTransport().getOpenAiModels(token);
  },

  generateCommitMessage(
    repoPath: string,
    changedFiles: string[],
    input?: Partial<AiGenerationConfig>,
  ): Promise<GeneratedCommitMessage> {
    return getBusinessTransport().generateCommitMessage(repoPath, changedFiles, input);
  },
};
