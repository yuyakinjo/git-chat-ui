interface ConfigShortcutLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

function normalizeShortcutKey(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function isConfigShortcut(event: ConfigShortcutLike): boolean {
  if (event.altKey || event.shiftKey) {
    return false;
  }

  return normalizeShortcutKey(event.key) === "," && Boolean(event.metaKey || event.ctrlKey);
}
