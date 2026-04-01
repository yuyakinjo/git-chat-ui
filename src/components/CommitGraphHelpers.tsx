import { Cloud, HardDrive, Tag, type LucideIcon } from "lucide-react";
import type { CSSProperties, JSX } from "react";

import type { LaneRow } from "../lib/commitGraphLayout";
import type { CommitListItem } from "../types";

// ── Constants ──────────────────────────────────────────────────────────

export const LANE_GAP = 18;
export const LANE_PADDING = 10;
export const ROW_HEIGHT = 32;
export const LINE_OVERDRAW = 1;
export const WIP_NODE_SIZE = 18;
export const WIP_NODE_CENTER = WIP_NODE_SIZE / 2;
export const WIP_NODE_RING_RADIUS = 7;
export const WIP_NODE_LINE_CLEARANCE = WIP_NODE_RING_RADIUS + 1;
export const REF_COLUMN_MIN_WIDTH = 140;
export const REF_COLUMN_MAX_WIDTH = 900;
export const REF_COLUMN_DEFAULT_WIDTH = 230;
export const REF_COLUMN_STORAGE_KEY = "git-chat-ui.commit-refs-column-width";
export const REF_BADGE_ICON_SIZE = 10;

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

// ── Types ──────────────────────────────────────────────────────────────

export interface CommitRefLabel {
  type: "head" | "branch" | "tag";
  name: string;
}

export interface CommitRefScopeContext {
  localRefNames: Set<string>;
  remoteRefNames: Set<string>;
  remoteNames: Set<string>;
}

// ── Pure functions ─────────────────────────────────────────────────────

function normalizeSha(sha: string | null | undefined): string {
  return sha?.trim() ?? "";
}

export function laneColor(index: number, defaultLaneIndex = 0): string {
  const offset = index - defaultLaneIndex;
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

export function laneX(index: number): number {
  return LANE_PADDING + index * LANE_GAP;
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

export function resolveCommitRefScope(
  label: CommitRefLabel,
  context: CommitRefScopeContext | null,
): "local" | "remote" | "tag" {
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

export function refLabelIcon(scope: "local" | "remote" | "tag"): LucideIcon {
  if (scope === "remote") {
    return Cloud;
  }
  if (scope === "tag") {
    return Tag;
  }
  return HardDrive;
}

export function refLabelIconClass(scope: "local" | "remote" | "tag"): string {
  return `commit-graph__ref-badge-icon commit-graph__ref-badge-icon--${scope}`;
}

// ── Sub-components ─────────────────────────────────────────────────────

export function WipNode({
  className = "",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}): JSX.Element {
  return (
    <span className={`wip-node ${className}`.trim()} style={style} aria-hidden="true">
      <svg
        width={WIP_NODE_SIZE}
        height={WIP_NODE_SIZE}
        viewBox={`0 0 ${WIP_NODE_SIZE} ${WIP_NODE_SIZE}`}
        fill="none"
      >
        <circle
          className="wip-node-ring"
          cx={WIP_NODE_CENTER}
          cy={WIP_NODE_CENTER}
          r={WIP_NODE_RING_RADIUS}
          strokeDasharray="2 3"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
