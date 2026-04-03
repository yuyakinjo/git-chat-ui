export const DEFAULT_APP_TOOLBAR_ITEM_ORDER = [
  "assistant",
  "commandPalette",
  "layout",
  "theme",
  "github",
  "config",
] as const;

export type AppToolbarItemId = (typeof DEFAULT_APP_TOOLBAR_ITEM_ORDER)[number];

export const APP_TOOLBAR_ITEM_ORDER_STORAGE_KEY = "git-chat-ui.app-toolbar-item-order";
export const APP_TOOLBAR_DRAG_THRESHOLD_PX = 6;

const APP_TOOLBAR_ITEM_ID_SET = new Set<string>(DEFAULT_APP_TOOLBAR_ITEM_ORDER);

export const appToolbarItemLabels: Record<AppToolbarItemId, string> = {
  commandPalette: "Palette",
  assistant: "Assistant",
  theme: "Theme",
  github: "GitHub",
  layout: "Layout",
  config: "Config",
};

export function isAppToolbarItemId(value: string): value is AppToolbarItemId {
  return APP_TOOLBAR_ITEM_ID_SET.has(value);
}

export function normalizeAppToolbarItemOrder(
  input: readonly string[] | null | undefined,
): AppToolbarItemId[] {
  const seen = new Set<AppToolbarItemId>();
  const normalized: AppToolbarItemId[] = [];

  for (const value of input ?? []) {
    if (!isAppToolbarItemId(value) || seen.has(value)) {
      continue;
    }

    seen.add(value);
    normalized.push(value);
  }

  for (const value of DEFAULT_APP_TOOLBAR_ITEM_ORDER) {
    if (!seen.has(value)) {
      normalized.push(value);
    }
  }

  return normalized;
}

export function getVisibleAppToolbarItemOrder(
  order: readonly AppToolbarItemId[],
  visibleItemIds: ReadonlySet<AppToolbarItemId>,
): AppToolbarItemId[] {
  return order.filter((itemId) => visibleItemIds.has(itemId));
}

export function canSwapAppToolbarItem(options: {
  sourceId: AppToolbarItemId | null;
  targetId: AppToolbarItemId | null;
}): boolean {
  const { sourceId, targetId } = options;
  if (!sourceId || !targetId) {
    return false;
  }

  return sourceId !== targetId;
}

export function swapAppToolbarItems(
  order: readonly AppToolbarItemId[],
  sourceId: AppToolbarItemId,
  targetId: AppToolbarItemId,
): AppToolbarItemId[] {
  if (sourceId === targetId) {
    return [...order];
  }

  const sourceIndex = order.indexOf(sourceId);
  const targetIndex = order.indexOf(targetId);

  if (sourceIndex < 0 || targetIndex < 0) {
    return [...order];
  }

  const next = [...order];
  next[sourceIndex] = targetId;
  next[targetIndex] = sourceId;
  return next;
}
