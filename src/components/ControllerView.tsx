import {
  Archive,
  Cog,
  Copy,
  Download,
  Eye,
  ExternalLink,
  GitCommitHorizontal,
  GripVertical,
  Moon,
  PanelsTopLeft,
  Plus,
  Sun,
  UploadCloud,
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
import { createPortal, flushSync } from "react-dom";

import { api } from "../lib/api";
import { getAppThemeMode, type AppThemeId } from "../lib/appTheme";
import { buildAppCommandPaletteActionSpecs } from "../lib/appCommandPalette";
import { copyTextToClipboard } from "../lib/clipboard";
import { getBranchDiffButtonTooltip } from "../lib/branchDiff";
import {
  parseRecentCommandPaletteItemIds,
  sortCommandPaletteItemsByRecency,
  updateRecentCommandPaletteItemIds,
} from "../lib/commandPalette";
import { describeGitError, formatUiErrorForClipboard, type UiError } from "../lib/errors";
import { shortSha } from "../lib/format";
import { getPullCommandDisabledReason } from "../lib/pullCommand";
import {
  canSwapControllerPanel,
  DEFAULT_CONTROLLER_PANEL_ORDER,
  DEFAULT_CONTROLLER_PANEL_VISIBILITY,
  getVisibleControllerPanelOrder,
  normalizeControllerPanelVisibility,
  toggleControllerPanelVisibility,
  type ControllerPanelId,
  type ControllerPanelVisibility,
} from "../lib/controllerPanelOrder";
import {
  CONTROLLER_PANEL_VISIBILITY_STORAGE_KEY,
  buildControllerPanelToggleCommandSpecs,
  controllerPanelLabels,
} from "../lib/controllerViewUtils";
import {
  canMergeBranchWithoutWorkingTreeChange,
  getSelfPullConfirmationMessage,
  getSelfStashMutationBlockedReason,
} from "../lib/repositoryMutationSafety";
import { stashFilesAsSingleEntry } from "../lib/stashFiles";
import { waitForNextPaint } from "../lib/waitForNextPaint";
import {
  getWorkingTreeDiscardConfirmMessage,
  resolveWorkingTreeDiscardTarget,
} from "../lib/workingTreeDiscard";
import { BranchActionDialog } from "./BranchActionDialog";
import { BranchCreateDialog } from "./BranchCreateDialog";
import { BranchDeleteDialog } from "./BranchDeleteDialog";
import { BranchDiffOverlay } from "./BranchDiffOverlay";
import { BranchTree } from "./BranchTree";
import { type CommandPaletteCommand } from "./CommandPalette";
import { CommitDetailPanel } from "./CommitDetailPanel";
import { CommitDiffOverlay } from "./CommitDiffOverlay";
import { CommitGraph } from "./CommitGraph";
import { ConflictOverlay } from "./ConflictOverlay";
import { ControllerCommandPaletteHost } from "./ControllerCommandPaletteHost";
import { ControllerInlineErrorAlert } from "./ControllerInlineErrorAlert";
import { GitOperationPanel } from "./GitOperationPanel";
import { StashDiffOverlay } from "./StashDiffOverlay";
import { StashDeleteDialog } from "./StashDeleteDialog";
import { StashRenameDialog } from "./StashRenameDialog";
import { useControllerBranchOps } from "../hooks/useControllerBranchOps";
import { useControllerData } from "../hooks/useControllerData";
import { useControllerPanelDrag } from "../hooks/useControllerPanelDrag";
import { WorkingTreeDiffOverlay } from "./WorkingTreeDiffOverlay";
import type { AppConfig, Branch, ConflictSummary, PullStatus, Repository } from "../types";

interface AssistantConflictOpenRequest {
  requestId: number;
  summary: ConflictSummary;
  file: string | null;
  sessionId: string | null;
}

interface ControllerViewProps {
  repository: Repository;
  appConfig: AppConfig | null;
  appThemeId?: AppThemeId | null;
  layoutPickerPortalContainer?: HTMLElement | null;
  onOpenConfig?: () => void;
  onSelectTheme?: (themeId: AppThemeId) => void;
  onNotify: (message: string) => void;
  onCurrentBranchChange: (repoPath: string, branchName: string | null) => void;
  active?: boolean;
  repositoryGithubUrl?: string | null;
  assistantRefreshRequestId?: number;
  assistantConflictOpenRequest?: AssistantConflictOpenRequest | null;
}

type CommitMessageGenerationState =
  | { status: "idle" }
  | { status: "success"; title: string; description: string }
  | { status: "error"; error: UiError };
type ControllerActivityTone = "idle" | "running" | "success" | "error";

const BRANCH_TREE_COLLAPSED_STORAGE_KEY_PREFIX = "git-chat-ui.branch-tree-collapsed";
const COMMAND_PALETTE_RECENT_ITEM_IDS_STORAGE_KEY = "git-chat-ui.command-palette-recent-item-ids";
const CONTROLLER_ACTIVITY_SUCCESS_DURATION_MS = 1400;
const CONTROLLER_ACTIVITY_ERROR_DURATION_MS = 1800;

function getControllerActivityMessage(tone: ControllerActivityTone): string {
  switch (tone) {
    case "running":
      return "操作を実行中です。";
    case "success":
      return "操作が完了しました。";
    case "error":
      return "操作に失敗しました。";
    case "idle":
    default:
      return "";
  }
}

function getBranchTreeCollapsedStorageKey(repoPath: string): string {
  return `${BRANCH_TREE_COLLAPSED_STORAGE_KEY_PREFIX}:${repoPath}`;
}

function readInitialBranchTreeCollapsed(repoPath: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(getBranchTreeCollapsedStorageKey(repoPath)) === "1";
}

function readInitialControllerPanelVisibility(): ControllerPanelVisibility {
  if (typeof window === "undefined") {
    return { ...DEFAULT_CONTROLLER_PANEL_VISIBILITY };
  }

  try {
    const raw = window.localStorage.getItem(CONTROLLER_PANEL_VISIBILITY_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_CONTROLLER_PANEL_VISIBILITY };
    }

    const parsed = JSON.parse(raw);
    return normalizeControllerPanelVisibility(
      parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null,
    );
  } catch {
    return { ...DEFAULT_CONTROLLER_PANEL_VISIBILITY };
  }
}

