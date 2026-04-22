import { Archive, Cloud, HardDrive, Tag, type LucideIcon } from "lucide-react";
import type { CSSProperties, JSX } from "react";

import type { LaneRow } from "../lib/commitGraphLayout";
import type { CommitGraphStyle, CommitListItem } from "../types";

// ── Constants ──────────────────────────────────────────────────────────

export const LANE_GAP = 27;
export const LANE_PADDING = 10;
export const ROW_HEIGHT = 32;
/** commit-row の border: 1px solid transparent による上下合計 2px */
export const COMMIT_ROW_BORDER_TOTAL = 2;
/** 隣接 graphCell 間の実距離 (ROW_HEIGHT + border) — 行をまたぐ Y 座標計算に使用 */
export const ROW_STEP = ROW_HEIGHT + COMMIT_ROW_BORDER_TOTAL;
export const LINE_OVERDRAW = 1;
export const WIP_NODE_SIZE = 18;
export const WIP_NODE_CENTER = WIP_NODE_SIZE / 2;
export const WIP_NODE_RING_RADIUS = 7;
export const WIP_NODE_LINE_CLEARANCE = WIP_NODE_RING_RADIUS + 1;
export const STASH_NODE_SIZE = 16;
export const STASH_LANE_COLOR = "#5b9bd5";
export const REF_COLUMN_MIN_WIDTH = 140;
export const REF_COLUMN_MAX_WIDTH = 900;
export const REF_COLUMN_DEFAULT_WIDTH = 230;
export const REF_COLUMN_STORAGE_KEY = "git-chat-ui.commit-refs-column-width";
export const REF_BADGE_ICON_SIZE = 10;
export const REF_BADGE_DONE_ICON_SIZE = 12;

export const LANE_COLORS = [
  "#0071e3",
  "#26a65b",
  "#ff6f00",
  "#9b59b6",
  "#ff375f",
  "#00a3a3",
  "#6e56cf",
  "#f59f00",
];
export const DEFAULT_BRANCH_LANE_COLOR = "#7ed957";
export const LEFT_BRANCH_LANE_COLORS = [
  "#ffd84a",
  "#ff9f43",
  "#ff5a54",
  "#ff2d95",
  "#9a35ff",
  "#21c7ff",
];
export const RIGHT_BRANCH_LANE_COLORS = [
  "#39d7b6",
  "#21c7ff",
  "#2f7cff",
  "#9a35ff",
  "#ff2d95",
  "#ff5a54",
];

export interface CommitGraphStyleMetrics {
  laneGap: number;
  lanePadding: number;
  minDetailedGraphWidth: number;
  compactGraphWidth: number;
  detailedLineWidth: number;
  detailedLineOpacity: number;
  compactLineWidth: number;
  nodeSize: number;
  avatarNodeSize: number;
  nodeRingWidth: number;
  wipNodeSize: number;
  wipNodeRingRadius: number;
  wipNodeStrokeWidth: number;
  wipNodeLineClearance: number;
  stashNodeSize: number;
  stashNodeStrokeWidth: number;
  /** Corner radius used for unified branch/merge elbow curves. */
  elbowCornerRadius: number;
}

const STANDARD_GRAPH_STYLE_METRICS: CommitGraphStyleMetrics = {
  laneGap: LANE_GAP,
  lanePadding: LANE_PADDING,
  minDetailedGraphWidth: 72,
  compactGraphWidth: 22,
  detailedLineWidth: 2.2,
  detailedLineOpacity: 0.85,
  compactLineWidth: 2,
  nodeSize: 12,
  avatarNodeSize: 24,
  nodeRingWidth: 0,
  wipNodeSize: WIP_NODE_SIZE,
  wipNodeRingRadius: WIP_NODE_RING_RADIUS,
  wipNodeStrokeWidth: 1.8,
  wipNodeLineClearance: WIP_NODE_LINE_CLEARANCE,
  stashNodeSize: STASH_NODE_SIZE,
  stashNodeStrokeWidth: 1.6,
  elbowCornerRadius: 10,
};

const JAPANESE_EXPRESS_GRAPH_STYLE_METRICS: CommitGraphStyleMetrics = {
  laneGap: 34,
  lanePadding: 18,
  minDetailedGraphWidth: 110,
  compactGraphWidth: 30,
  detailedLineWidth: 4.4,
  detailedLineOpacity: 0.96,
  compactLineWidth: 4,
  nodeSize: 18,
  avatarNodeSize: 28,
  nodeRingWidth: 4,
  wipNodeSize: 22,
  wipNodeRingRadius: 8,
  wipNodeStrokeWidth: 2.4,
  wipNodeLineClearance: 10,
  stashNodeSize: 20,
  stashNodeStrokeWidth: 2.0,
  elbowCornerRadius: 14,
};

