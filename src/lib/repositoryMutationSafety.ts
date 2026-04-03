import type { Branch, RepositoryMutationSafety } from "../types";

function formatSelfMutationBlockedReason(actionLabel: string): string {
  return `開発モードでアプリ自身のリポジトリに ${actionLabel} を行うと、dev server や tauri dev が再起動して UI が落ちるため、この操作は無効です。clone した repo かビルド済みアプリで実行してください。`;
}

const SELF_MUTATION_BLOCKED_REASON = formatSelfMutationBlockedReason("checkout / merge / pull");
const SELF_PULL_CONFIRMATION_MESSAGE =
  "開発モードでアプリ自身のリポジトリを pull すると、dev server や tauri dev が再起動して UI が切れる場合があります。\n\nこのまま pull しますか？";
const SELF_CURRENT_BRANCH_MERGE_CONFIRMATION_MESSAGE =
  "開発モードでアプリ自身のリポジトリの checkout 中ブランチに merge すると、dev server や tauri dev が再起動して UI が切れる場合があります。\n\nこのまま merge しますか？ push は行いません。";
const SELF_CONFLICT_RESOLUTION_CONFIRMATION_MESSAGE =
  "開発モードでアプリ自身のリポジトリの conflicted file を assistant から解消すると、dev server や tauri dev が再起動して UI が切れる場合があります。\n\nこのまま解消しますか？";

export function getSelfMutationBlockedReason(
  isDev: boolean,
  repositoryMutationSafety: RepositoryMutationSafety,
): string | null {
  return isDev && repositoryMutationSafety.isSelfRepository ? SELF_MUTATION_BLOCKED_REASON : null;
}

export function getSelfPullConfirmationMessage(): string {
  return SELF_PULL_CONFIRMATION_MESSAGE;
}

export function getSelfCurrentBranchMergeConfirmationMessage(): string {
  return SELF_CURRENT_BRANCH_MERGE_CONFIRMATION_MESSAGE;
}

export function getSelfConflictResolutionConfirmationMessage(): string {
  return SELF_CONFLICT_RESOLUTION_CONFIRMATION_MESSAGE;
}

export function getSelfStashMutationBlockedReason(
  actionLabel: "apply" | "pop" | "apply / pop",
): string {
  return formatSelfMutationBlockedReason(`stash ${actionLabel}`);
}

export function canCheckoutBranchWithoutWorkingTreeChange(
  currentLocalBranch: Branch | null,
  targetBranch: Branch,
): boolean {
  return Boolean(currentLocalBranch && currentLocalBranch.commit === targetBranch.commit);
}

export function canMergeBranchWithoutWorkingTreeChange(
  currentBranchName: string | null,
  targetBranch: Branch,
): boolean {
  return Boolean(
    currentBranchName && targetBranch.type === "local" && currentBranchName !== targetBranch.name,
  );
}
