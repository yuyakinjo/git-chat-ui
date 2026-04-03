import type { OpenAiReasoningEffort } from "./ai.js";

export type RepositoryAssistantMessageRole = "user" | "assistant";
export type RepositoryAssistantActionGroup = "git" | "githubPr" | "appApi";
export type RepositoryAssistantActionRisk = "low" | "medium" | "high";
export type RepositoryAssistantActionStatus =
  | "proposed"
  | "running"
  | "succeeded"
  | "failed"
  | "stale";
export type RepositoryAssistantActionResultStatus = "succeeded" | "failed";

export const REPOSITORY_ASSISTANT_ACTION_IDS = [
  "git.stage_file",
  "git.unstage_file",
  "git.stash_file",
  "git.checkout_ref",
  "git.create_branch",
  "git.merge_branches",
  "git.pull_current_branch",
  "git.commit",
  "git.push",
  "git.resolve_conflict_side",
  "git.complete_merge_session",
  "git.abort_merge_session",
  "git.apply_stash",
  "git.pop_stash",
  "gh.pr.prepare",
  "gh.pr.create",
] as const;

export type RepositoryAssistantActionId = (typeof REPOSITORY_ASSISTANT_ACTION_IDS)[number];

export interface RepositoryAssistantActionSpec {
  id: RepositoryAssistantActionId;
  label: string;
  description: string;
  group: RepositoryAssistantActionGroup;
  risk: RepositoryAssistantActionRisk;
  mutatesRepository: boolean;
  mutatesWorkingTree: boolean;
}

export const REPOSITORY_ASSISTANT_ACTION_SPECS = [
  {
    id: "git.stage_file",
    label: "Stage File",
    description: "Run Git Chat UI's stage-file operation for one file.",
    group: "git",
    risk: "low",
    mutatesRepository: true,
    mutatesWorkingTree: false,
  },
  {
    id: "git.unstage_file",
    label: "Unstage File",
    description: "Run Git Chat UI's unstage-file operation for one file.",
    group: "git",
    risk: "low",
    mutatesRepository: true,
    mutatesWorkingTree: false,
  },
  {
    id: "git.stash_file",
    label: "Stash File",
    description: "Stash one file with the existing stash-file operation.",
    group: "git",
    risk: "medium",
    mutatesRepository: true,
    mutatesWorkingTree: true,
  },
  {
    id: "git.checkout_ref",
    label: "Checkout Ref",
    description: "Checkout a branch or commit ref.",
    group: "git",
    risk: "high",
    mutatesRepository: true,
    mutatesWorkingTree: true,
  },
  {
    id: "git.create_branch",
    label: "Create Branch",
    description: "Create and checkout a new branch from a base branch.",
    group: "git",
    risk: "medium",
    mutatesRepository: true,
    mutatesWorkingTree: true,
  },
  {
    id: "git.merge_branches",
    label: "Merge Branches",
    description: "Merge a source branch into a target branch.",
    group: "git",
    risk: "high",
    mutatesRepository: true,
    mutatesWorkingTree: true,
  },
  {
    id: "git.pull_current_branch",
    label: "Pull Branch",
    description: "Pull upstream changes into the current or specified branch.",
    group: "git",
    risk: "high",
    mutatesRepository: true,
    mutatesWorkingTree: true,
  },
  {
    id: "git.commit",
    label: "Commit",
    description: "Create a commit from staged changes.",
    group: "git",
    risk: "high",
    mutatesRepository: true,
    mutatesWorkingTree: false,
  },
  {
    id: "git.push",
    label: "Push",
    description: "Push the current branch to its remote.",
    group: "git",
    risk: "high",
    mutatesRepository: true,
    mutatesWorkingTree: false,
  },
  {
    id: "git.resolve_conflict_side",
    label: "Resolve Conflict",
    description: "Resolve one conflicted file by choosing merged, ours, or theirs.",
    group: "git",
    risk: "high",
    mutatesRepository: true,
    mutatesWorkingTree: true,
  },
  {
    id: "git.complete_merge_session",
    label: "Complete Merge Session",
    description: "Finish an existing merge session after all conflicts are resolved.",
    group: "git",
    risk: "high",
    mutatesRepository: true,
    mutatesWorkingTree: true,
  },
  {
    id: "git.abort_merge_session",
    label: "Abort Merge Session",
    description: "Abort an in-progress merge session.",
    group: "git",
    risk: "high",
    mutatesRepository: true,
    mutatesWorkingTree: true,
  },
  {
    id: "git.apply_stash",
    label: "Apply Stash",
    description: "Apply a stash entry without dropping it.",
    group: "git",
    risk: "high",
    mutatesRepository: true,
    mutatesWorkingTree: true,
  },
  {
    id: "git.pop_stash",
    label: "Pop Stash",
    description: "Apply and drop a stash entry.",
    group: "git",
    risk: "high",
    mutatesRepository: true,
    mutatesWorkingTree: true,
  },
  {
    id: "gh.pr.prepare",
    label: "Prepare Pull Request",
    description: "Check whether the source branch needs to be pushed before PR creation.",
    group: "githubPr",
    risk: "low",
    mutatesRepository: false,
    mutatesWorkingTree: false,
  },
  {
    id: "gh.pr.create",
    label: "Create Pull Request",
    description: "Create a GitHub pull request, optionally pushing the source branch first.",
    group: "githubPr",
    risk: "high",
    mutatesRepository: true,
    mutatesWorkingTree: false,
  },
] as const satisfies RepositoryAssistantActionSpec[];

