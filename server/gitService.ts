// Barrel file — re-exports all git operations from domain modules.

export { ensureRepoPath, runGit } from "./git/command.js";
export {
  getCurrentBranch,
  getBranches,
  checkoutRef,
  createBranch,
  deleteBranch,
  getPullStatus,
  mergeBranches,
  pullCurrentBranch,
} from "./git/branch.js";
export {
  abortMergeSession,
  completeMergeSession,
  getConflictFileDetail,
  getConflictSummary,
  resolveConflictVersion,
} from "./git/conflict.js";
export {
  getCommits,
  getCommitDetail,
  getCommitFileDiffDetail,
  commitChanges,
  pushChanges,
} from "./git/commit.js";
export { getControllerSnapshot } from "./git/controllerSnapshot.js";
export { getCommitAuthorAvatars } from "./git/commitAvatars.js";
export {
  getBranchDiffDetail,
  getBranchDiffFileDetail,
  getWorkingTreeDiffDetail,
  getDiffSnippet,
} from "./git/diff.js";
export {
  normalizeGithubRemoteUrl,
  getOpenPullRequests,
  preparePullRequest,
  createPullRequest,
} from "./git/pullRequest.js";
export {
  discoverRepositories,
  resolveRepositories,
  getRepositoryGithubUrl,
  getRepositoryFingerprint,
} from "./git/repository.js";
export {
  getStashes,
  getStashDiffDetail,
  getStashDiffFileDetail,
  appendFileToStash,
  renameStash,
  deleteStash,
  applyStash,
  popStash,
} from "./git/stash.js";
export {
  getWorkingTreeStatus,
  stageFile,
  unstageFile,
  discardFile,
  stashFile,
  stashAllChanges,
} from "./git/workingTree.js";
