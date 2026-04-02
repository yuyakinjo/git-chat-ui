import { animate, stagger } from "animejs";
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";

import { useContainerWidth } from "../hooks/useContainerWidth";
import { copyTextToClipboard } from "../lib/clipboard";
import { resolveCommitGraphColumnLayout } from "../lib/commitGraphColumns";
import { buildLaneRows } from "../lib/commitGraphLayout";
import { resolveDefaultBranch } from "../lib/controllerViewUtils";
import { formatRelativeDate, shortSha } from "../lib/format";
import type { BranchResponse, CommitGraphMode, CommitListItem } from "../types";
import {
  buildCommitRefBadges,
  buildDefaultBranchAnchorLaneIndices,
  clampColumnWidth,
  DEFAULT_BRANCH_LANE_COLOR,
  LANE_GAP,
  LANE_PADDING,
  laneColor,
  laneX,
  LINE_OVERDRAW,
  parseCommitRefLabels,
  REF_BADGE_ICON_SIZE,
  REF_COLUMN_DEFAULT_WIDTH,
  REF_COLUMN_STORAGE_KEY,
  refLabelClass,
  refLabelIcon,
  refLabelIconClass,
  ROW_HEIGHT,
  WIP_NODE_CENTER,
  WIP_NODE_LINE_CLEARANCE,
  WipNode,
} from "./CommitGraphHelpers";

interface CommitGraphProps {
  commits: CommitListItem[];
  commitAuthorAvatars?: Record<string, string>;
  mode: CommitGraphMode;
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
  headerAccessory?: JSX.Element | null;
  branchContext?: BranchResponse | null;
}