const REPOSITORY_ASSISTANT_ACTION_SPEC_MAP = new Map(
  REPOSITORY_ASSISTANT_ACTION_SPECS.map((spec) => [spec.id, spec]),
);

type EmptyArgs = Record<string, never>;

export type RepositoryAssistantAction =
  | { id: "git.stage_file"; args: { file: string } }
  | { id: "git.unstage_file"; args: { file: string } }
  | { id: "git.stash_file"; args: { file: string } }
  | { id: "git.checkout_ref"; args: { ref: string } }
  | { id: "git.create_branch"; args: { baseBranch: string; newBranch: string } }
  | { id: "git.merge_branches"; args: { sourceBranch: string; targetBranch: string } }
  | { id: "git.pull_current_branch"; args: { branchName?: string | null } }
  | { id: "git.commit"; args: { title: string; description: string } }
  | { id: "git.push"; args: EmptyArgs }
  | {
      id: "git.resolve_conflict_side";
      args: {
        file: string;
        side: "merged" | "ours" | "theirs";
        sessionId?: string | null;
      };
    }
  | { id: "git.complete_merge_session"; args: { sessionId: string } }
  | { id: "git.abort_merge_session"; args: { sessionId: string } }
  | { id: "git.apply_stash"; args: { stashId: string } }
  | { id: "git.pop_stash"; args: { stashId: string } }
  | { id: "gh.pr.prepare"; args: { sourceBranch: string; targetBranch: string } }
  | {
      id: "gh.pr.create";
      args: {
        sourceBranch: string;
        targetBranch: string;
        pushSourceBranch: boolean;
      };
    };

export interface RepositoryAssistantActionResult {
  action: RepositoryAssistantAction;
  status: RepositoryAssistantActionResultStatus;
  message: string;
  createdAt: string;
  data?: unknown;
}

export interface RepositoryAssistantActionProposal {
  id: string;
  action: RepositoryAssistantAction;
  reason: string;
  status: RepositoryAssistantActionStatus;
  result?: RepositoryAssistantActionResult | null;
}

export interface RepositoryAssistantPolicy {
  allowedActionIds: RepositoryAssistantActionId[];
}

export type RepositoryAssistantPolicies = Record<string, RepositoryAssistantPolicy>;

export interface RepositoryAssistantMessage {
  id: string;
  role: RepositoryAssistantMessageRole;
  content: string;
  createdAt: string;
  proposedActions?: RepositoryAssistantActionProposal[];
  actionResult?: RepositoryAssistantActionResult | null;
}

export interface RepositoryAssistantResponse {
  message: RepositoryAssistantMessage;
  proposedActions: RepositoryAssistantActionProposal[];
}

export interface RepositoryAssistantActionExecutionResponse {
  result: RepositoryAssistantActionResult;
}

export interface RepositoryAssistantSettings {
  openAiModel: string;
  reasoningEffort: OpenAiReasoningEffort;
}

function normalizeTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalTrimmedString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return normalizeTrimmedString(value);
}

