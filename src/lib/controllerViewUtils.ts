import type { ControllerPanelId } from "./controllerPanelOrder";
import type { Branch, BranchResponse } from "../types";

export function resolveDefaultBranch(branches: BranchResponse | null): Branch | undefined {
  if (!branches) {
    return undefined;
  }

  const localBranches = branches.local;
  const candidate =
    localBranches.find((branch) => branch.name === "main") ??
    localBranches.find((branch) => branch.name === "master") ??
    localBranches.find((branch) => branch.name === branches.current) ??
    localBranches[0];

  if (!candidate) {
    return undefined;
  }

  return candidate;
}

export function resolveDefaultBranchRef(branches: BranchResponse | null): string | undefined {
  const candidate = resolveDefaultBranch(branches);
  if (!candidate) {
    return undefined;
  }

  return candidate.fullRef || candidate.name;
}

export function resolveLogRef(targetRef: string, branches: BranchResponse | null): string {
  const normalizedTarget = targetRef.trim();
  if (!branches || normalizedTarget !== "HEAD") {
    return normalizedTarget || "HEAD";
  }

  const currentLocal = branches.local.find((branch) => branch.name === branches.current);
  if (!currentLocal) {
    return "HEAD";
  }

  return currentLocal.fullRef || currentLocal.name;
}

export function resolveCompareRefs(targetRef: string, branches: BranchResponse | null): string[] {
  if (!branches) {
    return [];
  }

  const defaultRef = resolveDefaultBranchRef(branches);
  const refs = branches.local.map((branch) => branch.fullRef || branch.name);
  const ordered = defaultRef ? [defaultRef, ...refs.filter((ref) => ref !== defaultRef)] : refs;
  const deduped = [...new Set(ordered)];
  return deduped.filter((ref) => ref && ref !== targetRef);
}

export function isHeadDecoration(decoration: string): boolean {
  const trimmed = decoration.trim();
  if (!trimmed) {
    return false;
  }

  const body =
    trimmed.startsWith("(") && trimmed.endsWith(")")
      ? trimmed.slice(1, Math.max(trimmed.length - 1, 1))
      : trimmed;
  return body
    .split(",")
    .map((entry) => entry.trim())
    .some((entry) => entry === "HEAD" || entry.startsWith("HEAD -> "));
}

export const CONTROLLER_PANEL_ORDER_STORAGE_KEY = "git-chat-ui.controller-panel-order";
export const PANEL_DRAG_THRESHOLD_PX = 6;
export const CONTROLLER_PANEL_DRAG_IGNORE_SELECTOR = [
  '[data-controller-panel-drag-ignore="true"]',
  '[data-working-tree-no-drag="true"]',
  "button",
  "input",
  "textarea",
  "select",
  "option",
  "label",
  "a",
  '[role="button"]',
  '[role="link"]',
  '[contenteditable="true"]',
].join(", ");
export const controllerPanelLabels: Record<ControllerPanelId, string> = {
  commitGraph: "Commit Graph",
  gitOperations: "Git Operations",
  commitDetail: "Commit Detail",
};

export function resolveControllerPanelDragTarget(target: EventTarget | null): Element | null {
  if (target instanceof Element) {
    return target;
  }

  if (target instanceof Node) {
    return target.parentElement;
  }

  return null;
}

export function shouldIgnoreControllerPanelPointerDown(target: EventTarget | null): boolean {
  const element = resolveControllerPanelDragTarget(target);
  if (!element) {
    return false;
  }

  return Boolean(element.closest(CONTROLLER_PANEL_DRAG_IGNORE_SELECTOR));
}
