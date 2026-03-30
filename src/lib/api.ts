import { invoke } from '@tauri-apps/api/core';

import type { NativeWindowAppearance } from './appTheme';
import type {
  AiGenerationConfig,
  AppConfig,
  BranchDiffDetail,
  BranchResponse,
  CommitDetail,
  CommitResponse,
  GeneratedCommitMessage,
  PullRequestPreparation,
  PullRequestResponse,
  Repository,
  StashEntry,
  TokenValidationResult,
  WorkingTreeDiffArea,
  WorkingTreeDiffDetail,
  WorkingTreeStatus
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4141/api';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {})
    },
    ...options
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }

    throw new Error(String(error));
  }
}

export const api = {
  health(): Promise<{ ok: boolean }> {
    if (isTauriRuntime()) {
      return invokeCommand('health');
    }

    return request('/health');
  },

  getRepositories(query: string): Promise<{ repositories: Repository[] }> {
    if (isTauriRuntime()) {
      const normalized = query.trim();
      return invokeCommand('get_repositories', {
        query: normalized.length > 0 ? normalized : null
      });
    }

    const params = new URLSearchParams();
    if (query.trim()) {
      params.set('query', query.trim());
    }
    return request(`/repositories${params.toString() ? `?${params.toString()}` : ''}`);
  },

  resolveRepositories(repoPaths: string[]): Promise<{ repositories: Repository[] }> {
    if (isTauriRuntime()) {
      return invokeCommand('resolve_repositories', { repoPaths });
    }

    return request('/repositories/resolve', {
      method: 'POST',
      body: JSON.stringify({ repoPaths })
    });
  },

  markRecentRepository(repoPath: string): Promise<{ ok: boolean }> {
    if (isTauriRuntime()) {
      return invokeCommand('mark_recent_repository', { repoPath });
    }

    return request('/repositories/recent', {
      method: 'POST',
      body: JSON.stringify({ repoPath })
    });
  },

  getRepositoryGithubUrl(repoPath: string): Promise<{ url: string | null }> {
    if (isTauriRuntime()) {
      return invokeCommand('get_repository_github_url', { repoPath });
    }

    const params = new URLSearchParams({ repoPath });
    return request(`/repositories/github-url?${params.toString()}`);
  },

  getRepositoryMutationSafety(repoPath: string): Promise<{ isSelfRepository: boolean }> {
    if (isTauriRuntime()) {
      return invokeCommand('get_repository_mutation_safety', { repoPath });
    }

    const params = new URLSearchParams({ repoPath });
    return request(`/repositories/mutation-safety?${params.toString()}`);
  },

  async openExternalUrl(url: string): Promise<void> {
    if (isTauriRuntime()) {
      await invokeCommand('open_external_url', { url });
      return;
    }

    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  },

  async syncWindowAppearance(appearance: NativeWindowAppearance): Promise<void> {
    if (!isTauriRuntime()) {
      return;
    }

    await invokeCommand('sync_window_appearance', appearance);
  },

  getBranches(repoPath: string): Promise<BranchResponse> {
    if (isTauriRuntime()) {
      return invokeCommand('get_branches', { repoPath });
    }

    const params = new URLSearchParams({ repoPath });
    return request(`/branches?${params.toString()}`);
  },

  getCommits(
    repoPath: string,
    ref: string | undefined,
    offset: number,
    limit = 50,
    compareRefs?: string[]
  ): Promise<CommitResponse> {
    if (isTauriRuntime()) {
      const normalizedCompareRefs =
        compareRefs?.map((value) => value.trim()).filter((value) => value.length > 0) ?? [];

      return invokeCommand('get_commits', {
        repoPath,
        refName: ref && ref.trim() ? ref : null,
        compareRefs: normalizedCompareRefs.length > 0 ? normalizedCompareRefs : null,
        offset,
        limit
      });
    }

    const params = new URLSearchParams({
      repoPath,
      offset: String(offset),
      limit: String(limit)
    });

    if (ref && ref.trim()) {
      params.set('ref', ref);
    }
    const normalizedCompareRefs =
      compareRefs?.map((value) => value.trim()).filter((value) => value.length > 0) ?? [];

    for (const compareRef of normalizedCompareRefs) {
      params.append('compareRef', compareRef);
    }

    return request(`/commits?${params.toString()}`);
  },

  getCommitDetail(repoPath: string, sha: string): Promise<CommitDetail> {
    if (isTauriRuntime()) {
      return invokeCommand('get_commit_detail', { repoPath, sha });
    }

    const params = new URLSearchParams({ repoPath, sha });
    return request(`/commits/detail?${params.toString()}`);
  },

  getBranchDiffDetail(repoPath: string, baseRef: string, targetRef: string): Promise<BranchDiffDetail> {
    if (isTauriRuntime()) {
      return invokeCommand('get_branch_diff_detail', { repoPath, baseRef, targetRef });
    }

    const params = new URLSearchParams({ repoPath, baseRef, targetRef });
    return request(`/branches/diff?${params.toString()}`);
  },

  getWorkingTreeStatus(repoPath: string): Promise<WorkingTreeStatus> {
    if (isTauriRuntime()) {
      return invokeCommand('get_working_tree_status', { repoPath });
    }

    const params = new URLSearchParams({ repoPath });
    return request(`/status?${params.toString()}`);
  },

  getWorkingTreeDiffDetail(repoPath: string, file: string, area: WorkingTreeDiffArea): Promise<WorkingTreeDiffDetail> {
    if (isTauriRuntime()) {
      return invokeCommand('get_working_tree_diff_detail', { repoPath, file, area });
    }

    const params = new URLSearchParams({ repoPath, file, area });
    return request(`/working-tree/diff?${params.toString()}`);
  },

  stageFile(repoPath: string, file: string): Promise<{ ok: boolean }> {
    if (isTauriRuntime()) {
      return invokeCommand('stage_file', { repoPath, file });
    }

    return request('/stage', {
      method: 'POST',
      body: JSON.stringify({ repoPath, file })
    });
  },

  unstageFile(repoPath: string, file: string): Promise<{ ok: boolean }> {
    if (isTauriRuntime()) {
      return invokeCommand('unstage_file', { repoPath, file });
    }

    return request('/unstage', {
      method: 'POST',
      body: JSON.stringify({ repoPath, file })
    });
  },

  stashFile(repoPath: string, file: string): Promise<{ ok: boolean }> {
    if (isTauriRuntime()) {
      return invokeCommand('stash_file', { repoPath, file });
    }

    return request('/stash', {
      method: 'POST',
      body: JSON.stringify({ repoPath, file })
    });
  },

  getStashes(repoPath: string): Promise<{ stashes: StashEntry[] }> {
    if (isTauriRuntime()) {
      return invokeCommand('get_stashes', { repoPath });
    }

    const params = new URLSearchParams({ repoPath });
    return request(`/stashes?${params.toString()}`);
  },

  checkout(repoPath: string, ref: string): Promise<{ ok: boolean }> {
    if (isTauriRuntime()) {
      return invokeCommand('checkout', { repoPath, reference: ref });
    }

    return request('/checkout', {
      method: 'POST',
      body: JSON.stringify({ repoPath, ref })
    });
  },

  mergeBranches(repoPath: string, sourceBranch: string, targetBranch: string): Promise<{ ok: boolean }> {
    if (isTauriRuntime()) {
      return invokeCommand('merge_branches', { repoPath, sourceBranch, targetBranch });
    }

    return request('/branches/merge', {
      method: 'POST',
      body: JSON.stringify({ repoPath, sourceBranch, targetBranch })
    });
  },

  createBranch(repoPath: string, baseBranch: string, newBranch: string): Promise<{ ok: boolean }> {
    if (isTauriRuntime()) {
      return invokeCommand('create_branch', { repoPath, baseBranch, newBranch });
    }

    return request('/branches/create', {
      method: 'POST',
      body: JSON.stringify({ repoPath, baseBranch, newBranch })
    });
  },

  deleteBranch(repoPath: string, branchName: string, branchType: 'local' | 'remote'): Promise<{ ok: boolean }> {
    if (isTauriRuntime()) {
      return invokeCommand('delete_branch', { repoPath, branchName, branchType });
    }

    return request('/branches/delete', {
      method: 'POST',
      body: JSON.stringify({ repoPath, branchName, branchType })
    });
  },

  preparePullRequest(
    repoPath: string,
    sourceBranch: string,
    targetBranch: string
  ): Promise<PullRequestPreparation> {
    if (isTauriRuntime()) {
      return invokeCommand('prepare_pull_request', { repoPath, sourceBranch, targetBranch });
    }

    return request('/pull-request/prepare', {
      method: 'POST',
      body: JSON.stringify({ repoPath, sourceBranch, targetBranch })
    });
  },

  createPullRequest(
    repoPath: string,
    sourceBranch: string,
    targetBranch: string,
    pushSourceBranch: boolean
  ): Promise<PullRequestResponse> {
    if (isTauriRuntime()) {
      return invokeCommand('create_pull_request', {
        repoPath,
        sourceBranch,
        targetBranch,
        pushSourceBranch
      });
    }

    return request('/pull-request', {
      method: 'POST',
      body: JSON.stringify({ repoPath, sourceBranch, targetBranch, pushSourceBranch })
    });
  },

  commit(repoPath: string, title: string, description: string): Promise<{ ok: boolean }> {
    if (isTauriRuntime()) {
      return invokeCommand('commit', { repoPath, title, description });
    }

    return request('/commit', {
      method: 'POST',
      body: JSON.stringify({ repoPath, title, description })
    });
  },

  push(repoPath: string): Promise<{ ok: boolean }> {
    if (isTauriRuntime()) {
      return invokeCommand('push', { repoPath });
    }

    return request('/push', {
      method: 'POST',
      body: JSON.stringify({ repoPath })
    });
  },

  getFingerprint(repoPath: string): Promise<{ fingerprint: string }> {
    if (isTauriRuntime()) {
      return invokeCommand('get_fingerprint', { repoPath });
    }

    const params = new URLSearchParams({ repoPath });
    return request(`/updates?${params.toString()}`);
  },

  getConfig(): Promise<AppConfig> {
    if (isTauriRuntime()) {
      return invokeCommand('get_config');
    }

    return request('/config');
  },

  saveConfig(config: Partial<AppConfig>): Promise<{ ok: boolean; config?: AppConfig }> {
    if (isTauriRuntime()) {
      return invokeCommand('save_config', { input: config });
    }

    return request('/config', {
      method: 'PUT',
      body: JSON.stringify(config)
    });
  },

  validateClaudeCodeToken(token: string): Promise<TokenValidationResult> {
    if (isTauriRuntime()) {
      return invokeCommand('validate_claude_code_token', { token });
    }

    return request('/config/validate-claude-code-token', {
      method: 'POST',
      body: JSON.stringify({ token })
    });
  },

  validateOpenAiToken(token: string): Promise<TokenValidationResult> {
    if (isTauriRuntime()) {
      return invokeCommand('validate_open_ai_token', { token });
    }

    return request('/config/validate-openai-token', {
      method: 'POST',
      body: JSON.stringify({ token })
    });
  },

  generateCommitMessage(
    repoPath: string,
    changedFiles: string[],
    input?: Partial<AiGenerationConfig>
  ): Promise<GeneratedCommitMessage> {
    const payload = {
      repoPath,
      changedFiles,
      ...(input ?? {})
    };

    if (isTauriRuntime()) {
      return invokeCommand('generate_title', payload);
    }

    return request('/generate-title', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }
};
