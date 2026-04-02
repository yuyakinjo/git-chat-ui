export type WorkingTreeDropZone = "staged" | "unstaged" | "stash";
export type WorkingTreeDragSource = Exclude<WorkingTreeDropZone, "stash">;

export interface WorkingTreeDragPayload {
  file: string;
  files: string[];
  source: WorkingTreeDragSource;
}

export function getWorkingTreeDragFiles(payload: WorkingTreeDragPayload): string[] {
  const normalizedFiles = payload.files
    .map((file) => file.trim())
    .filter((file) => file.length > 0);

  if (normalizedFiles.length > 0) {
    return Array.from(new Set(normalizedFiles));
  }

  const normalizedFile = payload.file.trim();
  return normalizedFile.length > 0 ? [normalizedFile] : [];
}

export function getWorkingTreeDragFileCount(payload: WorkingTreeDragPayload): number {
  return getWorkingTreeDragFiles(payload).length;
}

export function canDropWorkingTreeFile(options: {
  busy: boolean;
  payload: WorkingTreeDragPayload | null;
  target: WorkingTreeDropZone;
}): boolean {
  const { busy, payload, target } = options;
  if (busy || !payload || getWorkingTreeDragFileCount(payload) === 0) {
    return false;
  }

  if (target === "stash") {
    return true;
  }

  if (target === "staged") {
    return payload.source === "unstaged";
  }

  return payload.source === "staged";
}

export function getWorkingTreeDropActionLabel(target: WorkingTreeDropZone): string {
  if (target === "staged") {
    return "Stage";
  }

  if (target === "unstaged") {
    return "Unstage";
  }

  return "Stash";
}

export function getWorkingTreeDropZoneLabel(target: WorkingTreeDropZone): string {
  if (target === "staged") {
    return "Staged Files";
  }

  if (target === "unstaged") {
    return "Unstaged Files";
  }

  return "Stash Area";
}
