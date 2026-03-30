import { animate, stagger } from 'animejs';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { resolveCommitGraphColumnLayout } from '../lib/commitGraphColumns';
import { buildLaneRows } from '../lib/commitGraphLayout';
import { formatRelativeDate, shortSha } from '../lib/format';
import type { CommitGraphMode, CommitListItem } from '../types';

interface CommitGraphProps {
  commits: CommitListItem[];
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
  onSelectWip: () => void;
  onSelectCommit: (commit: CommitListItem) => void;
  onCheckoutCommit: (commit: CommitListItem) => void;
  onCheckoutBranchRef: (refName: string) => void;
  onLoadMore: () => void;
  headerAccessory?: JSX.Element | null;
}

const LANE_GAP = 18;
const LANE_PADDING = 10;
const ROW_HEIGHT = 32;
const LINE_OVERDRAW = 1;
const WIP_NODE_SIZE = 18;
const WIP_NODE_CENTER = WIP_NODE_SIZE / 2;
const WIP_NODE_RING_RADIUS = 7;
const WIP_NODE_CORE_RADIUS = 3.5;
const WIP_LINE_TOP = ROW_HEIGHT / 2 + WIP_NODE_CENTER - 1;
const REF_COLUMN_MIN_WIDTH = 140;
const REF_COLUMN_MAX_WIDTH = 900;
const REF_COLUMN_DEFAULT_WIDTH = 230;
const REF_COLUMN_STORAGE_KEY = 'git-chat-ui.commit-refs-column-width';

const LANE_COLORS = [
  '#0071e3',
  '#26a65b',
  '#ff6f00',
  '#9b59b6',
  '#ff375f',
  '#00a3a3',
  '#6e56cf',
  '#f59f00'
];

function laneColor(index: number): string {
  return LANE_COLORS[index % LANE_COLORS.length];
}

function laneX(index: number): number {
  return LANE_PADDING + index * LANE_GAP;
}

interface CommitRefLabel {
  type: 'head' | 'branch' | 'tag';
  name: string;
}

