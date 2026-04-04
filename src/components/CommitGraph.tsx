import { animate, stagger } from "animejs";
import { Check } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
} from "react";

import { useContainerWidth } from "../hooks/useContainerWidth";
import { copyTextToClipboard } from "../lib/clipboard";
import { resolveCommitGraphColumnLayout } from "../lib/commitGraphColumns";
import { buildLaneRows } from "../lib/commitGraphLayout";
import { resolveDefaultBranch } from "../lib/controllerViewUtils";
import { formatRelativeDate, shortSha } from "../lib/format";
import type { BranchResponse, CommitGraphMode, CommitGraphStyle, CommitListItem } from "../types";
import {
  buildCommitRefBadges,
  buildPrimaryParentCurvePath,
  buildDefaultBranchAnchorLaneIndices,
  clampColumnWidth,
  getLaneDisplayOffset,
  laneColor,
  laneX,
  LINE_OVERDRAW,
  parseCommitRefLabels,
  REF_BADGE_ICON_SIZE,
  REF_BADGE_DONE_ICON_SIZE,
  REF_COLUMN_DEFAULT_WIDTH,
  REF_COLUMN_STORAGE_KEY,
  refLabelClass,
  refLabelIcon,
  refLabelIconClass,
  ROW_HEIGHT,
  resolveCommitGraphStyleMetrics,
  WipNode,
} from "./CommitGraphHelpers";

interface CommitGraphProps {
  commits: CommitListItem[];
  commitAuthorAvatars?: Record<string, string>;
  mode: CommitGraphMode;
  graphStyle: CommitGraphStyle;
  activeCommitSha: string | null;
  highlightedCommitSha: string | null;
  checkedOutCommitSha: string | null;
  scrollToCommitSha: string | null;
  onScrollToCommitHandled: (sha: string) => void;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  busy: boolean;
  wipStagedCount: number;
  wipUnstagedCount: number;
  wipConflictedCount: number;
  onSelectWip: () => void;
  onSelectCommit: (commit: CommitListItem) => void;
  onCheckoutCommit: (commit: CommitListItem) => void;
  onCheckoutBranchRef: (refName: string) => void;
  onLoadMore: () => void;
  onNotify: (message: string) => void;
  onJumpToCommit?: ((sha: string) => Promise<boolean>) | null;
  headerAccessory?: JSX.Element | null;
  branchContext?: BranchResponse | null;
}

export function resolveCommitEnterAnimationTargets<T>(
  nodes: readonly T[],
  previousCommitCount: number,
): T[] {
  if (previousCommitCount <= 0) {
    return [...nodes];
  }

  if (previousCommitCount >= nodes.length) {
    return [];
  }

  return nodes.slice(previousCommitCount);
}

