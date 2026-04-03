export interface SearchableCommandPaletteItem {
  id: string;
  title: string;
  description?: string;
  keywords?: readonly string[];
  disabledReason?: string | null;
}

const MAX_RECENT_COMMAND_PALETTE_ITEMS = 50;

interface CommandPaletteShortcutLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

function normalizeCommandPaletteText(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeCommandPaletteItemId(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function normalizeRecentCommandPaletteItemIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const itemId = normalizeCommandPaletteItemId(item);
    if (!itemId || seen.has(itemId)) {
      continue;
    }

    seen.add(itemId);
    normalized.push(itemId);

    if (normalized.length >= MAX_RECENT_COMMAND_PALETTE_ITEMS) {
      break;
    }
  }

  return normalized;
}

export function parseRecentCommandPaletteItemIds(rawValue: string | null | undefined): string[] {
  if (!rawValue) {
    return [];
  }

  try {
    return normalizeRecentCommandPaletteItemIds(JSON.parse(rawValue));
  } catch {
    return [];
  }
}

export function updateRecentCommandPaletteItemIds(
  recentItemIds: readonly string[],
  itemId: string,
): string[] {
  const normalizedItemId = normalizeCommandPaletteItemId(itemId);
  if (!normalizedItemId) {
    return [...recentItemIds];
  }

  return [
    normalizedItemId,
    ...normalizeRecentCommandPaletteItemIds(recentItemIds).filter(
      (recentItemId) => recentItemId !== normalizedItemId,
    ),
  ].slice(0, MAX_RECENT_COMMAND_PALETTE_ITEMS);
}

export function sortCommandPaletteItemsByRecency<T extends SearchableCommandPaletteItem>(
  items: readonly T[],
  recentItemIds: readonly string[],
): T[] {
  if (items.length <= 1 || recentItemIds.length === 0) {
    return [...items];
  }

  const recentOrder = new Map(
    normalizeRecentCommandPaletteItemIds(recentItemIds).map((itemId, index) => [itemId, index]),
  );

  return items
    .map((item, index) => ({
      item,
      index,
      recentIndex: recentOrder.get(item.id) ?? Number.POSITIVE_INFINITY,
    }))
    .sort((left, right) => {
      if (left.recentIndex !== right.recentIndex) {
        return left.recentIndex - right.recentIndex;
      }

      return left.index - right.index;
    })
    .map(({ item }) => item);
}

export function filterCommandPaletteItems<T extends SearchableCommandPaletteItem>(
  items: readonly T[],
  query: string,
): T[] {
  const normalizedQuery = normalizeCommandPaletteText(query);
  if (!normalizedQuery) {
    return [...items];
  }

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);

  return items.filter((item) => {
    const haystack = normalizeCommandPaletteText(
      [item.title, item.description, ...(item.keywords ?? [])].join(" "),
    );
    return tokens.every((token) => haystack.includes(token));
  });
}

export function getDefaultActiveCommandPaletteItemId<T extends SearchableCommandPaletteItem>(
  items: readonly T[],
  query: string,
): string | null {
  return normalizeCommandPaletteText(query) ? (items[0]?.id ?? null) : null;
}

export function getNextActiveCommandPaletteItemId<T extends SearchableCommandPaletteItem>(
  items: readonly T[],
  currentId: string | null,
  direction: 1 | -1,
): string | null {
  const lastItemId = items[items.length - 1]?.id ?? null;

  if (items.length === 0) {
    return null;
  }

  if (!currentId) {
    return direction === 1 ? (items[0]?.id ?? null) : lastItemId;
  }

  const currentIndex = items.findIndex((item) => item.id === currentId);
  if (currentIndex < 0) {
    return direction === 1 ? (items[0]?.id ?? null) : lastItemId;
  }

  const nextIndex = (currentIndex + direction + items.length) % items.length;
  return items[nextIndex]?.id ?? null;
}

export function isCommandPaletteShortcut(event: CommandPaletteShortcutLike): boolean {
  if (event.altKey || event.shiftKey) {
    return false;
  }

  const normalizedKey = normalizeCommandPaletteText(event.key);
  if (normalizedKey !== "p") {
    return false;
  }

  return Boolean(event.metaKey || event.ctrlKey);
}
