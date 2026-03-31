import type { WorkingFile } from "../types";

import type { WorkingTreeDragSource } from "./workingTreeDragDrop";

export type WorkingTreeDiscardMode = "restore" | "delete";

export interface WorkingTreeDiscardTarget {
  file: string;
  mode: WorkingTreeDiscardMode;
}

export const WORKING_TREE_CONTEXT_MENU_WIDTH_PX = 216;
export const WORKING_TREE_CONTEXT_MENU_HEIGHT_PX = 112;

export function isPureUntrackedWorkingFile(item: Pick<WorkingFile, "x" | "y">): boolean {
  return item.x === "?" && item.y === "?";
}

export function canDiscardWorkingFile(_item: Pick<WorkingFile, "x" | "y">): boolean {
  return true;
}

export function isStagedAddedWorkingFile(item: Pick<WorkingFile, "x">): boolean {
  return item.x === "A";
}

export function resolveWorkingTreeDiscardTarget(
  item: Pick<WorkingFile, "file" | "x" | "y">,
  _source: WorkingTreeDragSource,
): WorkingTreeDiscardTarget | null {
  const file = item.file.trim();
  if (!file) {
    return null;
  }

  return {
    file,
    mode: isPureUntrackedWorkingFile(item) || isStagedAddedWorkingFile(item) ? "delete" : "restore",
  };
}

export function getWorkingTreeDiscardConfirmMessage(target: WorkingTreeDiscardTarget): string {
  if (target.mode === "delete") {
    return [
      `${target.file} の変更を取り消しますか？`,
      "",
      "このパスは HEAD に存在しないため、取り消すとファイルまたはディレクトリ自体が削除されます。",
    ].join("\n");
  }

  return [
    `${target.file} の変更を取り消しますか？`,
    "",
    "staged / unstaged のローカル変更をまとめて破棄し、HEAD の状態に戻します。",
  ].join("\n");
}

export function getWorkingTreeDiscardMenuHint(target: WorkingTreeDiscardTarget): string {
  if (target.mode === "delete") {
    return "HEAD に存在しないため、取り消すとこのパスは削除されます。";
  }

  return "staged / unstaged のローカル変更をまとめて破棄して HEAD に戻します。";
}

export function clampWorkingTreeContextMenuPosition(
  x: number,
  y: number,
): { x: number; y: number } {
  if (typeof window === "undefined") {
    return { x, y };
  }

  return {
    x: Math.min(
      Math.max(12, x),
      Math.max(12, window.innerWidth - WORKING_TREE_CONTEXT_MENU_WIDTH_PX - 12),
    ),
    y: Math.min(
      Math.max(12, y),
      Math.max(12, window.innerHeight - WORKING_TREE_CONTEXT_MENU_HEIGHT_PX - 12),
    ),
  };
}
