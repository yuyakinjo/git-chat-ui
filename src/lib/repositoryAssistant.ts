import type { RepositoryAssistantMessage, RepositoryAssistantMessageRole } from "../types";

interface RepositoryAssistantShortcutLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

function normalizeShortcutKey(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function isRepositoryAssistantShortcut(event: RepositoryAssistantShortcutLike): boolean {
  if (event.altKey || event.shiftKey) {
    return false;
  }

  return normalizeShortcutKey(event.key) === "i" && Boolean(event.metaKey || event.ctrlKey);
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

export function createRepositoryAssistantMessage(
  role: RepositoryAssistantMessageRole,
  content: string,
): RepositoryAssistantMessage {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content: content.trim(),
    createdAt: new Date().toISOString(),
  };
}