// ── Types ──────────────────────────────────────────────────────────────

export interface CommitRefLabel {
  type: "head" | "branch" | "tag";
  name: string;
}

export type CommitRefBadgeScope = "local" | "remote" | "tag";

export interface CommitRefBadge {
  type: CommitRefLabel["type"];
  name: string;
  scopes: CommitRefBadgeScope[];
  title: string;
}

export interface CommitRefScopeContext {
  localRefNames: Set<string>;
  remoteRefNames: Set<string>;
  remoteNames: Set<string>;
}

const EMPTY_REMOTE_NAMES = new Set<string>();

// ── Pure functions ─────────────────────────────────────────────────────

function normalizeSha(sha: string | null | undefined): string {
  return sha?.trim() ?? "";
}

export function resolveCommitGraphStyleMetrics(style: CommitGraphStyle): CommitGraphStyleMetrics {
  return style === "japaneseExpress"
    ? JAPANESE_EXPRESS_GRAPH_STYLE_METRICS
    : STANDARD_GRAPH_STYLE_METRICS;
}

export function getLaneDisplayOffset(
  laneIndex: number,
  _style: CommitGraphStyle = "standard",
): number {
  return laneIndex;
}

export function laneColor(
  index: number,
  defaultLaneIndex = 0,
  style: CommitGraphStyle = "standard",
): string {
  const offset = getLaneDisplayOffset(index, style) - getLaneDisplayOffset(defaultLaneIndex, style);
  if (offset === 0) {
    return DEFAULT_BRANCH_LANE_COLOR;
  }

  if (offset < 0) {
    return LEFT_BRANCH_LANE_COLORS[(Math.abs(offset) - 1) % LEFT_BRANCH_LANE_COLORS.length];
  }

  return RIGHT_BRANCH_LANE_COLORS[(offset - 1) % RIGHT_BRANCH_LANE_COLORS.length];
}

export function buildDefaultBranchAnchorLaneIndices(
  commits: Array<Pick<CommitListItem, "sha" | "parentShas">>,
  rows: LaneRow[],
  defaultBranchHeadSha: string | null | undefined,
): number[] {
  if (commits.length === 0 || rows.length === 0) {
    return [];
  }

  const normalizedDefaultHeadSha = normalizeSha(defaultBranchHeadSha);
  if (!normalizedDefaultHeadSha) {
    return rows.map(() => 0);
  }

  const commitBySha = new Map(
    commits.map((commit) => [normalizeSha(commit.sha), commit] satisfies [string, typeof commit]),
  );
  const firstDefaultRowIndex = commits.findIndex(
    (commit) => normalizeSha(commit.sha) === normalizedDefaultHeadSha,
  );

  if (firstDefaultRowIndex === -1) {
    return rows.map(() => 0);
  }

  const anchors = rows.map(() => rows[firstDefaultRowIndex]?.laneIndex ?? 0);
  let currentAnchorLaneIndex = anchors[firstDefaultRowIndex] ?? 0;
  let nextDefaultSha = normalizedDefaultHeadSha;
  let started = false;

  for (let index = 0; index < commits.length; index += 1) {
    const commit = commits[index];
    const row = rows[index];
    if (!row) {
      anchors[index] = currentAnchorLaneIndex;
      continue;
    }

    const commitSha = normalizeSha(commit.sha);
    if (commitSha === nextDefaultSha) {
      started = true;
      anchors[index] = row.laneIndex;
      currentAnchorLaneIndex = row.primaryParentLaneIndex ?? row.laneIndex;

      const nextParentSha = normalizeSha(commit.parentShas[0]);
      nextDefaultSha = nextParentSha && commitBySha.has(nextParentSha) ? nextParentSha : "";
      continue;
    }

    anchors[index] = started ? currentAnchorLaneIndex : (anchors[firstDefaultRowIndex] ?? 0);
  }

  return anchors;
}

export function laneX(
  index: number,
  options?: {
    style?: CommitGraphStyle;
    minLaneDisplayOffset?: number;
    laneGap?: number;
    lanePadding?: number;
  },
): number {
  const style = options?.style ?? "standard";
  const laneGap = options?.laneGap ?? LANE_GAP;
  const lanePadding = options?.lanePadding ?? LANE_PADDING;
  const minLaneDisplayOffset = options?.minLaneDisplayOffset ?? 0;
  return lanePadding + (getLaneDisplayOffset(index, style) - minLaneDisplayOffset) * laneGap;
}

