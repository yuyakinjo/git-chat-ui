import { ensureRepoPath, runGh } from "../git/command.js";
import type { RepositoryAssistantUserProfile } from "../types.js";

interface GithubViewerResponse {
  login?: string | null;
  avatar_url?: string | null;
}

const EMPTY_REPOSITORY_ASSISTANT_USER_PROFILE: RepositoryAssistantUserProfile = {
  login: null,
  avatarUrl: null,
};

export function parseGithubViewerResponse(raw: string): RepositoryAssistantUserProfile {
  const parsed = JSON.parse(raw) as GithubViewerResponse | null;
  const login = parsed?.login?.trim() ?? "";
  const avatarUrl = parsed?.avatar_url?.trim() ?? "";

  return {
    login: login || null,
    avatarUrl: avatarUrl || null,
  };
}

export async function getRepositoryAssistantUserProfile(
  repoPath: string,
): Promise<RepositoryAssistantUserProfile> {
  await ensureRepoPath(repoPath);

  try {
    const output = await runGh(["api", "user", "--cache", "1h"], repoPath);
    return parseGithubViewerResponse(output);
  } catch {
    // Avatar hydration is opportunistic. Chat should remain usable without GitHub auth.
    return EMPTY_REPOSITORY_ASSISTANT_USER_PROFILE;
  }
}
