import {
  Archive,
  AlertTriangle,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  Cloud,
  Download,
  ExternalLink,
  Folder,
  GitBranch,
  HardDrive,
  PanelLeftClose,
  PanelLeftOpen,
  PackageOpen,
  Plus,
  Trash2,
} from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import { createPortal } from "react-dom";

import { getBranchDeleteDisabledReason } from "../lib/branchDelete";
import { canDropBranchOnBranch } from "../lib/branchDragDrop";
import { getBranchPullDisabledReason, shouldShowBranchPullAction } from "../lib/pullCommand";
import type { Branch, BranchPullRequest, BranchResponse, PullStatus, StashEntry } from "../types";

import {
  buildTree,
  clampContextMenuPosition,
  getBranchDisplayName,
  getContextMenuHeight,
  getStashMetaLabel,
  getStashPrimaryLabel,
  SectionTitle,
  STASH_CONTEXT_MENU_HEIGHT_PX,
  type TreeNode,
} from "./BranchTreeHelpers";

interface BranchTreeProps {
  branches: BranchResponse | null;
  branchPullRequests: Record<string, BranchPullRequest>;
  branchPullStatuses: Record<string, PullStatus | null>;
  branchPullStatusLoading: Record<string, boolean>;
  stashes: StashEntry[];
  collapsed: boolean;
  selectedBranchName: string | null;
  stashMutationBlockedReason: string | null;
  busy: boolean;
  onToggleCollapsed: () => void;
  onSelectBranch: (branch: Branch) => void;
  onCheckoutBranch: (branch: Branch) => void;
  onBranchDrop: (sourceBranch: Branch, targetBranch: Branch) => void;
  onOpenStashDiff: (stash: StashEntry) => void;
  onRequestRenameStash: (stash: StashEntry) => void;
  onRequestDeleteStash: (stash: StashEntry) => void;
  onRequestApplyStash: (stash: StashEntry) => void;
  onRequestPopStash: (stash: StashEntry) => void;
  onOpenBranchPullRequest: (branch: Branch) => void;
  onRequestCreateBranch: (branch: Branch) => void;
  onRequestDeleteBranch: (branch: Branch) => void;
  loadBranchPullStatus: (branch: Branch) => Promise<PullStatus | null>;
  onRequestPullBranch: (branch: Branch) => void;
}

const SINGLE_CLICK_DELAY_MS = 0;
const DRAG_THRESHOLD_PX = 6;

function isRemoteHeadAlias(branch: Branch): boolean {
  return (
    branch.type === "remote" &&
    (branch.name.endsWith("/HEAD") || branch.fullRef.endsWith("/HEAD"))
  );
}

