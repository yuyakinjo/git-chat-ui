export type AiProvider = "openAi" | "claudeCode";

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
