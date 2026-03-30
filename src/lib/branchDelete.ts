import type { Branch } from '../types';

export function getBranchDeleteDisabledReason(branch: Branch, currentBranchName: string | null): string | null {
  if (branch.type !== 'local') {
    return 'local branch のみ削除できます。';
  }

  if (branch.name === currentBranchName) {
    return '現在 checkout 中の branch は削除できません。';
  }

  return null;
}

export function canDeleteBranch(branch: Branch, currentBranchName: string | null): boolean {
  return getBranchDeleteDisabledReason(branch, currentBranchName) === null;
}
