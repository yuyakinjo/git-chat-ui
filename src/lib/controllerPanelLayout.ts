import type { WorkingTreeStatus } from "../types";
import type { ControllerPanelId } from "./controllerPanelOrder";

export type GitOperationPanelColumnCount = 1 | 3 | 4;
export type CollapsedControllerPanelsGridClassName =
  | "controller-panels-grid--without-git-operations-graph-detail"
  | "controller-panels-grid--without-git-operations-detail-graph";

const GIT_OPERATION_PANEL_THREE_COLUMN_THRESHOLD = 720;
const GIT_OPERATION_PANEL_FOUR_COLUMN_THRESHOLD = 1200;
const COMMIT_DETAIL_PANEL_SPLIT_THRESHOLD = 1160;

export function resolveGitOperationPanelColumnCount(
  containerWidth: number,
): GitOperationPanelColumnCount {
  if (containerWidth >= GIT_OPERATION_PANEL_FOUR_COLUMN_THRESHOLD) {
    return 4;
  }

  if (containerWidth >= GIT_OPERATION_PANEL_THREE_COLUMN_THRESHOLD) {
    return 3;
  }

  return 1;
}

export function shouldSplitCommitDetailPanel(containerWidth: number): boolean {
  return containerWidth >= COMMIT_DETAIL_PANEL_SPLIT_THRESHOLD;
}

export function shouldRenderGitOperationsPanel(status: WorkingTreeStatus | null): boolean {
  if (!status) {
    return true;
  }

  return status.unstaged.length > 0 || status.staged.length > 0 || status.conflicted.length > 0;
}

export function resolveCollapsedControllerPanelsGridClassName(
  visiblePanelOrder: readonly ControllerPanelId[],
): CollapsedControllerPanelsGridClassName {
  const visibleNonGitPanels = visiblePanelOrder.filter((panelId) => panelId !== "gitOperations");

  return visibleNonGitPanels[0] === "commitDetail"
    ? "controller-panels-grid--without-git-operations-detail-graph"
    : "controller-panels-grid--without-git-operations-graph-detail";
}
