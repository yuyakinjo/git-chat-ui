import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

import { normalizeOpenAiReasoningEffort, type OpenAiReasoningEffort } from "../../shared/ai.js";
import {
  REPOSITORY_ASSISTANT_ACTION_SPECS,
  normalizeRepositoryAssistantAction,
  type RepositoryAssistantActionProposal,
  type RepositoryAssistantMessage,
  type RepositoryAssistantResponse,
} from "../../shared/repositoryAssistant.js";
import {
  getBranches,
  getCommits,
  getConflictSummary,
  getPullStatus,
  getWorkingTreeStatus,
} from "../gitService.js";

import { resolveOpenAiModel } from "./normalize.js";

const MAX_MESSAGE_HISTORY = 12;
const MAX_LIST_ITEMS = 8;
const MAX_OUTPUT_TOKENS = 1200;

function createRepositoryAssistantMessageId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createAssistantMessage(content: string): RepositoryAssistantMessage {
  return {
    id: createRepositoryAssistantMessageId(),
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
  };
}

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

function describeActionArgs(actionId: (typeof REPOSITORY_ASSISTANT_ACTION_SPECS)[number]["id"]): string {
  switch (actionId) {
    case "git.stage_file":
    case "git.unstage_file":
    case "git.stash_file":
      return '{"file":"path/to/file"}';
    case "git.checkout_ref":
      return '{"ref":"feature/name"}';
    case "git.create_branch":
      return '{"baseBranch":"main","newBranch":"feature/name"}';
    case "git.merge_branches":
      return '{"sourceBranch":"feature/name","targetBranch":"main"}';
    case "git.pull_current_branch":
      return '{"branchName":"main"} or {}';
    case "git.commit":
      return '{"title":"feat: summary","description":"- detail"}';
    case "git.push":
      return "{}";
    case "git.resolve_conflict_side":
      return '{"file":"src/app.ts","side":"ours","sessionId":"session-1"}';
    case "git.complete_merge_session":
    case "git.abort_merge_session":
      return '{"sessionId":"session-1"}';
    case "git.apply_stash":
    case "git.pop_stash":
      return '{"stashId":"stash@{0}"}';
    case "gh.pr.prepare":
      return '{"sourceBranch":"feature/name","targetBranch":"main"}';
    case "gh.pr.create":
      return '{"sourceBranch":"feature/name","targetBranch":"main","pushSourceBranch":true}';
  }
}

function buildActionCatalogPrompt(): string {
  return REPOSITORY_ASSISTANT_ACTION_SPECS.map((spec) => {
    return `- ${spec.id}: ${spec.description} group=${spec.group} risk=${spec.risk} args=${describeActionArgs(spec.id)}`;
  }).join("\n");
}

function buildRepositoryAssistantSystemPrompt(context: string): string {
  return [
    "You are Git Chat UI's repository assistant.",
    "Help the user understand and plan Git operations for the current repository.",
    "Be concrete, operational, and concise.",
    "Prefer the safest next action and call out destructive or conflict-prone steps.",
    "If the repository state is ambiguous, say what additional detail is needed.",
    "Do not invent repository state beyond the provided context.",
    "When proposing actions, use only the catalog below and only when the next step is clear enough to run after user approval.",
    "Return strict JSON only with this shape:",
    '{"message":"short markdown reply","proposedActions":[{"action":{"id":"git.stage_file","args":{"file":"src/app.ts"}},"reason":"why this is the next step"}]}',
    "If no action should be suggested, return an empty proposedActions array.",
    "Do not include markdown fences, commentary before JSON, or unknown action ids.",
    "Action catalog:",
    buildActionCatalogPrompt(),
    "Repository context:",
    context,
  ].join("\n\n");
}

function extractStructuredPayload(rawText: string): unknown | null {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)```/i) ?? trimmed.match(/```\s*([\s\S]*?)```/);
    if (!fencedMatch?.[1]) {
      return null;
    }

    try {
      return JSON.parse(fencedMatch[1].trim());
    } catch {
      return null;
    }
  }
}

function normalizeStructuredProposals(value: unknown): RepositoryAssistantActionProposal[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const proposals = value
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return null;
      }

      const candidate = item as {
        action?: unknown;
        id?: unknown;
        reason?: unknown;
      };
      const action = normalizeRepositoryAssistantAction(candidate.action);
      const reason =
        typeof candidate.reason === "string" && candidate.reason.trim().length > 0
          ? candidate.reason.trim()
          : null;
      if (!action || !reason) {
        return null;
      }

      return {
        id:
          typeof candidate.id === "string" && candidate.id.trim().length > 0
            ? candidate.id.trim()
            : createRepositoryAssistantMessageId(),
        action,
        reason,
        status: "proposed" as const,
        result: null,
      };
    })
    .filter((proposal): proposal is NonNullable<typeof proposal> => proposal !== null);

  return proposals;
}

function normalizeStructuredResponseText(
  rawText: string,
): Pick<RepositoryAssistantResponse, "message" | "proposedActions"> {
  const structuredPayload = extractStructuredPayload(rawText);
  if (structuredPayload && typeof structuredPayload === "object") {
    const candidate = structuredPayload as { message?: unknown; proposedActions?: unknown };
    const message =
      typeof candidate.message === "string" && candidate.message.trim().length > 0
        ? candidate.message.trim()
        : null;
    const proposedActions = normalizeStructuredProposals(candidate.proposedActions);
    if (message) {
      return {
        message: createAssistantMessage(message),
        proposedActions,
      };
    }
  }

  const fallbackText = rawText.trim();
  if (!fallbackText) {
    throw new Error("AI sidebar returned no text.");
  }

  return {
    message: createAssistantMessage(fallbackText),
    proposedActions: [],
  };
}

export async function generateRepositoryAssistantReply({
  repoPath,
  messages,
  openAiToken,
  openAiModel,
  reasoningEffort,
}: {
  repoPath: string;
  messages: RepositoryAssistantMessage[];
  openAiToken: string;
  openAiModel: string;
  reasoningEffort?: OpenAiReasoningEffort | string;
}): Promise<RepositoryAssistantResponse> {
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
  const normalizedReasoningEffort = normalizeOpenAiReasoningEffort(reasoningEffort);

  const systemPrompt = buildRepositoryAssistantSystemPrompt(await buildRepositoryContext(repoPath));
  const response = await generateText({
    model: provider(resolveOpenAiModel(openAiModel)),
    system: systemPrompt,
    messages: normalizedMessages,
    temperature: 0.2,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    ...(normalizedReasoningEffort !== "default"
      ? {
          providerOptions: {
            openai: {
              reasoningEffort: normalizedReasoningEffort,
            },
          },
        }
      : {}),
  });

  return normalizeStructuredResponseText(response.text);
}