function roundSvgCoordinate(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return String(rounded);
}

export function buildPrimaryParentCurvePath(input: {
  sourceLaneIndex: number;
  targetLaneIndex: number;
  targetY: number;
  startY?: number;
  resolveLaneX?: (laneIndex: number) => number;
  targetJoinX?: number;
  cornerRadius?: number;
  reverse?: boolean;
  /**
   * 曲がり角の位置。
   * - "end" (既定): source lane を垂直に降りて target Y 付近で水平に折れる合流型 (子視点: 垂直→水平)。
   * - "start": source Y で水平に折れてから target lane を垂直に降りる分岐型 (子視点: 水平→垂直)。
   *   親視点では垂直→水平 (「↱」) に見えるため merge/branch 曲線の見え方を揃えたいときに使う。
   */
  elbowSide?: "end" | "start";
}): string {
  const startY = input.startY ?? ROW_HEIGHT / 2;
  const resolveX = input.resolveLaneX ?? ((laneIndex: number) => laneX(laneIndex));
  const sourceX = resolveX(input.sourceLaneIndex);
  const targetX = resolveX(input.targetLaneIndex);
  const targetJoinX = input.targetJoinX ?? targetX;
  if (sourceX === targetX) {
    if (input.reverse) {
      return `M ${roundSvgCoordinate(targetJoinX)} ${roundSvgCoordinate(input.targetY)} L ${roundSvgCoordinate(sourceX)} ${roundSvgCoordinate(startY)}`;
    }

    return `M ${roundSvgCoordinate(sourceX)} ${roundSvgCoordinate(startY)} L ${roundSvgCoordinate(sourceX)} ${roundSvgCoordinate(input.targetY)}`;
  }

  const verticalDistance = Math.max(input.targetY - startY, 0);
  const turnDirection = Math.sign(targetJoinX - sourceX) || Math.sign(targetX - sourceX) || 1;
  const maxCornerRadius = Math.max(
    0,
    Math.min(verticalDistance - 2, Math.abs(targetJoinX - sourceX) - 2),
  );
  const cornerRadius = Math.min(input.cornerRadius ?? 4, maxCornerRadius);
  const elbowY = input.targetY - cornerRadius;

  if (elbowY <= startY) {
    if (input.reverse) {
      return `M ${roundSvgCoordinate(targetJoinX)} ${roundSvgCoordinate(input.targetY)} L ${roundSvgCoordinate(sourceX)} ${roundSvgCoordinate(startY)}`;
    }

    return `M ${roundSvgCoordinate(sourceX)} ${roundSvgCoordinate(startY)} L ${roundSvgCoordinate(targetJoinX)} ${roundSvgCoordinate(input.targetY)}`;
  }

  if (cornerRadius < 0.5) {
    if (input.reverse) {
      return `M ${roundSvgCoordinate(targetJoinX)} ${roundSvgCoordinate(input.targetY)} L ${roundSvgCoordinate(sourceX)} ${roundSvgCoordinate(input.targetY)} L ${roundSvgCoordinate(sourceX)} ${roundSvgCoordinate(startY)}`;
    }

    return `M ${roundSvgCoordinate(sourceX)} ${roundSvgCoordinate(startY)} L ${roundSvgCoordinate(sourceX)} ${roundSvgCoordinate(input.targetY)} L ${roundSvgCoordinate(targetJoinX)} ${roundSvgCoordinate(input.targetY)}`;
  }

  const turnEndX = sourceX + turnDirection * cornerRadius;

  if (input.elbowSide === "start") {
    // 子視点で「水平 → 垂直」(親視点では「垂直 → 水平 = ↱」)。
    // target lane を垂直に降ろしたいので targetJoinX ではなく targetX で終端する。
    const turnStartX = targetX - turnDirection * cornerRadius;
    const elbowStartY = startY + cornerRadius;
    if (input.reverse) {
      return `M ${roundSvgCoordinate(targetX)} ${roundSvgCoordinate(input.targetY)} L ${roundSvgCoordinate(targetX)} ${roundSvgCoordinate(elbowStartY)} Q ${roundSvgCoordinate(targetX)} ${roundSvgCoordinate(startY)}, ${roundSvgCoordinate(turnStartX)} ${roundSvgCoordinate(startY)} L ${roundSvgCoordinate(sourceX)} ${roundSvgCoordinate(startY)}`;
    }
    return `M ${roundSvgCoordinate(sourceX)} ${roundSvgCoordinate(startY)} L ${roundSvgCoordinate(turnStartX)} ${roundSvgCoordinate(startY)} Q ${roundSvgCoordinate(targetX)} ${roundSvgCoordinate(startY)}, ${roundSvgCoordinate(targetX)} ${roundSvgCoordinate(elbowStartY)} L ${roundSvgCoordinate(targetX)} ${roundSvgCoordinate(input.targetY)}`;
  }

  if (input.reverse) {
    return `M ${roundSvgCoordinate(targetJoinX)} ${roundSvgCoordinate(input.targetY)} L ${roundSvgCoordinate(turnEndX)} ${roundSvgCoordinate(input.targetY)} Q ${roundSvgCoordinate(sourceX)} ${roundSvgCoordinate(input.targetY)}, ${roundSvgCoordinate(sourceX)} ${roundSvgCoordinate(elbowY)} L ${roundSvgCoordinate(sourceX)} ${roundSvgCoordinate(startY)}`;
  }

  // Stop on the parent node edge instead of the parent lane center so the
  // branch reads as growing from the commit node, not from the WIP line.
  return `M ${roundSvgCoordinate(sourceX)} ${roundSvgCoordinate(startY)} L ${roundSvgCoordinate(sourceX)} ${roundSvgCoordinate(elbowY)} Q ${roundSvgCoordinate(sourceX)} ${roundSvgCoordinate(input.targetY)}, ${roundSvgCoordinate(turnEndX)} ${roundSvgCoordinate(input.targetY)} L ${roundSvgCoordinate(targetJoinX)} ${roundSvgCoordinate(input.targetY)}`;
}

