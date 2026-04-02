import {
  AlertTriangle,
  Copy,
  Download,
  ExternalLink,
  GitCommitHorizontal,
  GripVertical,
  Plus,
  UploadCloud,
  X,
} from "lucide-react";
import {
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import { flushSync } from "react-dom";

import { api } from "../lib/api";
import type { AppThemeId } from "../lib/appTheme";
import { copyTextToClipboard } from "../lib/clipboard";
import { getBranchDiffButtonTooltip } from "../lib/branchDiff";
import { isCommandPaletteShortcut } from "../lib/commandPalette";
import { describeGitError, type UiError } from "../lib/errors";
import { canSwapControllerPanel, type ControllerPanelId } from "../lib/controllerPanelOrder";
import { controllerPanelLabels } from "../lib/controllerViewUtils";
import {
  canMergeBranchWithoutWorkingTreeChange,
  getSelfStashMutationBlockedReason,
} from "../lib/repositoryMutationSafety";
import { waitForNextPaint } from "../lib/waitForNextPaint";
import {
  resolveCollapsedControllerPanelsGridClassName,
  shouldRenderGitOperationsPanel,
} from "../lib/controllerPanelLayout";
import {
  getWorkingTreeDiscardConfirmMessage,
  resolveWorkingTreeDiscardTarget,
} from "../lib/workingTreeDiscard";
import { BranchActionDialog } from "./BranchActionDialog";
import { BranchCreateDialog } from "./BranchCreateDialog";
import { BranchDeleteDialog } from "./BranchDeleteDialog";
import { BranchDiffOverlay } from "./BranchDiffOverlay";
import { BranchTree } from "./BranchTree";
import { CommandPalette, type CommandPaletteCommand } from "./CommandPalette";
import { CommitDetailPanel } from "./CommitDetailPanel";
import { CommitDiffOverlay } from "./CommitDiffOverlay";
import { CommitGraph } from "./CommitGraph";
import { ConflictOverlay } from "./ConflictOverlay";
import { GitOperationPanel } from "./GitOperationPanel";
import { StashDiffOverlay } from "./StashDiffOverlay";
import { StashDeleteDialog } from "./StashDeleteDialog";
import { StashRenameDialog } from "./StashRenameDialog";
import { useControllerBranchOps } from "../hooks/useControllerBranchOps";
import { useControllerData } from "../hooks/useControllerData";
import { useControllerPanelDrag } from "../hooks/useControllerPanelDrag";
import { WorkingTreeDiffOverlay } from "./WorkingTreeDiffOverlay";
import type { AppConfig, Branch, Repository } from "../types";

interface ControllerViewProps {
  repository: Repository;
  appConfig: AppConfig | null;
  appThemeId?: AppThemeId | null;
  onNotify: (message: string) => void;
  onCurrentBranchChange: (repoPath: string, branchName: string | null) => void;
  active?: boolean;
  repositoryGithubUrl?: string | null;
}

type CommitMessageGenerationState =
  | { status: "idle" }
  | { status: "success"; title: string; description: string }
  | { status: "error"; error: UiError };

const GIT_OPERATION_PANEL_HIDE_DURATION_MS = 320;

export function ControllerView({
  repository,
  appConfig,
  appThemeId = null,
  onNotify,
  onCurrentBranchChange,
  active = false,
  repositoryGithubUrl = null,
}: ControllerViewProps): JSX.Element {
  const repoPath = repository.path;

  const [selectedBranchForHover, setSelectedBranchForHover] = useState<Branch | null>(null);
  const [pendingScrollCommitSha, setPendingScrollCommitSha] = useState<string | null>(null);
  const [commitMessageAnimationPending, setCommitMessageAnimationPending] = useState(false);
  const [pendingCommitMessageGenerationResult, setPendingCommitMessageGenerationResult] =
    useState<CommitMessageGenerationState>({ status: "idle" });
  const [gitOperationsPanelVisibility, setGitOperationsPanelVisibility] = useState<
    "visible" | "hiding" | "hidden"
  >("visible");
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const gitOperationsHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const data = useControllerData({ repoPath, appConfig, onNotify, onCurrentBranchChange });
  const [commitMessageGenerationState, runCommitMessageGeneration, generatingCommitMessage] =
    useActionState(
      async (
        _previousState: CommitMessageGenerationState,
        files: string[],
      ): Promise<CommitMessageGenerationState> => {
        if (files.length === 0) {
          return {
            status: "error",
            error: describeGitError(
              new Error("No staged changes are available for commit message generation."),
              "コミット文生成に失敗しました。",
            ),
          };
        }

        try {
          const response = await api.generateCommitMessage(repoPath, files);
          return {
            status: "success",
            title: response.title,
            description: response.description,
          };
        } catch (error) {
          return {
            status: "error",
            error: describeGitError(error, "コミット文生成に失敗しました。"),
          };
        }
      },
      { status: "idle" },
    );
  const isCommitMessageGenerating = commitMessageAnimationPending || generatingCommitMessage;
  const isCommitMessageEditorLocked =
    isCommitMessageGenerating || pendingCommitMessageGenerationResult.status !== "idle";

  const {
    panelOrder,
    draggedPanelId,
    dropTargetPanelId,
    panelDragPreviewPosition,
    panelDragHint,
    handlePanelPointerDown,
  } = useControllerPanelDrag({ repoPath, operationBusy: data.operationBusy });

  const branchOps = useControllerBranchOps({
    repoPath,
    onNotify,
    data,
    setSelectedBranchForHover,
    setPendingScrollCommitSha,
  });
  const branchPullRequests = data.branchPullRequests;
  const reportError = data.reportError;

  const handleOpenBranchPullRequest = useCallback(
    async (branch: Branch): Promise<void> => {
      const url = branchPullRequests[branch.name]?.url;
      if (!url) {
        return;
      }

      try {
        await api.openExternalUrl(url);
      } catch (error) {
        reportError(error, "Pull Request を開けませんでした。");
      }
    },
    [branchPullRequests, reportError],
  );

  const checkedOutBranchName = data.currentLocalBranch?.name ?? null;

  const handleCloseCommandPalette = useCallback((): void => {
    setCommandPaletteOpen(false);
  }, []);

  const copyCurrentBranchName = useCallback(async (): Promise<void> => {
    if (!checkedOutBranchName) {
      return;
    }

    try {
      await copyTextToClipboard(checkedOutBranchName);
      onNotify(`${checkedOutBranchName} をコピーしました。`);
    } catch (error) {
      reportError(error, "ブランチ名をコピーできませんでした。");
    }
  }, [checkedOutBranchName, onNotify, reportError]);

  const pushCurrentBranch = useCallback((): void => {
    if (!data.currentLocalBranch) {
      return;
    }

    void data.mutateAndReload(
      async () => {
        await api.push(repoPath);
      },
      {
        onSuccess: () => {
          flushSync(() => {
            data.clearCommitMessageDraft();
          });
        },
      },
    );
  }, [data, repoPath]);

  const pullCurrentBranch = useCallback((): void => {
    if (!data.currentLocalBranch) {
      return;
    }

    if (data.reportBlockedMutation("開発中のアプリ自身の repo は pull できません")) {
      return;
    }

    void data.mutateAndReload(
      async () => {
        await api.pull(repoPath);
      },
      {
        onSuccess: () => {
          onNotify("upstream の変更を取り込みました。");
        },
      },
    );
  }, [data, onNotify, repoPath]);

  const openRepositoryGithubPage = useCallback(async (): Promise<void> => {
    if (!repositoryGithubUrl) {
      onNotify("GitHub page を開けませんでした。");
      return;
    }

    try {
      await api.openExternalUrl(repositoryGithubUrl);
    } catch (error) {
      reportError(error, "GitHub page を開けませんでした。");
    }
  }, [onNotify, reportError, repositoryGithubUrl]);

  const openCreateBranchDialog = useCallback((): void => {
    if (!data.currentLocalBranch) {
      return;
    }

    branchOps.handleRequestCreateBranch(data.currentLocalBranch);
  }, [branchOps, data.currentLocalBranch]);

  const commandPaletteCommands = useMemo<CommandPaletteCommand[]>(
    () => [
      {
        id: "copy-current-branch-name",
        title: "Copy Current Branch Name",
        description: checkedOutBranchName
          ? `Current branch: ${checkedOutBranchName}`
          : "Currently checked out local branch name.",
        keywords: [
          "copy",
          "branch",
          "clipboard",
          "checkout",
          "current",
          "現在",
          "ブランチ",
          "コピー",
        ],
        icon: Copy,
        disabledReason: checkedOutBranchName
          ? null
          : "local branch を checkout 中のときだけ使えます。",
        onSelect: copyCurrentBranchName,
      },
      {
        id: "create-branch",
        title: "Create Branch",
        description: checkedOutBranchName
          ? `${checkedOutBranchName} から新しい branch を作成して切り替えます。`
          : "Create and checkout a new branch from the current local branch.",
        keywords: ["create", "branch", "checkout", "new", "現在", "ブランチ", "作成"],
        icon: Plus,
        disabledReason: data.operationBusy
          ? "Git 操作の完了を待ってから実行してください。"
          : data.currentLocalBranch
            ? null
            : "local branch を checkout 中のときだけ使えます。",
        onSelect: openCreateBranchDialog,
      },
      {
        id: "pull-current-branch",
        title: "Pull Current Branch",
        description: checkedOutBranchName
          ? `${checkedOutBranchName} に upstream の変更を取り込みます。`
          : "Pull upstream changes into the current local branch.",
        keywords: ["pull", "fetch", "branch", "remote", "現在", "ブランチ", "プル"],
        icon: Download,
        disabledReason: data.operationBusy
          ? "Git 操作の完了を待ってから実行してください。"
          : (data.selfMutationBlockedReason ??
            (data.currentLocalBranch ? null : "local branch を checkout 中のときだけ使えます。")),
        onSelect: pullCurrentBranch,
      },
      {
        id: "push-current-branch",
        title: "Push Current Branch",
        description: checkedOutBranchName
          ? `${checkedOutBranchName} を remote へ push します。`
          : "Push the current local branch to the remote.",
        keywords: ["push", "branch", "remote", "publish", "現在", "ブランチ", "プッシュ"],
        icon: UploadCloud,
        disabledReason: data.operationBusy
          ? "Git 操作の完了を待ってから実行してください。"
          : data.currentLocalBranch
            ? null
            : "local branch を checkout 中のときだけ使えます。",
        onSelect: pushCurrentBranch,
      },
      {
        id: "open-github-page",
        title: "Open GitHub Page",
        description: `${repository.name} の GitHub page を開きます。`,
        keywords: ["github", "open", "repository", "browser", "git hub", "ページ", "開く"],
        icon: ExternalLink,
        disabledReason: repositoryGithubUrl ? null : "GitHub remote を解決できたときだけ使えます。",
        onSelect: openRepositoryGithubPage,
      },
    ],
    [
      checkedOutBranchName,
      copyCurrentBranchName,
      data.currentLocalBranch,
      data.operationBusy,
      data.selfMutationBlockedReason,
      openCreateBranchDialog,
      openRepositoryGithubPage,
      pullCurrentBranch,
      pushCurrentBranch,
      repository.name,
      repositoryGithubUrl,
    ],
  );

  useEffect(() => {
    if (generatingCommitMessage) {
      setCommitMessageAnimationPending(false);
    }
  }, [generatingCommitMessage]);

  useEffect(() => {
    if (active) {
      return;
    }

    setCommandPaletteOpen(false);
  }, [active]);

  useEffect(() => {
    if (!active || typeof window === "undefined") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !isCommandPaletteShortcut(event)) {
        return;
      }

      event.preventDefault();
      setCommandPaletteOpen((current) => !current);
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [active]);

  /* oxlint-disable react-hooks/exhaustive-deps -- depend on stable setter references, not the data object itself */
  useEffect(() => {
    if (commitMessageGenerationState.status === "idle" || generatingCommitMessage) {
      return;
    }

    setCommitMessageAnimationPending(false);
    setPendingCommitMessageGenerationResult(commitMessageGenerationState);
  }, [commitMessageGenerationState, generatingCommitMessage]);
  /* oxlint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    setCommitMessageAnimationPending(false);
    setPendingCommitMessageGenerationResult({ status: "idle" });
  }, [repoPath]);

  useEffect(() => {
    if (data.commitMessageFiles.length > 0) {
      return;
    }

    setCommitMessageAnimationPending(false);
  }, [data.commitMessageFiles.length]);

  useEffect(() => {
    if (!data.operationBusy) {
      setCommitMessageAnimationPending(false);
      setPendingCommitMessageGenerationResult({ status: "idle" });
    }
  }, [data.operationBusy]);

  /* oxlint-disable react-hooks/exhaustive-deps -- depend on stable setter references, not the data object itself */
  useEffect(() => {
    if (pendingCommitMessageGenerationResult.status === "idle" || isCommitMessageGenerating) {
      return;
    }

    let cancelled = false;

    void (async () => {
      await waitForNextPaint();
      if (cancelled) {
        return;
      }

      if (pendingCommitMessageGenerationResult.status === "success") {
        data.setInlineError(null);
        data.setCommitTitle(pendingCommitMessageGenerationResult.title);
        data.setCommitDescription(pendingCommitMessageGenerationResult.description);
      } else {
        data.setInlineError(pendingCommitMessageGenerationResult.error);
        onNotify(pendingCommitMessageGenerationResult.error.title);
      }

      setPendingCommitMessageGenerationResult({ status: "idle" });
      data.setOperationBusy(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    data.setCommitDescription,
    data.setCommitTitle,
    data.setInlineError,
    data.setOperationBusy,
    isCommitMessageGenerating,
    onNotify,
    pendingCommitMessageGenerationResult,
  ]);
  /* oxlint-enable react-hooks/exhaustive-deps */

  const highlightedCommitSha = selectedBranchForHover?.commit ?? null;

  const workingTreeSelection = useMemo(() => {
    if (!data.isWipSelected) {
      return null;
    }

    return {
      stagedCount: data.workingStatus?.staged.length ?? 0,
      unstagedCount: data.workingStatus?.unstaged.length ?? 0,
      conflictedCount: data.workingStatus?.conflicted.length ?? 0,
      files: [
        ...(data.workingStatus?.staged.map((item) => ({
          file: item.file,
          area: "staged" as const,
          x: item.x,
          y: item.y,
          statusLabel: item.statusLabel,
        })) ?? []),
        ...(data.workingStatus?.unstaged.map((item) => ({
          file: item.file,
          area: "unstaged" as const,
          x: item.x,
          y: item.y,
          statusLabel: item.statusLabel,
        })) ?? []),
        ...(data.workingStatus?.conflicted.map((item) => ({
          file: item.file,
          area: "conflicted" as const,
          x: item.x,
          y: item.y,
          statusLabel: item.statusLabel,
        })) ?? []),
      ],
    };
  }, [data.isWipSelected, data.workingStatus]);

  const selectedCommitDetail = useMemo(
    () =>
      data.commitDetail && data.activeCommit && data.commitDetail.sha === data.activeCommit.sha
        ? data.commitDetail
        : null,
    [data.activeCommit, data.commitDetail],
  );
  const branchActionMergeDisabledReason =
    branchOps.branchAction?.step === "select-action" &&
    data.selfMutationBlockedReason &&
    !canMergeBranchWithoutWorkingTreeChange(data.currentBranchName, branchOps.branchAction.target)
      ? data.selfMutationBlockedReason
      : null;
  const stashMutationBlockedReason = data.selfMutationBlockedReason
    ? getSelfStashMutationBlockedReason("apply / pop")
    : null;
  const activeConflictSummary = data.conflictSummary;
  const branchDiffTooltip = getBranchDiffButtonTooltip(
    data.branchDiffBaseLabel,
    data.showBranchDiff,
  );
  const branchDiffHeaderAccessory = data.showBranchDiffButton ? (
    <button
      type="button"
      className={`button ${data.showBranchDiff ? "button-primary" : "button-secondary"}`}
      disabled={data.loadingBranchDiffDetail}
      title={branchDiffTooltip}
      aria-haspopup="dialog"
      aria-expanded={data.showBranchDiff}
      onClick={() => {
        data.setFocusedCommitDiffFile(null);
        data.setShowBranchDiff(!data.showBranchDiff);
      }}
    >
      {data.showBranchDiff ? "Close Diffs" : data.branchDiffButtonLabel}
    </button>
  ) : null;

  // --- Panel JSX ---

  const commitGraphPanel = (
    <CommitGraph
      commits={data.commits}
      commitAuthorAvatars={data.commitAuthorAvatars}
      mode={data.commitGraphMode}
      activeCommitSha={data.activeCommit?.sha ?? null}
      highlightedCommitSha={highlightedCommitSha}
      checkedOutCommitSha={data.checkedOutCommitSha}
      scrollToCommitSha={pendingScrollCommitSha}
      onScrollToCommitHandled={(sha) => {
        setPendingScrollCommitSha((current) => (current === sha ? null : current));
      }}
      hasMore={data.hasMoreCommits}
      loading={data.loadingCommits}
      loadingMore={data.loadingMoreCommits}
      busy={data.operationBusy}
      wipStagedCount={data.workingStatus?.staged.length ?? 0}
      wipUnstagedCount={data.workingStatus?.unstaged.length ?? 0}
      wipConflictedCount={data.workingStatus?.conflicted.length ?? 0}
      onSelectWip={() => {
        data.setIsWipSelected(true);
        data.setActiveCommit(null);
        data.setCommitDetail(null);
        data.setFocusedCommitDiffFile(null);
        data.setShowBranchDiff(false);
      }}
      onSelectCommit={(commit) => {
        data.setIsWipSelected(false);
        data.setActiveCommit(commit);
        void data.loadCommitDetail(commit.sha);
      }}
      onCheckoutCommit={(commit) => {
        void branchOps.handleCheckoutCommit(commit);
      }}
      onCheckoutBranchRef={branchOps.handleCheckoutBranchRef}
      onLoadMore={() => {
        void data.loadCommits({
          append: true,
          offset: data.commits.length,
          ref: data.activeLogRef,
          compareRefs: data.activeCompareRefs,
        });
      }}
      onNotify={onNotify}
      branchContext={data.branches}
    />
  );

  const commitCurrentChanges = (): void => {
    void data.mutateAndReload(
      async () => {
        await api.commit(repoPath, data.commitTitle, data.commitDescription);
      },
      {
        onSuccess: () => {
          flushSync(() => {
            data.clearCommitMessageDraft();
          });
        },
      },
    );
  };

  const commitActionDisabled =
    data.operationBusy ||
    (data.workingStatus?.staged.length ?? 0) === 0 ||
    !data.commitTitle.trim();
  const shouldShowGitOperations = shouldRenderGitOperationsPanel(data.workingStatus);

  useEffect(() => {
    if (gitOperationsHideTimeoutRef.current !== null) {
      clearTimeout(gitOperationsHideTimeoutRef.current);
      gitOperationsHideTimeoutRef.current = null;
    }

    if (shouldShowGitOperations) {
      setGitOperationsPanelVisibility("visible");
      return;
    }

    setGitOperationsPanelVisibility((current) => (current === "hidden" ? current : "hiding"));
    gitOperationsHideTimeoutRef.current = setTimeout(() => {
      gitOperationsHideTimeoutRef.current = null;
      setGitOperationsPanelVisibility("hidden");
    }, GIT_OPERATION_PANEL_HIDE_DURATION_MS);

    return () => {
      if (gitOperationsHideTimeoutRef.current !== null) {
        clearTimeout(gitOperationsHideTimeoutRef.current);
        gitOperationsHideTimeoutRef.current = null;
      }
    };
  }, [shouldShowGitOperations]);

  useEffect(() => {
    return () => {
      if (gitOperationsHideTimeoutRef.current !== null) {
        clearTimeout(gitOperationsHideTimeoutRef.current);
      }
    };
  }, []);

  const gitOperationPanel = (
    <GitOperationPanel
      status={data.workingStatus}
      stashes={data.stashes}
      pullStatus={data.pullStatus}
      commitTitle={data.commitTitle}
      commitDescription={data.commitDescription}
      busy={data.operationBusy}
      commitMessageEditorLocked={isCommitMessageEditorLocked}
      generatingCommitMessage={isCommitMessageGenerating}
      activeWorkingTreeDiff={data.focusedWorkingTreeDiff}
      activeConflictFile={data.focusedConflictFile}
      onCommitTitleChange={data.setCommitTitle}
      onCommitDescriptionChange={data.setCommitDescription}
      onStageFile={(file) => {
        void data.mutateAndReload(
          async () => {
            await api.stageFile(repoPath, file);
          },
          { reloadCommits: false },
        );
      }}
      onUnstageFile={(file) => {
        void data.mutateAndReload(
          async () => {
            await api.unstageFile(repoPath, file);
          },
          { reloadCommits: false },
        );
      }}
      onStageAll={() => {
        void data.mutateAndReload(
          async () => {
            const files = data.workingStatus?.unstaged.map((item) => item.file) ?? [];
            for (const file of files) {
              await api.stageFile(repoPath, file);
            }
          },
          { reloadCommits: false },
        );
      }}
      onUnstageAll={() => {
        void data.mutateAndReload(
          async () => {
            const files = data.workingStatus?.staged.map((item) => item.file) ?? [];
            for (const file of files) {
              await api.unstageFile(repoPath, file);
            }
          },
          { reloadCommits: false },
        );
      }}
      onStashFile={(file) => {
        void data.mutateAndReload(
          async () => {
            await api.stashFile(repoPath, file);
          },
          { reloadCommits: false },
        );
      }}
      onDiscardFileRequest={(item, source) => {
        const target = resolveWorkingTreeDiscardTarget(item, source);
        if (!target) {
          return;
        }

        if (!window.confirm(getWorkingTreeDiscardConfirmMessage(target))) {
          return;
        }

        void data.mutateAndReload(
          async () => {
            await api.discardFile(repoPath, target.file);
          },
          { reloadCommits: false },
        );
      }}
      onOpenWorkingTreeDiff={(file, area) => {
        void data.loadWorkingTreeDiffDetail(file, area);
      }}
      onOpenConflict={(file) => {
        void data.openConflictViewer({
          file,
          summary:
            activeConflictSummary?.contextType === "repository" ? activeConflictSummary : null,
        });
      }}
      onGenerateCommitMessage={() => {
        if (data.commitMessageFiles.length === 0) {
          const nextError = describeGitError(
            new Error("No staged changes are available for commit message generation."),
            "コミット文生成に失敗しました。",
          );
          data.setInlineError(nextError);
          onNotify(nextError.title);
          return;
        }

        const files = data.commitMessageFiles;

        flushSync(() => {
          setCommitMessageAnimationPending(true);
          data.setOperationBusy(true);
        });

        void (async () => {
          await waitForNextPaint();
          startTransition(() => {
            runCommitMessageGeneration(files);
          });
        })();
      }}
      onCommit={commitCurrentChanges}
      onPull={() => {
        pullCurrentBranch();
      }}
      hideFooterCommitAction
      headerAccessory={
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="button button-secondary inline-flex items-center gap-2"
            disabled={data.operationBusy}
            onClick={pushCurrentBranch}
          >
            <UploadCloud size={16} aria-hidden="true" />
            <span>Push</span>
          </button>
          <button
            type="button"
            className="button button-primary inline-flex items-center gap-2"
            disabled={commitActionDisabled}
            onClick={commitCurrentChanges}
          >
            <GitCommitHorizontal size={16} aria-hidden="true" />
            <span>Commit</span>
          </button>
        </div>
      }
    />
  );

  const commitDetailPanel = (
    <CommitDetailPanel
      detail={selectedCommitDetail}
      loading={data.loadingCommitDetail && !data.isWipSelected}
      activeDiffFile={data.focusedCommitDiffFile}
      activeWorkingTreeDiff={data.focusedWorkingTreeDiff}
      activeConflictFile={data.focusedConflictFile}
      onOpenFileDiff={(file) => {
        data.setFocusedCommitDiffFile(file);
      }}
      onOpenWorkingTreeDiff={(file, area) => {
        void data.loadWorkingTreeDiffDetail(file, area);
      }}
      onOpenConflict={(file) => {
        void data.openConflictViewer({
          file,
          summary:
            activeConflictSummary?.contextType === "repository" ? activeConflictSummary : null,
        });
      }}
      workingTreeSelection={workingTreeSelection}
      headerAccessory={branchDiffHeaderAccessory}
    />
  );

  const panelContentById: Record<ControllerPanelId, JSX.Element> = {
    commitGraph: commitGraphPanel,
    gitOperations: gitOperationPanel,
    commitDetail: commitDetailPanel,
  };
  const renderGitOperationsSlot = gitOperationsPanelVisibility !== "hidden";
  const visiblePanelOrder = renderGitOperationsSlot
    ? panelOrder
    : panelOrder.filter((panelId) => panelId !== "gitOperations");
  const controllerPanelsGridClassName = [
    "controller-panels-grid",
    !renderGitOperationsSlot ? "controller-panels-grid--without-git-operations" : null,
    !renderGitOperationsSlot
      ? resolveCollapsedControllerPanelsGridClassName(visiblePanelOrder)
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  // --- Render ---

  return (
    <section className="relative flex h-full flex-col gap-3">
      {data.inlineError ? (
        <section className="panel flex items-start justify-between gap-3 border border-red-500/25 bg-red-50/70 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 text-red-700" />
            <div>
              <div className="text-sm font-semibold text-red-800">{data.inlineError.title}</div>
              <div className="text-xs text-red-700">{data.inlineError.detail}</div>
            </div>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-red-700 transition hover:bg-red-100"
            onClick={() => data.setInlineError(null)}
            aria-label="close error"
          >
            <X size={14} />
          </button>
        </section>
      ) : null}

      {activeConflictSummary?.contextType === "mergeSession" && !data.showConflictViewer ? (
        <section className="panel flex flex-wrap items-center justify-between gap-3 border border-amber-500/25 bg-amber-50/80 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-amber-900">Merge session is paused</div>
            <div className="text-xs text-amber-800">
              {activeConflictSummary.sourceBranch && activeConflictSummary.targetBranch
                ? `${activeConflictSummary.sourceBranch} -> ${activeConflictSummary.targetBranch}`
                : "別ブランチ向けの merge session"}
              {" · "}
              {activeConflictSummary.files.length > 0
                ? `${activeConflictSummary.files.length} conflicted files remain.`
                : "No unresolved conflicts remain. Complete Merge で target branch を更新できます。"}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="button button-secondary"
              disabled={data.operationBusy}
              onClick={() => {
                void data.openConflictViewer({
                  summary: activeConflictSummary,
                  file: data.focusedConflictFile ?? activeConflictSummary.files[0]?.file ?? null,
                  sessionId: activeConflictSummary.sessionId ?? null,
                });
              }}
            >
              Resume Conflict Viewer
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={data.operationBusy}
              onClick={() => {
                void data.abortActiveMergeSession();
              }}
            >
              Abort Merge
            </button>
            {activeConflictSummary.files.length === 0 ? (
              <button
                type="button"
                className="button button-primary"
                disabled={data.operationBusy}
                onClick={() => {
                  void data.completeActiveMergeSession();
                }}
              >
                Complete Merge
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(236px,280px)_minmax(0,1fr)] gap-3 max-[1320px]:grid-cols-[minmax(220px,248px)_minmax(0,1fr)] max-[1100px]:grid-cols-1">
        <BranchTree
          branches={data.branches}
          branchPullRequests={data.branchPullRequests}
          stashes={data.stashes}
          selectedBranchName={data.branches?.current ?? null}
          stashMutationBlockedReason={stashMutationBlockedReason}
          busy={data.operationBusy}
          onSelectBranch={branchOps.handleSelectBranch}
          onCheckoutBranch={(branch) => {
            void branchOps.handleCheckoutBranch(branch);
          }}
          onBranchDrop={branchOps.handleBranchDrop}
          onOpenStashDiff={(stash) => {
            void data.loadStashDiffDetail(stash);
          }}
          onRequestRenameStash={branchOps.handleRequestRenameStash}
          onRequestDeleteStash={(stash) => {
            branchOps.handleRequestDeleteStash(stash);
          }}
          onRequestApplyStash={(stash) => {
            void branchOps.handleApplyStash(stash);
          }}
          onRequestPopStash={(stash) => {
            void branchOps.handlePopStash(stash);
          }}
          onOpenBranchPullRequest={(branch) => {
            void handleOpenBranchPullRequest(branch);
          }}
          onRequestCreateBranch={branchOps.handleRequestCreateBranch}
          onRequestDeleteBranch={branchOps.handleRequestDeleteBranch}
        />

        <div className={controllerPanelsGridClassName}>
          {visiblePanelOrder.map((panelId) => {
            const isDragActive = draggedPanelId !== null;
            const isDropTarget = dropTargetPanelId === panelId;
            const isDragSource = draggedPanelId === panelId;
            const isDropCandidate =
              isDragActive &&
              canSwapControllerPanel({
                busy: data.operationBusy,
                sourceId: draggedPanelId,
                targetId: panelId,
              });

            return (
              <div
                key={panelId}
                data-controller-panel-drop-id={panelId}
                data-controller-panel-drag-source-id={panelId}
                className={`controller-panel-slot min-h-0 ${
                  panelId === "gitOperations" && gitOperationsPanelVisibility === "hiding"
                    ? "controller-panel-slot--hiding"
                    : ""
                } ${isDropCandidate ? "is-drop-candidate" : ""} ${isDropTarget ? "is-drop-target" : ""} ${isDragSource ? "is-drag-source" : ""}`}
                onPointerDown={(event) => handlePanelPointerDown(event, panelId)}
              >
                <div className="controller-panel-slot__content">{panelContentById[panelId]}</div>

                {isDropTarget && draggedPanelId ? (
                  <div className="controller-panel-drop-split">
                    <div className="controller-panel-drop-split__pane controller-panel-drop-split__pane--source">
                      <div className="controller-panel-drop-split__eyebrow">From</div>
                      <div className="controller-panel-drop-split__title">
                        {controllerPanelLabels[draggedPanelId]}
                      </div>
                    </div>
                    <div className="controller-panel-drop-split__flow" aria-hidden="true">
                      <span className="controller-panel-drop-split__arrow">→</span>
                    </div>
                    <div className="controller-panel-drop-split__pane controller-panel-drop-split__pane--target">
                      <div className="controller-panel-drop-split__eyebrow">Swap</div>
                      <div className="controller-panel-drop-split__title">
                        {controllerPanelLabels[panelId]}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {draggedPanelId && panelDragPreviewPosition ? (
        <div
          className="controller-panel-drag-preview"
          style={{
            left: `${panelDragPreviewPosition.x + 18}px`,
            top: `${panelDragPreviewPosition.y + 18}px`,
          }}
        >
          <div className="controller-panel-drag-preview__title">
            <GripVertical size={13} />
            <span>{controllerPanelLabels[draggedPanelId]}</span>
          </div>
          <div className="controller-panel-drag-preview__hint">{panelDragHint}</div>
        </div>
      ) : null}

      <CommandPalette
        open={isCommandPaletteOpen}
        repositoryName={repository.name}
        currentBranchName={checkedOutBranchName}
        commands={commandPaletteCommands}
        onClose={handleCloseCommandPalette}
      />

      {selectedCommitDetail && data.focusedCommitDiffFile ? (
        <CommitDiffOverlay
          repoPath={repoPath}
          appThemeId={appThemeId}
          detail={selectedCommitDetail}
          filePath={data.focusedCommitDiffFile}
          onClose={() => data.setFocusedCommitDiffFile(null)}
          onNotify={onNotify}
        />
      ) : null}

      {data.focusedWorkingTreeDiff ? (
        <WorkingTreeDiffOverlay
          appThemeId={appThemeId}
          detail={data.workingTreeDiffDetail}
          loading={data.loadingWorkingTreeDiffDetail}
          filePath={data.focusedWorkingTreeDiff.file}
          area={data.focusedWorkingTreeDiff.area}
          onClose={data.closeWorkingTreeDiffOverlay}
        />
      ) : null}

      {data.focusedStash ? (
        <StashDiffOverlay
          repoPath={repoPath}
          appThemeId={appThemeId}
          stash={data.focusedStash}
          detail={data.stashDiffDetail}
          loading={data.loadingStashDiffDetail}
          onClose={data.closeStashDiffOverlay}
        />
      ) : null}

      {data.showBranchDiff ? (
        <BranchDiffOverlay
          repoPath={repoPath}
          appThemeId={appThemeId}
          detail={data.branchDiffMatchesCurrentBranch ? data.branchDiffDetail : null}
          loading={data.loadingBranchDiffDetail}
          baseBranchName={data.branchDiffBaseLabel}
          targetBranchName={data.currentLocalBranch?.name ?? null}
          onClose={() => data.setShowBranchDiff(false)}
          onNotify={onNotify}
        />
      ) : null}

      {data.showConflictViewer && activeConflictSummary ? (
        <ConflictOverlay
          summary={activeConflictSummary}
          activeFilePath={data.focusedConflictFile}
          detail={data.conflictFileDetail}
          loading={data.loadingConflictFileDetail}
          busy={data.operationBusy}
          onSelectFile={(file) => {
            void data.openConflictViewer({
              summary: activeConflictSummary,
              file,
              sessionId: activeConflictSummary.sessionId ?? null,
            });
          }}
          onResolve={(side) => {
            void data.resolveActiveConflict(side);
          }}
          onCompleteMergeSession={() => {
            void data.completeActiveMergeSession();
          }}
          onAbortMergeSession={() => {
            void data.abortActiveMergeSession();
          }}
          onClose={data.closeConflictViewer}
        />
      ) : null}

      {branchOps.branchAction ? (
        <BranchActionDialog
          sourceBranchName={branchOps.branchAction.source.name}
          targetBranchName={branchOps.branchAction.target.name}
          step={branchOps.branchAction.step}
          busy={data.operationBusy}
          mergeDisabledReason={branchActionMergeDisabledReason}
          onClose={() => branchOps.setBranchAction(null)}
          onMerge={() => {
            void branchOps.handleMergeBranchAction();
          }}
          onPreparePullRequest={() => {
            void branchOps.handlePreparePullRequest();
          }}
          onConfirmPushAndCreatePullRequest={() => {
            void branchOps.handleCreatePullRequest(true);
          }}
          onBack={() => {
            branchOps.setBranchAction((current) =>
              current ? { ...current, step: "select-action" } : current,
            );
          }}
        />
      ) : null}

      {branchOps.branchCreateSource ? (
        <BranchCreateDialog
          baseBranchName={branchOps.branchCreateSource.name}
          busy={data.operationBusy}
          onClose={() => branchOps.setBranchCreateSource(null)}
          onCreate={(newBranchName) => {
            void branchOps.handleCreateBranch(newBranchName);
          }}
        />
      ) : null}

      {branchOps.branchDeleteTarget ? (
        <BranchDeleteDialog
          branchName={branchOps.branchDeleteTarget.name}
          branchType={branchOps.branchDeleteTarget.type}
          busy={data.operationBusy}
          forceDelete={branchOps.branchDeleteForce}
          onClose={() => {
            branchOps.setBranchDeleteForce(false);
            branchOps.setBranchDeleteTarget(null);
          }}
          onForceDeleteChange={branchOps.setBranchDeleteForce}
          onDelete={() => {
            void branchOps.handleDeleteBranch();
          }}
        />
      ) : null}

      {branchOps.stashRenameTarget ? (
        <StashRenameDialog
          stashId={branchOps.stashRenameTarget.id}
          initialMessage={branchOps.stashRenameTarget.message}
          busy={data.operationBusy}
          onClose={() => branchOps.setStashRenameTarget(null)}
          onRename={(message) => {
            void branchOps.handleRenameStash(message);
          }}
        />
      ) : null}

      {branchOps.stashDeleteTarget ? (
        <StashDeleteDialog
          stashId={branchOps.stashDeleteTarget.id}
          message={branchOps.stashDeleteTarget.message}
          busy={data.operationBusy}
          onClose={() => branchOps.setStashDeleteTarget(null)}
          onDelete={() => {
            void branchOps.handleDeleteStash();
          }}
        />
      ) : null}
    </section>
  );
}
