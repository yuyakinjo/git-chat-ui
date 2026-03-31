import type { GeneratedCommitMessage } from "../../shared/ai.js";
import {
  DEFAULT_COMMIT_TITLE_PROMPT,
  DEFAULT_OPENAI_MODEL,
  resolveCommitTitlePrompt,
} from "../../shared/ai.js";

export { DEFAULT_COMMIT_TITLE_PROMPT, DEFAULT_OPENAI_MODEL, resolveCommitTitlePrompt };

export function resolveOpenAiModel(model: string | null | undefined): string {
  const normalized = typeof model === "string" ? model.trim() : "";
  return normalized.length > 0 ? normalized : DEFAULT_OPENAI_MODEL;
}

export function buildHeuristicTitle(changedFiles: string[]): string {
  if (changedFiles.length === 0) {
    return "chore: update repository state";
  }

  const uniqueRoots = new Set(
    changedFiles.map((file) => {
      const [root] = file.split("/");
      return root || file;
    }),
  );

  if (uniqueRoots.size === 1) {
    const [onlyRoot] = [...uniqueRoots];
    return `chore: update ${onlyRoot}`;
  }

  if (changedFiles.length === 1) {
    return `chore: update ${changedFiles[0]}`;
  }

  return `chore: refine ${changedFiles.length} files`;
}

function normalizeTitle(rawTitle: string, fallback: string): string {
  const trimmed = rawTitle
    .replace(/[\r\n]+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

  if (!trimmed) {
    return fallback;
  }

  return trimmed;
}

function stripLabel(value: string, labels: string[]): string {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();

  for (const label of labels) {
    const prefix = `${label}:`;
    if (lower.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trimStart();
    }
  }

  return trimmed;
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start].trim().length === 0) {
    start += 1;
  }

  while (end > start && lines[end - 1].trim().length === 0) {
    end -= 1;
  }

  return lines.slice(start, end);
}

export function normalizeGeneratedCommitMessage(
  rawMessage: string | null | undefined,
  fallbackTitle: string,
): GeneratedCommitMessage {
  const normalized =
    typeof rawMessage === "string" ? rawMessage.replace(/\r\n?/g, "\n").trim() : "";
  const fallback = normalizeTitle(fallbackTitle, "chore: update repository state");

  if (!normalized) {
    return {
      title: fallback,
      description: "",
    };
  }

  const fencedLines = normalized.split("\n");
  if (fencedLines[0]?.trimStart().startsWith("```")) {
    fencedLines.shift();
  }
  if (fencedLines.at(-1)?.trimStart().startsWith("```")) {
    fencedLines.pop();
  }

  const lines = trimBlankLines(fencedLines);
  if (lines.length === 0) {
    return {
      title: fallback,
      description: "",
    };
  }

  const rawTitleLine = stripLabel(lines[0].replace(/^["'`]+|["'`]+$/g, ""), [
    "title",
    "summary",
    "subject",
  ]);
  const title = normalizeTitle(rawTitleLine, fallback);
  const descriptionLines = lines.slice(1);

  const firstDescriptionLine = descriptionLines.findIndex((line) => line.trim().length > 0);
  if (firstDescriptionLine >= 0) {
    descriptionLines[firstDescriptionLine] = stripLabel(descriptionLines[firstDescriptionLine], [
      "description",
      "body",
    ]);
  }

  return {
    title,
    description: trimBlankLines(descriptionLines).join("\n"),
  };
}
