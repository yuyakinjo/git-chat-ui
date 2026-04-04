import React, { useState } from "react";

import { api } from "../lib/api";
import { getBranchDeleteDisabledReason, getBranchDeleteTargetName } from "../lib/branchDelete";
import { resolveCompareRefs } from "../lib/controllerViewUtils";
import { type UiError } from "../lib/errors";
import {
  canCheckoutBranchWithoutWorkingTreeChange,
  canMergeBranchWithoutWorkingTreeChange,
  getSelfStashMutationBlockedReason,
} from "../lib/repositoryMutationSafety";
import type { UseControllerDataResult } from "./useControllerData";
import { type BranchActionDialogStep } from "../components/BranchActionDialog";
import type { Branch, CommitListItem, ConflictOperationResult, StashEntry } from "../types";

interface UseControllerBranchOpsParams {
  repoPath: string;
  onNotify: (message: string) => void;
  data: UseControllerDataResult;
  setSelectedBranchForHover: (branch: Branch | null) => void;
  setPendingScrollCommitSha: (sha: string | null) => void;
}

export interface UseControllerBranchOpsResult {
  branchAction: { source: Branch; target: Branch; step: BranchActionDialogStep } | null;
  setBranchAction: React.Dispatch<
    React.SetStateAction<{ source: Branch; target: Branch; step: BranchActionDialogStep } | null>
  >;
  branchCreateSource: Branch | null;
  setBranchCreateSource: (source: Branch | null) => void;
  branchDeleteTarget: Branch | null;
  branchDeleteForce: boolean;
  setBranchDeleteTarget: (target: Branch | null) => void;
  setBranchDeleteForce: (forceDelete: boolean) => void;
  stashRenameTarget: StashEntry | null;
  stashDeleteTarget: StashEntry | null;
  setStashRenameTarget: (target: StashEntry | null) => void;
  setStashDeleteTarget: (target: StashEntry | null) => void;

  handleCheckoutBranch: (branch: Branch) => Promise<void>;
  handleCheckoutCommit: (commit: CommitListItem) => Promise<void>;
  handleSelectBranch: (branch: Branch) => void;
  handleCheckoutBranchRef: (refName: string) => void;
  handleBranchDrop: (sourceBranch: Branch, targetBranch: Branch) => void;
  handleRequestDeleteBranch: (branch: Branch) => void;
  handleRequestCreateBranch: (branch: Branch) => void;
  handleRequestRenameStash: (stash: StashEntry) => void;
  handleRequestDeleteStash: (stash: StashEntry) => void;
  handleDeleteStash: () => Promise<void>;
  handleApplyStash: (stash: StashEntry) => Promise<void>;
  handlePopStash: (stash: StashEntry) => Promise<void>;
  handleCreateBranch: (newBranchName: string) => Promise<void>;
  handleMergeBranchAction: () => Promise<void>;
  handleDeleteBranch: () => Promise<void>;
  handleRenameStash: (message: string) => Promise<void>;
  handleCreatePullRequest: (pushSourceBranch: boolean) => Promise<void>;
  handlePreparePullRequest: () => Promise<void>;
}