export function CommitGraph({
  commits,
  commitAuthorAvatars = {},
  mode,
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
  headerAccessory,
  branchContext = null,
}: CommitGraphProps): JSX.Element {
  const COMMIT_DOT_NODE_SIZE = 12;
  const COMMIT_AVATAR_NODE_SIZE = 24;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const refsResizeCleanupRef = useRef<(() => void) | null>(null);
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

  const visibleCommits = useMemo(() => commits, [commits]);
  const laneLayout = useMemo(() => buildLaneRows(commits), [commits]);
  const defaultBranchHeadSha = useMemo(
    () => resolveDefaultBranch(branchContext)?.commit ?? null,
    [branchContext],
  );
  const defaultBranchAnchorLaneIndices = useMemo(
    () => buildDefaultBranchAnchorLaneIndices(commits, laneLayout.rows, defaultBranchHeadSha),
    [commits, defaultBranchHeadSha, laneLayout.rows],
  );
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
        const pillWidth = textWidth + 18 + badge.scopes.length * (REF_BADGE_ICON_SIZE + 4);
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

    animate(rootRef.current.querySelectorAll('[data-animate="commit-enter"]'), {
      opacity: [0, 1],
      translateY: [6, 0],
      delay: stagger(18),
      duration: 250,
      easing: "linear",
    });
  }, [visibleCommits.length]);

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
  const hasWipRow =
    (wipStagedCount > 0 || wipUnstagedCount > 0 || wipConflictedCount > 0) && !loading;
  const graphColumnWidth = isDetailedMode
    ? Math.max(72, laneLayout.maxLanes * LANE_GAP + LANE_PADDING * 2)
    : 22;
  const columnLayout = resolveCommitGraphColumnLayout({
    containerWidth,
    graphColumnWidth,
    refsColumnWidth,
  });
  const isCompactLayout = columnLayout.isCompact;
  const displayedRefsColumnWidth = columnLayout.displayedRefsColumnWidth;
  const gridTemplateColumns = columnLayout.templateColumns;
  const wipLineBottomStart = ROW_HEIGHT / 2 + WIP_NODE_LINE_CLEARANCE;
  const resolveLaneStroke = useCallback(
    (rowIndex: number, laneIndex: number) =>
      laneColor(laneIndex, defaultBranchAnchorLaneIndices[rowIndex] ?? 0),
    [defaultBranchAnchorLaneIndices],
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

  return (
    <section className="panel flex min-h-0 min-w-0 flex-col overflow-hidden p-3">
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
        <div
          className="sticky top-0 z-10 grid gap-2 bg-white/80 px-2 py-2 text-[11px] uppercase tracking-[0.08em] text-ink-subtle backdrop-blur-sm"
          style={{ gridTemplateColumns }}
        >
          <span />
          <span className="relative flex items-center">
            Refs
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
          {!isCompactLayout ? <span>Date</span> : null}
          <span>Message</span>
          <span>Author</span>
          {!isCompactLayout ? <span className="commit-id-column">SHA</span> : null}
        </div>

        {loading ? (
          <div className="p-4 text-sm text-ink-subtle">コミットを読み込み中...</div>
        ) : null}

        {hasWipRow ? (
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
                >
                  <line
                    className="wip-row__lane-line wip-row__lane-line--connector"
                    x1={laneX(0)}
                    y1={wipLineBottomStart}
                    x2={laneX(0)}
                    y2={ROW_HEIGHT + LINE_OVERDRAW}
                    stroke={resolveLaneStroke(0, 0) || DEFAULT_BRANCH_LANE_COLOR}
                    strokeWidth={2.2}
                    opacity={0.85}
                    strokeLinecap="round"
                  />
                </svg>
                <WipNode
                  className="absolute block"
                  style={{
                    left: `${laneX(0) - WIP_NODE_CENTER}px`,
                    top: `${ROW_HEIGHT / 2 - WIP_NODE_CENTER}px`,
                  }}
                />
              </div>
            ) : (
              <div className="relative flex h-8 items-center justify-center">
                <div
                  className="wip-row__lane-line wip-row__lane-line--compact absolute w-[2px] bg-accent/20"
                  style={{
                    top: `${wipLineBottomStart}px`,
                    height: `${ROW_HEIGHT + LINE_OVERDRAW - wipLineBottomStart}px`,
                  }}
                />
                <WipNode />
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
        ) : null}

        {visibleCommits.map((commit, index) => {
          const isHighlighted = highlightedCommitSha === commit.sha;
          const isActive = activeCommitSha === commit.sha;
          const isCheckedOutCommit = checkedOutCommitSha === commit.sha;
          const avatarSrc = commitAuthorAvatars[commit.sha];
          const nodeSize = avatarSrc ? COMMIT_AVATAR_NODE_SIZE : COMMIT_DOT_NODE_SIZE;
          const row = laneLayout.rows[index] ?? {
            laneIndex: 0,
            activeLaneIndices: [0],
            incomingLaneIndices: [0],
            outgoingLaneIndices: [0],
            primaryParentLaneIndex: null,
            mergeTargetLaneIndices: [],
          };
          const commitRefBadges = refBadgeBySha.get(commit.sha) ?? [];

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
                    height={ROW_HEIGHT + LINE_OVERDRAW * 2}
                    style={{ top: `${-LINE_OVERDRAW}px` }}
                    viewBox={`0 ${-LINE_OVERDRAW} ${graphColumnWidth} ${ROW_HEIGHT + LINE_OVERDRAW * 2}`}
                    fill="none"
                  >
                    {row.activeLaneIndices.map((laneIndex) => {
                      const isCommitLane = laneIndex === row.laneIndex;
                      const strokeWidth = isCommitLane ? 2.2 : 1.5;
                      const hasIncoming =
                        (index > 0 && row.incomingLaneIndices.includes(laneIndex)) ||
                        (hasWipRow && index === 0 && laneIndex === 0);
                      const hasOutgoingRaw = row.outgoingLaneIndices.includes(laneIndex);
                      const hasOutgoing =
                        hasOutgoingRaw && !(index === visibleCommits.length - 1 && !hasMore);

                      if (!hasIncoming && !hasOutgoing) {
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
                          x1={laneX(laneIndex)}
                          y1={y1}
                          x2={laneX(laneIndex)}
                          y2={y2}
                          stroke={resolveLaneStroke(index, laneIndex)}
                          strokeWidth={strokeWidth}
                          opacity={isCommitLane ? 0.85 : 0.48}
                          strokeLinecap="round"
                        />
                      );
                    })}

                    {row.mergeTargetLaneIndices.map((targetLaneIndex) => {
                      const sourceX = laneX(row.laneIndex);
                      const targetX = laneX(targetLaneIndex);
                      const midY = ROW_HEIGHT / 2;
                      return (
                        <path
                          key={`${commit.sha}-merge-${targetLaneIndex}`}
                          d={`M ${sourceX} ${midY} C ${sourceX} ${midY + 6}, ${targetX} ${ROW_HEIGHT - 8}, ${targetX} ${ROW_HEIGHT}`}
                          stroke={resolveLaneStroke(index, targetLaneIndex)}
                          strokeWidth={1.5}
                          opacity={0.75}
                        />
                      );
                    })}

                    {row.primaryParentLaneIndex !== null &&
                    row.primaryParentLaneIndex !== row.laneIndex ? (
                      <path
                        d={`M ${laneX(row.laneIndex)} ${ROW_HEIGHT / 2} C ${laneX(row.laneIndex)} ${ROW_HEIGHT / 2 + 6}, ${laneX(row.primaryParentLaneIndex)} ${ROW_HEIGHT - 8}, ${laneX(row.primaryParentLaneIndex)} ${ROW_HEIGHT}`}
                        stroke={resolveLaneStroke(index, row.primaryParentLaneIndex)}
                        strokeWidth={1.6}
                        opacity={0.78}
                      />
                    ) : null}
                  </svg>

                  <span
                    className={`absolute block commit-node ${avatarSrc ? "commit-node--avatar" : "border border-white/90 shadow-sm"} ${isCheckedOutCommit ? "commit-node-head-glow" : ""}`}
                    style={{
                      left: `${laneX(row.laneIndex) - nodeSize / 2}px`,
                      top: `${ROW_HEIGHT / 2 - nodeSize / 2}px`,
                      background: avatarSrc ? undefined : resolveLaneStroke(index, row.laneIndex),
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
                    className="absolute w-[2px] bg-accent/20"
                    style={{
                      top: `${-LINE_OVERDRAW}px`,
                      height: `${ROW_HEIGHT + LINE_OVERDRAW * 2}px`,
                    }}
                  />
                  <span
                    className={`commit-node ${avatarSrc ? "commit-node--avatar" : ""} ${isCheckedOutCommit ? "commit-node-head-glow" : ""}`}
                    style={{
                      background: avatarSrc ? undefined : resolveLaneStroke(index, row.laneIndex),
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
                          <span
                            className="inline-flex shrink-0 items-center gap-0.5"
                            aria-hidden="true"
                          >
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
                          <span className="commit-graph__ref-badge-label truncate">
                            {badge.name}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <span className="text-ink-subtle">-</span>
                )}
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
