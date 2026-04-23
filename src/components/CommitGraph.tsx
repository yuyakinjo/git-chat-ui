import { animate, stagger } from "animejs";
import { Check } from "lucide-react";
import {
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
import {
  buildCommitBranchColoring,
  type BranchTip,
} from "../lib/commitGraphBranchColoring";
import { resolveCommitGraphColumnLayout } from "../lib/commitGraphColumns";
import { buildLaneRows, type CommitForLane } from "../lib/commitGraphLayout";
import { resolveDefaultBranch } from "../lib/controllerViewUtils";
import { formatRelativeDate, shortSha } from "../lib/format";
import type {
  BranchResponse,
  CommitGraphMode,
  CommitGraphStyle,
  CommitListItem,
  CommitMergeAnimation,
  StashEntry,
} from "../types";
import {
  buildCommitRefBadges,
  buildPrimaryParentCurvePath,
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
  ROW_STEP,
  resolveCommitGraphStyleMetrics,
  STASH_LANE_COLOR,
  StashNode,
  WipNode,
  type CommitRefLabel,
} from "./CommitGraphHelpers";

interface CommitGraphProps {
  commits: CommitListItem[];
  commitAuthorAvatars?: Record<string, string>;
  mode: CommitGraphMode;
  graphStyle: CommitGraphStyle;
  mergeAnimation?: CommitMergeAnimation;
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
  stashes?: StashEntry[];
  onSelectStash?: (stash: StashEntry) => void;
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

function normalizeCurrentBranchLabels(
  labels: CommitRefLabel[],
  options: {
    currentLocalBranchName: string;
    isCurrentBranchCommit: boolean;
  },
): CommitRefLabel[] {
  const currentLocalBranchName = options.currentLocalBranchName.trim();
  const normalizedLabels: CommitRefLabel[] = labels.map((label) => ({
    ...label,
    type: label.type === "head" ? "branch" : label.type,
  }));

  if (!currentLocalBranchName) {
    return normalizedLabels;
  }

  let promoted = false;
  const promotedLabels = normalizedLabels.map((label) => {
    if (
      options.isCurrentBranchCommit &&
      label.type !== "tag" &&
      label.name === currentLocalBranchName
    ) {
      promoted = true;
      return {
        ...label,
        type: "head",
      } satisfies CommitRefLabel;
    }

    return label;
  });

  if (!options.isCurrentBranchCommit || promoted) {
    return promotedLabels;
  }

  return [
    {
      type: "head",
      name: currentLocalBranchName,
    },
    ...promotedLabels,
  ];
}

export function CommitGraph({
  commits,
  commitAuthorAvatars = {},
  mode,
  graphStyle,
  mergeAnimation = "none",
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
  stashes = [],
  onSelectStash,
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

  const currentLocalBranch = useMemo(
    () => branchContext?.local.find((branch) => branch.name === branchContext.current) ?? null,
    [branchContext],
  );
  const currentLocalBranchName = currentLocalBranch?.name ?? "";
  const currentLocalBranchCommitSha = currentLocalBranch?.commit ?? "";
  const defaultBranchHeadSha = useMemo(
    () => resolveDefaultBranch(branchContext)?.commit ?? null,
    [branchContext],
  );
  const graphStyleMetrics = useMemo(() => resolveCommitGraphStyleMetrics(graphStyle), [graphStyle]);
  const commitDateBySha = useMemo(() => {
    const map = new Map<string, number>();
    for (const commit of commits) {
      const parsed = new Date(commit.date).getTime();
      map.set(commit.sha, Number.isFinite(parsed) ? parsed : -Infinity);
    }
    return map;
  }, [commits]);
  const branchTipsForColoring = useMemo<BranchTip[]>(() => {
    if (!branchContext) {
      return [];
    }
    const currentName = branchContext.current.trim();
    const registeredShortNames = new Set<string>();
    const tipDate = (sha: string): number => commitDateBySha.get(sha) ?? -Infinity;
    const compareByPriority = <T extends { name: string; commit: string }>(a: T, b: T): number => {
      if (a.name === currentName && b.name !== currentName) return -1;
      if (b.name === currentName && a.name !== currentName) return 1;
      const da = tipDate(a.commit);
      const db = tipDate(b.commit);
      if (da !== db) return db - da;
      return a.name.localeCompare(b.name);
    };
    const localSorted = [...branchContext.local].sort(compareByPriority);
    const tips: BranchTip[] = [];
    for (const branch of localSorted) {
      tips.push({ name: branch.name, sha: branch.commit });
      registeredShortNames.add(branch.name);
    }
    const remoteSorted = [...branchContext.remote].sort(compareByPriority);
    for (const branch of remoteSorted) {
      const slashIndex = branch.name.indexOf("/");
      if (slashIndex <= 0) {
        continue;
      }
      const shortName = branch.name.slice(slashIndex + 1);
      if (!shortName || shortName === "HEAD" || registeredShortNames.has(shortName)) {
        continue;
      }
      tips.push({ name: branch.name, sha: branch.commit });
      registeredShortNames.add(shortName);
    }
    return tips;
  }, [branchContext, commitDateBySha]);
  const defaultBranchName = useMemo(
    () => resolveDefaultBranch(branchContext)?.name ?? null,
    [branchContext],
  );
  const branchColoring = useMemo(
    () =>
      buildCommitBranchColoring({
        commits: commits.map((commit) => ({
          sha: commit.sha,
          parentShas: commit.parentShas,
        })),
        branchTips: branchTipsForColoring,
      }),
    [commits, branchTipsForColoring],
  );
  const laneLayout = useMemo(() => {
    const laneCommits: CommitForLane[] = commits.map((commit) => ({
      sha: commit.sha,
      parentShas: commit.parentShas,
      branchTag: branchColoring.get(commit.sha.trim()) ?? null,
    }));
    return buildLaneRows(laneCommits, {
      defaultBranchHeadSha,
      defaultBranchName,
    });
  }, [branchColoring, commits, defaultBranchHeadSha, defaultBranchName]);
  // -- Unified timeline: interleave commits and stashes by date (newest-first) --
  type TimelineCommitEntry = { type: "commit"; commit: CommitListItem; commitIndex: number };
  type TimelineStashEntry = { type: "stash"; stash: StashEntry };
  type TimelineEntry = TimelineCommitEntry | TimelineStashEntry;

  const shaToCommitIndex = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < commits.length; i++) {
      map.set(commits[i].sha, i);
    }
    return map;
  }, [commits]);

  const timeline: TimelineEntry[] = useMemo(() => {
    const commitEntries: (TimelineEntry & { _ts: number })[] = commits.map((commit, i) => ({
      type: "commit" as const,
      commit,
      commitIndex: i,
      _ts: new Date(commit.date).getTime(),
    }));
    const stashEntries: (TimelineEntry & { _ts: number })[] = stashes.map((stash) => ({
      type: "stash" as const,
      stash,
      _ts: new Date(stash.date).getTime(),
    }));
    return [...commitEntries, ...stashEntries]
      .sort((a, b) => b._ts - a._ts)
      .map(({ _ts: _, ...entry }) => entry as TimelineEntry);
  }, [commits, stashes]);

  const commitIndexToTimelineIndex = useMemo(() => {
    const map = new Map<number, number>();
    for (let t = 0; t < timeline.length; t++) {
      const entry = timeline[t];
      if (entry.type === "commit") {
        map.set(entry.commitIndex, t);
      }
    }
    return map;
  }, [timeline]);

  // 各 stash は専用レーンに配置する。ブランチのレーン（過去に登場したものを
  // 含む）とは視覚的に混ざらないよう、常にコミットグラフ全体の maxLanes より
  // 右側へ配置する。stash 同士は詰めて並べる。
  const stashLayout = useMemo(() => {
    const laneByStashId = new Map<string, number>();
    let extraStashLanes = 0;
    const hasDefaultBranch = (defaultBranchHeadSha ?? "").trim() !== "";
    const minStashLane = hasDefaultBranch ? 1 : 0;
    const stashLaneFloor = Math.max(minStashLane, laneLayout.maxLanes);
    // 同じコミット区間に並ぶ stash 同士でもレーンが被らないよう、
    // preceding/following コミットのペアごとに割当済みレーンを記録する。
    const assignedLanesByBoundary = new Map<string, Set<number>>();

    for (let t = 0; t < timeline.length; t++) {
      const entry = timeline[t];
      if (entry.type !== "stash") continue;

      let nearestPrecedingCommitIndex: number | null = null;
      for (let ti = t - 1; ti >= 0; ti--) {
        const e = timeline[ti];
        if (e.type === "commit") {
          nearestPrecedingCommitIndex = e.commitIndex;
          break;
        }
      }
      let nearestFollowingCommitIndex: number | null = null;
      for (let ti = t + 1; ti < timeline.length; ti++) {
        const e = timeline[ti];
        if (e.type === "commit") {
          nearestFollowingCommitIndex = e.commitIndex;
          break;
        }
      }

      const boundaryKey = `${nearestPrecedingCommitIndex ?? "_"}:${nearestFollowingCommitIndex ?? "_"}`;
      const lanesTakenByNeighbourStashes =
        assignedLanesByBoundary.get(boundaryKey) ?? new Set<number>();

      let stashLaneIndex = stashLaneFloor;
      while (lanesTakenByNeighbourStashes.has(stashLaneIndex)) {
        stashLaneIndex += 1;
      }

      laneByStashId.set(entry.stash.id, stashLaneIndex);
      lanesTakenByNeighbourStashes.add(stashLaneIndex);
      assignedLanesByBoundary.set(boundaryKey, lanesTakenByNeighbourStashes);

      const extra = Math.max(0, stashLaneIndex - laneLayout.maxLanes + 1);
      if (extra > extraStashLanes) {
        extraStashLanes = extra;
      }
    }

    return { laneByStashId, extraStashLanes };
  }, [timeline, laneLayout, defaultBranchHeadSha]);

  /** Count non-commit (stash) rows that sit between two commits in the timeline. */
  const stashRowsBetweenCommits = useCallback(
    (fromCommitIndex: number, toCommitIndex: number): number => {
      const fromTl = commitIndexToTimelineIndex.get(fromCommitIndex);
      const toTl = commitIndexToTimelineIndex.get(toCommitIndex);
      if (fromTl == null || toTl == null) return 0;
      let count = 0;
      const lo = Math.min(fromTl, toTl);
      const hi = Math.max(fromTl, toTl);
      for (let i = lo + 1; i < hi; i++) {
        if (timeline[i].type === "stash") count++;
      }
      return count;
    },
    [commitIndexToTimelineIndex, timeline],
  );
  // 上の行の primary parent curve が担う合流先 lane を row 毎にまとめる。
  // ここに含まれる lane は converging 水平線を描くと curve と重なり二股に見えるためスキップする。
  const convergingLanesCoveredByPrimaryCurveByRow = useMemo(() => {
    const byRow = new Map<number, Set<number>>();
    laneLayout.rows.forEach((row, rowIndex) => {
      if (
        row.primaryParentLaneIndex === null ||
        row.primaryParentLaneIndex === row.laneIndex ||
        row.primaryParentRowIndex === null ||
        row.primaryParentRowIndex <= rowIndex
      ) {
        return;
      }
      const lanes = byRow.get(row.primaryParentRowIndex) ?? new Set<number>();
      lanes.add(row.laneIndex);
      byRow.set(row.primaryParentRowIndex, lanes);
    });
    return byRow;
  }, [laneLayout.rows]);
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
          buildCommitRefBadges(
            normalizeCurrentBranchLabels(parseCommitRefLabels(commit.decoration), {
              currentLocalBranchName,
              isCurrentBranchCommit: commit.sha === currentLocalBranchCommitSha,
            }),
            commitRefScopeContext,
          ),
        ]),
      ),
    [commits, commitRefScopeContext, currentLocalBranchCommitSha, currentLocalBranchName],
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

    const nextVisibleCommitCount = timeline.length;
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
  }, [timeline.length]);

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
  }, [onScrollToCommitHandled, scrollToCommitSha, timeline.length]);

  const isDetailedMode = mode === "detailed";
  const effectiveMaxLanes = Math.max(
    laneLayout.maxLanes + stashLayout.extraStashLanes,
    1,
  );
  const laneDisplayOffsets = useMemo(
    () =>
      Array.from({ length: effectiveMaxLanes }, (_, laneIndex) =>
        getLaneDisplayOffset(laneIndex, graphStyle),
      ),
    [graphStyle, effectiveMaxLanes],
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

    const anchorHeadSha = (checkedOutCommitSha ?? "").trim();
    const anchorRowIndex = anchorHeadSha
      ? commits.findIndex((commit) => commit.sha.trim() === anchorHeadSha)
      : -1;
    const anchorLaneIndex =
      anchorRowIndex >= 0 ? (laneLayout.rows[anchorRowIndex]?.laneIndex ?? 0) : 0;

    return {
      incomingLaneIndices: [] as number[],
      rowIndex: 0,
      laneIndex: anchorLaneIndex,
    };
  }, [hasWipRow, laneLayout.rows, checkedOutCommitSha, commits]);
  const resolveLaneStroke = useCallback(
    (_rowIndex: number, laneIndex: number) =>
      laneColor(laneIndex, 0, graphStyle),
    [graphStyle],
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

        {timeline.map((timelineEntry, timelineIndex) => {
          // --- Stash row (standalone, at its chronological position) ---
          if (timelineEntry.type === "stash") {
            const stash = timelineEntry.stash;
            const parentCommitIndex = shaToCommitIndex.get(stash.parentSha?.trim() ?? "");
            const parentRow =
              parentCommitIndex != null ? (laneLayout.rows[parentCommitIndex] ?? null) : null;
            const stashParentLaneIndex = parentRow?.laneIndex ?? 0;
            // gitkraken のように stash を独立したレーンに描画する。
            // レーン番号は事前計算済み（stashLayout）。見つからない場合は親レーンにフォールバック。
            const stashLaneIndex =
              stashLayout.laneByStashId.get(stash.id) ?? stashParentLaneIndex;
            const stashIsOnOwnLane = stashLaneIndex !== stashParentLaneIndex;
            const stashNodeSize = graphStyleMetrics.stashNodeSize;
            const stashNodeCenter = stashNodeSize / 2;
            const stashIconTopY = ROW_HEIGHT / 2 - stashNodeCenter;
            const stashIconBottomY = ROW_HEIGHT / 2 + stashNodeCenter;
            const parentLaneX = resolveLaneX(stashParentLaneIndex);
            const stashLaneX = resolveLaneX(stashLaneIndex);
            const parentLaneStroke =
              parentCommitIndex != null
                ? resolveLaneStroke(parentCommitIndex, stashParentLaneIndex)
                : STASH_LANE_COLOR;

            // Determine which lanes are actually active at this timeline position.
            // Use the nearest following commit's incomingLaneIndices (lanes arriving
            // from above) — these are the lanes that truly pass through this row.
            let nearestFollowingCommitIndex: number | null = null;
            for (let ti = timelineIndex + 1; ti < timeline.length; ti++) {
              const e = timeline[ti];
              if (e.type === "commit") {
                nearestFollowingCommitIndex = e.commitIndex;
                break;
              }
            }
            let nearestPrecedingCommitIndex: number | null = null;
            for (let ti = timelineIndex - 1; ti >= 0; ti--) {
              const e = timeline[ti];
              if (e.type === "commit") {
                nearestPrecedingCommitIndex = e.commitIndex;
                break;
              }
            }
            const followingRow =
              nearestFollowingCommitIndex != null
                ? (laneLayout.rows[nearestFollowingCommitIndex] ?? null)
                : null;
            const precedingRow =
              nearestPrecedingCommitIndex != null
                ? (laneLayout.rows[nearestPrecedingCommitIndex] ?? null)
                : null;
            // Active lanes that pass through this stash row.
            // Priority: preceding commit's outgoingLaneIndices → following commit's
            // incomingLaneIndices → WIP lane → empty.
            // Note: `??` doesn't trigger on empty arrays so we check `.length`.
            // Passthrough lanes: stash shares the parent lane, so no separate stash
            // column needs to be excluded from this list.
            // When no neighbouring commit provides lanes and there is no WIP row,
            // fall back to the parent lane index (same as original behaviour).
            const passthroughLanes: number[] = (() => {
              const fromPreceding = precedingRow?.outgoingLaneIndices;
              if (fromPreceding?.length) return fromPreceding;
              const fromFollowing = followingRow?.incomingLaneIndices;
              if (fromFollowing?.length) return fromFollowing;
              // Stash is above all commits – only the WIP lane passes through.
              if (hasWipRow) return [wipAnchor.laneIndex];
              return [stashParentLaneIndex];
            })();
            // Resolve stroke color from the nearest commit context
            const laneStrokeRefIndex =
              nearestPrecedingCommitIndex ?? nearestFollowingCommitIndex ?? 0;

            // Calculate Y distance from this stash row down to its parent commit row.
            // The SVG extends downward so the dashed stash line reaches the parent.
            const parentTimelineIdx =
              parentCommitIndex != null
                ? commitIndexToTimelineIndex.get(parentCommitIndex) ?? null
                : null;
            const stashToParentRowCount =
              parentTimelineIdx != null ? parentTimelineIdx - timelineIndex : 1;
            const stashToParentY = stashToParentRowCount * ROW_STEP;
            const stashSvgHeight = Math.max(
              ROW_HEIGHT + LINE_OVERDRAW * 2,
              stashToParentY + ROW_HEIGHT / 2 + LINE_OVERDRAW,
            );
            // Without a WIP row above, nothing should visually connect into the stash row
            // from the header. Starting lane stems at the stash icon top avoids stray
            // coloured segments (other branches' incoming lanes) above the icon.
            const stashSolidLineY1 = hasWipRow ? -LINE_OVERDRAW : stashIconTopY;
            const stashSvgTopPx = hasWipRow ? -LINE_OVERDRAW : 0;
            const stashViewBoxY = hasWipRow ? -LINE_OVERDRAW : 0;

            return (
              <div
                key={stash.id}
                className="stash-row commit-row"
                style={{ gridTemplateColumns }}
                data-animate="commit-enter"
                onClick={() => onSelectStash?.(stash)}
                title={`${stash.id}: ${stash.message}`}
              >
                {isDetailedMode ? (
                  <div
                    className="relative h-8"
                    style={{ width: `${graphColumnWidth}px` }}
                  >
                    <svg
                      className="absolute left-0"
                      width={graphColumnWidth}
                      height={stashSvgHeight}
                      style={{ top: `${stashSvgTopPx}px` }}
                      viewBox={`0 ${stashViewBoxY} ${graphColumnWidth} ${stashSvgHeight}`}
                      fill="none"
                      overflow="visible"
                    >
                      {/* 1. Solid passthrough lines. Stash は独立レーンにあるので、
                          通過コミットのレーンは上下とも実線で描画する。stashIsOnOwnLane=false
                          （フォールバック）の場合のみ、旧挙動で親レーンは上部のみに留める。 */}
                      {passthroughLanes
                        .filter((laneIdx) => laneIdx !== stashLaneIndex)
                        .map((laneIdx) => {
                          const lx = resolveLaneX(laneIdx);
                          const stroke = resolveLaneStroke(laneStrokeRefIndex, laneIdx);
                          const common = {
                            strokeWidth: graphStyleMetrics.detailedLineWidth,
                            opacity: graphStyleMetrics.detailedLineOpacity,
                            strokeLinecap: "round" as const,
                          };
                          if (!stashIsOnOwnLane && laneIdx === stashParentLaneIndex) {
                            if (stashSolidLineY1 >= stashIconTopY - 0.001) {
                              return null;
                            }
                            return (
                              <line
                                key={`stash-pass-${stash.id}-${laneIdx}`}
                                x1={lx}
                                y1={stashSolidLineY1}
                                x2={lx}
                                y2={stashIconTopY}
                                stroke={stroke}
                                {...common}
                              />
                            );
                          }

                          return (
                            <line
                              key={`stash-pass-${stash.id}-${laneIdx}`}
                              x1={lx}
                              y1={stashSolidLineY1}
                              x2={lx}
                              y2={ROW_HEIGHT + LINE_OVERDRAW}
                              stroke={stroke}
                              {...common}
                            />
                          );
                        })}
                      {/* 親レーンがpassthroughに含まれない場合のフォールバック描画。
                          独立レーン時は上下全域、フォールバック（親と同一レーン）時は上部のみ。 */}
                      {!passthroughLanes.includes(stashParentLaneIndex) ? (
                        stashIsOnOwnLane ? (
                          <line
                            x1={parentLaneX}
                            y1={stashSolidLineY1}
                            x2={parentLaneX}
                            y2={ROW_HEIGHT + LINE_OVERDRAW}
                            stroke={parentLaneStroke}
                            strokeWidth={graphStyleMetrics.detailedLineWidth}
                            opacity={graphStyleMetrics.detailedLineOpacity}
                            strokeLinecap="round"
                          />
                        ) : stashSolidLineY1 < stashIconTopY - 0.001 ? (
                          <line
                            x1={parentLaneX}
                            y1={stashSolidLineY1}
                            x2={parentLaneX}
                            y2={stashIconTopY}
                            stroke={parentLaneStroke}
                            strokeWidth={graphStyleMetrics.detailedLineWidth}
                            opacity={graphStyleMetrics.detailedLineOpacity}
                            strokeLinecap="round"
                          />
                        ) : null
                      ) : null}
                      {/* 2. Dashed stash connector: stashレーンから親レーンへ肘曲線で接続。
                          従来挙動（親レーンと同一）は縦直線にフォールバック。 */}
                      <path
                        d={(() => {
                          const parentY = stashToParentY + ROW_HEIGHT / 2;
                          if (!stashIsOnOwnLane) {
                            return `M ${stashLaneX} ${stashIconBottomY} L ${stashLaneX} ${parentY}`;
                          }
                          const dirX = parentLaneX < stashLaneX ? -1 : 1;
                          const cornerR = Math.max(
                            0,
                            Math.min(
                              graphStyleMetrics.elbowCornerRadius,
                              Math.abs(stashLaneX - parentLaneX) / 2,
                              (parentY - stashIconBottomY) / 2,
                            ),
                          );
                          return [
                            `M ${stashLaneX} ${stashIconBottomY}`,
                            `L ${stashLaneX} ${parentY - cornerR}`,
                            `Q ${stashLaneX} ${parentY} ${stashLaneX + dirX * cornerR} ${parentY}`,
                            `L ${parentLaneX} ${parentY}`,
                          ].join(" ");
                        })()}
                        stroke={STASH_LANE_COLOR}
                        strokeWidth={graphStyleMetrics.detailedLineWidth}
                        opacity={0.7}
                        strokeDasharray="3 2.5"
                        fill="none"
                        strokeLinecap="butt"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <StashNode
                      className="absolute block"
                      style={{
                        left: `${stashLaneX - stashNodeCenter}px`,
                        top: `${ROW_HEIGHT / 2 - stashNodeCenter}px`,
                      }}
                      size={stashNodeSize}
                      strokeWidth={graphStyleMetrics.stashNodeStrokeWidth}
                      variant={graphStyle}
                    />
                  </div>
                ) : (
                  <div className="relative flex h-8 items-center justify-center">
                    <div
                      className="absolute"
                      style={{
                        width: `${graphStyleMetrics.compactLineWidth}px`,
                        top: 0,
                        height: `${ROW_HEIGHT}px`,
                        background: parentLaneStroke,
                        opacity: graphStyleMetrics.detailedLineOpacity,
                      }}
                    />
                    <StashNode
                      size={stashNodeSize}
                      strokeWidth={graphStyleMetrics.stashNodeStrokeWidth}
                      variant={graphStyle}
                    />
                  </div>
                )}
                <div className="overflow-hidden whitespace-nowrap text-xs" />
                {!isCompactLayout ? (
                  <div className="stash-row__meta truncate text-xs">
                    {formatRelativeDate(stash.date)}
                  </div>
                ) : null}
                <div className="stash-row__primary truncate text-sm">
                  {stash.message}
                </div>
                <div className="stash-row__meta truncate text-xs">
                  {stash.files.length > 0 ? `${stash.files.length} files` : "—"}
                </div>
                {!isCompactLayout ? (
                  <div className="stash-row__meta commit-id-column truncate text-xs">
                    {stash.sha ? (
                      <button
                        type="button"
                        className="cursor-pointer truncate hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          void copyTextToClipboard(stash.sha);
                          onNotify("SHA をコピーしました");
                        }}
                        title={`${stash.sha} をコピー`}
                      >
                        {shortSha(stash.sha)}
                      </button>
                    ) : (
                      "—"
                    )}
                  </div>
                ) : null}
              </div>
            );
          }

          // --- Commit row ---
          const commit = timelineEntry.commit;
          const index = timelineEntry.commitIndex;
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
            convergingLaneIndices: [],
          };
          const commitRefBadges = refBadgeBySha.get(commit.sha) ?? [];
          const isPrimaryBranchSourceRow =
            row.primaryParentLaneIndex !== null && row.primaryParentLaneIndex !== row.laneIndex;
          const primaryParentCommit =
            row.primaryParentRowIndex !== null
              ? (commits[row.primaryParentRowIndex] ?? null)
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
          const interveningStashRows =
            isPrimaryBranchSourceRow &&
            row.primaryParentRowIndex !== null &&
            row.primaryParentRowIndex > index
              ? stashRowsBetweenCommits(index, row.primaryParentRowIndex)
              : 0;
          const primaryParentTargetY =
            isPrimaryBranchSourceRow &&
            row.primaryParentRowIndex !== null &&
            row.primaryParentRowIndex > index
              ? (row.primaryParentRowIndex - index + interveningStashRows) * ROW_STEP +
                ROW_HEIGHT / 2
              : null;
          // マージ曲線も 1 行分下の中央まで延ばして垂直優勢な「↱」形に見せる
          // (行内完結だと曲がり角が始点に寄り過ぎて「⤴」に見えるため)
          const hasRenderedMergeTarget = row.mergeTargetLaneIndices.some(
            (targetLaneIndex) => targetLaneIndex !== row.primaryParentLaneIndex,
          );
          const mergeTargetCurveY = hasRenderedMergeTarget
            ? ROW_STEP + ROW_HEIGHT / 2
            : null;
          const graphSvgHeight = Math.max(
            ROW_HEIGHT + LINE_OVERDRAW * 2,
            primaryParentTargetY !== null ? primaryParentTargetY + LINE_OVERDRAW * 2 : 0,
            mergeTargetCurveY !== null ? mergeTargetCurveY + LINE_OVERDRAW * 2 : 0,
          );
          const rowLaneStroke = resolveLaneStroke(index, row.laneIndex);
          const isMergeCommit = commit.parentShas.length >= 2;
          const activeMergeAnimation: CommitMergeAnimation = isMergeCommit
            ? mergeAnimation
            : "none";
          const mergePulseApplied = activeMergeAnimation === "pulse";
          const mergeRingAnimation =
            activeMergeAnimation === "ripple" ||
            activeMergeAnimation === "orbit" ||
            activeMergeAnimation === "shimmer" ||
            activeMergeAnimation === "metaball" ||
            activeMergeAnimation === "morph" ||
            activeMergeAnimation === "dissolve" ||
            activeMergeAnimation === "particle"
              ? activeMergeAnimation
              : null;
          const nodeClassName = [
            "absolute block commit-node",
            avatarSrc ? "commit-node--avatar" : "",
            graphStyle === "japaneseExpress" ? "commit-node--japanese-express" : "",
            !avatarSrc && graphStyle === "standard" ? "border border-white/90 shadow-sm" : "",
            isCheckedOutCommit ? "commit-node-head-glow" : "",
            mergePulseApplied ? "commit-node-merge-pulse" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
              <div
                key={commit.sha}
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
                        const strokeWidth = resolveLaneStrokeWidth(index, laneIndex, row.laneIndex);
                        // 前後行で同じ laneIndex に dot が乗っている場合は、
                        // layout 側の incoming/outgoing に含まれていなくても
                        // 視覚的な連続性を保つために縦線を強制する。
                        // (elbow で lane が CLOSED された直後、同じ lane が
                        // 再利用されるケースで縦線が途切れる問題への対応)
                        const prevRowLaneIndex =
                          index > 0 ? (laneLayout.rows[index - 1]?.laneIndex ?? null) : null;
                        const nextRowLaneIndex =
                          index < commits.length - 1
                            ? (laneLayout.rows[index + 1]?.laneIndex ?? null)
                            : null;
                        const isPrevRowReusingLane =
                          laneIndex === row.laneIndex && prevRowLaneIndex === laneIndex;
                        const isNextRowReusingLane =
                          laneIndex === row.laneIndex && nextRowLaneIndex === laneIndex;
                        const hasIncoming =
                          (index > 0 && row.incomingLaneIndices.includes(laneIndex)) ||
                          (hasWipRow && index === 0 && laneIndex === wipAnchor.laneIndex) ||
                          isPrevRowReusingLane;
                        const isTopRowSiblingPassthroughLane =
                          index === 0 && laneIndex !== row.laneIndex && !hasIncoming;
                        const hasOutgoingRaw =
                          (row.outgoingLaneIndices.includes(laneIndex) &&
                            !(isPrimaryBranchSourceRow && laneIndex === row.laneIndex)) ||
                          isNextRowReusingLane;
                        const hasOutgoing =
                          hasOutgoingRaw &&
                          !(index === commits.length - 1 && !hasMore) &&
                          !isTopRowSiblingPassthroughLane;

                        if (!hasIncoming && !hasOutgoing) {
                          return null;
                        }

                        // マージカーブまたは primary parent カーブが接続を担うため stub 線をスキップ
                        if (
                          !hasIncoming &&
                          (row.mergeTargetLaneIndices.includes(laneIndex) ||
                            (row.primaryParentLaneIndex === laneIndex &&
                              row.primaryParentLaneIndex !== row.laneIndex))
                        ) {
                          return null;
                        }

                        // converging lane は下の合流カーブが接続を担うため縦線をスキップ
                        if (
                          laneIndex !== row.laneIndex &&
                          !hasOutgoing &&
                          row.convergingLaneIndices.includes(laneIndex)
                        ) {
                          return null;
                        }

                        const y1 = hasIncoming ? -LINE_OVERDRAW : ROW_HEIGHT / 2 + strokeWidth / 2;
                        const y2 = hasOutgoing
                          ? ROW_HEIGHT + LINE_OVERDRAW
                          : ROW_HEIGHT / 2 - strokeWidth / 2;

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
                          />
                        );
                      })}

                      {row.convergingLaneIndices
                        .filter((convergingLaneIdx) => {
                          const covered =
                            convergingLanesCoveredByPrimaryCurveByRow.get(index);
                          return !(covered && covered.has(convergingLaneIdx));
                        })
                        .map((convergingLaneIdx) => {
                          const laneXValue = resolveLaneX(convergingLaneIdx);
                          const joinDirection =
                            Math.sign(laneXValue - resolveLaneX(row.laneIndex)) || 1;
                          const joinX =
                            nodeHorizontalOverlap !== null
                              ? resolveLaneX(row.laneIndex) - joinDirection * nodeHorizontalOverlap
                              : resolveLaneX(row.laneIndex) +
                                joinDirection * (nodeSize / 2 - nodeJoinInset);

                          return (
                            <path
                              className="commit-graph__lane-line"
                              key={`${commit.sha}-converge-${convergingLaneIdx}`}
                              d={buildPrimaryParentCurvePath({
                                sourceLaneIndex: convergingLaneIdx,
                                targetLaneIndex: row.laneIndex,
                                startY: -LINE_OVERDRAW,
                                targetY: ROW_HEIGHT / 2,
                                resolveLaneX,
                                targetJoinX: joinX,
                                cornerRadius: graphStyleMetrics.elbowCornerRadius,
                              })}
                              stroke={resolveLaneStroke(index, convergingLaneIdx)}
                              strokeWidth={resolveLaneStrokeWidth(
                                index,
                                convergingLaneIdx,
                                row.laneIndex,
                              )}
                              opacity={resolveLaneOpacity(index, convergingLaneIdx, row.laneIndex)}
                              fill="none"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          );
                        })}

                      {row.mergeTargetLaneIndices
                        .filter((targetLaneIndex) => targetLaneIndex !== row.primaryParentLaneIndex)
                        .map((targetLaneIndex) => (
                          <path
                            key={`${commit.sha}-merge-${targetLaneIndex}`}
                            d={buildPrimaryParentCurvePath({
                              sourceLaneIndex: row.laneIndex,
                              targetLaneIndex,
                              targetY: mergeTargetCurveY ?? ROW_HEIGHT + LINE_OVERDRAW,
                              resolveLaneX,
                              cornerRadius: graphStyleMetrics.elbowCornerRadius,
                              elbowSide: "start",
                            })}
                            stroke={resolveLaneStroke(index, targetLaneIndex)}
                            strokeWidth={resolveLaneStrokeWidth(index, targetLaneIndex, null)}
                            opacity={resolveLaneOpacity(index, targetLaneIndex, null)}
                            fill="none"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        ))}

                      {row.primaryParentLaneIndex !== null &&
                      row.primaryParentLaneIndex !== row.laneIndex ? (
                        <path
                          d={buildPrimaryParentCurvePath({
                            sourceLaneIndex: row.laneIndex,
                            targetLaneIndex: row.primaryParentLaneIndex,
                            targetY: primaryParentTargetY ?? ROW_HEIGHT,
                            resolveLaneX,
                            targetJoinX: primaryParentJoinX ?? undefined,
                            cornerRadius: graphStyleMetrics.elbowCornerRadius,
                          })}
                          stroke={rowLaneStroke}
                          strokeWidth={resolveLaneStrokeWidth(index, row.laneIndex, row.laneIndex)}
                          opacity={resolveLaneOpacity(index, row.laneIndex, row.laneIndex)}
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ) : null}

                      {/* (stash rows are now rendered at their chronological position in the timeline) */}
                    </svg>

                    {mergeRingAnimation ? (
                      <span
                        aria-hidden="true"
                        className={`commit-node-merge-ring commit-node-merge-ring--${mergeRingAnimation}`}
                        style={{
                          width: `${nodeSize}px`,
                          height: `${nodeSize}px`,
                          left: `${resolveLaneX(row.laneIndex) - nodeSize / 2}px`,
                          top: `${ROW_HEIGHT / 2 - nodeSize / 2}px`,
                          ["--merge-pulse-color" as string]: rowLaneStroke,
                          ["--merge-particle-radius" as string]: `${Math.round(
                            nodeSize * 1.2,
                          )}px`,
                        }}
                      />
                    ) : null}
                    <span
                      className={nodeClassName}
                      style={{
                        ...buildCommitNodeStyle(
                          rowLaneStroke,
                          nodeSize,
                          row.laneIndex,
                          avatarSrc,
                        ),
                        ...(mergePulseApplied
                          ? ({ "--merge-pulse-color": rowLaneStroke } as CSSProperties)
                          : {}),
                      }}
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
                    {mergeRingAnimation ? (
                      <span
                        aria-hidden="true"
                        className={`commit-node-merge-ring commit-node-merge-ring--${mergeRingAnimation}`}
                        style={{
                          width: `${nodeSize}px`,
                          height: `${nodeSize}px`,
                          ["--merge-pulse-color" as string]: rowLaneStroke,
                          ["--merge-particle-radius" as string]: `${Math.round(
                            nodeSize * 1.2,
                          )}px`,
                        }}
                      />
                    ) : null}
                    <span
                      className={[
                        "commit-node",
                        avatarSrc ? "commit-node--avatar" : "",
                        graphStyle === "japaneseExpress" ? "commit-node--japanese-express" : "",
                        isCheckedOutCommit ? "commit-node-head-glow" : "",
                        mergePulseApplied ? "commit-node-merge-pulse" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={{
                        ...buildCommitNodeStyle(
                          rowLaneStroke,
                          nodeSize,
                          row.laneIndex,
                          avatarSrc,
                        ),
                        ...(mergePulseApplied
                          ? ({ "--merge-pulse-color": rowLaneStroke } as CSSProperties)
                          : {}),
                      }}
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
          );
        })}

        {!loading && commits.length === 0 ? (
          <div className="p-4 text-sm text-ink-subtle">コミットが見つかりません。</div>
        ) : null}

        {loadingMore ? (
          <div className="p-4 text-xs text-ink-subtle">さらに読み込み中...</div>
        ) : null}
      </div>
    </section>
  );
}
