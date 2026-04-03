import fs from "node:fs/promises";
import path from "node:path";

import {
  getRepositoryAssistantActionSpec,
  type RepositoryAssistantAction,
  type RepositoryAssistantActionExecutionOptions,
  type RepositoryAssistantActionResult,
} from "../../shared/repositoryAssistant.js";
import {
  abortMergeSession,
  applyStash,
  checkoutRef,
  commitChanges,
  completeMergeSession,
  createBranch,
  createPullRequest,
  getCurrentBranch,
  mergeBranches,
  popStash,
  preparePullRequest,
  pullCurrentBranch,
  pushChanges,
  resolveConflictVersion,
  stageFile,
  stashFile,
  unstageFile,
} from "../gitService.js";

interface RepositoryAssistantActionExecutorDependencies {
  abortMergeSession?: typeof abortMergeSession;
  applyStash?: typeof applyStash;
  checkoutRef?: typeof checkoutRef;
  commitChanges?: typeof commitChanges;
  completeMergeSession?: typeof completeMergeSession;
  createBranch?: typeof createBranch;
  createPullRequest?: typeof createPullRequest;
  mergeBranches?: typeof mergeBranches;
  popStash?: typeof popStash;
  preparePullRequest?: typeof preparePullRequest;
  pullCurrentBranch?: typeof pullCurrentBranch;
  pushChanges?: typeof pushChanges;
  resolveConflictVersion?: typeof resolveConflictVersion;
  stageFile?: typeof stageFile;
  stashFile?: typeof stashFile;
  unstageFile?: typeof unstageFile;
}

function createActionResult(
  action: RepositoryAssistantAction,
  status: RepositoryAssistantActionResult["status"],
  message: string,
  data?: unknown,
): RepositoryAssistantActionResult {
  return {
    action,
    status,
    message,
    createdAt: new Date().toISOString(),
    data,
  };
}

function formatConflictMessage(prefix: string, files: number): string {
  return `${prefix} Conflicts require manual resolution (${files} file${files === 1 ? "" : "s"}).`;
}

export async function isSelfRepositoryPath(repoPath: string): Promise<boolean> {
  const [resolvedRepoPath, resolvedAppRootPath] = await Promise.all([
    fs.realpath(repoPath).catch(() => path.resolve(repoPath)),
    fs.realpath(process.cwd()).catch(() => path.resolve(process.cwd())),
  ]);

  return resolvedRepoPath === resolvedAppRootPath;
}

function getSelfRepositoryActionBlockedMessage(
  action: RepositoryAssistantAction,
  label: string,
): string {
  switch (action.id) {
    case "git.merge_branches":
      return `Repository assistant cannot run ${label} against git-chat-ui's own repository when the target branch is currently checked out while the app is running from that checkout.`;
    default:
      return `Repository assistant cannot run ${label} against git-chat-ui's own repository while the app is running from that checkout.`;
  }
}

async function actionTouchesSelfRepositoryWorkingTree(
  repoPath: string,
  action: RepositoryAssistantAction,
  options: RepositoryAssistantActionExecutionOptions = {},
): Promise<boolean> {
  const spec = getRepositoryAssistantActionSpec(action.id);
  if (!spec.mutatesWorkingTree) {
    return false;
  }

  if (!(await isSelfRepositoryPath(repoPath))) {
    return false;
  }

  switch (action.id) {
    case "git.merge_branches":
      return (
        (await getCurrentBranch(repoPath)) === action.args.targetBranch &&
        !options.allowSelfRepositoryCurrentTargetMerge
      );
    case "git.resolve_conflict_side":
      return !action.args.sessionId && !options.allowSelfRepositoryConflictResolution;
    case "git.complete_merge_session":
    case "git.abort_merge_session":
      return false;
    default:
      return true;
  }
}

export async function assertRepositoryAssistantActionSafe(
  repoPath: string,
  action: RepositoryAssistantAction,
  options: RepositoryAssistantActionExecutionOptions = {},
): Promise<void> {
  const spec = getRepositoryAssistantActionSpec(action.id);
  if (await actionTouchesSelfRepositoryWorkingTree(repoPath, action, options)) {
    throw new Error(getSelfRepositoryActionBlockedMessage(action, spec.label));
  }
}

