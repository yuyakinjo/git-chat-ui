import type { Branch } from "../types";

export const BRANCH_DRAG_MIME = "application/x-git-chat-ui-branch";

export interface BranchDragPayload {
  branchName: string;
  branchType: Branch["type"];
}

export function serializeBranchDragPayload(payload: BranchDragPayload): string {
  return JSON.stringify(payload);
}

export function parseBranchDragPayload(raw: string): BranchDragPayload | null {
  if (!raw.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<BranchDragPayload>;
    if (
      typeof parsed.branchName !== "string" ||
      !parsed.branchName.trim() ||
      (parsed.branchType !== "local" && parsed.branchType !== "remote")
    ) {
      return null;
    }

    return {
      branchName: parsed.branchName,
      branchType: parsed.branchType,
    };
  } catch {
    return null;
  }
}

export function writeBranchDragPayload(
  dataTransfer: DataTransfer,
  payload: BranchDragPayload,
): void {
  const serialized = serializeBranchDragPayload(payload);
  dataTransfer.setData(BRANCH_DRAG_MIME, serialized);
  dataTransfer.setData("text/plain", serialized);
  dataTransfer.effectAllowed = "move";
}

export function readBranchDragPayload(dataTransfer: DataTransfer): BranchDragPayload | null {
  const raw = dataTransfer.getData(BRANCH_DRAG_MIME) || dataTransfer.getData("text/plain");

  return parseBranchDragPayload(raw);
}

export function canDropBranchOnBranch(options: {
  busy: boolean;
  source: BranchDragPayload | null;
  target: Branch;
}): boolean {
  const { busy, source, target } = options;
  if (busy || !source) {
    return false;
  }

  if (source.branchType !== "local" || target.type !== "local") {
    return false;
  }

  return source.branchName !== target.name;
}
