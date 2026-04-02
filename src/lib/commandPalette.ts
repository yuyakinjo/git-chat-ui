export interface SearchableCommandPaletteItem {
  id: string;
  title: string;
  description?: string;
  keywords?: readonly string[];
  disabledReason?: string | null;
}

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
