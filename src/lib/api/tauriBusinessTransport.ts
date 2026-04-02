import type { BusinessTransport } from "./businessTransport";
import { invokeCommand } from "../tauriRuntime";

export function createTauriBusinessTransport(): BusinessTransport {
  return {
    health() {
      return invokeCommand("health");
    },

    getRepositories(query) {
      const normalized = query.trim();
      return invokeCommand("get_repositories", {
        query: normalized.length > 0 ? normalized : null,
      });
    },

    resolveRepositories(repoPaths) {
      return invokeCommand("resolve_repositories", { repoPaths });
    },

    markRecentRepository(repoPath) {
      return invokeCommand("mark_recent_repository", { repoPath });
    },

    getRepositoryGithubUrl(repoPath) {
      return invokeCommand("get_repository_github_url", { repoPath });
    },

    getRepositoryMutationSafety(repoPath) {
      return invokeCommand("get_repository_mutation_safety", { repoPath });
    },

    getBranches(repoPath) {
      return invokeCommand("get_branches", { repoPath });
    },

    getBranchPullRequests(repoPath) {
      return invokeCommand("get_branch_pull_requests", { repoPath });
    },

    getCommits(repoPath, ref, offset, limit = 50, compareRefs) {
      const normalizedCompareRefs =
        compareRefs?.map((value) => value.trim()).filter((value) => value.length > 0) ?? [];

      return invokeCommand("get_commits", {
        repoPath,
        refName: ref && ref.trim() ? ref : null,
        compareRefs: normalizedCompareRefs.length > 0 ? normalizedCompareRefs : null,
        offset,
        limit,
      });
    },

    getCommitAuthorAvatars(repoPath, ref, shas, allowRemoteFetch = false) {
      return invokeCommand("get_commit_author_avatars", {
        repoPath,
        refName: ref?.trim() ? ref.trim() : null,
        shas,
        allowRemoteFetch,
      });
    },

    getCommitDetail(repoPath, sha) {
      return invokeCommand("get_commit_detail", { repoPath, sha });
    },

    getCommitFileDiffDetail(repoPath, sha, file) {
      return invokeCommand("get_commit_file_diff_detail", { repoPath, sha, file });
    },

    getBranchDiffDetail(repoPath, baseRef, targetRef) {
      return invokeCommand("get_branch_diff_detail", { repoPath, baseRef, targetRef });
    },

    getBranchDiffFileDetail(repoPath, baseRef, targetRef, file) {
      return invokeCommand("get_branch_diff_file_detail", { repoPath, baseRef, targetRef, file });
    },

    getWorkingTreeStatus(repoPath) {
      return invokeCommand("get_working_tree_status", { repoPath });
    },

    getConflictSummary(repoPath, sessionId) {
      return invokeCommand("get_conflict_summary", {
        repoPath,
        sessionId: sessionId?.trim() ? sessionId.trim() : null,
      });
    },

    getConflictFileDetail(repoPath, file, sessionId) {
      return invokeCommand("get_conflict_file_detail", {
        repoPath,
        file,
        sessionId: sessionId?.trim() ? sessionId.trim() : null,
      });
    },

    resolveConflictVersion(repoPath, file, side, sessionId) {
      return invokeCommand("resolve_conflict_version", {
        repoPath,
        file,
        side,
        sessionId: sessionId?.trim() ? sessionId.trim() : null,
      });
    },

    completeMergeSession(repoPath, sessionId) {
      return invokeCommand("complete_merge_session", { repoPath, sessionId });
    },

    abortMergeSession(repoPath, sessionId) {
      return invokeCommand("abort_merge_session", { repoPath, sessionId });
    },

    getWorkingTreeDiffDetail(repoPath, file, area) {
      return invokeCommand("get_working_tree_diff_detail", { repoPath, file, area });
    },

    stageFile(repoPath, file) {
      return invokeCommand("stage_file", { repoPath, file });
    },

    unstageFile(repoPath, file) {
      return invokeCommand("unstage_file", { repoPath, file });
    },

    discardFile(repoPath, file) {
      return invokeCommand("discard_file", { repoPath, file });
    },

    stashFile(repoPath, file) {
      return invokeCommand("stash_file", { repoPath, file });
    },

    appendFileToStash(repoPath, stashId, file) {
      return invokeCommand("append_file_to_stash", { repoPath, stashId, file });
    },

    getStashes(repoPath) {
      return invokeCommand("get_stashes", { repoPath });
    },

    getStashDiffDetail(repoPath, stashId) {
      return invokeCommand("get_stash_diff_detail", { repoPath, stashId });
    },

    getStashDiffFileDetail(repoPath, stashId, file) {
      return invokeCommand("get_stash_diff_file_detail", { repoPath, stashId, file });
    },

    renameStash(repoPath, stashId, message) {
      return invokeCommand("rename_stash", { repoPath, stashId, message });
    },

    deleteStash(repoPath, stashId) {
      return invokeCommand("delete_stash", { repoPath, stashId });
    },

    applyStash(repoPath, stashId) {
      return invokeCommand("apply_stash", { repoPath, stashId });
    },

    popStash(repoPath, stashId) {
      return invokeCommand("pop_stash", { repoPath, stashId });
    },

    checkout(repoPath, ref) {
      return invokeCommand("checkout", { repoPath, reference: ref });
    },

    mergeBranches(repoPath, sourceBranch, targetBranch) {
      return invokeCommand("merge_branches", { repoPath, sourceBranch, targetBranch });
    },

    getPullStatus(repoPath, branchName) {
      return invokeCommand("get_pull_status", {
        repoPath,
        branchName: branchName?.trim() ? branchName.trim() : null,
      });
    },

    pull(repoPath, branchName) {
      return invokeCommand("pull_current_branch", {
        repoPath,
        branchName: branchName?.trim() ? branchName.trim() : null,
      });
    },

    createBranch(repoPath, baseBranch, newBranch) {
      return invokeCommand("create_branch", { repoPath, baseBranch, newBranch });
    },

    deleteBranch(repoPath, branchName, branchType, forceDelete = false) {
      return invokeCommand("delete_branch", { repoPath, branchName, branchType, forceDelete });
    },

    preparePullRequest(repoPath, sourceBranch, targetBranch) {
      return invokeCommand("prepare_pull_request", { repoPath, sourceBranch, targetBranch });
    },

    createPullRequest(repoPath, sourceBranch, targetBranch, pushSourceBranch) {
      return invokeCommand("create_pull_request", {
        repoPath,
        sourceBranch,
        targetBranch,
        pushSourceBranch,
      });
    },

    commit(repoPath, title, description) {
      return invokeCommand("commit", { repoPath, title, description });
    },

    push(repoPath) {
      return invokeCommand("push", { repoPath });
    },

    getFingerprint(repoPath) {
      return invokeCommand("get_fingerprint", { repoPath });
    },

    getConfig() {
      return invokeCommand("get_config");
    },

    saveConfig(config) {
      return invokeCommand("save_config", { input: config });
    },

    validateClaudeCodeToken(token) {
      return invokeCommand("validate_claude_code_token", { token });
    },

    validateOpenAiToken(token) {
      return invokeCommand("validate_open_ai_token", { token });
    },

    getOpenAiModels(token) {
      return invokeCommand("get_open_ai_models", { token });
    },

    generateCommitMessage(repoPath, changedFiles, input) {
      return invokeCommand("generate_title", {
        input: {
          repoPath,
          changedFiles,
          ...input,
        },
      });
    },

    chatWithRepositoryAssistant(repoPath, messages) {
      return invokeCommand("chat_with_repository_assistant", {
        input: {
          repoPath,
          messages,
        },
      });
    },
  };
}
