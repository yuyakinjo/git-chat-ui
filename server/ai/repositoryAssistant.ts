import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

import {
  getBranches,
  getCommits,
  getConflictSummary,
  getPullStatus,
  getWorkingTreeStatus,
} from "../gitService.js";
import type { RepositoryAssistantMessage } from "../types.js";

import { resolveOpenAiModel } from "./normalize.js";

const MAX_MESSAGE_HISTORY = 12;
const MAX_LIST_ITEMS = 8;
const MAX_OUTPUT_TOKENS = 900;

function formatWorkingFileList(
  items: Array<{ file: string; statusLabel: string }>,
  emptyLabel: string,
): string {
  if (items.length === 0) {
    return emptyLabel;
  }

  const visibleItems = items
    .slice(0, MAX_LIST_ITEMS)
    .map((item) => `${item.file} (${item.statusLabel})`);
  const remainder = items.length - visibleItems.length;
  return remainder > 0 ? `${visibleItems.join(", ")}, +${remainder} more` : visibleItems.join(", ");
}

function summarizeCommitSubjects(
  commits: Array<{ sha: string; subject: string; author: string }>,
): string {
  if (commits.length === 0) {
    return "No recent commits were loaded.";
  }

  return commits
    .slice(0, 6)
    .map((commit) => `- ${commit.sha.slice(0, 7)} ${commit.subject} (${commit.author})`)
    .join("\n");
}

function summarizeBranchNames(branchNames: string[], emptyLabel: string): string {
  if (branchNames.length === 0) {
    return emptyLabel;
  }

  const visibleBranches = branchNames.slice(0, MAX_LIST_ITEMS);
  const remainder = branchNames.length - visibleBranches.length;
  return remainder > 0
    ? `${visibleBranches.join(", ")}, +${remainder} more`
    : visibleBranches.join(", ");
}

function normalizeMessages(messages: RepositoryAssistantMessage[]): Array<{
  role: "user" | "assistant";
  content: string;
}> {
  return messages
    .filter(
      (message): message is RepositoryAssistantMessage =>
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim().length > 0,
    )
    .slice(-MAX_MESSAGE_HISTORY)
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }));
}

async function buildRepositoryContext(repoPath: string): Promise<string> {
  const [branches, workingTreeStatus, pullStatus, recentCommits, conflictSummary] =
    await Promise.all([
      getBranches(repoPath),
      getWorkingTreeStatus(repoPath),
      getPullStatus(repoPath).catch(() => null),
      getCommits({ repoPath, offset: 0, limit: 6 }),
      getConflictSummary(repoPath).catch(() => null),
    ]);

  const conflictLine =
    conflictSummary && conflictSummary.files.length > 0
      ? `${conflictSummary.files.length} conflicted files during ${conflictSummary.operation}${
          conflictSummary.sourceBranch && conflictSummary.targetBranch
            ? ` (${conflictSummary.sourceBranch} -> ${conflictSummary.targetBranch})`
            : ""
        }: ${formatWorkingFileList(conflictSummary.files, "none")}`
      : "No active conflicts.";

  const pullLine = pullStatus?.branchName
    ? `${pullStatus.branchName} is ${pullStatus.state}${
        pullStatus.upstreamName ? ` against ${pullStatus.upstreamName}` : ""
      } (ahead ${pullStatus.aheadCount}, behind ${pullStatus.behindCount}).`
    : "Pull status is unavailable or detached.";

  return [
    `Repository path: ${repoPath}`,
    `Checked out branch: ${branches.current}`,
    `Local branches: ${summarizeBranchNames(
      branches.local.map((branch) => branch.name),
      "none",
    )}`,
    `Remote branches: ${summarizeBranchNames(
      branches.remote.map((branch) => branch.name),
      "none",
    )}`,
    `Pull status: ${pullLine}`,
    `Conflicts: ${conflictLine}`,
    `Staged files (${workingTreeStatus.staged.length}): ${formatWorkingFileList(
      workingTreeStatus.staged,
      "none",
    )}`,
    `Unstaged files (${workingTreeStatus.unstaged.length}): ${formatWorkingFileList(
      workingTreeStatus.unstaged,
      "none",
    )}`,
    `Recent commits:\n${summarizeCommitSubjects(recentCommits.commits)}`,
  ].join("\n");
}

function buildRepositoryAssistantSystemPrompt(context: string): string {
  return [
    "You are Git Chat UI's repository assistant.",
    "Help the user understand and plan Git operations for the current repository.",
    "Be concrete, operational, and concise.",
    "Prefer explaining the safest next action and call out destructive or conflict-prone steps.",
    "If the repository state is ambiguous, say what additional detail is needed.",
    "Do not invent repository state beyond the provided context.",
    "When useful, reference branch names, conflicted files, staged files, and recent commits from the context.",
    "Repository context:",
    context,
  ].join("\n\n");
}

export async function generateRepositoryAssistantReply({
  repoPath,
  messages,
  openAiToken,
  openAiModel,
}: {
  repoPath: string;
  messages: RepositoryAssistantMessage[];
  openAiToken: string;
  openAiModel: string;
}): Promise<string> {
  const normalizedMessages = normalizeMessages(messages);
  if (normalizedMessages.length === 0) {
    throw new Error("messages must include at least one non-empty user message.");
  }

  const normalizedToken = openAiToken.trim();
  if (!normalizedToken) {
    throw new Error("AI sidebar requires an OpenAI token in Config.");
  }

  const provider = createOpenAI({
    apiKey: normalizedToken,
  });

  const systemPrompt = buildRepositoryAssistantSystemPrompt(await buildRepositoryContext(repoPath));
  const response = await generateText({
    model: provider(resolveOpenAiModel(openAiModel)),
    system: systemPrompt,
    messages: normalizedMessages,
    temperature: 0.2,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  const text = response.text.trim();
  if (!text) {
    throw new Error("AI sidebar returned no text.");
  }

  return text;
}
