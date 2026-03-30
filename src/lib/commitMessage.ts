import type { WorkingTreeStatus } from '../types';

export function getCommitMessageFiles(status: WorkingTreeStatus | null): string[] {
  if (!status) {
    return [];
  }

  return [...new Set(status.staged.map((item) => item.file.trim()).filter((file) => file.length > 0))];
}