export function parseCommitRefLabels(decoration: string): CommitRefLabel[] {
  const trimmed = decoration.trim();
  if (!trimmed) {
    return [];
  }

  const body =
    trimmed.startsWith("(") && trimmed.endsWith(")")
      ? trimmed.slice(1, Math.max(trimmed.length - 1, 1))
      : trimmed;
  const entries = body
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const parsed: CommitRefLabel[] = [];

  for (const entry of entries) {
    if (entry === "HEAD") {
      continue;
    }

    if (entry.startsWith("HEAD -> ")) {
      parsed.push({
        type: "head",
        name: entry.slice("HEAD -> ".length).trim(),
      });
      continue;
    }

    if (entry.startsWith("tag: ")) {
      parsed.push({
        type: "tag",
        name: entry.slice("tag: ".length).trim(),
      });
      continue;
    }

    if (entry.includes(" -> ")) {
      const [, rhs] = entry.split(" -> ", 2);
      if (rhs?.trim()) {
        parsed.push({
          type: "branch",
          name: rhs.trim(),
        });
      }
      continue;
    }

    parsed.push({
      type: "branch",
      name: entry,
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

export function clampColumnWidth(value: number): number {
  return Math.max(REF_COLUMN_MIN_WIDTH, Math.min(REF_COLUMN_MAX_WIDTH, Math.round(value)));
}

export function refLabelClass(type: CommitRefLabel["type"]): string {
  if (type === "head") {
    return "commit-graph__ref-badge--head border-blue-300 bg-blue-50 text-blue-700";
  }
  if (type === "tag") {
    return "commit-graph__ref-badge--tag border-amber-300 bg-amber-50 text-amber-700";
  }
  return "border-slate-300 bg-white/85 text-slate-700";
}

function hasRemotePrefix(labelName: string, remoteNames: Set<string>): boolean {
  return [...remoteNames].some((remoteName) => labelName.startsWith(`${remoteName}/`));
}

function getRemoteRefShortName(labelName: string, remoteNames: Set<string>): string | null {
  for (const remoteName of remoteNames) {
    const prefix = `${remoteName}/`;
    if (!labelName.startsWith(prefix) || labelName.length <= prefix.length) {
      continue;
    }

    const shortName = labelName.slice(prefix.length);
    return shortName === "HEAD" ? null : shortName;
  }

  return null;
}

function isRemoteHeadAliasLabel(labelName: string, remoteNames: Set<string>): boolean {
  return labelName.endsWith("/HEAD") && hasRemotePrefix(labelName, remoteNames);
}

export function resolveCommitRefScope(
  label: CommitRefLabel,
  context: CommitRefScopeContext | null,
): CommitRefBadgeScope {
  if (label.type === "tag") {
    return "tag";
  }

  if (label.type === "head") {
    return "local";
  }

  if (!context) {
    return "local";
  }

  const isLocal = context.localRefNames.has(label.name);
  const isRemote = context.remoteRefNames.has(label.name);

  if (isLocal && !isRemote) {
    return "local";
  }

  if (isRemote && !isLocal) {
    return "remote";
  }

  if (isRemote && isLocal) {
    return hasRemotePrefix(label.name, context.remoteNames) ? "remote" : "local";
  }

  if (label.name.endsWith("/HEAD") && hasRemotePrefix(label.name, context.remoteNames)) {
    return "remote";
  }

  if (hasRemotePrefix(label.name, context.remoteNames)) {
    return "remote";
  }

  return "local";
}

export function buildCommitRefBadges(
  labels: CommitRefLabel[],
  context: CommitRefScopeContext | null,
): CommitRefBadge[] {
  if (labels.length === 0) {
    return [];
  }

  const remoteNames = context?.remoteNames ?? EMPTY_REMOTE_NAMES;
  const scopes = labels.map((label) => resolveCommitRefScope(label, context));
  const localLabelNames = new Set(
    labels.flatMap((label, index) => (scopes[index] === "local" ? [label.name] : [])),
  );
  const consumedIndices = new Set<number>();

  return labels.flatMap((label, index): CommitRefBadge[] => {
    if (consumedIndices.has(index)) {
      return [];
    }

    const scope = scopes[index];
    if (scope === "remote" && isRemoteHeadAliasLabel(label.name, remoteNames)) {
      return [];
    }

    if (scope === "tag") {
      return [
        {
          type: label.type,
          name: label.name,
          scopes: ["tag"],
          title: label.name,
        },
      ];
    }

    if (scope === "local") {
      const mergedRemoteIndex = labels.findIndex((candidate, candidateIndex) => {
        if (candidateIndex === index || consumedIndices.has(candidateIndex)) {
          return false;
        }

        if (scopes[candidateIndex] !== "remote" || !candidate.name.startsWith("origin/")) {
          return false;
        }

        return getRemoteRefShortName(candidate.name, remoteNames) === label.name;
      });

      if (mergedRemoteIndex >= 0) {
        consumedIndices.add(mergedRemoteIndex);
        const mergedRemoteName = labels[mergedRemoteIndex]?.name ?? label.name;
        return [
          {
            type: label.type,
            name: label.name,
            scopes: ["local", "remote"],
            title: `${label.name}, ${mergedRemoteName}`,
          },
        ];
      }

      return [
        {
          type: label.type,
          name: label.name,
          scopes: ["local"],
          title: label.name,
        },
      ];
    }

    const shortName = getRemoteRefShortName(label.name, remoteNames);
    if (label.name.startsWith("origin/") && shortName && localLabelNames.has(shortName)) {
      return [];
    }

    return [
      {
        type: label.type,
        name: label.name,
        scopes: ["remote"],
        title: label.name,
      },
    ];
  });
}

export function refLabelIcon(scope: CommitRefBadgeScope): LucideIcon {
  if (scope === "remote") {
    return Cloud;
  }
  if (scope === "tag") {
    return Tag;
  }
  return HardDrive;
}

export function refLabelIconClass(scope: CommitRefBadgeScope): string {
  return `commit-graph__ref-badge-icon commit-graph__ref-badge-icon--${scope}`;
}

// ── Sub-components ─────────────────────────────────────────────────────

export function WipNode({
  className = "",
  style,
  size = WIP_NODE_SIZE,
  ringRadius = WIP_NODE_RING_RADIUS,
  strokeWidth = 1.8,
  variant = "standard",
}: {
  className?: string;
  style?: CSSProperties;
  size?: number;
  ringRadius?: number;
  strokeWidth?: number;
  variant?: CommitGraphStyle;
}): JSX.Element {
  const center = size / 2;
  return (
    <span
      className={`wip-node ${variant === "japaneseExpress" ? "wip-node--japanese-express" : ""} ${className}`.trim()}
      style={style}
      aria-hidden="true"
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
        <circle
          className="wip-node-ring"
          cx={center}
          cy={center}
          r={ringRadius}
          strokeWidth={strokeWidth}
          strokeDasharray="2 3"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export function StashNode({
  className = "",
  style,
  size = STASH_NODE_SIZE,
  strokeWidth: _strokeWidth = 1.6,
  variant = "standard",
}: {
  className?: string;
  style?: CSSProperties;
  size?: number;
  strokeWidth?: number;
  variant?: CommitGraphStyle;
}): JSX.Element {
  const iconSize = Math.round(size * 0.6);
  return (
    <span
      className={`stash-node ${variant === "japaneseExpress" ? "stash-node--japanese-express" : ""} ${className}`.trim()}
      style={{
        ...style,
        width: `${size}px`,
        height: `${size}px`,
      }}
      aria-hidden="true"
    >
      <Archive size={iconSize} strokeWidth={2} />
    </span>
  );
}
