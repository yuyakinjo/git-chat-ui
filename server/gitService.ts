// Barrel file — re-exports all git operations from domain modules.

export { ensureRepoPath, runGit } from './git/command.js';
export { getCurrentBranch, getBranches, checkoutRef, createBranch, deleteBranch, mergeBranches } from './git/branch.js';
export { getCommits, getCommitDetail, commitChanges, pushChanges } from './git/commit.js';
export { getBranchDiffDetail, getWorkingTreeDiffDetail, getDiffSnippet } from './git/diff.js';
export { normalizeGithubRemoteUrl, preparePullRequest, createPullRequest } from './git/pullRequest.js';
export { discoverRepositories, resolveRepositories, getRepositoryGithubUrl, getRepositoryFingerprint } from './git/repository.js';
export { getStashes, getStashDiffDetail, renameStash, applyStash, popStash } from './git/stash.js';
export { getWorkingTreeStatus, stageFile, unstageFile, stashFile } from './git/workingTree.js';