function readInitialRecentCommandPaletteItemIds(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    return parseRecentCommandPaletteItemIds(
      window.localStorage.getItem(COMMAND_PALETTE_RECENT_ITEM_IDS_STORAGE_KEY),
    );
  } catch {
    return [];
  }
}

export function ControllerView({
  repository,
  appConfig,
  appThemeId = null,
  layoutPickerPortalContainer,
  onOpenConfig,
  onSelectTheme,
  onNotify,
  onCurrentBranchChange,
  active = false,
  repositoryGithubUrl = null,
  assistantRefreshRequestId = 0,
  assistantConflictOpenRequest = null,
}: ControllerViewProps): JSX.Element {
  const repoPath = repository.path;

  const [selectedBranchForHover, setSelectedBranchForHover] = useState<Branch | null>(null);
  const [pendingScrollCommitSha, setPendingScrollCommitSha] = useState<string | null>(null);
  const [commitMessageAnimationPending, setCommitMessageAnimationPending] = useState(false);
  const [pendingCommitMessageGenerationResult, setPendingCommitMessageGenerationResult] =
    useState<CommitMessageGenerationState>({ status: "idle" });
  const [branchPullStatuses, setBranchPullStatuses] = useState<Record<string, PullStatus | null>>(
    {},
  );
  const [branchPullStatusLoading, setBranchPullStatusLoading] = useState<Record<string, boolean>>(
    {},
  );
  const [isBranchTreeCollapsed, setBranchTreeCollapsed] = useState<boolean>(() =>
    readInitialBranchTreeCollapsed(repoPath),
  );
  const [isLayoutPickerOpen, setLayoutPickerOpen] = useState(false);
  const [panelVisibility, setPanelVisibility] = useState<ControllerPanelVisibility>(() =>
    readInitialControllerPanelVisibility(),
  );
  const [recentCommandPaletteItemIds, setRecentCommandPaletteItemIds] = useState<string[]>(() =>
    readInitialRecentCommandPaletteItemIds(),
  );
  const [controllerActivityTone, setControllerActivityTone] =
    useState<ControllerActivityTone>("idle");
  const lastHandledAssistantConflictOpenRequestIdRef = useRef(
    assistantConflictOpenRequest?.requestId ?? 0,
  );
  const controllerActivityResetTimeoutRef = useRef<number | null>(null);
  const controllerActivityPreviousErrorKeyRef = useRef<string | null>(null);
  const controllerActivityErrorVersionRef = useRef(0);
  const controllerActivityRunningBaselineErrorVersionRef = useRef(0);
  const controllerActivityWasRunningRef = useRef(false);
  const layoutPickerRef = useRef<HTMLDetailsElement | null>(null);

  const data = useControllerData({ repoPath, appConfig, onNotify, onCurrentBranchChange });
  const refreshAll = data.refreshAll;
  const loadWorkingState = data.loadWorkingState;
  const openConflictViewer = data.openConflictViewer;
  const reportConflictViewerError = data.reportError;
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
  const branchPullStatusBusy = useMemo(
    () => Object.values(branchPullStatusLoading).some(Boolean),
    [branchPullStatusLoading],
  );
  const isControllerActionRunning =
    data.operationBusy ||
    isCommitMessageGenerating ||
    data.loadingCommits ||
    data.loadingMoreCommits ||
    data.loadingCommitDetail ||
    data.loadingBranchDiffDetail ||
    data.loadingWorkingTreeDiffDetail ||
    data.loadingConflictFileDetail ||
    data.loadingStashDiffDetail ||
    branchPullStatusBusy;
  const controllerActivityMessage = getControllerActivityMessage(controllerActivityTone);

  const clearControllerActivityResetTimeout = useCallback((): void => {
    if (controllerActivityResetTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(controllerActivityResetTimeoutRef.current);
    controllerActivityResetTimeoutRef.current = null;
  }, []);

  const scheduleControllerActivityIdle = useCallback(
    (delayMs: number): void => {
      clearControllerActivityResetTimeout();
      controllerActivityResetTimeoutRef.current = window.setTimeout(() => {
        controllerActivityResetTimeoutRef.current = null;
        setControllerActivityTone("idle");
      }, delayMs);
    },
    [clearControllerActivityResetTimeout],
  );

  const flashControllerActivity = useCallback(
    (tone: Exclude<ControllerActivityTone, "idle" | "running">): void => {
      clearControllerActivityResetTimeout();
      setControllerActivityTone(tone);
      scheduleControllerActivityIdle(
        tone === "error"
          ? CONTROLLER_ACTIVITY_ERROR_DURATION_MS
          : CONTROLLER_ACTIVITY_SUCCESS_DURATION_MS,
      );
    },
    [clearControllerActivityResetTimeout, scheduleControllerActivityIdle],
  );

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

  useEffect(() => {
    return () => {
      clearControllerActivityResetTimeout();
    };
  }, [clearControllerActivityResetTimeout]);

  useEffect(() => {
    const nextErrorKey = data.inlineError
      ? `${data.inlineError.title}\u0000${data.inlineError.detail}`
      : null;

    if (nextErrorKey && nextErrorKey !== controllerActivityPreviousErrorKeyRef.current) {
      controllerActivityErrorVersionRef.current += 1;
      if (!isControllerActionRunning) {
        flashControllerActivity("error");
      }
    }

    controllerActivityPreviousErrorKeyRef.current = nextErrorKey;
  }, [data.inlineError, flashControllerActivity, isControllerActionRunning]);

  useEffect(() => {
    const wasRunning = controllerActivityWasRunningRef.current;

    if (isControllerActionRunning) {
      if (!wasRunning) {
        controllerActivityRunningBaselineErrorVersionRef.current =
          controllerActivityErrorVersionRef.current;
      }

      clearControllerActivityResetTimeout();
      setControllerActivityTone("running");
    } else if (wasRunning) {
      flashControllerActivity(
        controllerActivityErrorVersionRef.current >
          controllerActivityRunningBaselineErrorVersionRef.current
          ? "error"
          : "success",
      );
    }

    controllerActivityWasRunningRef.current = isControllerActionRunning;
  }, [clearControllerActivityResetTimeout, flashControllerActivity, isControllerActionRunning]);

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

  const handleJumpToCommit = useCallback(
    async (sha: string): Promise<boolean> => {
      const normalizedSha = sha.trim();
      if (!normalizedSha) {
        onNotify("SHA を入力してください。");
        return false;
      }

      try {
        const detail = await api.getCommitDetail(repoPath, normalizedSha);
        const resolvedSha = detail.sha.trim();
        if (!resolvedSha) {
          onNotify("SHA を解決できませんでした。");
          return false;
        }

        setSelectedBranchForHover(null);
        setPendingScrollCommitSha(resolvedSha);
        data.setIsWipSelected(false);
        data.setShowBranchDiff(false);
        data.setFocusedCommitDiffFile(null);

        const result = await data.loadCommits({
          append: false,
          offset: 0,
          ref: data.activeLogRef,
          compareRefs: data.activeCompareRefs,
          focusCommitSha: resolvedSha,
        });

        if (result.status === "focus-miss") {
          setPendingScrollCommitSha((current) => (current === resolvedSha ? null : current));
          onNotify("この SHA は現在の commit graph に見つかりませんでした。");
          return false;
        }

        if (result.status === "error") {
          setPendingScrollCommitSha((current) => (current === resolvedSha ? null : current));
          return false;
        }

        onNotify(`${shortSha(resolvedSha)} に移動しました。`);
        return true;
      } catch (error) {
        data.reportError(error, "SHA の解決に失敗しました。");
        return false;
      }
    },
    [data, onNotify, repoPath],
  );

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

  const copyInlineError = useCallback(async (): Promise<void> => {
    if (!data.inlineError) {
      return;
    }

    try {
      await copyTextToClipboard(formatUiErrorForClipboard(data.inlineError));
      onNotify("エラー内容をコピーしました。");
    } catch (error) {
      reportError(error, "エラー内容をコピーできませんでした。");
    }
  }, [data.inlineError, onNotify, reportError]);

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

  const togglePanelVisibility = useCallback((panelId: ControllerPanelId): void => {
    setLayoutPickerOpen(false);
    setPanelVisibility((current) => toggleControllerPanelVisibility(current, panelId));
  }, []);

  const pullBranch = useCallback(
    (branch: Branch): void => {
      if (branch.type !== "local") {
        return;
      }

      const isCurrentBranch = data.currentLocalBranch?.name === branch.name;

      if (
        isCurrentBranch &&
        data.selfMutationBlockedReason &&
        typeof window !== "undefined" &&
        !window.confirm(getSelfPullConfirmationMessage())
      ) {
        return;
      }

      data.setOperationBusy(true);
      void (async () => {
        try {
          await api.pull(repoPath, branch.name);
          data.setInlineError(null);
          await data.refreshAll();
          onNotify(
            isCurrentBranch
              ? "upstream の変更を取り込みました。"
              : `${branch.name} に upstream の変更を取り込みました。`,
          );
        } catch (error) {
          reportError(error, "pull に失敗しました。");
        } finally {
          data.setOperationBusy(false);
        }
      })();
    },
    [data, onNotify, repoPath, reportError],
  );

  const pullCurrentBranch = useCallback((): void => {
    if (!data.currentLocalBranch) {
      return;
    }

    pullBranch(data.currentLocalBranch);
  }, [data.currentLocalBranch, pullBranch]);

  const loadBranchPullStatus = useCallback(
    async (branch: Branch): Promise<PullStatus | null> => {
      if (branch.type !== "local") {
        return null;
      }

      if (data.pullStatus?.branchName === branch.name) {
        return data.pullStatus;
      }

      try {
        return await api.getPullStatus(repoPath, branch.name);
      } catch (error) {
        reportError(error, "pull 状態の取得に失敗しました。");
        return null;
      }
    },
    [data.pullStatus, repoPath, reportError],
  );

  useEffect(() => {
    const localBranches = data.branches?.local ?? [];
    if (localBranches.length === 0) {
      setBranchPullStatuses({});
      setBranchPullStatusLoading({});
      return;
    }

    let isMounted = true;
    const currentPullStatus = data.pullStatus;
    const branchNames = new Set(localBranches.map((branch) => branch.name));

    setBranchPullStatuses((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([branchName]) => branchNames.has(branchName)),
      );

      if (currentPullStatus?.branchName) {
        next[currentPullStatus.branchName] = currentPullStatus;
      }

      return next;
    });

    setBranchPullStatusLoading(
      Object.fromEntries(
        localBranches.map((branch) => [branch.name, currentPullStatus?.branchName !== branch.name]),
      ),
    );

    void Promise.all(
      localBranches.map(async (branch) => {
        if (currentPullStatus?.branchName === branch.name) {
          return [branch.name, currentPullStatus] as const;
        }

        try {
          return [branch.name, await api.getPullStatus(repoPath, branch.name)] as const;
        } catch {
          return [branch.name, null] as const;
        }
      }),
    ).then((entries) => {
      if (!isMounted) {
        return;
      }

      setBranchPullStatuses(Object.fromEntries(entries));
      setBranchPullStatusLoading(
        Object.fromEntries(entries.map(([branchName]) => [branchName, false])),
      );
    });

    return () => {
      isMounted = false;
    };
  }, [data.branches, data.pullStatus, repoPath]);

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
  const handleExecuteCommandPaletteCommand = useCallback((commandId: string): void => {
    setRecentCommandPaletteItemIds((current) =>
      updateRecentCommandPaletteItemIds(current, commandId),
    );
  }, []);

  const appCommandPaletteCommands = useMemo<CommandPaletteCommand[]>(
    () =>
      buildAppCommandPaletteActionSpecs(appThemeId).map((command) => {
        if (command.action === "openConfig") {
          return {
            id: command.id,
            title: command.title,
            description: command.description,
            keywords: command.keywords,
            disabledReason: command.disabledReason,
            icon: Cog,
            onSelect: () => {
              onOpenConfig?.();
            },
          };
        }

        return {
          id: command.id,
          title: command.title,
          description: command.description,
          keywords: command.keywords,
          disabledReason: command.disabledReason,
          icon: getAppThemeMode(command.themeId) === "light" ? Sun : Moon,
          onSelect: () => {
            onSelectTheme?.(command.themeId);
          },
        };
      }),
    [appThemeId, onOpenConfig, onSelectTheme],
  );
  const layoutCommandPaletteCommands = useMemo<CommandPaletteCommand[]>(
    () =>
      buildControllerPanelToggleCommandSpecs(panelVisibility).map((command) => ({
        id: command.id,
        title: command.title,
        description: command.description,
        keywords: command.keywords,
        icon: Eye,
        onSelect: () => {
          togglePanelVisibility(command.panelId);
        },
      })),
    [panelVisibility, togglePanelVisibility],
  );

  const baseCommandPaletteCommands = useMemo<CommandPaletteCommand[]>(
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
        disabledReason: getPullCommandDisabledReason(
          data.operationBusy,
          data.currentLocalBranch,
          data.pullStatus,
        ),
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
      ...layoutCommandPaletteCommands,
      ...appCommandPaletteCommands,
    ],
    [
      appCommandPaletteCommands,
      checkedOutBranchName,
      copyCurrentBranchName,
      data.currentLocalBranch,
      data.operationBusy,
      data.pullStatus,
      layoutCommandPaletteCommands,
      openCreateBranchDialog,
      openRepositoryGithubPage,
      pullCurrentBranch,
      pushCurrentBranch,
      repository.name,
      repositoryGithubUrl,
    ],
  );
  const commandPaletteCommands = useMemo<CommandPaletteCommand[]>(
    () => sortCommandPaletteItemsByRecency(baseCommandPaletteCommands, recentCommandPaletteItemIds),
    [baseCommandPaletteCommands, recentCommandPaletteItemIds],
  );

  useEffect(() => {
    if (generatingCommitMessage) {
      setCommitMessageAnimationPending(false);
    }
  }, [generatingCommitMessage]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(
        getBranchTreeCollapsedStorageKey(repoPath),
        isBranchTreeCollapsed ? "1" : "0",
      );
    } catch {
      // Ignore storage failures and keep the in-memory state.
    }
  }, [isBranchTreeCollapsed, repoPath]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(
        CONTROLLER_PANEL_VISIBILITY_STORAGE_KEY,
        JSON.stringify(panelVisibility),
      );
    } catch {
      // Ignore storage failures and keep the in-memory state.
    }
  }, [panelVisibility]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(
        COMMAND_PALETTE_RECENT_ITEM_IDS_STORAGE_KEY,
        JSON.stringify(recentCommandPaletteItemIds),
      );
    } catch {
      // Ignore storage failures and keep the in-memory order.
    }
  }, [recentCommandPaletteItemIds]);

  useEffect(() => {
    if (active) {
      return;
    }

    setLayoutPickerOpen(false);
  }, [active]);

  useEffect(() => {
    if (!active || assistantRefreshRequestId === 0) {
      return;
    }

    void refreshAll();
  }, [active, assistantRefreshRequestId, refreshAll]);

  useEffect(() => {
    if (!active) {
      lastHandledAssistantConflictOpenRequestIdRef.current =
        assistantConflictOpenRequest?.requestId ?? 0;
      return;
    }

    if (!assistantConflictOpenRequest) {
      return;
    }

    if (
      assistantConflictOpenRequest.requestId ===
      lastHandledAssistantConflictOpenRequestIdRef.current
    ) {
      return;
    }

    lastHandledAssistantConflictOpenRequestIdRef.current = assistantConflictOpenRequest.requestId;

    void (async () => {
      try {
        await loadWorkingState();
        await openConflictViewer({
          summary: assistantConflictOpenRequest.summary,
          file: assistantConflictOpenRequest.file,
          sessionId: assistantConflictOpenRequest.sessionId,
        });
      } catch (error) {
        reportConflictViewerError(error, "conflict viewer の起動に失敗しました。");
      }
    })();
  }, [
    active,
    assistantConflictOpenRequest,
    loadWorkingState,
    openConflictViewer,
    reportConflictViewerError,
  ]);

  useEffect(() => {
    if (!isLayoutPickerOpen || typeof window === "undefined") {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node) || layoutPickerRef.current?.contains(target)) {
        return;
      }

      setLayoutPickerOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }

      setLayoutPickerOpen(false);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isLayoutPickerOpen]);

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
  const stashableWorkingTreeFileCount =
    (data.workingStatus?.staged.length ?? 0) + (data.workingStatus?.unstaged.length ?? 0);
  const hasConflictedFiles = (data.workingStatus?.conflicted.length ?? 0) > 0;
  const stashAllDisabledReason = data.operationBusy
    ? "Git 操作の完了を待ってから実行してください。"
    : hasConflictedFiles
      ? "競合中のファイルがあるため、全変更を stash できません。"
      : stashableWorkingTreeFileCount > 0
        ? null
        : "staged / unstaged changes があるときだけ使えます。";
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
      graphStyle={data.commitGraphStyle}
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
      onJumpToCommit={handleJumpToCommit}
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

  const stashAllWorkingTreeChanges = (): void => {
    void data.mutateWorkingState(async () => {
      await api.stashAllChanges(repoPath);
    });
  };

  const commitActionDisabled =
    data.operationBusy ||
    (data.workingStatus?.staged.length ?? 0) === 0 ||
    !data.commitTitle.trim();

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
        void data.mutateWorkingState(async () => {
          await api.stageFile(repoPath, file);
        });
      }}
      onUnstageFile={(file) => {
        void data.mutateWorkingState(async () => {
          await api.unstageFile(repoPath, file);
        });
      }}
      onStageFiles={(files) => {
        void data.mutateWorkingState(async () => {
          for (const file of files) {
            await api.stageFile(repoPath, file);
          }
        });
      }}
      onUnstageFiles={(files) => {
        void data.mutateWorkingState(async () => {
          for (const file of files) {
            await api.unstageFile(repoPath, file);
          }
        });
      }}
      onStageAll={() => {
        void data.mutateWorkingState(async () => {
          const files = data.workingStatus?.unstaged.map((item) => item.file) ?? [];
          for (const file of files) {
            await api.stageFile(repoPath, file);
          }
        });
      }}
      onUnstageAll={() => {
        void data.mutateWorkingState(async () => {
          const files = data.workingStatus?.staged.map((item) => item.file) ?? [];
          for (const file of files) {
            await api.unstageFile(repoPath, file);
          }
        });
      }}
      onStashFile={(file) => {
        void data.mutateWorkingState(async () => {
          await api.stashFile(repoPath, file);
        });
      }}
      onStashFiles={(files) => {
        void data.mutateWorkingState(async () => {
          await stashFilesAsSingleEntry(repoPath, files, api);
        });
      }}
      onDiscardFileRequest={(item, source) => {
        const target = resolveWorkingTreeDiscardTarget(item, source);
        if (!target) {
          return;
        }

        if (!window.confirm(getWorkingTreeDiscardConfirmMessage(target))) {
          return;
        }

        void data.mutateWorkingState(async () => {
          await api.discardFile(repoPath, target.file);
        });
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
            disabled={Boolean(stashAllDisabledReason)}
            title={stashAllDisabledReason ?? "staged / unstaged changes をまとめて stash します。"}
            onClick={stashAllWorkingTreeChanges}
          >
            <Archive size={16} aria-hidden="true" />
            <span>Stash</span>
          </button>
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
  const visiblePanelOrder = useMemo(
    () => getVisibleControllerPanelOrder(panelOrder, panelVisibility),
    [panelOrder, panelVisibility],
  );
  const visiblePanelCount = visiblePanelOrder.length;
  const panelGridVisibilityClass =
    visiblePanelCount <= 1
      ? "controller-panels-grid--1"
      : visiblePanelCount === 2
        ? "controller-panels-grid--2"
        : "";
  const layoutPicker = (
    <details
      ref={layoutPickerRef}
      className="controller-layout-picker"
      open={isLayoutPickerOpen}
      onToggle={(event) => {
        setLayoutPickerOpen(event.currentTarget.open);
      }}
    >
      <summary
        className="controller-layout-picker__trigger"
        aria-haspopup="menu"
        aria-expanded={isLayoutPickerOpen}
      >
        <PanelsTopLeft size={16} className="controller-layout-picker__icon" aria-hidden="true" />
        <span className="controller-layout-picker__content">
          <span className="controller-layout-picker__label app-toolbar-disclosure__label">
            Layout
          </span>
          <span className="controller-layout-picker__summary">
            {visiblePanelCount}/{DEFAULT_CONTROLLER_PANEL_ORDER.length}
          </span>
        </span>
      </summary>
      <div className="controller-layout-picker__menu">
        <div className="controller-layout-picker__menu-title">Visible Panels</div>
        {panelOrder.map((panelId) => (
          <label key={panelId} className="controller-layout-picker__option">
            <input
              type="checkbox"
              className="controller-layout-picker__checkbox"
              checked={panelVisibility[panelId]}
              onChange={() => togglePanelVisibility(panelId)}
            />
            <span className="controller-layout-picker__option-label">
              {controllerPanelLabels[panelId]}
            </span>
          </label>
        ))}
        <div className="controller-layout-picker__hint">
          Checked panels stay visible after restart.
        </div>
      </div>
    </details>
  );
  const shouldRenderLayoutPickerInline =
    layoutPickerPortalContainer === undefined || typeof document === "undefined";

  // --- Render ---

  return (
    <section className="controller-view relative flex h-full flex-col gap-3">
      <div
        className={`controller-activity-glow controller-activity-glow--${controllerActivityTone}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="sr-only">{controllerActivityMessage}</span>
      </div>

      {data.inlineError ? (
        <ControllerInlineErrorAlert
          error={data.inlineError}
          onCopy={() => {
            void copyInlineError();
          }}
          onClose={() => data.setInlineError(null)}
        />
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

      <div
        className={`controller-view__layout grid min-h-0 flex-1 grid-cols-[minmax(236px,280px)_minmax(0,1fr)] gap-3 max-[1320px]:grid-cols-[minmax(220px,248px)_minmax(0,1fr)] max-[1100px]:grid-cols-1 ${
          isBranchTreeCollapsed ? "controller-view__layout--branch-tree-collapsed" : ""
        }`}
      >
        <BranchTree
          branches={data.branches}
          branchPullRequests={data.branchPullRequests}
          branchPullStatuses={branchPullStatuses}
          branchPullStatusLoading={branchPullStatusLoading}
          stashes={data.stashes}
          collapsed={isBranchTreeCollapsed}
          selectedBranchName={data.branches?.current ?? null}
          stashMutationBlockedReason={stashMutationBlockedReason}
          busy={data.operationBusy}
          onToggleCollapsed={() => setBranchTreeCollapsed((current) => !current)}
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
          loadBranchPullStatus={loadBranchPullStatus}
          onRequestPullBranch={pullBranch}
        />

        <div className="controller-panels-column">
          {active && layoutPickerPortalContainer ? (
            createPortal(layoutPicker, layoutPickerPortalContainer)
          ) : shouldRenderLayoutPickerInline ? (
            <div className="controller-panels-toolbar">{layoutPicker}</div>
          ) : null}

          {visiblePanelCount > 0 ? (
            <div className={`controller-panels-grid ${panelGridVisibilityClass}`.trim()}>
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
                    className={[
                      "controller-panel-slot min-h-0",
                      isDropCandidate ? "is-drop-candidate" : null,
                      isDropTarget ? "is-drop-target" : null,
                      isDragSource ? "is-drag-source" : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onPointerDown={(event) => handlePanelPointerDown(event, panelId)}
                  >
                    <div className="controller-panel-slot__content">
                      {panelContentById[panelId]}
                    </div>

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
          ) : (
            <div className="panel controller-panels-empty">
              <div className="controller-panels-empty__title">No panels selected</div>
              <div className="controller-panels-empty__hint">
                Open Layout and check the panels you want to show.
              </div>
            </div>
          )}
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

      <ControllerCommandPaletteHost
        active={active}
        commands={commandPaletteCommands}
        onBeforeOpen={() => {
          setLayoutPickerOpen(false);
        }}
        onExecuteCommand={handleExecuteCommandPaletteCommand}
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