function parseCommitRefLabels(decoration: string): CommitRefLabel[] {
  const trimmed = decoration.trim();
  if (!trimmed) {
    return [];
  }

  const body =
    trimmed.startsWith('(') && trimmed.endsWith(')') ? trimmed.slice(1, Math.max(trimmed.length - 1, 1)) : trimmed;
  const entries = body
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const parsed: CommitRefLabel[] = [];

  for (const entry of entries) {
    if (entry === 'HEAD') {
      continue;
    }

    if (entry.startsWith('HEAD -> ')) {
      parsed.push({
        type: 'head',
        name: entry.slice('HEAD -> '.length).trim()
      });
      continue;
    }

    if (entry.startsWith('tag: ')) {
      parsed.push({
        type: 'tag',
        name: entry.slice('tag: '.length).trim()
      });
      continue;
    }

    if (entry.includes(' -> ')) {
      const [, rhs] = entry.split(' -> ', 2);
      if (rhs?.trim()) {
        parsed.push({
          type: 'branch',
          name: rhs.trim()
        });
      }
      continue;
    }

    parsed.push({
      type: 'branch',
      name: entry
    });
  }

  const seen = new Set<string>();
  return parsed
    .filter((item) => item.name)
    .filter((item) => {
      const key = `${item.type}:${item.name}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function clampColumnWidth(value: number): number {
  return Math.max(REF_COLUMN_MIN_WIDTH, Math.min(REF_COLUMN_MAX_WIDTH, Math.round(value)));
}

function refLabelClass(type: CommitRefLabel['type']): string {
  if (type === 'head') {
    return 'commit-graph__ref-badge--head border-blue-300 bg-blue-50 text-blue-700';
  }
  if (type === 'tag') {
    return 'border-amber-300 bg-amber-50 text-amber-700';
  }
  return 'border-slate-300 bg-white/85 text-slate-700';
}

function WipNode({ className = '', style }: { className?: string; style?: CSSProperties }): JSX.Element {
  return (
    <span className={`wip-node ${className}`.trim()} style={style} aria-hidden="true">
      <svg width={WIP_NODE_SIZE} height={WIP_NODE_SIZE} viewBox={`0 0 ${WIP_NODE_SIZE} ${WIP_NODE_SIZE}`} fill="none">
        <circle
          className="wip-node-ring"
          cx={WIP_NODE_CENTER}
          cy={WIP_NODE_CENTER}
          r={WIP_NODE_RING_RADIUS}
          strokeDasharray="2 3"
          strokeLinecap="round"
        />
        <circle className="wip-node-core" cx={WIP_NODE_CENTER} cy={WIP_NODE_CENTER} r={WIP_NODE_CORE_RADIUS} />
      </svg>
    </span>
  );
}

export function CommitGraph({
  commits,
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
  onSelectWip,
  onSelectCommit,
  onCheckoutCommit,
  onCheckoutBranchRef,
  onLoadMore,
  headerAccessory
}: CommitGraphProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const refsResizeCleanupRef = useRef<(() => void) | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [refsColumnWidth, setRefsColumnWidth] = useState<number>(() => {
    if (typeof window === 'undefined') {
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
  const refLabelBySha = useMemo(
    () => new Map(commits.map((commit) => [commit.sha, parseCommitRefLabels(commit.decoration)])),
    [commits]
  );
  const refsAutoWidth = useMemo(() => {
    if (typeof document === 'undefined') {
      return REF_COLUMN_DEFAULT_WIDTH;
    }

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      return REF_COLUMN_DEFAULT_WIDTH;
    }

    context.font =
      '600 10px "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';

    let maxRowWidth = 0;
    for (const labels of refLabelBySha.values()) {
      if (labels.length === 0) {
        continue;
      }

      const rowWidth = labels.reduce((total, label, index) => {
        const textWidth = Math.ceil(context.measureText(label.name).width);
        const pillWidth = textWidth + 18; // horizontal padding + border
        return total + pillWidth + (index > 0 ? 4 : 0);
      }, 0);

      maxRowWidth = Math.max(maxRowWidth, rowWidth);
    }

    const headerWidth = Math.ceil(context.measureText('REFS').width) + 24;
    return clampColumnWidth(Math.max(REF_COLUMN_DEFAULT_WIDTH, maxRowWidth + 12, headerWidth));
  }, [refLabelBySha]);

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
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', cleanup);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        refsResizeCleanupRef.current = null;
      };

      refsResizeCleanupRef.current = cleanup;
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', cleanup);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [refsColumnWidth]
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(REF_COLUMN_STORAGE_KEY, String(refsColumnWidth));
  }, [refsColumnWidth]);

  useEffect(() => () => {
    refsResizeCleanupRef.current?.();
  }, []);

  useEffect(() => {
    const rootNode = rootRef.current;
    if (!rootNode) {
      return;
    }

    const updateWidth = (): void => {
      setContainerWidth(rootNode.clientWidth);
    };

    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => {
        window.removeEventListener('resize', updateWidth);
      };
    }

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(rootNode);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!rootRef.current) {
      return;
    }

    animate(rootRef.current.querySelectorAll('[data-animate="commit-enter"]'), {
      opacity: [0, 1],
      translateY: [6, 0],
      delay: stagger(18),
      duration: 250,
      easing: 'linear'
    });
  }, [visibleCommits.length]);

  useEffect(() => {
    if (!scrollToCommitSha || !rootRef.current) {
      return;
    }

    const targetRow = rootRef.current.querySelector<HTMLElement>(`[data-commit-sha="${scrollToCommitSha}"]`);
    if (!targetRow) {
      return;
    }

    targetRow.scrollIntoView({
      block: 'center',
      behavior: 'smooth'
    });
    onScrollToCommitHandled(scrollToCommitSha);
  }, [onScrollToCommitHandled, scrollToCommitSha, visibleCommits.length]);

  const isDetailedMode = mode === 'detailed';
  const graphColumnWidth = isDetailedMode
    ? Math.max(72, laneLayout.maxLanes * LANE_GAP + LANE_PADDING * 2)
    : 22;
  const columnLayout = resolveCommitGraphColumnLayout({
    containerWidth,
    graphColumnWidth,
    refsColumnWidth
  });
  const isCompactLayout = columnLayout.isCompact;
  const displayedRefsColumnWidth = columnLayout.displayedRefsColumnWidth;
  const gridTemplateColumns = columnLayout.templateColumns;

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
          className="sticky top-0 z-10 grid gap-2 bg-white/80 px-2 py-2 text-[11px] uppercase tracking-[0.08em] text-ink-subtle backdrop-blur"
          style={{ gridTemplateColumns }}
        >
          <span />
          <span className="relative flex items-center">
            Refs
            <button
              type="button"
              className="absolute -right-2 top-[-6px] h-[calc(100%+12px)] w-4 cursor-col-resize rounded-sm bg-transparent hover:bg-black/5"
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

        {loading ? <div className="p-4 text-sm text-ink-subtle">コミットを読み込み中...</div> : null}

        {(wipStagedCount > 0 || wipUnstagedCount > 0) && !loading ? (
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
                    x1={laneX(0)}
                    y1={WIP_LINE_TOP}
                    x2={laneX(0)}
                    y2={ROW_HEIGHT + LINE_OVERDRAW}
                    stroke={LANE_COLORS[0]}
                    strokeWidth={2.2}
                    opacity={0.85}
                    strokeLinecap="round"
                    strokeDasharray="4 3"
                  />
                </svg>
                <WipNode
                  className="absolute block"
                  style={{
                    left: `${laneX(0) - WIP_NODE_CENTER}px`,
                    top: `${ROW_HEIGHT / 2 - WIP_NODE_CENTER}px`
                  }}
                />
              </div>
            ) : (
              <div className="relative flex h-8 items-center justify-center">
                <div
                  className="absolute w-[2px] bg-accent/20"
                  style={{
                    top: `${WIP_LINE_TOP}px`,
                    height: `${ROW_HEIGHT - WIP_LINE_TOP + LINE_OVERDRAW}px`
                  }}
                />
                <WipNode />
              </div>
            )}
            <div className="overflow-hidden whitespace-nowrap text-xs">
              <span className="wip-row__badge inline-flex items-center px-2 py-[1px] text-[10px] font-semibold leading-4">
                WIP
              </span>
            </div>
            {!isCompactLayout ? <div className="wip-row__meta truncate text-xs">今</div> : null}
            <div className="wip-row__primary flex items-center gap-2 truncate text-sm font-medium">
              <span>// WIP</span>
              <span className="wip-row__meta truncate text-xs font-normal">
                {wipStagedCount > 0 ? `${wipStagedCount} staged` : ''}
                {wipStagedCount > 0 && wipUnstagedCount > 0 ? ' · ' : ''}
                {wipUnstagedCount > 0 ? `${wipUnstagedCount} unstaged` : ''}
              </span>
            </div>
            <div className="wip-row__meta truncate text-xs">—</div>
            {!isCompactLayout ? <div className="wip-row__meta commit-id-column truncate text-xs">—</div> : null}
          </div>
        ) : null}

        {visibleCommits.map((commit, index) => {
          const isHighlighted = highlightedCommitSha === commit.sha;
          const isActive = activeCommitSha === commit.sha;
          const isCheckedOutCommit = checkedOutCommitSha === commit.sha;
          const row = laneLayout.rows[index] ?? {
            laneIndex: 0,
            activeLaneIndices: [0],
            incomingLaneIndices: [0],
            outgoingLaneIndices: [0],
            primaryParentLaneIndex: null,
            mergeTargetLaneIndices: []
          };
          const commitRefLabels = refLabelBySha.get(commit.sha) ?? [];

          return (
            <div
              key={commit.sha}
              className={`commit-row ${isActive || isHighlighted ? 'active' : ''}`}
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
                      const hasIncoming = index > 0 && row.incomingLaneIndices.includes(laneIndex);
                      const hasOutgoingRaw = row.outgoingLaneIndices.includes(laneIndex);
                      const hasOutgoing =
                        hasOutgoingRaw && !(index === visibleCommits.length - 1 && !hasMore);

                      if (!hasIncoming && !hasOutgoing) {
                        return null;
                      }

                      const y1 = hasIncoming ? -LINE_OVERDRAW : ROW_HEIGHT / 2 + strokeWidth / 2;
                      const y2 = hasOutgoing ? ROW_HEIGHT + LINE_OVERDRAW : ROW_HEIGHT / 2 - strokeWidth / 2;

                      return (
                        <line
                          key={`${commit.sha}-${laneIndex}`}
                          x1={laneX(laneIndex)}
                          y1={y1}
                          x2={laneX(laneIndex)}
                          y2={y2}
                          stroke={laneColor(laneIndex)}
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
                          stroke={laneColor(targetLaneIndex)}
                          strokeWidth={1.5}
                          opacity={0.75}
                        />
                      );
                    })}

                    {row.primaryParentLaneIndex !== null && row.primaryParentLaneIndex !== row.laneIndex ? (
                      <path
                        d={`M ${laneX(row.laneIndex)} ${ROW_HEIGHT / 2} C ${laneX(row.laneIndex)} ${ROW_HEIGHT / 2 + 6}, ${laneX(row.primaryParentLaneIndex)} ${ROW_HEIGHT - 8}, ${laneX(row.primaryParentLaneIndex)} ${ROW_HEIGHT}`}
                        stroke={laneColor(row.primaryParentLaneIndex)}
                        strokeWidth={1.6}
                        opacity={0.78}
                      />
                    ) : null}
                  </svg>

                  <span
                    className={`absolute block commit-node border border-white/90 shadow ${isCheckedOutCommit ? 'commit-node-head-glow' : ''}`}
                    style={{
                      left: `${laneX(row.laneIndex) - 6}px`,
                      top: `${ROW_HEIGHT / 2 - 6}px`,
                      background: laneColor(row.laneIndex)
                    }}
                  />
                </div>
              ) : (
                <div className="relative flex h-8 items-center justify-center">
                  <div
                    className="absolute w-[2px] bg-accent/20"
                    style={{
                      top: `${-LINE_OVERDRAW}px`,
                      height: `${ROW_HEIGHT + LINE_OVERDRAW * 2}px`
                    }}
                  />
                  <span className={`commit-node ${isCheckedOutCommit ? 'commit-node-head-glow' : ''}`} />
                </div>
              )}

              <div className="overflow-hidden whitespace-nowrap text-xs text-ink-soft">
                {commitRefLabels.length > 0 ? (
                  <div className="flex items-center gap-1 overflow-hidden">
                    {commitRefLabels.map((label) => (
                      <span
                        key={`${commit.sha}-${label.type}-${label.name}`}
                        className={`inline-flex min-w-0 shrink-0 items-center rounded-full border px-2 py-[1px] text-[10px] font-semibold leading-4 ${
                          refLabelClass(label.type)
                        } ${label.type === 'tag' ? '' : 'cursor-pointer'}`}
                        style={{ maxWidth: `${Math.max(90, displayedRefsColumnWidth - 16)}px` }}
                        title={label.name}
                        onDoubleClick={(event) => {
                          if (busy || label.type === 'tag') {
                            return;
                          }

                          event.preventDefault();
                          event.stopPropagation();
                          onCheckoutBranchRef(label.name);
                        }}
                      >
                        <span className="truncate">{label.name}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-ink-subtle">-</span>
                )}
              </div>

              {!isCompactLayout ? (
                <div className="truncate text-xs text-ink-soft">{formatRelativeDate(commit.date)}</div>
              ) : null}
              <div className="commit-graph__cell--primary truncate text-sm text-ink">{commit.subject}</div>
              <div className="truncate text-xs text-ink-soft">{commit.author}</div>
              {!isCompactLayout ? (
                <div className="commit-id-column truncate text-xs text-ink-subtle">{shortSha(commit.sha)}</div>
              ) : null}
            </div>
          );
        })}

        {!loading && visibleCommits.length === 0 ? (
          <div className="p-4 text-sm text-ink-subtle">コミットが見つかりません。</div>
        ) : null}

        {loadingMore ? <div className="p-4 text-xs text-ink-subtle">さらに読み込み中...</div> : null}
      </div>
    </section>
  );
}
