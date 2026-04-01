import type { Branch, BranchDiffDetail, BranchResponse } from "../types";

function matchesBranchRef(detailRef: string, branch: Branch): boolean {
  return detailRef === branch.name || detailRef === branch.fullRef;
}

function getRemoteBranchShortName(branchName: string): string {
  const parts = branchName.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return branchName;
  }

  return parts.slice(1).join("/");
}

export function resolveBranchDiffBaseBranch(branches: BranchResponse | null): Branch | null {
  if (!branches) {
    return null;
  }

  const localMain = branches.local.find((branch) => branch.name === "main") ?? null;
  if (localMain) {
    return localMain;
  }

  const localMaster = branches.local.find((branch) => branch.name === "master") ?? null;
  if (localMaster) {
    return localMaster;
  }

  const remoteDefault = branches.remote.find((branch) => branch.isRemoteDefault) ?? null;
  if (remoteDefault) {
    return remoteDefault;
  }

  const remoteMain =
    branches.remote.find((branch) => getRemoteBranchShortName(branch.name) === "main") ?? null;
  if (remoteMain) {
    return remoteMain;
  }

  const remoteMaster =
    branches.remote.find((branch) => getRemoteBranchShortName(branch.name) === "master") ?? null;
  if (remoteMaster) {
    return remoteMaster;
  }

  return null;
}

export function canCompareCurrentBranch(
  currentLocalBranch: Branch | null,
  defaultBranch: Branch | null,
): boolean {
  return Boolean(currentLocalBranch && defaultBranch);
}

export function isCurrentBranchDiffDetail(
  detail: BranchDiffDetail | null,
  baseBranch: Branch | null,
  targetBranch: Branch | null,
): boolean {
  if (!detail || !baseBranch || !targetBranch) {
    return false;
  }

  return (
    matchesBranchRef(detail.baseRef, baseBranch) && matchesBranchRef(detail.targetRef, targetBranch)
  );
}

export function getBranchDiffBaseLabel(branch: Branch | null): string | null {
  if (!branch) {
    return null;
  }

  return branch.type === "remote" ? getRemoteBranchShortName(branch.name) : branch.name;
}

export function getBranchDiffButtonLabel(defaultBranchName: string | null): string {
  return `Diffs vs ${defaultBranchName ?? "default"}`;
}

export function getBranchDiffButtonTooltip(
  defaultBranchName: string | null,
  expanded: boolean,
): string {
  const baseLabel = defaultBranchName ?? "default";

  return expanded
    ? `${baseLabel} との差分表示を閉じる`
    : `現在のブランチと ${baseLabel} の差分を表示する`;
}
