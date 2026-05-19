import type { CommitListItem } from "../types";

export function shouldAttemptRemoteCommitAvatarHydration(options: {
  append: boolean;
  commits: CommitListItem[];
  currentAvatars: Record<string, string>;
}): boolean {
  if (options.append) {
    return false;
  }

  // Initial page hydration can use the remote source. Load-more pages should not
  // start network avatar hydration while the user is actively scrolling.
  return options.commits.some((commit) => {
    const sha = commit.sha.trim();
    return sha.length > 0 && !options.currentAvatars[sha];
  });
}
