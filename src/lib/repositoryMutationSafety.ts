import type { Branch, RepositoryMutationSafety } from '../types';

const SELF_MUTATION_BLOCKED_REASON =
  '開発モードでアプリ自身のリポジトリに checkout / merge を行うと、dev server や tauri dev が再起動して UI が落ちるため、この操作は無効です。clone した repo かビルド済みアプリで実行してください。';

export function getSelfMutationBlockedReason(
  isDev: boolean,
  repositoryMutationSafety: RepositoryMutationSafety
): string | null {
  return isDev && repositoryMutationSafety.isSelfRepository ? SELF_MUTATION_BLOCKED_REASON : null;
}

export function canCheckoutBranchWithoutWorkingTreeChange(
  currentLocalBranch: Branch | null,
  targetBranch: Branch
): boolean {
  return Boolean(currentLocalBranch && currentLocalBranch.commit === targetBranch.commit);
}
