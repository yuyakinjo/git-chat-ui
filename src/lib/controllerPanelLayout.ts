export type GitOperationPanelColumnCount = 1 | 3 | 4;

const GIT_OPERATION_PANEL_THREE_COLUMN_THRESHOLD = 720;
const GIT_OPERATION_PANEL_FOUR_COLUMN_THRESHOLD = 1200;
const COMMIT_DETAIL_PANEL_SPLIT_THRESHOLD = 760;

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
