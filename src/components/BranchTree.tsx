import { ChevronDown, ChevronRight, Folder, GitBranch } from 'lucide-react';
import { type DragEvent, useEffect, useMemo, useRef, useState } from 'react';

import {
  type BranchDragPayload,
  canDropBranchOnBranch,
  readBranchDragPayload,
  writeBranchDragPayload
} from '../lib/branchDragDrop';
import type { Branch, BranchResponse } from '../types';

interface BranchTreeProps {
  branches: BranchResponse | null;
  selectedBranchName: string | null;
  busy: boolean;
  onSelectBranch: (branch: Branch) => void;
  onCheckoutBranch: (branch: Branch) => void;
  onBranchDrop: (sourceBranch: Branch, targetBranch: Branch) => void;
}

interface TreeNode {
  children: Map<string, TreeNode>;
  leaves: Array<{ branch: Branch; displayName: string }>;
}

const SINGLE_CLICK_DELAY_MS = 400;

function buildTree(items: Branch[]): TreeNode {
  const root: TreeNode = {
    children: new Map<string, TreeNode>(),
    leaves: []
  };

  for (const branch of items) {
    const parts = branch.name.split('/').filter(Boolean);
    if (parts.length <= 1) {
      root.leaves.push({
        branch,
        displayName: branch.name
      });
      continue;
    }

    let currentNode = root;

    for (let index = 0; index < parts.length - 1; index += 1) {
      const segment = parts[index];
      const nextNode = currentNode.children.get(segment);

      if (nextNode) {
        currentNode = nextNode;
      } else {
        const created: TreeNode = {
          children: new Map<string, TreeNode>(),
          leaves: []
        };
        currentNode.children.set(segment, created);
        currentNode = created;
      }
    }

    currentNode.leaves.push({
      branch,
      displayName: parts[parts.length - 1]
    });
  }

  return root;
}

function SectionTitle({ children }: { children: string }): JSX.Element {
  return (
    <div className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
      {children}
    </div>
  );
}

export function BranchTree({
  branches,
  selectedBranchName,
  busy,
  onSelectBranch,
  onCheckoutBranch,
  onBranchDrop
}: BranchTreeProps): JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [draggedBranchName, setDraggedBranchName] = useState<string | null>(null);
  const [dropTargetBranchName, setDropTargetBranchName] = useState<string | null>(null);
  const draggedPayloadRef = useRef<BranchDragPayload | null>(null);
  const pendingClickRef = useRef<{
    branchName: string;
    timeoutId: ReturnType<typeof globalThis.setTimeout>;
  } | null>(null);

  const localTree = useMemo(() => buildTree(branches?.local ?? []), [branches]);
  const remoteTree = useMemo(() => buildTree(branches?.remote ?? []), [branches]);
  const localBranchMap = useMemo(
    () => new Map((branches?.local ?? []).map((branch) => [branch.name, branch])),
    [branches]
  );

  useEffect(() => {
    return () => {
      if (pendingClickRef.current) {
        globalThis.clearTimeout(pendingClickRef.current.timeoutId);
      }
    };
  }, []);

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

  const handleBranchClick = (branch: Branch): void => {
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
      }, SINGLE_CLICK_DELAY_MS)
    };
  };

  const handleBranchDoubleClick = (branch: Branch): void => {
    if (pendingClickRef.current) {
      globalThis.clearTimeout(pendingClickRef.current.timeoutId);
      pendingClickRef.current = null;
    }

    onCheckoutBranch(branch);
  };

  const handleBranchDragStart = (event: DragEvent<HTMLButtonElement>, branch: Branch): void => {
    if (busy || branch.type !== 'local') {
      event.preventDefault();
      return;
    }

    const payload: BranchDragPayload = {
      branchName: branch.name,
      branchType: branch.type
    };
    writeBranchDragPayload(event.dataTransfer, payload);
    draggedPayloadRef.current = payload;
    setDraggedBranchName(branch.name);
  };

  const handleBranchDragEnd = (): void => {
    draggedPayloadRef.current = null;
    setDraggedBranchName(null);
    setDropTargetBranchName(null);
  };

  const handleBranchDragOver = (event: DragEvent<HTMLButtonElement>, branch: Branch): void => {
    const payload = draggedPayloadRef.current ?? readBranchDragPayload(event.dataTransfer);
    const canDrop = canDropBranchOnBranch({
      busy,
      source: payload,
      target: branch
    });

    if (!canDrop) {
      if (dropTargetBranchName === branch.name) {
        setDropTargetBranchName(null);
      }
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetBranchName(branch.name);
  };

  const handleBranchDrop = (event: DragEvent<HTMLButtonElement>, targetBranch: Branch): void => {
    event.preventDefault();
    setDropTargetBranchName(null);
    setDraggedBranchName(null);

    const payload = draggedPayloadRef.current ?? readBranchDragPayload(event.dataTransfer);
    draggedPayloadRef.current = null;
    const canDrop = canDropBranchOnBranch({
      busy,
      source: payload,
      target: targetBranch
    });

    if (!canDrop || !payload) {
      return;
    }

    const sourceBranch = localBranchMap.get(payload.branchName);
    if (!sourceBranch) {
      return;
    }

    onBranchDrop(sourceBranch, targetBranch);
  };

  const renderNode = (node: TreeNode, prefix: string, depth: number): JSX.Element => {
    const children = [...node.children.entries()].sort(([left], [right]) => left.localeCompare(right));
    const leaves = [...node.leaves].sort((left, right) =>
      left.displayName.localeCompare(right.displayName)
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
          const isLocalBranch = leaf.branch.type === 'local';
          const isDropTarget = dropTargetBranchName === leaf.branch.name;
          const isDragSource = draggedBranchName === leaf.branch.name;
          return (
            <button
              key={`${prefix}/${leaf.branch.name}`}
              type="button"
              draggable={isLocalBranch && !busy}
              style={{ paddingLeft: `${depth * 12 + 28}px` }}
              className={`list-item w-full text-left ${isCurrent ? 'active' : ''} ${isDropTarget ? 'is-drop-target' : ''} ${isDragSource ? 'is-drag-source' : ''}`}
              onClick={() => handleBranchClick(leaf.branch)}
              onDoubleClick={() => handleBranchDoubleClick(leaf.branch)}
              onDragStart={(event) => handleBranchDragStart(event, leaf.branch)}
              onDragEnd={handleBranchDragEnd}
              onDragOver={(event) => {
                if (isLocalBranch) {
                  handleBranchDragOver(event, leaf.branch);
                }
              }}
              onDragLeave={() => {
                if (dropTargetBranchName === leaf.branch.name) {
                  setDropTargetBranchName(null);
                }
              }}
              onDrop={(event) => {
                if (isLocalBranch) {
                  handleBranchDrop(event, leaf.branch);
                }
              }}
            >
              <GitBranch size={13} />
              <span className="truncate text-[13px] font-medium">{leaf.displayName}</span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <section className="panel flex min-h-0 flex-col p-3">
      <div className="section-title px-2 pb-2">Branch List</div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SectionTitle>Local</SectionTitle>
        <div className="mt-1">{renderNode(localTree, 'local', 0)}</div>

        <SectionTitle>Remote</SectionTitle>
        <div className="mt-1">{renderNode(remoteTree, 'remote', 0)}</div>
      </div>
    </section>
  );
}
