import type { Branch } from "../types";

function getRemoteBranchTargetName(branchName: string): string | null {
  const parts = branchName.split("/").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  return parts.slice(1).join("/");
}

export function getBranchDeleteTargetName(branch: Branch): string {
  if (branch.type === "local") {
    return branch.name;
  }

  return getRemoteBranchTargetName(branch.name) ?? branch.name;
}

export function getBranchDeleteDisabledReason(
  branch: Branch,
  currentBranchName: string | null,
  defaultBranchName: string | null = null,
): string | null {
  if (branch.type === "remote") {
    const targetName = getRemoteBranchTargetName(branch.name);
    if (!targetName) {
      return "削除できない remote branch です。";
    }

    if (branch.isRemoteDefault) {
      return "remote の default branch は削除できません。";
    }

    return null;
  }

  if (branch.name === currentBranchName) {
    return "現在 checkout 中の branch は削除できません。";
  }

  if (defaultBranchName && branch.name === defaultBranchName) {
    return "default branch は削除できません。";
  }

  return null;
}

export function canDeleteBranch(
  branch: Branch,
  currentBranchName: string | null,
  defaultBranchName: string | null = null,
): boolean {
  return getBranchDeleteDisabledReason(branch, currentBranchName, defaultBranchName) === null;
}
