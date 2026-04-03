import { DEFAULT_OPENAI_MODEL, normalizeOpenAiReasoningEffort } from "../../shared/ai.js";
import {
  getRepositoryAssistantActionSpec,
  getRepositoryAssistantAllowedActionIds,
  normalizeRepositoryAssistantPolicies,
  type RepositoryAssistantAction,
  type RepositoryAssistantActionId,
  type RepositoryAssistantActionProposal,
  type RepositoryAssistantActionResult,
  type RepositoryAssistantPolicies,
} from "../../shared/repositoryAssistant.js";
import type {
  AppConfig,
  RepositoryAssistantMessage,
  RepositoryAssistantMessageRole,
  RepositoryAssistantSettings,
} from "../types";

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
  options?: {
    proposedActions?: RepositoryAssistantActionProposal[];
    actionResult?: RepositoryAssistantActionResult | null;
  },
): RepositoryAssistantMessage {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content: content.trim(),
    createdAt: new Date().toISOString(),
    proposedActions: options?.proposedActions,
    actionResult: options?.actionResult ?? null,
  };
}

export function createRepositoryAssistantExecutionMessage(
  result: RepositoryAssistantActionResult,
): RepositoryAssistantMessage {
  return createRepositoryAssistantMessage("assistant", result.message, {
    actionResult: result,
  });
}

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

export function createRepositoryAssistantSettingsFromConfig(
  config: Pick<
    AppConfig,
    "openAiModel" | "repositoryAssistantOpenAiModel" | "repositoryAssistantReasoningEffort"
  >,
): RepositoryAssistantSettings {
  return normalizeRepositoryAssistantSettings(
    {
      openAiModel: config.repositoryAssistantOpenAiModel,
      reasoningEffort: config.repositoryAssistantReasoningEffort,
    },
    config.openAiModel,
  );
}

export function toRepositoryAssistantConfigPatch(
  settings: RepositoryAssistantSettings,
): Pick<AppConfig, "repositoryAssistantOpenAiModel" | "repositoryAssistantReasoningEffort"> {
  return {
    repositoryAssistantOpenAiModel:
      typeof settings.openAiModel === "string" && settings.openAiModel.trim().length > 0
        ? settings.openAiModel.trim()
        : DEFAULT_OPENAI_MODEL,
    repositoryAssistantReasoningEffort: normalizeOpenAiReasoningEffort(settings.reasoningEffort),
  };
}

export function getRepositoryAssistantPolicyAllowedActionIds(
  policies: RepositoryAssistantPolicies | null | undefined,
  repoPath: string,
): RepositoryAssistantActionId[] {
  return getRepositoryAssistantAllowedActionIds(policies, repoPath);
}

export function setRepositoryAssistantPolicyActionAllowed(
  policies: RepositoryAssistantPolicies | null | undefined,
  repoPath: string,
  actionId: RepositoryAssistantActionId,
  allowed: boolean,
): RepositoryAssistantPolicies {
  const normalizedPolicies = normalizeRepositoryAssistantPolicies(policies);
  const currentAllowed = getRepositoryAssistantAllowedActionIds(normalizedPolicies, repoPath);
  const nextAllowed = allowed
    ? Array.from(new Set([...currentAllowed, actionId]))
    : currentAllowed.filter((candidate) => candidate !== actionId);

  return {
    ...normalizedPolicies,
    [repoPath]: {
      allowedActionIds: nextAllowed,
    },
  };
}

export function updateRepositoryAssistantProposal(
  messages: RepositoryAssistantMessage[],
  proposalId: string,
  updater: (proposal: RepositoryAssistantActionProposal) => RepositoryAssistantActionProposal,
): RepositoryAssistantMessage[] {
  return messages.map((message) => {
    if (!message.proposedActions?.some((proposal) => proposal.id === proposalId)) {
      return message;
    }

    return {
      ...message,
      proposedActions: message.proposedActions.map((proposal) =>
        proposal.id === proposalId ? updater(proposal) : proposal,
      ),
    };
  });
}

export function markRepositoryAssistantProposalsStale(
  messages: RepositoryAssistantMessage[],
  executedProposalId: string,
): RepositoryAssistantMessage[] {
  return messages.map((message) => {
    if (!message.proposedActions || message.proposedActions.length === 0) {
      return message;
    }

    let changed = false;
    const nextProposals = message.proposedActions.map((proposal) => {
      if (
        proposal.id === executedProposalId ||
        (proposal.status !== "proposed" && proposal.status !== "running")
      ) {
        return proposal;
      }

      changed = true;
      return {
        ...proposal,
        status: "stale" as const,
      };
    });

    return changed
      ? {
          ...message,
          proposedActions: nextProposals,
        }
      : message;
  });
}

export function formatRepositoryAssistantActionArgs(action: RepositoryAssistantAction): string {
  switch (action.id) {
    case "git.stage_file":
    case "git.unstage_file":
    case "git.stash_file":
      return action.args.file;
    case "git.checkout_ref":
      return action.args.ref;
    case "git.create_branch":
      return `${action.args.baseBranch} -> ${action.args.newBranch}`;
    case "git.merge_branches":
      return `${action.args.sourceBranch} -> ${action.args.targetBranch}`;
    case "git.pull_current_branch":
      return action.args.branchName ?? "current branch";
    case "git.commit":
      return action.args.title;
    case "git.push":
      return "current branch";
    case "git.resolve_conflict_side":
      return `${action.args.file} (${action.args.side})`;
    case "git.complete_merge_session":
    case "git.abort_merge_session":
      return action.args.sessionId;
    case "git.apply_stash":
    case "git.pop_stash":
      return action.args.stashId;
    case "gh.pr.prepare":
      return `${action.args.sourceBranch} -> ${action.args.targetBranch}`;
    case "gh.pr.create":
      return `${action.args.sourceBranch} -> ${action.args.targetBranch}${
        action.args.pushSourceBranch ? " + push" : ""
      }`;
  }
}

export function getRepositoryAssistantActionDisplayLabel(action: RepositoryAssistantAction): string {
  return getRepositoryAssistantActionSpec(action.id).label;
}
