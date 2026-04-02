import { DEFAULT_OPENAI_MODEL, normalizeOpenAiReasoningEffort } from "../../shared/ai.js";
import type {
  RepositoryAssistantMessage,
  RepositoryAssistantMessageRole,
  RepositoryAssistantSettings,
} from "../types";

const REPOSITORY_ASSISTANT_SETTINGS_STORAGE_KEY = "git-chat-ui.repository-assistant-settings";

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

export function isRepositoryAssistantSubmitShortcut(
  event: RepositoryAssistantShortcutLike,
): boolean {
  if (event.altKey || event.shiftKey) {
    return false;
  }

  return normalizeShortcutKey(event.key) === "enter" && Boolean(event.metaKey || event.ctrlKey);
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

export { REPOSITORY_ASSISTANT_SETTINGS_STORAGE_KEY };

export function createDefaultRepositoryAssistantSettings(
  fallbackOpenAiModel: string | null | undefined,
): RepositoryAssistantSettings {
  const normalizedModel = fallbackOpenAiModel?.trim();

  return {
    openAiModel:
      normalizedModel && normalizedModel.length > 0 ? normalizedModel : DEFAULT_OPENAI_MODEL,
    reasoningEffort: "default",
  };
}

export function normalizeRepositoryAssistantSettings(
  value: unknown,
  fallbackOpenAiModel: string | null | undefined,
): RepositoryAssistantSettings {
  if (typeof value !== "object" || value === null) {
    return createDefaultRepositoryAssistantSettings(fallbackOpenAiModel);
  }

  const candidate = value as Partial<RepositoryAssistantSettings>;
  const fallback = createDefaultRepositoryAssistantSettings(fallbackOpenAiModel);

  return {
    openAiModel:
      typeof candidate.openAiModel === "string" && candidate.openAiModel.trim().length > 0
        ? candidate.openAiModel.trim()
        : fallback.openAiModel,
    reasoningEffort: normalizeOpenAiReasoningEffort(candidate.reasoningEffort),
  };
}