export function BranchTree({
  branches,
  branchPullRequests,
  branchPullStatuses,
  branchPullStatusLoading,
  stashes,
  collapsed,
  selectedBranchName,
  stashMutationBlockedReason,
  busy,
  onToggleCollapsed,
  onSelectBranch,
  onCheckoutBranch,
  onBranchDrop,
  onOpenStashDiff,
  onRequestRenameStash,
  onRequestDeleteStash,
  onRequestApplyStash,
  onRequestPopStash,
  onOpenBranchPullRequest,
  onRequestCreateBranch,
  onRequestDeleteBranch,
  loadBranchPullStatus,
  onRequestPullBranch,
}: BranchTreeProps): JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [isStashesExpanded, setIsStashesExpanded] = useState(true);
  const [draggedBranchName, setDraggedBranchName] = useState<string | null>(null);
  const [dropTargetBranchName, setDropTargetBranchName] = useState<string | null>(null);
  const [dragPreviewPosition, setDragPreviewPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [contextMenu, setContextMenu] = useState<
    | {
        kind: "branch";
        branch: Branch;
        x: number;
        y: number;
        disabledReason: string | null;
        pullStatus: PullStatus | null;
        pullStatusLoading: boolean;
      }
    | {
        kind: "stash";
        stash: StashEntry;
        x: number;
        y: number;
      }
    | null
  >(null);
  const draggedBranchNameRef = useRef<string | null>(null);
  const dropTargetBranchNameRef = useRef<string | null>(null);
  const dragPointerRef = useRef<{
    branchName: string;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressClickUntilRef = useRef(0);
  const pendingClickRef = useRef<{
    branchName: string;
    timeoutId: ReturnType<typeof globalThis.setTimeout>;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  const visibleRemoteBranches = useMemo(
    () => (branches?.remote ?? []).filter((branch) => !isRemoteHeadAlias(branch)),
    [branches],
  );
  const localTree = useMemo(() => buildTree(branches?.local ?? []), [branches]);
  const remoteTree = useMemo(() => buildTree(visibleRemoteBranches), [visibleRemoteBranches]);
  const localBranchMap = useMemo(
    () => new Map((branches?.local ?? []).map((branch) => [branch.name, branch])),
    [branches],
  );

  const updateDraggedBranchName = (value: string | null): void => {
    draggedBranchNameRef.current = value;
    setDraggedBranchName(value);
  };

  const updateDropTargetBranchName = (value: string | null): void => {
    dropTargetBranchNameRef.current = value;
    setDropTargetBranchName(value);
  };

  const clearDragState = (): void => {
    dragPointerRef.current = null;
    updateDraggedBranchName(null);
    updateDropTargetBranchName(null);
    setDragPreviewPosition(null);
  };

  useEffect(() => {
    return () => {
      if (pendingClickRef.current) {
        globalThis.clearTimeout(pendingClickRef.current.timeoutId);
      }
    };
  }, []);

  useEffect(() => {
    if (!collapsed) {
      return;
    }

    if (pendingClickRef.current) {
      globalThis.clearTimeout(pendingClickRef.current.timeoutId);
      pendingClickRef.current = null;
    }

    setContextMenu(null);
    clearDragState();
  }, [collapsed]);

  useEffect(() => {
    if (busy) {
      dragPointerRef.current = null;
      clearDragState();
      setContextMenu(null);
    }
  }, [busy]);

  useEffect(() => {
    setContextMenu(null);
    clearDragState();
  }, [branches, selectedBranchName, stashes]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    document.body.classList.toggle("is-branch-dragging", Boolean(draggedBranchName));
    return () => {
      document.body.classList.remove("is-branch-dragging");
    };
  }, [draggedBranchName]);

  const handleBranchClick = (branch: Branch): void => {
    if (Date.now() < suppressClickUntilRef.current) {
      return;
    }

    setContextMenu(null);

    if (pendingClickRef.current) {
      globalThis.clearTimeout(pendingClickRef.current.timeoutId);
    }

    pendingClickRef.current = {
      branchName: branch.name,
      timeoutId: globalThis.setTimeout(() => {
        if (pendingClickRef.current?.branchName === branch.name) {
          pendingClickRef.current = null;
        }
        onSelectBranch(branch);
      }, SINGLE_CLICK_DELAY_MS),
    };
  };

  const handleBranchDoubleClick = (branch: Branch): void => {
    if (Date.now() < suppressClickUntilRef.current) {
      return;
    }

    setContextMenu(null);

    if (pendingClickRef.current) {
      globalThis.clearTimeout(pendingClickRef.current.timeoutId);
      pendingClickRef.current = null;
    }

    onCheckoutBranch(branch);
  };

  const toggle = (key: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent): void => {
      const dragPointer = dragPointerRef.current;
      if (!dragPointer || dragPointer.pointerId !== event.pointerId) {
        return;
      }

      const offsetX = event.clientX - dragPointer.startX;
      const offsetY = event.clientY - dragPointer.startY;
      const distance = Math.hypot(offsetX, offsetY);

      if (!draggedBranchNameRef.current && distance < DRAG_THRESHOLD_PX) {
        return;
      }

      if (!draggedBranchNameRef.current) {
        if (pendingClickRef.current?.branchName === dragPointer.branchName) {
          globalThis.clearTimeout(pendingClickRef.current.timeoutId);
          pendingClickRef.current = null;
        }
        setContextMenu(null);
        updateDraggedBranchName(dragPointer.branchName);
      }

      setDragPreviewPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const element = document.elementFromPoint(event.clientX, event.clientY);
      const targetName =
        element?.closest<HTMLElement>("[data-branch-drop-name]")?.dataset.branchDropName ?? null;
      const targetBranch = targetName ? (localBranchMap.get(targetName) ?? null) : null;

      if (
        targetBranch &&
        canDropBranchOnBranch({
          busy,
          source: { branchName: dragPointer.branchName, branchType: "local" },
          target: targetBranch,
        })
      ) {
        updateDropTargetBranchName(targetBranch.name);
        return;
      }

      updateDropTargetBranchName(null);
    };

    const handlePointerUp = (event: PointerEvent): void => {
      const dragPointer = dragPointerRef.current;
      if (!dragPointer || dragPointer.pointerId !== event.pointerId) {
        return;
      }

      const sourceBranch = localBranchMap.get(dragPointer.branchName) ?? null;
      const targetBranch = dropTargetBranchNameRef.current
        ? (localBranchMap.get(dropTargetBranchNameRef.current) ?? null)
        : null;
      const didDrag = draggedBranchNameRef.current === dragPointer.branchName;

      if (
        didDrag &&
        sourceBranch &&
        targetBranch &&
        canDropBranchOnBranch({
          busy,
          source: { branchName: sourceBranch.name, branchType: sourceBranch.type },
          target: targetBranch,
        })
      ) {
        onBranchDrop(sourceBranch, targetBranch);
      }

      if (didDrag) {
        suppressClickUntilRef.current = Date.now() + 250;
      }

      clearDragState();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [busy, localBranchMap, onBranchDrop]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && contextMenuRef.current?.contains(target)) {
        return;
      }

      setContextMenu(null);
    };

    const handleClose = (): void => {
      setContextMenu(null);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("resize", handleClose);
    window.addEventListener("scroll", handleClose, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("resize", handleClose);
      window.removeEventListener("scroll", handleClose, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const handleBranchPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    branch: Branch,
  ): void => {
    if (busy) {
      return;
    }

    setContextMenu(null);

    if (branch.type !== "local" || event.button !== 0) {
      return;
    }

    dragPointerRef.current = {
      branchName: branch.name,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  const handleBranchContextMenu = (
    event: ReactMouseEvent<HTMLDivElement>,
    branch: Branch,
  ): void => {
    event.preventDefault();

    if (busy) {
      return;
    }

    if (pendingClickRef.current?.branchName === branch.name) {
      globalThis.clearTimeout(pendingClickRef.current.timeoutId);
      pendingClickRef.current = null;
    }

    const position = clampContextMenuPosition(
      event.clientX,
      event.clientY,
      getContextMenuHeight(branch),
    );
    setContextMenu({
      kind: "branch",
      branch,
      x: position.x,
      y: position.y,
      disabledReason: getBranchDeleteDisabledReason(branch, selectedBranchName),
      pullStatus: branch.type === "local" ? (branchPullStatuses[branch.name] ?? null) : null,
      pullStatusLoading:
        branch.type === "local"
          ? (branchPullStatusLoading[branch.name] ??
            !Object.prototype.hasOwnProperty.call(branchPullStatuses, branch.name))
          : false,
    });

    if (branch.type !== "local") {
      return;
    }

    const hasKnownPullStatus = Object.prototype.hasOwnProperty.call(
      branchPullStatuses,
      branch.name,
    );
    if (hasKnownPullStatus && !branchPullStatusLoading[branch.name]) {
      return;
    }

    void loadBranchPullStatus(branch).then((pullStatus) => {
      setContextMenu((current) => {
        if (
          !current ||
          current.kind !== "branch" ||
          current.branch.name !== branch.name ||
          current.branch.type !== branch.type
        ) {
          return current;
        }

        return {
          ...current,
          pullStatus,
          pullStatusLoading: false,
        };
      });
    });
  };

  const handleStashContextMenu = (
    event: ReactMouseEvent<HTMLButtonElement>,
    stash: StashEntry,
  ): void => {
    event.preventDefault();

    if (busy) {
      return;
    }

    const position = clampContextMenuPosition(
      event.clientX,
      event.clientY,
      STASH_CONTEXT_MENU_HEIGHT_PX,
    );
    setContextMenu({
      kind: "stash",
      stash,
      x: position.x,
      y: position.y,
    });
  };

  const handleDeleteRequestFromTree = (branch: Branch): void => {
    setContextMenu(null);
    onRequestDeleteBranch(branch);
  };

  const handleCreateRequestFromTree = (branch: Branch): void => {
    setContextMenu(null);
    onRequestCreateBranch(branch);
  };

  const handlePullRequestFromTree = (branch: Branch): void => {
    setContextMenu(null);
    onRequestPullBranch(branch);
  };

  const handleRenameStashRequestFromTree = (stash: StashEntry): void => {
    setContextMenu(null);
    onRequestRenameStash(stash);
  };

  const handleApplyStashRequestFromTree = (stash: StashEntry): void => {
    setContextMenu(null);
    onRequestApplyStash(stash);
  };

  const handleDeleteStashRequestFromTree = (stash: StashEntry): void => {
    setContextMenu(null);
    onRequestDeleteStash(stash);
  };

  const handlePopStashRequestFromTree = (stash: StashEntry): void => {
    setContextMenu(null);
    onRequestPopStash(stash);
  };

  const handleStashClick = (stash: StashEntry): void => {
    setContextMenu(null);
    onOpenStashDiff(stash);
  };

  const renderNode = (node: TreeNode, prefix: string, depth: number): JSX.Element => {
    const children = [...node.children.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    );
    const leaves = [...node.leaves].sort((left, right) =>
      left.displayName.localeCompare(right.displayName),
    );

    return (
      <div className="space-y-1">
        {children.map(([name, child]) => {
          const key = `${prefix}/${name}`;
          const isOpen = expanded.has(key);
          return (
            <div key={key}>
              <button
                type="button"
                className="list-item w-full text-left"
                style={{ paddingLeft: `${depth * 12 + 10}px` }}
                onClick={() => toggle(key)}
              >
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Folder size={14} className="text-ink-subtle" />
                <span className="truncate text-[13px] font-medium">{name}</span>
              </button>
              {isOpen ? renderNode(child, key, depth + 1) : null}
            </div>
          );
        })}

        {leaves.map((leaf) => {
          const isCurrent = selectedBranchName === leaf.branch.name;
          const isLocalBranch = leaf.branch.type === "local";
          const branchPullStatus = isLocalBranch
            ? (branchPullStatuses[leaf.branch.name] ?? null)
            : null;
          const branchBehindCount =
            branchPullStatus?.branchName === leaf.branch.name && branchPullStatus.state === "behind"
              ? branchPullStatus.behindCount
              : 0;
          const branchPullRequest = isLocalBranch
            ? (branchPullRequests[leaf.branch.name] ?? null)
            : null;
          const branchPullRequestUrl = branchPullRequest?.url ?? null;
          const branchPullRequestHasConflicts = branchPullRequest?.hasConflicts ?? false;
          const BranchTypeIcon = isLocalBranch ? HardDrive : Cloud;
          const branchTypeIconClass = isLocalBranch
            ? "branch-list-item__icon branch-list-item__icon--local"
            : "branch-list-item__icon branch-list-item__icon--remote";
          const isDragActive = draggedBranchName !== null;
          const isDropTarget = dropTargetBranchName === leaf.branch.name;
          const isDragSource = draggedBranchName === leaf.branch.name;
          const isDropCandidate =
            isDragActive &&
            isLocalBranch &&
            draggedBranchName !== leaf.branch.name &&
            canDropBranchOnBranch({
              busy,
              source: draggedBranchName
                ? { branchName: draggedBranchName, branchType: "local" }
                : null,
              target: leaf.branch,
            });
          const statusLabel = isDropTarget
            ? "Drop to open Merge / PR"
            : isDragSource
              ? "Dragging branch"
              : isDropCandidate
                ? "Drop target"
                : null;
          const draggedDisplayName = draggedBranchName
            ? getBranchDisplayName(draggedBranchName)
            : "";

          return (
            <div
              key={`${prefix}/${leaf.branch.name}`}
              data-branch-drop-name={isLocalBranch ? leaf.branch.name : undefined}
              style={{ paddingLeft: `${depth * 12 + 28}px` }}
              className={`list-item branch-list-item w-full text-left ${isCurrent ? "active" : ""} ${isLocalBranch ? "is-draggable" : ""} ${isDropCandidate ? "is-drop-candidate" : ""} ${isDropTarget ? "is-drop-target is-split-preview" : ""} ${isDragSource ? "is-drag-source" : ""}`}
              onClick={() => handleBranchClick(leaf.branch)}
              onDoubleClick={() => handleBranchDoubleClick(leaf.branch)}
              onPointerDown={(event) => handleBranchPointerDown(event, leaf.branch)}
              onContextMenu={(event) => handleBranchContextMenu(event, leaf.branch)}
            >
              <button
                type="button"
                className="branch-list-item__trigger"
                title={isDropTarget ? undefined : leaf.branch.name}
              >
                {isDropTarget && draggedBranchName ? (
                  <div className="branch-drop-split">
                    <div className="branch-drop-split__pane branch-drop-split__pane--source">
                      <div className="branch-drop-split__eyebrow">From</div>
                      <div className="branch-drop-split__branch" title={draggedBranchName}>
                        <GitBranch size={12} />
                        <span className="truncate">{draggedDisplayName}</span>
                      </div>
                    </div>
                    <div className="branch-drop-split__flow" aria-hidden="true">
                      <span className="branch-drop-split__arrow">→</span>
                    </div>
                    <div className="branch-drop-split__pane branch-drop-split__pane--target">
                      <div className="branch-drop-split__eyebrow">Into</div>
                      <div className="branch-drop-split__branch" title={leaf.branch.name}>
                        <GitBranch size={12} />
                        <span className="truncate">{leaf.displayName}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <BranchTypeIcon size={13} className={branchTypeIconClass} aria-hidden="true" />
                    <div className="branch-list-item__content">
                      <div className="branch-list-item__header">
                        <div className="branch-list-item__title truncate text-[13px] font-medium">
                          {leaf.displayName}
                        </div>
                      </div>
                      {statusLabel ? (
                        <div className="branch-list-item__status">{statusLabel}</div>
                      ) : null}
                    </div>
                  </>
                )}
              </button>

              {!isDropTarget && branchPullRequestUrl ? (
                <div className="branch-list-item__actions">
                  {branchBehindCount > 0 ? (
                    <button
                      type="button"
                      className="branch-list-item__pull-link"
                      aria-label={`${leaf.branch.name} に upstream の ${branchBehindCount} commit を pull`}
                      title={`${branchBehindCount} commit を pull`}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                      }}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRequestPullBranch(leaf.branch);
                      }}
                    >
                      <span className="branch-list-item__pull-count">{branchBehindCount}</span>
                      <ArrowDown size={13} />
                    </button>
                  ) : null}
                  {branchPullRequestHasConflicts ? (
                    <span
                      className="branch-list-item__pr-warning"
                      aria-label={`${leaf.branch.name} の Pull Request は conflict しています`}
                      title="This pull request has conflicts"
                    >
                      <AlertTriangle size={13} />
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className={`branch-list-item__pr-link ${branchPullRequestHasConflicts ? "is-warning" : ""}`}
                    aria-label={`${leaf.branch.name} の Pull Request を開く`}
                    title={branchPullRequestUrl}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenBranchPullRequest(leaf.branch);
                    }}
                  >
                    <ExternalLink size={13} />
                  </button>
                </div>
              ) : !isDropTarget && branchBehindCount > 0 ? (
                <div className="branch-list-item__actions">
                  <button
                    type="button"
                    className="branch-list-item__pull-link"
                    aria-label={`${leaf.branch.name} に upstream の ${branchBehindCount} commit を pull`}
                    title={`${branchBehindCount} commit を pull`}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRequestPullBranch(leaf.branch);
                    }}
                  >
                    <span className="branch-list-item__pull-count">{branchBehindCount}</span>
                    <ArrowDown size={13} />
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  const dragHint = draggedBranchName
    ? dropTargetBranchName
      ? `${dropTargetBranchName} にドロップして Merge / PR を開く`
      : "別の local branch にドロップ"
    : null;
  const hasStashes = stashes.length > 0;
  const collapsedSummaryItems = [
    {
      key: "local",
      label: "Local branches",
      count: branches?.local.length ?? 0,
      Icon: HardDrive,
      iconClassName: "branch-tree__summary-icon branch-tree__summary-icon--local",
    },
    {
      key: "remote",
      label: "Remote branches",
      count: visibleRemoteBranches.length,
      Icon: Cloud,
      iconClassName: "branch-tree__summary-icon branch-tree__summary-icon--remote",
    },
    ...(hasStashes
      ? [
          {
            key: "stash",
            label: "Stashes",
            count: stashes.length,
            Icon: Archive,
            iconClassName: "branch-tree__summary-icon branch-tree__summary-icon--stash",
          },
        ]
      : []),
  ];
  const branchContextMenuPullState =
    contextMenu && contextMenu.kind === "branch"
      ? {
          showPullAction: shouldShowBranchPullAction(
            contextMenu.branch,
            contextMenu.pullStatus,
            contextMenu.pullStatusLoading,
          ),
          pullDisabledReason: getBranchPullDisabledReason(
            busy,
            contextMenu.branch,
            contextMenu.pullStatus,
            contextMenu.pullStatusLoading,
          ),
        }
      : null;

  const contextMenuPortal =
    contextMenu && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={contextMenuRef}
            className="branch-context-menu"
            role="menu"
            aria-label={
              contextMenu.kind === "branch" ? "branch context menu" : "stash context menu"
            }
            style={{
              left: `${contextMenu.x}px`,
              top: `${contextMenu.y}px`,
            }}
          >
            {contextMenu.kind === "branch" ? (
              <>
                {branchContextMenuPullState?.showPullAction ? (
                  <button
                    type="button"
                    role="menuitem"
                    className={`branch-context-menu__item ${branchContextMenuPullState.pullDisabledReason ? "is-disabled" : ""}`}
                    disabled={Boolean(branchContextMenuPullState.pullDisabledReason)}
                    title={branchContextMenuPullState.pullDisabledReason ?? undefined}
                    onClick={() => handlePullRequestFromTree(contextMenu.branch)}
                  >
                    <Download size={14} />
                    <span>Pull</span>
                  </button>
                ) : null}
                {contextMenu.branch.type === "local" ? (
                  <button
                    type="button"
                    role="menuitem"
                    className={`branch-context-menu__item ${busy ? "is-disabled" : ""}`}
                    disabled={busy}
                    onClick={() => handleCreateRequestFromTree(contextMenu.branch)}
                  >
                    <Plus size={14} />
                    <span>このブランチから作成</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  className={`branch-context-menu__item ${contextMenu.disabledReason ? "is-disabled" : "is-danger"}`}
                  disabled={busy || Boolean(contextMenu.disabledReason)}
                  onClick={() => handleDeleteRequestFromTree(contextMenu.branch)}
                >
                  <Trash2 size={14} />
                  <span>ブランチを削除</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className={`branch-context-menu__item ${busy || stashMutationBlockedReason ? "is-disabled" : ""}`}
                  disabled={busy || Boolean(stashMutationBlockedReason)}
                  onClick={() => handleApplyStashRequestFromTree(contextMenu.stash)}
                >
                  <Download size={14} />
                  <span>Apply stash</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={`branch-context-menu__item ${busy || stashMutationBlockedReason ? "is-disabled" : ""}`}
                  disabled={busy || Boolean(stashMutationBlockedReason)}
                  onClick={() => handlePopStashRequestFromTree(contextMenu.stash)}
                >
                  <PackageOpen size={14} />
                  <span>Pop stash</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={`branch-context-menu__item ${busy ? "is-disabled" : ""}`}
                  disabled={busy}
                  onClick={() => handleRenameStashRequestFromTree(contextMenu.stash)}
                >
                  <Archive size={14} />
                  <span>Rename stash</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={`branch-context-menu__item is-danger ${busy ? "is-disabled" : ""}`}
                  disabled={busy}
                  onClick={() => handleDeleteStashRequestFromTree(contextMenu.stash)}
                >
                  <Trash2 size={14} />
                  <span>Delete stash</span>
                </button>
              </>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <section
        className={`panel branch-tree relative flex min-h-0 flex-col p-3 ${draggedBranchName ? "is-dragging" : ""} ${collapsed ? "branch-tree--collapsed" : ""}`}
      >
        {collapsed ? (
          <>
            <button
              type="button"
              className="branch-tree__icon-button branch-tree__icon-button--collapsed"
              aria-label="Expand branch list"
              title="Expand branch list"
              onClick={onToggleCollapsed}
            >
              <PanelLeftOpen size={16} />
            </button>

            <div className="branch-tree__summary" role="list" aria-label="branch list summary">
              {collapsedSummaryItems.map(({ key, label, count, Icon, iconClassName }) => (
                <button
                  key={key}
                  type="button"
                  className="branch-tree__summary-item"
                  aria-label={`Expand branch list. ${label}: ${count}`}
                  title={`${label}: ${count}`}
                  onClick={onToggleCollapsed}
                >
                  <Icon size={16} className={iconClassName} aria-hidden="true" />
                  <span className="branch-tree__summary-count">{count}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="branch-tree__header">
              <div className="branch-tree__header-copy">
                <div className="section-title">Branch List</div>
                {dragHint ? (
                  <div className={`branch-tree__hint ${draggedBranchName ? "is-active" : ""}`}>
                    {dragHint}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="branch-tree__icon-button"
                aria-label="Collapse branch list"
                title="Collapse branch list"
                onClick={onToggleCollapsed}
              >
                <PanelLeftClose size={16} />
              </button>
            </div>

            <div className="branch-tree__body">
              <div className="branch-tree__branch-scroll">
                <SectionTitle>Local</SectionTitle>
                <div className="mt-1">{renderNode(localTree, "local", 0)}</div>

                <SectionTitle>Remote</SectionTitle>
                <div className="mt-1">{renderNode(remoteTree, "remote", 0)}</div>
              </div>

              {hasStashes ? (
                <div className="branch-tree__stash-section border-t border-black/5 pt-3">
                  <button
                    type="button"
                    className="branch-tree__expand-button"
                    aria-expanded={isStashesExpanded}
                    aria-controls="branch-tree-stashes"
                    onClick={() => setIsStashesExpanded((current) => !current)}
                  >
                    <div className="branch-tree__expand-title">
                      {isStashesExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <Archive size={14} className="text-ink-subtle" />
                      <span className="section-title">Stashes</span>
                    </div>
                    <span className="branch-tree__expand-count">{stashes.length}</span>
                  </button>

                  {isStashesExpanded ? (
                    <div
                      id="branch-tree-stashes"
                      className="branch-tree__stash-list"
                      role="list"
                      aria-label="stashes"
                    >
                      {stashes.map((stash) => (
                        <button
                          key={stash.id}
                          type="button"
                          className="branch-tree__stash-item"
                          title={`${getStashPrimaryLabel(stash)} • ${getStashMetaLabel(stash)}`}
                          onClick={() => handleStashClick(stash)}
                          onContextMenu={(event) => handleStashContextMenu(event, stash)}
                          disabled={busy}
                        >
                          <Archive size={13} className="shrink-0 text-ink-subtle" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-medium text-ink">
                              {getStashPrimaryLabel(stash)}
                            </div>
                            <div className="branch-tree__stash-meta truncate">
                              {getStashMetaLabel(stash)}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </>
        )}

        {draggedBranchName && dragPreviewPosition ? (
          <div
            className="branch-drag-preview"
            style={{
              left: `${dragPreviewPosition.x + 18}px`,
              top: `${dragPreviewPosition.y + 18}px`,
            }}
          >
            <div className="branch-drag-preview__title">
              <GitBranch size={13} />
              <span>{draggedBranchName}</span>
            </div>
            <div className="branch-drag-preview__hint">{dragHint}</div>
          </div>
        ) : null}
      </section>
      {contextMenuPortal}
    </>
  );
}