export function CommitGraph({
  commits,
  commitAuthorAvatars = {},
  mode,
  graphStyle,
  activeCommitSha,
  highlightedCommitSha,
  checkedOutCommitSha,
  scrollToCommitSha,
  onScrollToCommitHandled,
  hasMore,
  loading,
  loadingMore,
  busy,
  wipStagedCount,
  wipUnstagedCount,
  wipConflictedCount,
  onSelectWip,
  onSelectCommit,
  onCheckoutCommit,
  onCheckoutBranchRef,
  onLoadMore,
  onNotify,
  onJumpToCommit = null,
  headerAccessory,
  branchContext = null,
}: CommitGraphProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const refsResizeCleanupRef = useRef<(() => void) | null>(null);
  const previousVisibleCommitCountRef = useRef(0);
  const shaJumpContainerRef = useRef<HTMLDivElement | null>(null);
  const shaJumpInputRef = useRef<HTMLInputElement | null>(null);
  const containerWidth = useContainerWidth(rootRef);
  const [refsColumnWidth, setRefsColumnWidth] = useState<number>(() => {
    if (typeof window === "undefined") {
      return REF_COLUMN_DEFAULT_WIDTH;
    }

    const persisted = Number(window.localStorage.getItem(REF_COLUMN_STORAGE_KEY));
    if (!Number.isFinite(persisted)) {
      return REF_COLUMN_DEFAULT_WIDTH;
    }

    return clampColumnWidth(persisted);
  });
  const [isShaJumpOpen, setIsShaJumpOpen] = useState(false);
  const [shaJumpValue, setShaJumpValue] = useState("");
  const [shaJumpPending, setShaJumpPending] = useState(false);
  const normalizedCheckedOutCommitSha = checkedOutCommitSha?.trim() ?? "";

  const visibleCommits = useMemo(() => commits, [commits]);
  const defaultBranchHeadSha = useMemo(
    () => resolveDefaultBranch(branchContext)?.commit ?? null,
    [branchContext],
  );
  const graphStyleMetrics = useMemo(() => resolveCommitGraphStyleMetrics(graphStyle), [graphStyle]);
  const reservedLaneHeadSha = normalizedCheckedOutCommitSha || defaultBranchHeadSha || "";
  const laneLayout = useMemo(
    () => buildLaneRows(commits, { reservedHeadSha: reservedLaneHeadSha }),
    [commits, reservedLaneHeadSha],
  );
  const defaultBranchAnchorLaneIndices = useMemo(
    () => buildDefaultBranchAnchorLaneIndices(commits, laneLayout.rows, defaultBranchHeadSha),
    [commits, defaultBranchHeadSha, laneLayout.rows],
  );
  const sharedStemLaneIndicesByRow = useMemo(() => {
    const byRow = new Map<number, number[]>();
    if (graphStyle !== "japaneseExpress") {
      return byRow;
    }

    laneLayout.rows.forEach((row) => {
      if (
        row.primaryParentLaneIndex === null ||
        row.primaryParentLaneIndex === row.laneIndex ||
        row.primaryParentRowIndex === null
      ) {
        return;
      }

      const lanes = byRow.get(row.primaryParentRowIndex) ?? [];
      if (!lanes.includes(row.laneIndex)) {
        lanes.push(row.laneIndex);
        lanes.sort((left, right) => left - right);
      }
      byRow.set(row.primaryParentRowIndex, lanes);
    });

    return byRow;
  }, [graphStyle, laneLayout.rows]);
  const commitRefScopeContext = useMemo(
    () =>
      branchContext
        ? {
            localRefNames: new Set(branchContext.local.map((branch) => branch.name)),
            remoteRefNames: new Set(branchContext.remote.map((branch) => branch.name)),
            remoteNames: new Set(
              branchContext.remote.map((branch) => branch.name.split("/", 1)[0]).filter(Boolean),
            ),
          }
        : null,
    [branchContext],
  );
  const refBadgeBySha = useMemo(
    () =>
      new Map(
        commits.map((commit) => [
          commit.sha,
          buildCommitRefBadges(parseCommitRefLabels(commit.decoration), commitRefScopeContext),
        ]),
      ),
    [commits, commitRefScopeContext],
  );
  const refsAutoWidth = useMemo(() => {
    if (typeof document === "undefined") {
      return REF_COLUMN_DEFAULT_WIDTH;
    }

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      return REF_COLUMN_DEFAULT_WIDTH;
    }

    context.font =
      '600 10px "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';

    let maxRowWidth = 0;
    for (const badges of refBadgeBySha.values()) {
      if (badges.length === 0) {
        continue;
      }

      const rowWidth = badges.reduce((total, badge, index) => {
        const textWidth = Math.ceil(context.measureText(badge.name).width);
        const pillWidth =
          textWidth +
          18 +
          badge.scopes.length * (REF_BADGE_ICON_SIZE + 4) +
          (badge.type === "head" ? REF_BADGE_DONE_ICON_SIZE + 4 : 0);
        return total + pillWidth + (index > 0 ? 4 : 0);
      }, 0);

      maxRowWidth = Math.max(maxRowWidth, rowWidth);
    }

    const headerWidth = Math.ceil(context.measureText("REFS").width) + 24;
    return clampColumnWidth(Math.max(REF_COLUMN_DEFAULT_WIDTH, maxRowWidth + 12, headerWidth));
  }, [refBadgeBySha]);

  const startRefsColumnResize = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const startWidth = refsColumnWidth;

      refsResizeCleanupRef.current?.();

      const handlePointerMove = (moveEvent: PointerEvent): void => {
        const delta = moveEvent.clientX - startX;
        setRefsColumnWidth(clampColumnWidth(startWidth + delta));
      };

      const cleanup = (): void => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", cleanup);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        refsResizeCleanupRef.current = null;
      };

      refsResizeCleanupRef.current = cleanup;
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", cleanup);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [refsColumnWidth],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(REF_COLUMN_STORAGE_KEY, String(refsColumnWidth));
  }, [refsColumnWidth]);

  useEffect(
    () => () => {
      refsResizeCleanupRef.current?.();
    },
    [],
  );

  useEffect(() => {
    if (!rootRef.current) {
      return;
    }

    const nextVisibleCommitCount = visibleCommits.length;
    const animationTargets = resolveCommitEnterAnimationTargets(
      Array.from(rootRef.current.querySelectorAll('[data-animate="commit-enter"]')),
      previousVisibleCommitCountRef.current,
    );
    previousVisibleCommitCountRef.current = nextVisibleCommitCount;

    if (animationTargets.length === 0) {
      return;
    }

    animate(animationTargets, {
      opacity: [0, 1],
      translateY: [6, 0],
      delay: stagger(18),
      duration: 250,
      easing: "linear",
    });
  }, [visibleCommits.length]);

  useEffect(() => {
    if (!isShaJumpOpen) {
      return;
    }

    shaJumpInputRef.current?.focus();
    shaJumpInputRef.current?.select();
  }, [isShaJumpOpen]);

  useEffect(() => {
    if (!isShaJumpOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const container = shaJumpContainerRef.current;
      if (!container || container.contains(event.target as Node)) {
        return;
      }

      setIsShaJumpOpen(false);
      setShaJumpValue("");
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [isShaJumpOpen]);

  useEffect(() => {
    if (!scrollToCommitSha || !rootRef.current) {
      return;
    }

    const targetRow = rootRef.current.querySelector<HTMLElement>(
      `[data-commit-sha="${scrollToCommitSha}"]`,
    );
    if (!targetRow) {
      return;
    }

    targetRow.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
    onScrollToCommitHandled(scrollToCommitSha);
  }, [onScrollToCommitHandled, scrollToCommitSha, visibleCommits.length]);

  const isDetailedMode = mode === "detailed";
  const laneDisplayOffsets = useMemo(
    () =>
      Array.from({ length: Math.max(laneLayout.maxLanes, 1) }, (_, laneIndex) =>
        getLaneDisplayOffset(laneIndex, graphStyle),
      ),
    [graphStyle, laneLayout.maxLanes],
  );
  const minLaneDisplayOffset = useMemo(
    () => Math.min(0, ...laneDisplayOffsets),
    [laneDisplayOffsets],
  );
  const maxLaneDisplayOffset = useMemo(
    () => Math.max(0, ...laneDisplayOffsets),
    [laneDisplayOffsets],
  );
  const resolveLaneX = useCallback(
    (laneIndex: number) =>
      laneX(laneIndex, {
        style: graphStyle,
        minLaneDisplayOffset,
        laneGap: graphStyleMetrics.laneGap,
        lanePadding: graphStyleMetrics.lanePadding,
      }),
    [graphStyleMetrics.laneGap, graphStyleMetrics.lanePadding, minLaneDisplayOffset, graphStyle],
  );
  const hasWipRow =
    (wipStagedCount > 0 || wipUnstagedCount > 0 || wipConflictedCount > 0) && !loading;
  const graphColumnWidth = isDetailedMode
    ? Math.max(
        graphStyleMetrics.minDetailedGraphWidth,
        (maxLaneDisplayOffset - minLaneDisplayOffset) * graphStyleMetrics.laneGap +
          graphStyleMetrics.lanePadding * 2,
      )
    : graphStyleMetrics.compactGraphWidth;
  const columnLayout = resolveCommitGraphColumnLayout({
    containerWidth,
    graphColumnWidth,
    refsColumnWidth,
  });
  const isCompactLayout = columnLayout.isCompact;
  const displayedRefsColumnWidth = columnLayout.displayedRefsColumnWidth;
  const gridTemplateColumns = columnLayout.templateColumns;
  const wipNodeCenter = graphStyleMetrics.wipNodeSize / 2;
  const wipLineTopEnd = ROW_HEIGHT / 2 - graphStyleMetrics.wipNodeLineClearance;
  const wipLineBottomStart = ROW_HEIGHT / 2 + graphStyleMetrics.wipNodeLineClearance;
  const wipAnchor = useMemo(() => {
    if (!hasWipRow) {
      return {
        incomingLaneIndices: [] as number[],
        rowIndex: 0,
        laneIndex: 0,
      };
    }

    const anchorHeadSha = (reservedLaneHeadSha ?? "").trim();
    const anchorRowIndex = anchorHeadSha
      ? visibleCommits.findIndex((commit) => commit.sha.trim() === anchorHeadSha)
      : -1;
    const anchorLaneIndex =
      anchorRowIndex >= 0 ? (laneLayout.rows[anchorRowIndex]?.laneIndex ?? 0) : 0;

    return {
      incomingLaneIndices: [] as number[],
      rowIndex: 0,
      laneIndex: anchorLaneIndex,
    };
  }, [hasWipRow, laneLayout.rows, reservedLaneHeadSha, visibleCommits]);
  const reservedHeadRowIndex = useMemo(() => {
    const headSha = reservedLaneHeadSha.trim();
    if (!headSha) {
      return -1;
    }

    return visibleCommits.findIndex((commit) => commit.sha.trim() === headSha);
  }, [reservedLaneHeadSha, visibleCommits]);
  const resolveLaneStroke = useCallback(
    (rowIndex: number, laneIndex: number) =>
      laneColor(laneIndex, defaultBranchAnchorLaneIndices[rowIndex] ?? 0, graphStyle),
    [defaultBranchAnchorLaneIndices, graphStyle],
  );
  const resolveLaneStrokeWidth = useCallback(
    (_rowIndex: number, _laneIndex: number, _commitLaneIndex: number | null) =>
      graphStyleMetrics.detailedLineWidth,
    [graphStyleMetrics.detailedLineWidth],
  );
  const resolveLaneOpacity = useCallback(
    (_rowIndex: number, _laneIndex: number, _commitLaneIndex: number | null) =>
      graphStyleMetrics.detailedLineOpacity,
    [graphStyleMetrics.detailedLineOpacity],
  );
  const wipLaneDotSpacing = graphStyle === "japaneseExpress" ? 8 : 5;
  const resolveLaneStrokeDasharray = useCallback(
    (_rowIndex: number, laneIndex: number) => {
      if (!hasWipRow || laneIndex !== wipAnchor.laneIndex) {
        return undefined;
      }

      return `0 ${wipLaneDotSpacing}`;
    },
    [hasWipRow, wipAnchor.laneIndex, wipLaneDotSpacing],
  );
  const resolveLaneStrokeDashoffset = useCallback(
    (laneIndex: number, absoluteStartY: number) => {
      if (!hasWipRow || laneIndex !== wipAnchor.laneIndex) {
        return undefined;
      }

      return (
        (((absoluteStartY - wipLineBottomStart) % wipLaneDotSpacing) + wipLaneDotSpacing) %
        wipLaneDotSpacing
      );
    },
    [hasWipRow, wipAnchor.laneIndex, wipLaneDotSpacing, wipLineBottomStart],
  );
  const buildCommitNodeStyle = useCallback(
    (
      laneStroke: string,
      nodeSize: number,
      laneIndex: number,
      avatarSrc: string | undefined,
    ): CSSProperties => {
      const baseStyle: CSSProperties = {
        width: `${nodeSize}px`,
        height: `${nodeSize}px`,
        left: `${resolveLaneX(laneIndex) - nodeSize / 2}px`,
        top: `${ROW_HEIGHT / 2 - nodeSize / 2}px`,
      };

      if (graphStyle === "japaneseExpress") {
        return {
          ...baseStyle,
          background: "rgb(var(--theme-elevated-rgb) / 0.98)",
          border: `${avatarSrc ? 3 : graphStyleMetrics.nodeRingWidth}px solid ${laneStroke}`,
          boxShadow: avatarSrc
            ? "0 10px 24px rgb(15 23 42 / 0.16)"
            : "0 8px 18px rgb(15 23 42 / 0.12)",
        };
      }

      if (!avatarSrc) {
        return {
          ...baseStyle,
          background: laneStroke,
        };
      }

      return baseStyle;
    },
    [graphStyle, graphStyleMetrics.nodeRingWidth, resolveLaneX],
  );
  const handleCopySha = useCallback(
    (sha: string) => {
      void copyTextToClipboard(sha)
        .then(() => {
          onNotify(`${shortSha(sha)} をコピーしました。`);
        })
        .catch(() => {
          onNotify("SHA のコピーに失敗しました。");
        });
    },
    [onNotify],
  );
  const handleToggleShaJump = useCallback((): void => {
    if (!onJumpToCommit || shaJumpPending) {
      return;
    }

    const nextIsOpen = !isShaJumpOpen;
    setIsShaJumpOpen(nextIsOpen);
    if (!nextIsOpen) {
      setShaJumpValue("");
    }
  }, [isShaJumpOpen, onJumpToCommit, shaJumpPending]);
  const handleSubmitShaJump = useCallback(
    async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();

      if (!onJumpToCommit || shaJumpPending) {
        return;
      }

      const normalizedSha = shaJumpValue.trim();
      if (!normalizedSha) {
        onNotify("SHA を入力してください。");
        shaJumpInputRef.current?.focus();
        return;
      }

      setShaJumpPending(true);
      try {
        const didJump = await onJumpToCommit(normalizedSha);
        if (didJump) {
          setShaJumpValue("");
          setIsShaJumpOpen(false);
          return;
        }

        shaJumpInputRef.current?.focus();
        shaJumpInputRef.current?.select();
      } finally {
        setShaJumpPending(false);
      }
    },
    [onJumpToCommit, onNotify, shaJumpPending, shaJumpValue],
  );
  const renderWipRow = useCallback((): JSX.Element => {
    const anchorLaneHasIncoming = wipAnchor.incomingLaneIndices.includes(wipAnchor.laneIndex);
    const anchorLaneStroke = resolveLaneStroke(wipAnchor.rowIndex, wipAnchor.laneIndex);
    const anchorLaneStrokeWidth = resolveLaneStrokeWidth(
      wipAnchor.rowIndex,
      wipAnchor.laneIndex,
      wipAnchor.laneIndex,
    );
    const anchorLaneOpacity = resolveLaneOpacity(
      wipAnchor.rowIndex,
      wipAnchor.laneIndex,
      wipAnchor.laneIndex,
    );
    const anchorLaneStrokeDasharray = resolveLaneStrokeDasharray(
      wipAnchor.rowIndex,
      wipAnchor.laneIndex,
    );
    const anchorLaneTopStrokeDashoffset = resolveLaneStrokeDashoffset(
      wipAnchor.laneIndex,
      -LINE_OVERDRAW,
    );
    const anchorLaneBottomStrokeDashoffset = resolveLaneStrokeDashoffset(
      wipAnchor.laneIndex,
      wipLineBottomStart,
    );

    return (
      <div
        className="wip-row commit-row"
        style={{ gridTemplateColumns }}
        onClick={onSelectWip}
        title="未コミットの変更があります"
      >
        {isDetailedMode ? (
          <div className="relative h-8" style={{ width: `${graphColumnWidth}px` }}>
            <svg
              className="absolute left-0"
              width={graphColumnWidth}
              height={ROW_HEIGHT + LINE_OVERDRAW * 2}
              style={{ top: `${-LINE_OVERDRAW}px` }}
              viewBox={`0 ${-LINE_OVERDRAW} ${graphColumnWidth} ${ROW_HEIGHT + LINE_OVERDRAW * 2}`}
              fill="none"
              overflow="hidden"
            >
              {anchorLaneHasIncoming ? (
                <line
                  className="wip-row__lane-line wip-row__lane-line--connector-top"
                  x1={resolveLaneX(wipAnchor.laneIndex)}
                  y1={-LINE_OVERDRAW}
                  x2={resolveLaneX(wipAnchor.laneIndex)}
                  y2={wipLineTopEnd}
                  stroke={anchorLaneStroke}
                  strokeWidth={anchorLaneStrokeWidth}
                  opacity={anchorLaneOpacity}
                  strokeLinecap="round"
                  strokeDasharray={anchorLaneStrokeDasharray}
                  strokeDashoffset={anchorLaneTopStrokeDashoffset}
                />
              ) : null}
              <line
                className="wip-row__lane-line wip-row__lane-line--connector"
                x1={resolveLaneX(wipAnchor.laneIndex)}
                y1={wipLineBottomStart}
                x2={resolveLaneX(wipAnchor.laneIndex)}
                y2={ROW_HEIGHT + LINE_OVERDRAW}
                stroke={anchorLaneStroke}
                strokeWidth={anchorLaneStrokeWidth}
                opacity={anchorLaneOpacity}
                strokeLinecap="round"
                strokeDasharray={anchorLaneStrokeDasharray}
                strokeDashoffset={anchorLaneBottomStrokeDashoffset}
              />
            </svg>
            <WipNode
              className="absolute block"
              style={{
                color: anchorLaneStroke,
                left: `${resolveLaneX(wipAnchor.laneIndex) - wipNodeCenter}px`,
                top: `${ROW_HEIGHT / 2 - wipNodeCenter}px`,
              }}
              size={graphStyleMetrics.wipNodeSize}
              ringRadius={graphStyleMetrics.wipNodeRingRadius}
              strokeWidth={graphStyleMetrics.wipNodeStrokeWidth}
              variant={graphStyle}
            />
          </div>
        ) : (
          <div className="relative flex h-8 items-center justify-center">
            <div
              className="wip-row__lane-line wip-row__lane-line--compact absolute"
              style={{
                width: `${graphStyleMetrics.compactLineWidth}px`,
                top: `${wipLineBottomStart}px`,
                height: `${ROW_HEIGHT + LINE_OVERDRAW - wipLineBottomStart}px`,
                background:
                  graphStyle === "japaneseExpress"
                    ? resolveLaneStroke(wipAnchor.rowIndex, wipAnchor.laneIndex)
                    : "rgb(var(--color-accent) / 0.2)",
              }}
            />
            <WipNode
              style={{ color: anchorLaneStroke }}
              size={graphStyleMetrics.wipNodeSize}
              ringRadius={graphStyleMetrics.wipNodeRingRadius}
              strokeWidth={graphStyleMetrics.wipNodeStrokeWidth}
              variant={graphStyle}
            />
          </div>
        )}
        <div className="overflow-hidden whitespace-nowrap text-xs">
          <span className="wip-row__badge inline-flex items-center px-2 py-px text-[10px] font-semibold leading-4">
            WIP
          </span>
        </div>
        {!isCompactLayout ? <div className="wip-row__meta truncate text-xs">今</div> : null}
        <div className="wip-row__primary flex items-center gap-2 truncate text-sm font-medium">
          <span>{"// WIP"}</span>
          <span className="wip-row__meta truncate text-xs font-normal">
            {[
              wipStagedCount > 0 ? `${wipStagedCount} staged` : null,
              wipUnstagedCount > 0 ? `${wipUnstagedCount} unstaged` : null,
              wipConflictedCount > 0 ? `${wipConflictedCount} conflicted` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        <div className="wip-row__meta truncate text-xs">—</div>
        {!isCompactLayout ? (
          <div className="wip-row__meta commit-id-column truncate text-xs">—</div>
        ) : null}
      </div>
    );
  }, [
    graphColumnWidth,
    graphStyleMetrics.compactLineWidth,
    graphStyleMetrics.wipNodeRingRadius,
    graphStyleMetrics.wipNodeSize,
    graphStyleMetrics.wipNodeStrokeWidth,
    gridTemplateColumns,
    isCompactLayout,
    isDetailedMode,
    onSelectWip,
    resolveLaneOpacity,
    resolveLaneStrokeDasharray,
    resolveLaneStrokeDashoffset,
    resolveLaneStroke,
    resolveLaneStrokeWidth,
    resolveLaneX,
    graphStyle,
    wipAnchor.incomingLaneIndices,
    wipAnchor.laneIndex,
    wipAnchor.rowIndex,
    wipConflictedCount,
    wipLineBottomStart,
    wipLineTopEnd,
    wipNodeCenter,
    wipStagedCount,
    wipUnstagedCount,
  ]);

  return (
    <section
      className={`commit-graph panel flex min-h-0 min-w-0 flex-col overflow-hidden p-3 ${
        graphStyle === "japaneseExpress"
          ? "commit-graph--japanese-express"
          : "commit-graph--standard"
      }`}
      data-commit-graph-style={graphStyle}
    >
      <div className="commit-graph__header mb-2 flex items-center justify-between px-2">
        <div>
          <div className="section-title">Commit Graph</div>
        </div>
        {headerAccessory}
      </div>

      <div
        ref={rootRef}
        className="min-h-0 flex-1 overflow-auto"
        data-controller-panel-drag-ignore="true"
        onScroll={(event) => {
          const target = event.currentTarget;
          if (!hasMore || loadingMore) {
            return;
          }

          if (target.scrollHeight - target.scrollTop - target.clientHeight < 200) {
            onLoadMore();
          }
        }}
      >
        <div className="commit-graph__columns" style={{ gridTemplateColumns }}>
          <span className="commit-graph__column-spacer" aria-hidden="true" />
          <span className="commit-graph__column-header commit-graph__column-header--refs">
            <span className="commit-graph__column-label">Refs</span>
            <button
              type="button"
              className="absolute -right-2 top-[-6px] h-[calc(100%+12px)] w-4 cursor-col-resize rounded-xs bg-transparent hover:bg-black/5"
              onPointerDown={startRefsColumnResize}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setRefsColumnWidth(refsAutoWidth);
              }}
              aria-label="Resize refs column"
            />
          </span>
          {!isCompactLayout ? (
            <span className="commit-graph__column-header">
              <span className="commit-graph__column-label">Date</span>
            </span>
          ) : null}
          <span className="commit-graph__column-header">
            <span className="commit-graph__column-label">Message</span>
          </span>
          <span className="commit-graph__column-header">
            <span className="commit-graph__column-label">Author</span>
          </span>
          {!isCompactLayout ? (
            <div
              className="commit-graph__column-header commit-graph__column-header--sha commit-id-column relative"
              ref={shaJumpContainerRef}
            >
              {onJumpToCommit ? (
                <>
                  <button
                    type="button"
                    className="commit-graph__sha-jump-trigger inline-flex items-center rounded-full border border-transparent px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] transition hover:border-black/8 hover:bg-black/5 hover:text-ink focus-visible:border-black/10 focus-visible:outline-none"
                    onClick={handleToggleShaJump}
                    aria-expanded={isShaJumpOpen}
                    aria-haspopup="dialog"
                    title="SHA を入力して commit に移動"
                  >
                    SHA
                  </button>
                  {isShaJumpOpen ? (
                    <form
                      className="commit-graph__sha-jump-popover absolute right-0 top-full z-20 mt-2 flex w-[240px] items-center gap-2 rounded-2xl border border-black/6 bg-white/96 p-2 shadow-lg backdrop-blur-md"
                      onSubmit={(event) => {
                        void handleSubmitShaJump(event);
                      }}
                    >
                      <input
                        ref={shaJumpInputRef}
                        type="text"
                        className="input commit-graph__sha-jump-input h-9 min-w-0 flex-1 px-3 py-2 text-xs"
                        value={shaJumpValue}
                        onChange={(event) => {
                          setShaJumpValue(event.target.value);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Escape" || shaJumpPending) {
                            return;
                          }

                          event.preventDefault();
                          setIsShaJumpOpen(false);
                          setShaJumpValue("");
                        }}
                        placeholder="git sha"
                        aria-label="Jump to commit SHA"
                        autoComplete="off"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        disabled={shaJumpPending}
                      />
                      <button
                        type="submit"
                        className="commit-graph__sha-jump-submit inline-flex h-9 shrink-0 items-center rounded-xl border border-black/8 px-3 text-[11px] font-semibold text-ink transition hover:border-black/12 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={shaJumpPending}
                      >
                        {shaJumpPending ? "移動中" : "移動"}
                      </button>
                    </form>
                  ) : null}
                </>
              ) : (
                <span className="commit-graph__column-label">SHA</span>
              )}
            </div>
          ) : null}
        </div>

        {loading ? (
          <div className="p-4 text-sm text-ink-subtle">コミットを読み込み中...</div>
        ) : null}

        {hasWipRow ? renderWipRow() : null}

        {visibleCommits.map((commit, index) => {
          const isHighlighted = highlightedCommitSha === commit.sha;
          const isActive = activeCommitSha === commit.sha;
          const isCheckedOutCommit = checkedOutCommitSha === commit.sha;
          const avatarSrc = commitAuthorAvatars[commit.sha];
          const nodeSize = avatarSrc
            ? graphStyleMetrics.avatarNodeSize
            : graphStyleMetrics.nodeSize;
          const nodeHorizontalOverlap =
            graphStyle === "japaneseExpress" && avatarSrc
              ? Math.max(2, Math.min(4, nodeSize * 0.12))
              : null;
          const nodeJoinInset =
            graphStyle === "japaneseExpress" && avatarSrc
              ? Math.max(1, Math.min(2, nodeSize * 0.06))
              : Math.max(1, Math.min(3, nodeSize * 0.18));
          const row = laneLayout.rows[index] ?? {
            laneIndex: 0,
            activeLaneIndices: [0],
            incomingLaneIndices: [0],
            outgoingLaneIndices: [0],
            primaryParentLaneIndex: null,
            primaryParentRowIndex: null,
            mergeTargetLaneIndices: [],
          };
          const commitRefBadges = refBadgeBySha.get(commit.sha) ?? [];
          const isPrimaryBranchSourceRow =
            row.primaryParentLaneIndex !== null && row.primaryParentLaneIndex !== row.laneIndex;
          const primaryParentCommit =
            row.primaryParentRowIndex !== null
              ? (visibleCommits[row.primaryParentRowIndex] ?? null)
              : null;
          const primaryParentAvatarSrc = primaryParentCommit
            ? commitAuthorAvatars[primaryParentCommit.sha]
            : undefined;
          const primaryParentNodeSize = primaryParentAvatarSrc
            ? graphStyleMetrics.avatarNodeSize
            : graphStyleMetrics.nodeSize;
          const primaryParentHorizontalOverlap =
            graphStyle === "japaneseExpress" && primaryParentAvatarSrc
              ? Math.max(2, Math.min(4, primaryParentNodeSize * 0.12))
              : null;
          const primaryParentJoinInset =
            graphStyle === "japaneseExpress" && primaryParentAvatarSrc
              ? Math.max(1, Math.min(2, primaryParentNodeSize * 0.06))
              : Math.max(1, Math.min(3, primaryParentNodeSize * 0.18));
          const primaryParentJoinX =
            row.primaryParentLaneIndex !== null
              ? (() => {
                  const primaryParentLaneX = resolveLaneX(row.primaryParentLaneIndex);
                  const primaryParentDirection =
                    Math.sign(resolveLaneX(row.laneIndex) - primaryParentLaneX) || 1;
                  if (primaryParentHorizontalOverlap !== null) {
                    // Keep the horizontal segment hidden under the avatar long enough
                    // that it reads as leaving from the node's side, not the WIP stem.
                    return (
                      primaryParentLaneX - primaryParentDirection * primaryParentHorizontalOverlap
                    );
                  }

                  return (
                    primaryParentLaneX +
                    primaryParentDirection * (primaryParentNodeSize / 2 - primaryParentJoinInset)
                  );
                })()
              : null;
          const primaryParentTargetY =
            isPrimaryBranchSourceRow &&
            row.primaryParentRowIndex !== null &&
            row.primaryParentRowIndex > index
              ? (row.primaryParentRowIndex - index) * ROW_HEIGHT + ROW_HEIGHT / 2
              : null;
          const sharedStemLaneIndices = sharedStemLaneIndicesByRow.get(index) ?? [];
          const graphSvgHeight = Math.max(
            ROW_HEIGHT + LINE_OVERDRAW * 2,
            primaryParentTargetY !== null ? primaryParentTargetY + LINE_OVERDRAW * 2 : 0,
          );
          const rowLaneStroke = resolveLaneStroke(index, row.laneIndex);
          const nodeClassName = [
            "absolute block commit-node",
            avatarSrc ? "commit-node--avatar" : "",
            graphStyle === "japaneseExpress" ? "commit-node--japanese-express" : "",
            !avatarSrc && graphStyle === "standard" ? "border border-white/90 shadow-sm" : "",
            isCheckedOutCommit ? "commit-node-head-glow" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <Fragment key={commit.sha}>
              <div
                className={`commit-row ${isActive || isHighlighted ? "active" : ""}`}
                style={{ gridTemplateColumns }}
                data-animate="commit-enter"
                data-commit-sha={commit.sha}
                onClick={() => onSelectCommit(commit)}
                onDoubleClick={() => {
                  if (!busy) {
                    onCheckoutCommit(commit);
                  }
                }}
              >
                {isDetailedMode ? (
                  <div className="relative h-8" style={{ width: `${graphColumnWidth}px` }}>
                    <svg
                      className="absolute left-0"
                      width={graphColumnWidth}
                      height={graphSvgHeight}
                      style={{ top: `${-LINE_OVERDRAW}px` }}
                      viewBox={`0 ${-LINE_OVERDRAW} ${graphColumnWidth} ${graphSvgHeight}`}
                      fill="none"
                      overflow="hidden"
                    >
                      {row.activeLaneIndices.map((laneIndex) => {
                        const isReservedHeadEntryLane =
                          reservedHeadRowIndex > 0 &&
                          index === reservedHeadRowIndex &&
                          laneIndex === row.laneIndex;
                        const strokeWidth = resolveLaneStrokeWidth(index, laneIndex, row.laneIndex);
                        const hasIncoming =
                          ((index > 0 && row.incomingLaneIndices.includes(laneIndex)) ||
                            (hasWipRow && index === 0 && laneIndex === wipAnchor.laneIndex)) &&
                          !isReservedHeadEntryLane;
                        const isTopRowSiblingPassthroughLane =
                          index === 0 && laneIndex !== row.laneIndex && !hasIncoming;
                        const hasOutgoingRaw =
                          row.outgoingLaneIndices.includes(laneIndex) &&
                          !(isPrimaryBranchSourceRow && laneIndex === row.laneIndex);
                        const hasOutgoing =
                          hasOutgoingRaw &&
                          !(index === visibleCommits.length - 1 && !hasMore) &&
                          !isTopRowSiblingPassthroughLane;

                        if (!hasIncoming && !hasOutgoing) {
                          return null;
                        }

                        const y1 = hasIncoming ? -LINE_OVERDRAW : ROW_HEIGHT / 2 + strokeWidth / 2;
                        const y2 = hasOutgoing
                          ? ROW_HEIGHT + LINE_OVERDRAW
                          : ROW_HEIGHT / 2 - strokeWidth / 2;
                        const strokeDasharray = resolveLaneStrokeDasharray(index, laneIndex);
                        const strokeDashoffset = resolveLaneStrokeDashoffset(
                          laneIndex,
                          (index + 1) * ROW_HEIGHT + y1,
                        );

                        return (
                          <line
                            className="commit-graph__lane-line"
                            key={`${commit.sha}-${laneIndex}`}
                            x1={resolveLaneX(laneIndex)}
                            y1={y1}
                            x2={resolveLaneX(laneIndex)}
                            y2={y2}
                            stroke={resolveLaneStroke(index, laneIndex)}
                            strokeWidth={strokeWidth}
                            opacity={resolveLaneOpacity(index, laneIndex, row.laneIndex)}
                            strokeLinecap="round"
                            strokeDasharray={strokeDasharray}
                            strokeDashoffset={strokeDashoffset}
                          />
                        );
                      })}

                      {sharedStemLaneIndices.map((laneIndex) => {
                        const laneXValue = resolveLaneX(laneIndex);
                        const joinDirection =
                          Math.sign(laneXValue - resolveLaneX(row.laneIndex)) || 1;
                        const joinX =
                          nodeHorizontalOverlap !== null
                            ? resolveLaneX(row.laneIndex) - joinDirection * nodeHorizontalOverlap
                            : resolveLaneX(row.laneIndex) +
                              joinDirection * (nodeSize / 2 - nodeJoinInset);

                        return (
                          <line
                            className="commit-graph__lane-line"
                            key={`${commit.sha}-stem-${laneIndex}`}
                            x1={laneXValue}
                            y1={ROW_HEIGHT / 2}
                            x2={joinX}
                            y2={ROW_HEIGHT / 2}
                            stroke={resolveLaneStroke(index, laneIndex)}
                            strokeWidth={resolveLaneStrokeWidth(index, laneIndex, row.laneIndex)}
                            opacity={resolveLaneOpacity(index, laneIndex, row.laneIndex)}
                            strokeLinecap="round"
                          />
                        );
                      })}

                      {row.mergeTargetLaneIndices.map((targetLaneIndex) => {
                        const sourceX = resolveLaneX(row.laneIndex);
                        const targetX = resolveLaneX(targetLaneIndex);
                        const midY = ROW_HEIGHT / 2;
                        return (
                          <path
                            key={`${commit.sha}-merge-${targetLaneIndex}`}
                            d={`M ${sourceX} ${midY} C ${sourceX} ${midY + 6}, ${targetX} ${ROW_HEIGHT - 8}, ${targetX} ${ROW_HEIGHT}`}
                            stroke={resolveLaneStroke(index, targetLaneIndex)}
                            strokeWidth={resolveLaneStrokeWidth(index, targetLaneIndex, null)}
                            opacity={resolveLaneOpacity(index, targetLaneIndex, null)}
                          />
                        );
                      })}

                      {row.primaryParentLaneIndex !== null &&
                      row.primaryParentLaneIndex !== row.laneIndex ? (
                        <path
                          d={buildPrimaryParentCurvePath({
                            sourceLaneIndex: row.laneIndex,
                            targetLaneIndex: row.primaryParentLaneIndex,
                            targetY: primaryParentTargetY ?? ROW_HEIGHT,
                            resolveLaneX,
                            targetJoinX: primaryParentJoinX ?? undefined,
                          })}
                          stroke={rowLaneStroke}
                          strokeWidth={resolveLaneStrokeWidth(index, row.laneIndex, row.laneIndex)}
                          opacity={resolveLaneOpacity(index, row.laneIndex, row.laneIndex)}
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ) : null}
                    </svg>

                    <span
                      className={nodeClassName}
                      style={buildCommitNodeStyle(
                        rowLaneStroke,
                        nodeSize,
                        row.laneIndex,
                        avatarSrc,
                      )}
                    >
                      {avatarSrc ? (
                        <img
                          src={avatarSrc}
                          alt=""
                          aria-hidden="true"
                          className="commit-node__avatar"
                          draggable={false}
                        />
                      ) : null}
                    </span>
                  </div>
                ) : (
                  <div className="relative flex h-8 items-center justify-center">
                    <div
                      className="absolute"
                      style={{
                        width: `${graphStyleMetrics.compactLineWidth}px`,
                        top: `${-LINE_OVERDRAW}px`,
                        height: `${ROW_HEIGHT + LINE_OVERDRAW * 2}px`,
                        background:
                          graphStyle === "japaneseExpress"
                            ? rowLaneStroke
                            : "rgb(var(--color-accent) / 0.2)",
                      }}
                    />
                    <span
                      className={[
                        "commit-node",
                        avatarSrc ? "commit-node--avatar" : "",
                        graphStyle === "japaneseExpress" ? "commit-node--japanese-express" : "",
                        isCheckedOutCommit ? "commit-node-head-glow" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={buildCommitNodeStyle(
                        rowLaneStroke,
                        nodeSize,
                        row.laneIndex,
                        avatarSrc,
                      )}
                    >
                      {avatarSrc ? (
                        <img
                          src={avatarSrc}
                          alt=""
                          aria-hidden="true"
                          className="commit-node__avatar"
                          draggable={false}
                        />
                      ) : null}
                    </span>
                  </div>
                )}

                <div className="overflow-hidden whitespace-nowrap text-xs text-ink-soft">
                  {commitRefBadges.length > 0 ? (
                    <div className="flex items-center gap-1 overflow-hidden">
                      {commitRefBadges.map((badge) => {
                        const isCheckedOutRefBadge = badge.type === "head";
                        const badgeScopeIcons = (
                          <span className="commit-graph__ref-badge-icons" aria-hidden="true">
                            {badge.scopes.map((scope) => {
                              const RefBadgeIcon = refLabelIcon(scope);
                              return (
                                <RefBadgeIcon
                                  key={`${badge.name}-${scope}`}
                                  size={REF_BADGE_ICON_SIZE}
                                  className={refLabelIconClass(scope)}
                                />
                              );
                            })}
                          </span>
                        );

                        return (
                          <span
                            key={`${commit.sha}-${badge.type}-${badge.name}`}
                            className={`commit-graph__ref-badge inline-flex min-w-0 shrink-0 items-center rounded-full border px-2 py-px text-[10px] font-semibold leading-4 ${refLabelClass(
                              badge.type,
                            )} ${badge.type === "tag" ? "" : "cursor-pointer"}`}
                            style={{ maxWidth: `${Math.max(90, displayedRefsColumnWidth - 16)}px` }}
                            title={badge.title}
                            onDoubleClick={(event) => {
                              if (busy || badge.type === "tag") {
                                return;
                              }

                              event.preventDefault();
                              event.stopPropagation();
                              onCheckoutBranchRef(badge.name);
                            }}
                          >
                            {isCheckedOutRefBadge ? (
                              <Check
                                size={REF_BADGE_DONE_ICON_SIZE}
                                className="commit-graph__ref-badge-done"
                                aria-hidden="true"
                              />
                            ) : (
                              badgeScopeIcons
                            )}
                            <span className="commit-graph__ref-badge-label truncate">
                              {badge.name}
                            </span>
                            {isCheckedOutRefBadge ? badgeScopeIcons : null}
                          </span>
                        );
                      })}
                    </div>
                  ) : null}
                </div>

                {!isCompactLayout ? (
                  <div className="truncate text-xs text-ink-soft">
                    {formatRelativeDate(commit.date)}
                  </div>
                ) : null}
                <div className="commit-graph__cell--primary truncate text-sm text-ink">
                  {commit.subject}
                </div>
                <div className="truncate text-xs text-ink-soft">{commit.author}</div>
                {!isCompactLayout ? (
                  <div className="commit-id-column truncate text-xs text-ink-subtle">
                    <button
                      type="button"
                      className="inline-flex max-w-full cursor-pointer items-center truncate rounded-sm border border-transparent px-1 py-px text-left transition hover:text-ink focus-visible:border-black/10 focus-visible:outline-none"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        handleCopySha(commit.sha);
                      }}
                      onDoubleClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      title={`${commit.sha} をコピー`}
                      aria-label={`${commit.sha} をクリップボードにコピー`}
                    >
                      <span className="truncate">{shortSha(commit.sha)}</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </Fragment>
          );
        })}

        {!loading && visibleCommits.length === 0 ? (
          <div className="p-4 text-sm text-ink-subtle">コミットが見つかりません。</div>
        ) : null}

        {loadingMore ? (
          <div className="p-4 text-xs text-ink-subtle">さらに読み込み中...</div>
        ) : null}
      </div>
    </section>
  );
}
