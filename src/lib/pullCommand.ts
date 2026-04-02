import type { Branch, PullStatus } from "../types";

const BUSY_PULL_REASON = "Git 操作の完了を待ってから実行してください。";
const LOCAL_BRANCH_ONLY_REASON = "local branch を checkout 中のときだけ使えます。";
const NO_UPSTREAM_PULL_REASON = "upstream branch を設定してから pull してください。";
const DIVERGED_PULL_REASON =
  "local branch と upstream が分岐しているため、fast-forward の pull はできません。";
const PULL_STATUS_LOADING_REASON = "pull 状態を確認しています。";
const PULL_STATUS_UNAVAILABLE_REASON = "pull 状態を確認できませんでした。";

export function getPullCommandDisabledReason(
  operationBusy: boolean,
  currentLocalBranch: Branch | null,
  pullStatus: PullStatus | null,
): string | null {
  if (operationBusy) {
    return BUSY_PULL_REASON;
  }

  if (!currentLocalBranch) {
    return LOCAL_BRANCH_ONLY_REASON;
  }

  if (pullStatus?.state === "noUpstream") {
    return NO_UPSTREAM_PULL_REASON;
  }

  if (pullStatus?.state === "diverged") {
    return DIVERGED_PULL_REASON;
  }

  return null;
}

export function getBranchPullDisabledReason(
  operationBusy: boolean,
  branch: Branch,
  pullStatus: PullStatus | null,
  loading = false,
): string | null {
  if (operationBusy) {
    return BUSY_PULL_REASON;
  }

  if (branch.type !== "local") {
    return LOCAL_BRANCH_ONLY_REASON;
  }

  if (loading) {
    return PULL_STATUS_LOADING_REASON;
  }

  if (!pullStatus || pullStatus.branchName !== branch.name) {
    return PULL_STATUS_UNAVAILABLE_REASON;
  }

  switch (pullStatus.state) {
    case "behind":
      return null;
    case "noUpstream":
      return NO_UPSTREAM_PULL_REASON;
    case "diverged":
      return DIVERGED_PULL_REASON;
    case "ahead":
      return "local branch が upstream より進んでいるため pull は不要です。";
    case "upToDate":
      return "upstream に取り込む変更はありません。";
    case "detached":
      return LOCAL_BRANCH_ONLY_REASON;
    default:
      return null;
  }
}

export function shouldShowBranchPullAction(
  branch: Branch,
  pullStatus: PullStatus | null,
  loading = false,
): boolean {
  if (branch.type !== "local") {
    return false;
  }

  if (loading) {
    return true;
  }

  if (!pullStatus || pullStatus.branchName !== branch.name) {
    return false;
  }

  return (
    pullStatus.state === "behind" ||
    pullStatus.state === "noUpstream" ||
    pullStatus.state === "diverged"
  );
}