export function useControllerBranchOps({
  repoPath,
  onNotify,
  data,
  setSelectedBranchForHover,
  setPendingScrollCommitSha,
}: UseControllerBranchOpsParams): UseControllerBranchOpsResult {
  const [branchAction, setBranchAction] = useState<{
    source: Branch;
    target: Branch;
    step: BranchActionDialogStep;
  } | null>(null);
  const [branchCreateSource, setBranchCreateSource] = useState<Branch | null>(null);
  const [branchDeleteTarget, setBranchDeleteTarget] = useState<Branch | null>(null);
  const [branchDeleteForce, setBranchDeleteForce] = useState(false);
  const [stashRenameTarget, setStashRenameTarget] = useState<StashEntry | null>(null);
  const [stashDeleteTarget, setStashDeleteTarget] = useState<StashEntry | null>(null);

  const openConflictFromResult = async (
    result: ConflictOperationResult,
    title: string,
    detail: string,
  ): Promise<boolean> => {
    if (result.ok) {
      return false;
    }

    await data.loadWorkingState();
    await data.openConflictViewer({
      summary: result.conflict,
      file: result.conflict.files[0]?.file ?? null,
      sessionId: result.conflict.sessionId ?? null,
    });
    setBranchAction(null);
    data.setInlineError({ title, detail });
    onNotify(title);
    return true;
  };

  const handleCheckoutBranch = async (branch: Branch): Promise<void> => {
    const canBypassSelfMutationBlock = canCheckoutBranchWithoutWorkingTreeChange(
      data.currentLocalBranch,
      branch,
    );
    if (
      !canBypassSelfMutationBlock &&
      data.reportBlockedMutation("開発中のアプリ自身の repo は checkout できません")
    ) {
      return;
    }

    data.setOperationBusy(true);
    const branchRefForLog = branch.fullRef || branch.name;

    try {
      await api.checkout(repoPath, branch.name);
      data.setActiveLogRef(branchRefForLog);
      data.setInlineError(null);
      onNotify(`${branch.name} に切り替えました。`);
      await data.refreshAfterCheckout(branchRefForLog);
    } catch (error) {
      data.reportError(error, "ブランチ切り替えに失敗しました。");
    } finally {
      data.setOperationBusy(false);
    }
  };

  const handleCheckoutCommit = async (commit: CommitListItem): Promise<void> => {
    if (data.reportBlockedMutation("開発中のアプリ自身の repo は checkout できません")) {
      return;
    }

    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `このコミット ${commit.sha.slice(0, 7)} に checkout しますか？\n\nDetached HEAD になります。開いている作業内容によっては画面が再読み込みされたり不安定になる場合があります。`,
      )
    ) {
      return;
    }

    data.setOperationBusy(true);

    try {
      setSelectedBranchForHover(null);
      setPendingScrollCommitSha(null);
      data.setShowBranchDiff(false);
      data.setActiveCompareRefs([]);
      data.setActiveLogRef("HEAD");
      await api.checkout(repoPath, commit.sha);
      data.setInlineError(null);
      onNotify(`${commit.sha.slice(0, 7)} にチェックアウトしました。`);
      await data.refreshAfterCheckout("HEAD");
    } catch (error) {
      data.reportError(error, "コミットチェックアウトに失敗しました。");
    } finally {
      data.setOperationBusy(false);
    }
  };

  const handleSelectBranch = (branch: Branch): void => {
    setSelectedBranchForHover(branch);
    setPendingScrollCommitSha(branch.commit);
    const branchRefForLog = branch.fullRef || branch.name;
    const compareRefs = resolveCompareRefs(branchRefForLog, data.branches);
    data.setActiveLogRef(branchRefForLog);
    void data.loadCommits({
      append: false,
      offset: 0,
      ref: branchRefForLog,
      compareRefs,
      focusCommitSha: branch.commit,
    });
  };

  const handleCheckoutBranchRef = (refName: string): void => {
    const target = [...(data.branches?.local ?? []), ...(data.branches?.remote ?? [])].find(
      (branch) => branch.name === refName,
    );
    if (!target) {
      onNotify(`${refName} を checkout できませんでした。`);
      return;
    }

    void handleCheckoutBranch(target);
  };

  const handleBranchDrop = (sourceBranch: Branch, targetBranch: Branch): void => {
    if (data.operationBusy || sourceBranch.name === targetBranch.name) {
      return;
    }

    setStashRenameTarget(null);
    setStashDeleteTarget(null);
    setBranchCreateSource(null);
    setBranchDeleteTarget(null);
    setBranchDeleteForce(false);
    data.setShowBranchDiff(false);
    data.setFocusedCommitDiffFile(null);
    setBranchAction({
      source: sourceBranch,
      target: targetBranch,
      step: "select-action",
    });
  };

  const handleRequestDeleteBranch = (branch: Branch): void => {
    const disabledReason = getBranchDeleteDisabledReason(branch, data.branches?.current ?? null);
    if (disabledReason) {
      const nextError: UiError = {
        title: "このブランチは削除できません",
        detail: disabledReason,
      };
      data.setInlineError(nextError);
      onNotify(nextError.title);
      return;
    }

    setBranchAction(null);
    setStashRenameTarget(null);
    setStashDeleteTarget(null);
    setBranchCreateSource(null);
    setBranchDeleteForce(false);
    data.setShowBranchDiff(false);
    data.setFocusedCommitDiffFile(null);
    setBranchDeleteTarget(branch);
  };

  const handleRequestCreateBranch = (branch: Branch): void => {
    if (branch.type !== "local") {
      return;
    }

    setBranchAction(null);
    setStashRenameTarget(null);
    setStashDeleteTarget(null);
    setBranchDeleteTarget(null);
    setBranchDeleteForce(false);
    data.setShowBranchDiff(false);
    data.setFocusedCommitDiffFile(null);
    setBranchCreateSource(branch);
  };

  const handleRequestRenameStash = (stash: StashEntry): void => {
    setBranchAction(null);
    setBranchCreateSource(null);
    setBranchDeleteTarget(null);
    setBranchDeleteForce(false);
    setStashDeleteTarget(null);
    data.setShowBranchDiff(false);
    data.setFocusedCommitDiffFile(null);
    setStashRenameTarget(stash);
  };

  const handleRequestDeleteStash = (stash: StashEntry): void => {
    setBranchAction(null);
    setBranchCreateSource(null);
    setBranchDeleteTarget(null);
    setBranchDeleteForce(false);
    setStashRenameTarget(null);
    data.setShowBranchDiff(false);
    data.setFocusedCommitDiffFile(null);
    setStashDeleteTarget(stash);
  };

  const handleDeleteStash = async (): Promise<void> => {
    const currentTarget = stashDeleteTarget;
    if (!currentTarget) {
      return;
    }

    data.setOperationBusy(true);

    try {
      await api.deleteStash(repoPath, currentTarget.id);
      setStashDeleteTarget(null);
      data.setInlineError(null);
      onNotify(`${currentTarget.id} を削除しました。`);
      await data.refreshAll();
    } catch (error) {
      data.reportError(error, "stash の削除に失敗しました。");
    } finally {
      data.setOperationBusy(false);
    }
  };

  const handleCreateBranch = async (newBranchName: string): Promise<void> => {
    const currentSource = branchCreateSource;
    if (!currentSource) {
      return;
    }

    const canBypassSelfMutationBlock = canCheckoutBranchWithoutWorkingTreeChange(
      data.currentLocalBranch,
      currentSource,
    );
    if (
      !canBypassSelfMutationBlock &&
      data.reportBlockedMutation("開発中のアプリ自身の repo は branch 作成後に checkout できません")
    ) {
      return;
    }

    data.setOperationBusy(true);

    try {
      await api.createBranch(repoPath, currentSource.name, newBranchName);
      setBranchCreateSource(null);
      setBranchAction(null);
      setBranchDeleteTarget(null);
      setBranchDeleteForce(false);
      setSelectedBranchForHover(null);
      setPendingScrollCommitSha(null);
      data.setShowBranchDiff(false);
      data.setFocusedCommitDiffFile(null);
      data.setInlineError(null);
      onNotify(`${newBranchName} を ${currentSource.name} から作成して切り替えました。`);
      await data.reloadAfterBranchMutation(newBranchName);
    } catch (error) {
      data.reportError(error, "ブランチ作成に失敗しました。");
    } finally {
      data.setOperationBusy(false);
    }
  };

  const handleMergeBranchAction = async (): Promise<void> => {
    const currentAction = branchAction;
    if (!currentAction) {
      return;
    }

    const canBypassSelfMutationBlock = canMergeBranchWithoutWorkingTreeChange(
      data.currentBranchName,
      currentAction.target,
    );
    if (
      !canBypassSelfMutationBlock &&
      data.reportBlockedMutation("開発中のアプリ自身の repo は merge できません")
    ) {
      return;
    }

    data.setOperationBusy(true);
    let primaryError = false;

    try {
      const result = await api.mergeBranches(
        repoPath,
        currentAction.source.name,
        currentAction.target.name,
      );
      if (
        await openConflictFromResult(
          result,
          "競合が発生しました",
          "Conflict Viewer を開きました。Compare で見比べて Take Ours / Take Theirs / Mark Resolved で解消してください。",
        )
      ) {
        return;
      }

      data.setInlineError(null);
      setBranchAction(null);
      onNotify(`${currentAction.source.name} を ${currentAction.target.name} に merge しました。`);
    } catch (error) {
      primaryError = true;
      data.reportError(error, "ブランチマージに失敗しました。");
    } finally {
      try {
        await data.reloadAfterBranchMutation(currentAction.target.name);
      } catch (refreshError) {
        if (!primaryError) {
          data.reportError(refreshError, "画面の更新に失敗しました。");
        }
      } finally {
        data.setOperationBusy(false);
      }
    }
  };

  const handleDeleteBranch = async (): Promise<void> => {
    const currentTarget = branchDeleteTarget;
    if (!currentTarget) {
      return;
    }
    const shouldForceDelete = currentTarget.type === "local" && branchDeleteForce;

    const disabledReason = getBranchDeleteDisabledReason(
      currentTarget,
      data.branches?.current ?? null,
    );
    if (disabledReason) {
      const nextError: UiError = {
        title: "このブランチは削除できません",
        detail: disabledReason,
      };
      setBranchDeleteTarget(null);
      setBranchDeleteForce(false);
      data.setInlineError(nextError);
      onNotify(nextError.title);
      return;
    }

    data.setOperationBusy(true);

    try {
      await api.deleteBranch(repoPath, currentTarget.name, currentTarget.type, shouldForceDelete);
      setBranchDeleteTarget(null);
      setBranchDeleteForce(false);
      setBranchAction(null);
      setSelectedBranchForHover(null);
      setPendingScrollCommitSha(null);
      data.setShowBranchDiff(false);
      data.setFocusedCommitDiffFile(null);
      data.setInlineError(null);
      onNotify(`${getBranchDeleteTargetName(currentTarget)} を削除しました。`);
      await data.reloadAfterBranchMutation();
    } catch (error) {
      setBranchDeleteTarget(null);
      setBranchDeleteForce(false);
      data.reportError(error, "ブランチ削除に失敗しました。");
    } finally {
      data.setOperationBusy(false);
    }
  };

  const handleRenameStash = async (message: string): Promise<void> => {
    const currentTarget = stashRenameTarget;
    if (!currentTarget) {
      return;
    }

    data.setOperationBusy(true);

    try {
      await api.renameStash(repoPath, currentTarget.id, message);
      setStashRenameTarget(null);
      data.setInlineError(null);
      onNotify(`${currentTarget.id} の stash message を更新しました。`);
      await data.loadWorkingState();
    } catch (error) {
      data.reportError(error, "stash の rename に失敗しました。");
    } finally {
      data.setOperationBusy(false);
    }
  };

  const handleApplyOrPopStash = async (stash: StashEntry, mode: "apply" | "pop"): Promise<void> => {
    const blockedReason = getSelfStashMutationBlockedReason(mode);
    if (mode === "apply") {
      if (
        data.reportBlockedMutation(
          "開発中のアプリ自身の repo は stash を apply できません",
          blockedReason,
        )
      ) {
        return;
      }
    } else if (
      data.reportBlockedMutation(
        "開発中のアプリ自身の repo は stash を pop できません",
        blockedReason,
      )
    ) {
      return;
    }

    data.setOperationBusy(true);
    let primaryError = false;

    try {
      if (mode === "apply") {
        const result = await api.applyStash(repoPath, stash.id);
        if (
          await openConflictFromResult(
            result,
            "競合が発生しました",
            "Conflict Viewer を開きました。Compare で見比べて Take Ours / Take Theirs / Mark Resolved で解消してください。",
          )
        ) {
          return;
        }

        onNotify(`${stash.id} を apply しました。`);
      } else {
        const result = await api.popStash(repoPath, stash.id);
        if (
          await openConflictFromResult(
            result,
            "競合が発生しました",
            "Conflict Viewer を開きました。Compare で見比べて Take Ours / Take Theirs / Mark Resolved で解消してください。",
          )
        ) {
          return;
        }

        onNotify(`${stash.id} を pop しました。`);
      }

      data.setInlineError(null);
    } catch (error) {
      primaryError = true;
      data.reportError(
        error,
        mode === "apply" ? "stash の apply に失敗しました。" : "stash の pop に失敗しました。",
      );
    } finally {
      try {
        await data.refreshAll();
      } catch (refreshError) {
        if (!primaryError) {
          data.reportError(refreshError, "画面の更新に失敗しました。");
        }
      } finally {
        data.setOperationBusy(false);
      }
    }
  };

  const handleApplyStash = async (stash: StashEntry): Promise<void> => {
    await handleApplyOrPopStash(stash, "apply");
  };

  const handlePopStash = async (stash: StashEntry): Promise<void> => {
    await handleApplyOrPopStash(stash, "pop");
  };

  const handleCreatePullRequest = async (pushSourceBranch: boolean): Promise<void> => {
    const currentAction = branchAction;
    if (!currentAction) {
      return;
    }

    data.setOperationBusy(true);

    try {
      const response = await api.createPullRequest(
        repoPath,
        currentAction.source.name,
        currentAction.target.name,
        pushSourceBranch,
      );
      data.setInlineError(null);
      setBranchAction(null);
      data.rememberBranchPullRequest(currentAction.source.name, {
        url: response.url,
        hasConflicts: false,
      });
      onNotify(`Pull Request を作成しました: ${response.url}`);
      void api.openExternalUrl(response.url).catch((error) => {
        data.reportError(error, "Pull Request を開けませんでした。");
      });
      await data.refreshAll();
    } catch (error) {
      data.reportError(error, "Pull Request の作成に失敗しました。");
    } finally {
      data.setOperationBusy(false);
    }
  };

  const handlePreparePullRequest = async (): Promise<void> => {
    const currentAction = branchAction;
    if (!currentAction) {
      return;
    }

    data.setOperationBusy(true);
    let shouldCreateImmediately = false;

    try {
      const response = await api.preparePullRequest(
        repoPath,
        currentAction.source.name,
        currentAction.target.name,
      );
      data.setInlineError(null);

      if (response.pushRequired) {
        setBranchAction((current) =>
          current &&
          current.source.name === currentAction.source.name &&
          current.target.name === currentAction.target.name
            ? { ...current, step: "confirm-push" }
            : current,
        );
        return;
      }

      shouldCreateImmediately = true;
    } catch (error) {
      data.reportError(error, "Pull Request の準備に失敗しました。");
      return;
    } finally {
      data.setOperationBusy(false);
    }

    if (shouldCreateImmediately) {
      void handleCreatePullRequest(false);
    }
  };

  return {
    branchAction,
    setBranchAction,
    branchCreateSource,
    setBranchCreateSource,
    branchDeleteTarget,
    branchDeleteForce,
    setBranchDeleteTarget,
    setBranchDeleteForce,
    stashRenameTarget,
    stashDeleteTarget,
    setStashRenameTarget,
    setStashDeleteTarget,

    handleCheckoutBranch,
    handleCheckoutCommit,
    handleSelectBranch,
    handleCheckoutBranchRef,
    handleBranchDrop,
    handleRequestDeleteBranch,
    handleRequestCreateBranch,
    handleRequestRenameStash,
    handleRequestDeleteStash,
    handleDeleteStash,
    handleApplyStash,
    handlePopStash,
    handleCreateBranch,
    handleMergeBranchAction,
    handleDeleteBranch,
    handleRenameStash,
    handleCreatePullRequest,
    handlePreparePullRequest,
  };
}
