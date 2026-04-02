import type { BusinessTransport } from "./businessTransport";

async function request<T>(baseUrl: string, path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export function createHttpBusinessTransport(baseUrl: string): BusinessTransport {
  return {
    health() {
      return request(baseUrl, "/health");
    },

    getRepositories(query) {
      const params = new URLSearchParams();
      if (query.trim()) {
        params.set("query", query.trim());
      }

      return request(baseUrl, `/repositories${params.toString() ? `?${params.toString()}` : ""}`);
    },

    resolveRepositories(repoPaths) {
      return request(baseUrl, "/repositories/resolve", {
        method: "POST",
        body: JSON.stringify({ repoPaths }),
      });
    },

    markRecentRepository(repoPath) {
      return request(baseUrl, "/repositories/recent", {
        method: "POST",
        body: JSON.stringify({ repoPath }),
      });
    },

    getRepositoryGithubUrl(repoPath) {
      const params = new URLSearchParams({ repoPath });
      return request(baseUrl, `/repositories/github-url?${params.toString()}`);
    },

    getRepositoryMutationSafety(repoPath) {
      const params = new URLSearchParams({ repoPath });
      return request(baseUrl, `/repositories/mutation-safety?${params.toString()}`);
    },

    getBranches(repoPath) {
      const params = new URLSearchParams({ repoPath });
      return request(baseUrl, `/branches?${params.toString()}`);
    },

    getCommits(repoPath, ref, offset, limit = 50, compareRefs) {
      const params = new URLSearchParams({
        repoPath,
        offset: String(offset),
        limit: String(limit),
      });

      if (ref && ref.trim()) {
        params.set("ref", ref);
      }

      const normalizedCompareRefs =
        compareRefs?.map((value) => value.trim()).filter((value) => value.length > 0) ?? [];
      for (const compareRef of normalizedCompareRefs) {
        params.append("compareRef", compareRef);
      }

      return request(baseUrl, `/commits?${params.toString()}`);
    },

    getCommitAuthorAvatars(repoPath, ref, shas, allowRemoteFetch = false) {
      return request(baseUrl, "/commits/avatars", {
        method: "POST",
        body: JSON.stringify({
          repoPath,
          ref: ref?.trim() ? ref.trim() : undefined,
          shas,
          allowRemoteFetch,
        }),
      });
    },

    getCommitDetail(repoPath, sha) {
      const params = new URLSearchParams({ repoPath, sha });
      return request(baseUrl, `/commits/detail?${params.toString()}`);
    },

    getCommitFileDiffDetail(repoPath, sha, file) {
      const params = new URLSearchParams({ repoPath, sha, file });
      return request(baseUrl, `/commits/detail/file?${params.toString()}`);
    },

    getBranchDiffDetail(repoPath, baseRef, targetRef) {
      const params = new URLSearchParams({ repoPath, baseRef, targetRef });
      return request(baseUrl, `/branches/diff?${params.toString()}`);
    },

    getBranchDiffFileDetail(repoPath, baseRef, targetRef, file) {
      const params = new URLSearchParams({ repoPath, baseRef, targetRef, file });
      return request(baseUrl, `/branches/diff/file?${params.toString()}`);
    },

    getWorkingTreeStatus(repoPath) {
      const params = new URLSearchParams({ repoPath });
      return request(baseUrl, `/status?${params.toString()}`);
    },

    getConflictSummary(repoPath, sessionId) {
      const params = new URLSearchParams({ repoPath });
      if (sessionId?.trim()) {
        params.set("sessionId", sessionId.trim());
      }

      return request(baseUrl, `/conflicts?${params.toString()}`);
    },

    getConflictFileDetail(repoPath, file, sessionId) {
      const params = new URLSearchParams({ repoPath, file });
      if (sessionId?.trim()) {
        params.set("sessionId", sessionId.trim());
      }

      return request(baseUrl, `/conflicts/file?${params.toString()}`);
    },

    resolveConflictVersion(repoPath, file, side, sessionId) {
      return request(baseUrl, "/conflicts/resolve", {
        method: "POST",
        body: JSON.stringify({
          repoPath,
          file,
          side,
          sessionId: sessionId?.trim() ? sessionId.trim() : undefined,
        }),
      });
    },

    completeMergeSession(repoPath, sessionId) {
      return request(baseUrl, "/conflicts/complete-merge-session", {
        method: "POST",
        body: JSON.stringify({ repoPath, sessionId }),
      });
    },

    abortMergeSession(repoPath, sessionId) {
      return request(baseUrl, "/conflicts/abort-merge-session", {
        method: "POST",
        body: JSON.stringify({ repoPath, sessionId }),
      });
    },

    getWorkingTreeDiffDetail(repoPath, file, area) {
      const params = new URLSearchParams({ repoPath, file, area });
      return request(baseUrl, `/working-tree/diff?${params.toString()}`);
    },

    stageFile(repoPath, file) {
      return request(baseUrl, "/stage", {
        method: "POST",
        body: JSON.stringify({ repoPath, file }),
      });
    },

    unstageFile(repoPath, file) {
      return request(baseUrl, "/unstage", {
        method: "POST",
        body: JSON.stringify({ repoPath, file }),
      });
    },

    discardFile(repoPath, file) {
      return request(baseUrl, "/discard", {
        method: "POST",
        body: JSON.stringify({ repoPath, file }),
      });
    },

    stashFile(repoPath, file) {
      return request(baseUrl, "/stash", {
        method: "POST",
        body: JSON.stringify({ repoPath, file }),
      });
    },

    appendFileToStash(repoPath, stashId, file) {
      return request(baseUrl, "/stashes/append-file", {
        method: "POST",
        body: JSON.stringify({ repoPath, stashId, file }),
      });
    },

    getStashes(repoPath) {
      const params = new URLSearchParams({ repoPath });
      return request(baseUrl, `/stashes?${params.toString()}`);
    },

    getStashDiffDetail(repoPath, stashId) {
      const params = new URLSearchParams({ repoPath, stashId });
      return request(baseUrl, `/stashes/diff?${params.toString()}`);
    },

    getStashDiffFileDetail(repoPath, stashId, file) {
      const params = new URLSearchParams({ repoPath, stashId, file });
      return request(baseUrl, `/stashes/diff/file?${params.toString()}`);
    },

    renameStash(repoPath, stashId, message) {
      return request(baseUrl, "/stashes/rename", {
        method: "POST",
        body: JSON.stringify({ repoPath, stashId, message }),
      });
    },

    deleteStash(repoPath, stashId) {
      return request(baseUrl, "/stashes/delete", {
        method: "POST",
        body: JSON.stringify({ repoPath, stashId }),
      });
    },

    applyStash(repoPath, stashId) {
      return request(baseUrl, "/stashes/apply", {
        method: "POST",
        body: JSON.stringify({ repoPath, stashId }),
      });
    },

    popStash(repoPath, stashId) {
      return request(baseUrl, "/stashes/pop", {
        method: "POST",
        body: JSON.stringify({ repoPath, stashId }),
      });
    },

    checkout(repoPath, ref) {
      return request(baseUrl, "/checkout", {
        method: "POST",
        body: JSON.stringify({ repoPath, ref }),
      });
    },

    mergeBranches(repoPath, sourceBranch, targetBranch) {
      return request(baseUrl, "/branches/merge", {
        method: "POST",
        body: JSON.stringify({ repoPath, sourceBranch, targetBranch }),
      });
    },

    getPullStatus(repoPath) {
      const params = new URLSearchParams({ repoPath });
      return request(baseUrl, `/pull/status?${params.toString()}`);
    },

    pull(repoPath) {
      return request(baseUrl, "/pull", {
        method: "POST",
        body: JSON.stringify({ repoPath }),
      });
    },

    createBranch(repoPath, baseBranch, newBranch) {
      return request(baseUrl, "/branches/create", {
        method: "POST",
        body: JSON.stringify({ repoPath, baseBranch, newBranch }),
      });
    },

    deleteBranch(repoPath, branchName, branchType, forceDelete = false) {
      return request(baseUrl, "/branches/delete", {
        method: "POST",
        body: JSON.stringify({ repoPath, branchName, branchType, forceDelete }),
      });
    },

    preparePullRequest(repoPath, sourceBranch, targetBranch) {
      return request(baseUrl, "/pull-request/prepare", {
        method: "POST",
        body: JSON.stringify({ repoPath, sourceBranch, targetBranch }),
      });
    },

    createPullRequest(repoPath, sourceBranch, targetBranch, pushSourceBranch) {
      return request(baseUrl, "/pull-request", {
        method: "POST",
        body: JSON.stringify({ repoPath, sourceBranch, targetBranch, pushSourceBranch }),
      });
    },

    commit(repoPath, title, description) {
      return request(baseUrl, "/commit", {
        method: "POST",
        body: JSON.stringify({ repoPath, title, description }),
      });
    },

    push(repoPath) {
      return request(baseUrl, "/push", {
        method: "POST",
        body: JSON.stringify({ repoPath }),
      });
    },

    getFingerprint(repoPath) {
      const params = new URLSearchParams({ repoPath });
      return request(baseUrl, `/updates?${params.toString()}`);
    },

    getConfig() {
      return request(baseUrl, "/config");
    },

    saveConfig(config) {
      return request(baseUrl, "/config", {
        method: "PUT",
        body: JSON.stringify(config),
      });
    },

    validateClaudeCodeToken(token) {
      return request(baseUrl, "/config/validate-claude-code-token", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
    },

    validateOpenAiToken(token) {
      return request(baseUrl, "/config/validate-openai-token", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
    },

    getOpenAiModels(token) {
      return request(baseUrl, "/config/openai-models", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
    },

    generateCommitMessage(repoPath, changedFiles, input) {
      return request(baseUrl, "/generate-title", {
        method: "POST",
        body: JSON.stringify({
          repoPath,
          changedFiles,
          ...input,
        }),
      });
    },
  };
}