function normalizeActionArgs(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function normalizeEmptyArgs(value: unknown): EmptyArgs | null {
  if (value === undefined || value === null) {
    return {};
  }

  return typeof value === "object" && value !== null ? {} : null;
}

function normalizeConflictResolutionSide(
  value: unknown,
): "merged" | "ours" | "theirs" | null {
  if (value === "merged" || value === "ours" || value === "theirs") {
    return value;
  }

  return null;
}

function normalizeProposalStatus(value: unknown): RepositoryAssistantActionStatus {
  switch (value) {
    case "running":
    case "succeeded":
    case "failed":
    case "stale":
    case "proposed":
      return value;
    default:
      return "proposed";
  }
}

function normalizeResultStatus(value: unknown): RepositoryAssistantActionResultStatus | null {
  if (value === "succeeded" || value === "failed") {
    return value;
  }

  return null;
}

function normalizeAllowedActionIds(value: unknown): RepositoryAssistantActionId[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<RepositoryAssistantActionId>();
  const normalized: RepositoryAssistantActionId[] = [];
  for (const candidate of value) {
    if (!isRepositoryAssistantActionId(candidate) || seen.has(candidate)) {
      continue;
    }

    seen.add(candidate);
    normalized.push(candidate);
  }

  return normalized.sort(
    (left, right) =>
      REPOSITORY_ASSISTANT_ACTION_IDS.indexOf(left) - REPOSITORY_ASSISTANT_ACTION_IDS.indexOf(right),
  );
}

export function isRepositoryAssistantActionId(value: unknown): value is RepositoryAssistantActionId {
  return (
    typeof value === "string" &&
    REPOSITORY_ASSISTANT_ACTION_IDS.includes(value as RepositoryAssistantActionId)
  );
}

export function getRepositoryAssistantActionSpec(
  actionId: RepositoryAssistantActionId,
): RepositoryAssistantActionSpec {
  return (
    REPOSITORY_ASSISTANT_ACTION_SPEC_MAP.get(actionId) ??
    REPOSITORY_ASSISTANT_ACTION_SPECS[0]
  );
}

export function normalizeRepositoryAssistantAction(
  value: unknown,
): RepositoryAssistantAction | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as { id?: unknown; args?: unknown };
  if (!isRepositoryAssistantActionId(candidate.id)) {
    return null;
  }

  const args = normalizeActionArgs(candidate.args);

  switch (candidate.id) {
    case "git.stage_file": {
      const file = normalizeTrimmedString(args.file);
      return file ? { id: candidate.id, args: { file } } : null;
    }
    case "git.unstage_file": {
      const file = normalizeTrimmedString(args.file);
      return file ? { id: candidate.id, args: { file } } : null;
    }
    case "git.stash_file": {
      const file = normalizeTrimmedString(args.file);
      return file ? { id: candidate.id, args: { file } } : null;
    }
    case "git.checkout_ref": {
      const ref = normalizeTrimmedString(args.ref);
      return ref ? { id: candidate.id, args: { ref } } : null;
    }
    case "git.create_branch": {
      const baseBranch = normalizeTrimmedString(args.baseBranch);
      const newBranch = normalizeTrimmedString(args.newBranch);
      return baseBranch && newBranch
        ? { id: candidate.id, args: { baseBranch, newBranch } }
        : null;
    }
    case "git.merge_branches": {
      const sourceBranch = normalizeTrimmedString(args.sourceBranch);
      const targetBranch = normalizeTrimmedString(args.targetBranch);
      return sourceBranch && targetBranch
        ? { id: candidate.id, args: { sourceBranch, targetBranch } }
        : null;
    }
    case "git.pull_current_branch": {
      const branchName = normalizeOptionalTrimmedString(args.branchName);
      return { id: candidate.id, args: branchName ? { branchName } : {} };
    }
    case "git.commit": {
      const title = normalizeTrimmedString(args.title);
      const description =
        typeof args.description === "string" ? args.description.trim() : "";
      return title ? { id: candidate.id, args: { title, description } } : null;
    }
    case "git.push":
      return normalizeEmptyArgs(candidate.args) ? { id: candidate.id, args: {} } : null;
    case "git.resolve_conflict_side": {
      const file = normalizeTrimmedString(args.file);
      const side = normalizeConflictResolutionSide(args.side);
      const sessionId = normalizeOptionalTrimmedString(args.sessionId);
      return file && side
        ? {
            id: candidate.id,
            args: sessionId ? { file, side, sessionId } : { file, side },
          }
        : null;
    }
    case "git.complete_merge_session": {
      const sessionId = normalizeTrimmedString(args.sessionId);
      return sessionId ? { id: candidate.id, args: { sessionId } } : null;
    }
    case "git.abort_merge_session": {
      const sessionId = normalizeTrimmedString(args.sessionId);
      return sessionId ? { id: candidate.id, args: { sessionId } } : null;
    }
    case "git.apply_stash": {
      const stashId = normalizeTrimmedString(args.stashId);
      return stashId ? { id: candidate.id, args: { stashId } } : null;
    }
    case "git.pop_stash": {
      const stashId = normalizeTrimmedString(args.stashId);
      return stashId ? { id: candidate.id, args: { stashId } } : null;
    }
    case "gh.pr.prepare": {
      const sourceBranch = normalizeTrimmedString(args.sourceBranch);
      const targetBranch = normalizeTrimmedString(args.targetBranch);
      return sourceBranch && targetBranch
        ? { id: candidate.id, args: { sourceBranch, targetBranch } }
        : null;
    }
    case "gh.pr.create": {
      const sourceBranch = normalizeTrimmedString(args.sourceBranch);
      const targetBranch = normalizeTrimmedString(args.targetBranch);
      return sourceBranch &&
        targetBranch &&
        typeof args.pushSourceBranch === "boolean"
        ? {
            id: candidate.id,
            args: { sourceBranch, targetBranch, pushSourceBranch: args.pushSourceBranch },
          }
        : null;
    }
  }
}

