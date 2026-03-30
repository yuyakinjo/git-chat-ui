export type WorkingTreeDropZone = 'staged' | 'unstaged' | 'stash';
export type WorkingTreeDragSource = Exclude<WorkingTreeDropZone, 'stash'>;

export interface WorkingTreeDragPayload {
  file: string;
  source: WorkingTreeDragSource;
}

export function canDropWorkingTreeFile(options: {
  busy: boolean;
  payload: WorkingTreeDragPayload | null;
  target: WorkingTreeDropZone;
}): boolean {
  const { busy, payload, target } = options;
  if (busy || !payload || !payload.file.trim()) {
    return false;
  }

  if (target === 'stash') {
    return true;
  }

  if (target === 'staged') {
    return payload.source === 'unstaged';
  }

  return payload.source === 'staged';
}

export function getWorkingTreeDropActionLabel(target: WorkingTreeDropZone): string {
  if (target === 'staged') {
    return 'Stage';
  }

  if (target === 'unstaged') {
    return 'Unstage';
  }

  return 'Stash';
}

export function getWorkingTreeDropZoneLabel(target: WorkingTreeDropZone): string {
  if (target === 'staged') {
    return 'Staged Files';
  }

  if (target === 'unstaged') {
    return 'Unstaged Files';
  }

  return 'Stash Area';
}
