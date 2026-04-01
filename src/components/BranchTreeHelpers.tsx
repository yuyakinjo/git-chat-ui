import type { JSX } from "react";

import { formatFileCountLabel } from "../lib/format";
import type { Branch, StashEntry } from "../types";

export interface TreeNode {
  children: Map<string, TreeNode>;
  leaves: Array<{ branch: Branch; displayName: string }>;
}

export const CONTEXT_MENU_WIDTH_PX = 232;
export const REMOTE_CONTEXT_MENU_HEIGHT_PX = 60;
export const LOCAL_CONTEXT_MENU_HEIGHT_PX = 96;
export const STASH_CONTEXT_MENU_HEIGHT_PX = 188;
export const BLOCKED_STASH_CONTEXT_MENU_HEIGHT_PX = 280;

export function clampContextMenuPosition(
  x: number,
  y: number,
  height: number,
): { x: number; y: number } {
  if (typeof window === "undefined") {
    return { x, y };
  }

  return {
    x: Math.min(Math.max(12, x), Math.max(12, window.innerWidth - CONTEXT_MENU_WIDTH_PX - 12)),
    y: Math.min(Math.max(12, y), Math.max(12, window.innerHeight - height - 12)),
  };
}

export function getContextMenuHeight(branch: Branch): number {
  return branch.type === "local" ? LOCAL_CONTEXT_MENU_HEIGHT_PX : REMOTE_CONTEXT_MENU_HEIGHT_PX;
}

export function getStashContextMenuHeight(blockedReason: string | null): number {
  return blockedReason ? BLOCKED_STASH_CONTEXT_MENU_HEIGHT_PX : STASH_CONTEXT_MENU_HEIGHT_PX;
}

export function getStashContextMenuHint(): string {
  return "Apply は stash を残し、Pop は適用後に取り除きます。Rename は message だけを更新します。";
}

export function getBranchDisplayName(branchName: string): string {
  const parts = branchName.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? branchName;
}

export function buildTree(items: Branch[]): TreeNode {
  const root: TreeNode = {
    children: new Map<string, TreeNode>(),
    leaves: [],
  };

  for (const branch of items) {
    const parts = branch.name.split("/").filter(Boolean);
    if (parts.length <= 1) {
      root.leaves.push({
        branch,
        displayName: branch.name,
      });
      continue;
    }

    let currentNode = root;

    for (let index = 0; index < parts.length - 1; index += 1) {
      const segment = parts[index];
      const nextNode = currentNode.children.get(segment);

      if (nextNode) {
        currentNode = nextNode;
      } else {
        const created: TreeNode = {
          children: new Map<string, TreeNode>(),
          leaves: [],
        };
        currentNode.children.set(segment, created);
        currentNode = created;
      }
    }

    currentNode.leaves.push({
      branch,
      displayName: parts[parts.length - 1],
    });
  }

  return root;
}

export function getStashPrimaryLabel(stash: StashEntry): string {
  const message = stash.message.trim();
  return message || stash.id;
}

export function getStashMetaLabel(stash: StashEntry): string {
  const parts = [formatFileCountLabel(stash.files.length)];
  const relativeDate = stash.relativeDate.trim();
  if (relativeDate) {
    parts.push(relativeDate);
  }

  return parts.join(" • ");
}

export function SectionTitle({ children }: { children: string }): JSX.Element {
  return (
    <div className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
      {children}
    </div>
  );
}