export function createRepositoryAssistantActionExecutor(
  dependencies: RepositoryAssistantActionExecutorDependencies = {},
): (
  repoPath: string,
  action: RepositoryAssistantAction,
) => Promise<RepositoryAssistantActionResult> {
  const {
    abortMergeSession: abortMergeSessionImpl = abortMergeSession,
    applyStash: applyStashImpl = applyStash,
    checkoutRef: checkoutRefImpl = checkoutRef,
    commitChanges: commitChangesImpl = commitChanges,
    completeMergeSession: completeMergeSessionImpl = completeMergeSession,
    createBranch: createBranchImpl = createBranch,
    createPullRequest: createPullRequestImpl = createPullRequest,
    mergeBranches: mergeBranchesImpl = mergeBranches,
    popStash: popStashImpl = popStash,
    preparePullRequest: preparePullRequestImpl = preparePullRequest,
    pullCurrentBranch: pullCurrentBranchImpl = pullCurrentBranch,
    pushChanges: pushChangesImpl = pushChanges,
    resolveConflictVersion: resolveConflictVersionImpl = resolveConflictVersion,
    stageFile: stageFileImpl = stageFile,
    stashFile: stashFileImpl = stashFile,
    unstageFile: unstageFileImpl = unstageFile,
  } = dependencies;

  return async (repoPath: string, action: RepositoryAssistantAction) => {
    try {
      switch (action.id) {
        case "git.stage_file":
          await stageFileImpl(repoPath, action.args.file);
          return createActionResult(action, "succeeded", `Staged ${action.args.file}.`);
        case "git.unstage_file":
          await unstageFileImpl(repoPath, action.args.file);
          return createActionResult(action, "succeeded", `Unstaged ${action.args.file}.`);
        case "git.stash_file":
          await stashFileImpl(repoPath, action.args.file);
          return createActionResult(action, "succeeded", `Stashed ${action.args.file}.`);
        case "git.checkout_ref":
          await checkoutRefImpl(repoPath, action.args.ref);
          return createActionResult(action, "succeeded", `Checked out ${action.args.ref}.`);
        case "git.create_branch":
          await createBranchImpl(repoPath, action.args.baseBranch, action.args.newBranch);
          return createActionResult(
            action,
            "succeeded",
            `Created and checked out ${action.args.newBranch} from ${action.args.baseBranch}.`,
          );
        case "git.merge_branches": {
          const result = await mergeBranchesImpl(
            repoPath,
            action.args.sourceBranch,
            action.args.targetBranch,
          );
          if (!result.ok) {
            return createActionResult(
              action,
              "failed",
              formatConflictMessage(
                `Merge from ${action.args.sourceBranch} into ${action.args.targetBranch} started.`,
                result.conflict.files.length,
              ),
              result,
            );
          }

          return createActionResult(
            action,
            "succeeded",
            `Merged ${action.args.sourceBranch} into ${action.args.targetBranch}.`,
          );
        }
        case "git.pull_current_branch":
          await pullCurrentBranchImpl(repoPath, action.args.branchName ?? undefined);
          return createActionResult(
            action,
            "succeeded",
            action.args.branchName
              ? `Pulled upstream changes into ${action.args.branchName}.`
              : "Pulled upstream changes into the current branch.",
          );
        case "git.commit":
          await commitChangesImpl(repoPath, action.args.title, action.args.description);
          return createActionResult(action, "succeeded", `Committed: ${action.args.title}`);
        case "git.push":
          await pushChangesImpl(repoPath);
          return createActionResult(action, "succeeded", "Pushed the current branch.");
        case "git.resolve_conflict_side":
          await resolveConflictVersionImpl({
            repoPath,
            file: action.args.file,
            side: action.args.side,
            sessionId: action.args.sessionId ?? null,
          });
          return createActionResult(
            action,
            "succeeded",
            `Resolved ${action.args.file} using ${action.args.side}.`,
          );
        case "git.complete_merge_session":
          await completeMergeSessionImpl(repoPath, action.args.sessionId);
          return createActionResult(action, "succeeded", "Completed the merge session.");
        case "git.abort_merge_session":
          await abortMergeSessionImpl(repoPath, action.args.sessionId);
          return createActionResult(action, "succeeded", "Aborted the merge session.");
        case "git.apply_stash": {
          const result = await applyStashImpl(repoPath, action.args.stashId);
          if (!result.ok) {
            return createActionResult(
              action,
              "failed",
              formatConflictMessage(
                `Applied ${action.args.stashId}.`,
                result.conflict.files.length,
              ),
              result,
            );
          }

          return createActionResult(action, "succeeded", `Applied ${action.args.stashId}.`);
        }
        case "git.pop_stash": {
          const result = await popStashImpl(repoPath, action.args.stashId);
          if (!result.ok) {
            return createActionResult(
              action,
              "failed",
              formatConflictMessage(`Popped ${action.args.stashId}.`, result.conflict.files.length),
              result,
            );
          }

          return createActionResult(action, "succeeded", `Popped ${action.args.stashId}.`);
        }
        case "gh.pr.prepare": {
          const result = await preparePullRequestImpl(
            repoPath,
            action.args.sourceBranch,
            action.args.targetBranch,
          );
          return createActionResult(
            action,
            "succeeded",
            result.pushRequired
              ? `${action.args.sourceBranch} needs a push before creating the pull request.`
              : `${action.args.sourceBranch} is ready for pull request creation.`,
            result,
          );
        }
        case "gh.pr.create": {
          const result = await createPullRequestImpl(
            repoPath,
            action.args.sourceBranch,
            action.args.targetBranch,
            action.args.pushSourceBranch,
          );
          return createActionResult(
            action,
            "succeeded",
            `Created pull request: ${result.url}`,
            result,
          );
        }
      }
    } catch (error) {
      return createActionResult(
        action,
        "failed",
        error instanceof Error ? error.message : "Repository assistant action failed.",
      );
    }
  };
}

export const executeRepositoryAssistantAction = createRepositoryAssistantActionExecutor();
