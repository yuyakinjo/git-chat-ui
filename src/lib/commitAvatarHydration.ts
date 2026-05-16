import type { CommitListItem } from "../types";

export function shouldAttemptRemoteCommitAvatarHydration(options: {
  append: boolean;
  commits: CommitListItem[];
  currentAvatars: Record<string, string>;
}): boolean {
  // append=true（load-more）でも、新しく見えてきた commit に avatar が無いなら
  // リモート fetch を許可する。さもないと branch tip から first 100 commit
  // 以降の commit の avatar が永久に取得できない。
  return options.commits.some((commit) => {
    const sha = commit.sha.trim();
    return sha.length > 0 && !options.currentAvatars[sha];
  });
}
