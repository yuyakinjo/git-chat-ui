interface RepositoryTabShortcutLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

const REPOSITORY_TAB_SHORTCUT_KEYS = ["1", "2", "3"] as const;

function normalizeShortcutKey(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function getRepositoryTabShortcutIndex(event: RepositoryTabShortcutLike): number | null {
  if (event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey)) {
    return null;
  }

  const shortcutIndex = REPOSITORY_TAB_SHORTCUT_KEYS.indexOf(
    normalizeShortcutKey(event.key) as (typeof REPOSITORY_TAB_SHORTCUT_KEYS)[number],
  );
  return shortcutIndex >= 0 ? shortcutIndex : null;
}

export function getRepositoryTabShortcutLabel(repositoryIndex: number): string | null {
  if (repositoryIndex < 0 || repositoryIndex >= REPOSITORY_TAB_SHORTCUT_KEYS.length) {
    return null;
  }

  return `Cmd/Ctrl + ${REPOSITORY_TAB_SHORTCUT_KEYS[repositoryIndex]}`;
}