export function normalizeRepositoryAssistantActionResult(
  value: unknown,
): RepositoryAssistantActionResult | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Partial<RepositoryAssistantActionResult>;
  const action = normalizeRepositoryAssistantAction(candidate.action);
  const status = normalizeResultStatus(candidate.status);
  if (!action || !status || typeof candidate.message !== "string" || typeof candidate.createdAt !== "string") {
    return null;
  }

  return {
    action,
    status,
    message: candidate.message,
    createdAt: candidate.createdAt,
    data: candidate.data,
  };
}

export function normalizeRepositoryAssistantActionProposal(
  value: unknown,
): RepositoryAssistantActionProposal | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Partial<RepositoryAssistantActionProposal>;
  const action = normalizeRepositoryAssistantAction(candidate.action);
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.reason !== "string" ||
    !action
  ) {
    return null;
  }

  return {
    id: candidate.id,
    action,
    reason: candidate.reason,
    status: normalizeProposalStatus(candidate.status),
    result: normalizeRepositoryAssistantActionResult(candidate.result) ?? null,
  };
}

export function normalizeRepositoryAssistantPolicies(
  value: unknown,
): RepositoryAssistantPolicies {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  const normalized: RepositoryAssistantPolicies = {};
  for (const [repoPath, policyValue] of Object.entries(value)) {
    const trimmedRepoPath = repoPath.trim();
    if (!trimmedRepoPath || typeof policyValue !== "object" || policyValue === null) {
      continue;
    }

    const allowedActionIds = normalizeAllowedActionIds(
      (policyValue as Partial<RepositoryAssistantPolicy>).allowedActionIds,
    );
    normalized[trimmedRepoPath] = { allowedActionIds };
  }

  return normalized;
}

export function getRepositoryAssistantAllowedActionIds(
  policies: RepositoryAssistantPolicies | null | undefined,
  repoPath: string,
): RepositoryAssistantActionId[] {
  if (!policies) {
    return [];
  }

  return normalizeAllowedActionIds(policies[repoPath]?.allowedActionIds);
}

export function isRepositoryAssistantActionAllowed(
  policies: RepositoryAssistantPolicies | null | undefined,
  repoPath: string,
  actionOrId: RepositoryAssistantAction | RepositoryAssistantActionId,
): boolean {
  const actionId = typeof actionOrId === "string" ? actionOrId : actionOrId.id;
  return getRepositoryAssistantAllowedActionIds(policies, repoPath).includes(actionId);
}
