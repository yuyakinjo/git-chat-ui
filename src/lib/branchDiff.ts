import type { Branch, BranchDiffDetail } from '../types';

function matchesBranchRef(detailRef: string, branch: Branch): boolean {
  return detailRef === branch.name || detailRef === branch.fullRef;
}

export function canCompareCurrentBranch(currentLocalBranch: Branch | null, defaultBranch: Branch | null): boolean {
  return Boolean(currentLocalBranch && defaultBranch && currentLocalBranch.name !== defaultBranch.name);
}

export function isCurrentBranchDiffDetail(
  detail: BranchDiffDetail | null,
  baseBranch: Branch | null,
  targetBranch: Branch | null
): boolean {
  if (!detail || !baseBranch || !targetBranch) {
    return false;
  }

  return matchesBranchRef(detail.baseRef, baseBranch) && matchesBranchRef(detail.targetRef, targetBranch);
}

export function getBranchDiffButtonLabel(defaultBranchName: string | null): string {
  return `Changed Files vs ${defaultBranchName ?? 'default'}`;
}
