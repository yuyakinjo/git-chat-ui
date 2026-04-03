export type AiProvider = "openAi" | "claudeCode";
export type OpenAiReasoningEffort =
  | "default"
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export interface GeneratedCommitMessage {
  title: string;
  description: string;
}

export interface TokenValidationResult {
  valid: boolean;
}

export interface OpenAiModelsResponse {
  models: string[];
}

export const OPENAI_REASONING_EFFORT_VALUES = [
  "default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const satisfies OpenAiReasoningEffort[];

const OPENAI_REASONING_MODEL_ALIASES = [
  "o1",
  "o3",
  "o3-mini",
  "o4-mini",
  "gpt-5",
  "gpt-5-codex",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5-pro",
  "gpt-5.1",
  "gpt-5.1-chat-latest",
  "gpt-5.1-codex-mini",
  "gpt-5.1-codex",
  "gpt-5.1-codex-max",
  "gpt-5.2",
  "gpt-5.2-chat-latest",
  "gpt-5.2-pro",
  "gpt-5.2-codex",
  "gpt-5.3-chat-latest",
  "gpt-5.3-codex",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.4-pro",
] as const;

export const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";

export const DEFAULT_COMMIT_TITLE_PROMPT = [
  "You are a Git assistant. Write a Git commit message from the provided staged changes.",
  "Requirements:",
  "- The first line must be an conventional commit title such as feat:, fix:, docs:, style:, refactor:, perf:, test:, build:, ci:, chore:, or revert:. Use an optional scope when it adds clarity.",
  "- Keep the title in imperative mood. The title line must be 72 characters or fewer including prefix, scope, spaces, and punctuation.",
  "- If the title would exceed 72 characters, rewrite it shorter. Do not continue the overflow on the next line or in the description.",
  "- After the title, insert a blank line and always include a short description of the key changes.",
  "- Prefer 1-3 concise bullet points for the description. The first line becomes the title and the rest becomes the description.",
  "- Do not add labels like Title: or Description:, and do not wrap the response in quotes or code fences.",
  "- Do not omit the description, even for small changes.",
].join("\n");

export function resolveCommitTitlePrompt(prompt: string | null | undefined): string {
  const normalized = typeof prompt === "string" ? prompt.trim() : "";
  return normalized.length > 0 ? normalized : DEFAULT_COMMIT_TITLE_PROMPT;
}

export function isOpenAiReasoningEffort(value: unknown): value is OpenAiReasoningEffort {
  return (
    typeof value === "string" &&
    OPENAI_REASONING_EFFORT_VALUES.includes(value as OpenAiReasoningEffort)
  );
}

export function normalizeOpenAiReasoningEffort(value: unknown): OpenAiReasoningEffort {
  return isOpenAiReasoningEffort(value) ? value : "default";
}

export function supportsOpenAiReasoningEffort(model: string | null | undefined): boolean {
  const normalizedModel = typeof model === "string" ? model.trim().toLocaleLowerCase() : "";
  if (!normalizedModel) {
    return false;
  }

  return OPENAI_REASONING_MODEL_ALIASES.some(
    (alias) => normalizedModel === alias || normalizedModel.startsWith(`${alias}-20`),
  );
}
