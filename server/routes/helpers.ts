import type { Request } from "express";

import type { AppConfig } from "../types.js";

export function getRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required.`);
  }

  return value;
}

export function getRepoPathFromQuery(request: Request): string {
  return getRequiredString(request.query.repoPath, "repoPath");
}

export function parseCommitGraphMode(value: unknown): AppConfig["commitGraphMode"] | null {
  if (value === "simple" || value === "detailed") {
    return value;
  }

  return null;
}

export function parseCommitGraphStyle(value: unknown): AppConfig["commitGraphStyle"] | null {
  if (value === "standard" || value === "japaneseExpress") {
    return value;
  }

  return null;
}

export function parseCommitMergeAnimation(
  value: unknown,
): AppConfig["commitMergeAnimation"] | null {
  if (
    value === "none" ||
    value === "pulse" ||
    value === "ripple" ||
    value === "orbit" ||
    value === "shimmer" ||
    value === "metaball" ||
    value === "morph" ||
    value === "dissolve" ||
    value === "particle"
  ) {
    return value;
  }

  return null;
}

export function parseDiffViewerMode(value: unknown): AppConfig["diffViewerMode"] | null {
  if (value === "builtin" || value === "pierre") {
    return value;
  }

  return null;
}

export function parseSelectedAiProvider(value: unknown): AppConfig["selectedAiProvider"] | null {
  if (value === "openAi" || value === "claudeCode") {
    return value;
  }

  return null;
}

export function parseRepositoryScanDepth(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

export function parseWorkingTreeDiffArea(value: unknown): "staged" | "unstaged" {
  if (value === "staged" || value === "unstaged") {
    return value;
  }

  throw new Error("area must be staged or unstaged.");
}

export function parseConflictResolutionSide(value: unknown): "merged" | "ours" | "theirs" {
  if (value === "merged" || value === "ours" || value === "theirs") {
    return value;
  }

  throw new Error("side must be merged, ours, or theirs.");
}
