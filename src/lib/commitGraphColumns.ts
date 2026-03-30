const COMPACT_LAYOUT_THRESHOLD = 860;
const COMPACT_REF_COLUMN_MAX_WIDTH = 112;

export interface CommitGraphColumnLayout {
  isCompact: boolean;
  displayedRefsColumnWidth: number;
  templateColumns: string;
}

export function resolveCommitGraphColumnLayout(input: {
  containerWidth: number;
  graphColumnWidth: number;
  refsColumnWidth: number;
}): CommitGraphColumnLayout {
  const isCompact = input.containerWidth > 0 && input.containerWidth <= COMPACT_LAYOUT_THRESHOLD;
  const displayedRefsColumnWidth = isCompact
    ? Math.min(input.refsColumnWidth, COMPACT_REF_COLUMN_MAX_WIDTH)
    : input.refsColumnWidth;

  return {
    isCompact,
    displayedRefsColumnWidth,
    templateColumns: isCompact
      ? `${input.graphColumnWidth}px ${displayedRefsColumnWidth}px minmax(0,1fr) 96px`
      : `${input.graphColumnWidth}px ${displayedRefsColumnWidth}px 140px minmax(0,1fr) 130px 96px`
  };
}
