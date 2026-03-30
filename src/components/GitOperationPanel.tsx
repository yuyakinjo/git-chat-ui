import { GripVertical, Sparkles, UploadCloud } from 'lucide-react';
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { resolveGitOperationPanelColumnCount } from '../lib/controllerPanelLayout';
import {
  canDropWorkingTreeFile,
  getWorkingTreeDropActionLabel,
  getWorkingTreeDropZoneLabel,
  type WorkingTreeDragPayload,
  type WorkingTreeDragSource,
  type WorkingTreeDropZone
} from '../lib/workingTreeDragDrop';
import type { StashEntry, WorkingFile, WorkingTreeDiffArea, WorkingTreeStatus } from '../types';
import { GitFilePathLabel, getWorkingFileStatusPresentation } from './GitFilePresentation';

interface GitOperationPanelProps {
  status: WorkingTreeStatus | null;
  stashes: StashEntry[];
  commitTitle: string;
  commitDescription: string;
  busy: boolean;
  activeWorkingTreeDiff: { file: string; area: WorkingTreeDiffArea } | null;
  onCommitTitleChange: (value: string) => void;
  onCommitDescriptionChange: (value: string) => void;
  onStageFile: (file: string) => void;
  onUnstageFile: (file: string) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onStashFile: (file: string) => void;
  onOpenWorkingTreeDiff: (file: string, area: WorkingTreeDiffArea) => void;
  onGenerateCommitMessage: () => void;
  onCommit: () => void;
  onPush: () => void;
  headerAccessory?: JSX.Element | null;
}

const DRAG_THRESHOLD_PX = 6;
const COMMIT_TITLE_SOFT_LIMIT = 72;

function isWorkingTreeDropZone(value: string | undefined): value is WorkingTreeDropZone {
  return value === 'staged' || value === 'unstaged' || value === 'stash';
}

export function GitOperationPanel({
  status,
  stashes,
  commitTitle,
  commitDescription,
  busy,
  onCommitTitleChange,
  onCommitDescriptionChange,
  onStageFile,
  onUnstageFile,
  onStageAll,
  onUnstageAll,
  onStashFile,
  activeWorkingTreeDiff,
  onOpenWorkingTreeDiff,
  onGenerateCommitMessage,
  onCommit,
  onPush,
  headerAccessory
}: GitOperationPanelProps): JSX.Element {
  const rootRef = useRef<HTMLElement | null>(null);
  const [draggedFile, setDraggedFile] = useState<WorkingTreeDragPayload | null>(null);
  const [dropZone, setDropZone] = useState<WorkingTreeDropZone | null>(null);
  const [dragPreviewPosition, setDragPreviewPosition] = useState<{ x: number; y: number } | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const draggedFileRef = useRef<WorkingTreeDragPayload | null>(null);
  const dropZoneRef = useRef<WorkingTreeDropZone | null>(null);
  const dragPointerRef = useRef<{
    payload: WorkingTreeDragPayload;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);

  const unstaged = status?.unstaged ?? [];
  const staged = status?.staged ?? [];
  const normalizedCommitTitle = commitTitle.replace(/\r?\n/g, ' ');
  const commitTitleLength = Array.from(normalizedCommitTitle.trim()).length;
  const commitTitleOverflowCount = Math.max(0, commitTitleLength - COMMIT_TITLE_SOFT_LIMIT);

  const updateDraggedFile = (value: WorkingTreeDragPayload | null): void => {
    draggedFileRef.current = value;
    setDraggedFile(value);
  };

  const updateDropZone = (value: WorkingTreeDropZone | null): void => {
    dropZoneRef.current = value;
    setDropZone(value);
  };

  const clearDragState = (): void => {
    dragPointerRef.current = null;
    updateDraggedFile(null);
    updateDropZone(null);
    setDragPreviewPosition(null);
  };

  useEffect(() => {
    if (busy) {
      clearDragState();
    }
  }, [busy]);

  useEffect(() => {
    const rootNode = rootRef.current;
    if (!rootNode) {
      return;
    }

    const updateWidth = (): void => {
      setContainerWidth(rootNode.clientWidth);
    };

    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => {
        window.removeEventListener('resize', updateWidth);
      };
    }

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(rootNode);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    clearDragState();
  }, [status, stashes]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.body.classList.toggle('is-working-tree-dragging', Boolean(draggedFile));
    return () => {
      document.body.classList.remove('is-working-tree-dragging');
    };
  }, [draggedFile]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent): void => {
      const dragPointer = dragPointerRef.current;
      if (!dragPointer || dragPointer.pointerId !== event.pointerId) {
        return;
      }

      const offsetX = event.clientX - dragPointer.startX;
      const offsetY = event.clientY - dragPointer.startY;
      const distance = Math.hypot(offsetX, offsetY);

      if (!draggedFileRef.current && distance < DRAG_THRESHOLD_PX) {
        return;
      }

      if (!draggedFileRef.current) {
        updateDraggedFile(dragPointer.payload);
      }

      setDragPreviewPosition({
        x: event.clientX,
        y: event.clientY
      });

      const element = document.elementFromPoint(event.clientX, event.clientY);
      const rawTarget = element?.closest<HTMLElement>('[data-working-tree-drop-zone]')?.dataset.workingTreeDropZone;
      const target = isWorkingTreeDropZone(rawTarget) ? rawTarget : null;

      if (
        target &&
        canDropWorkingTreeFile({
          busy,
          payload: dragPointer.payload,
          target
        })
      ) {
        updateDropZone(target);
        return;
      }

      updateDropZone(null);
    };

    const handlePointerUp = (event: PointerEvent): void => {
      const dragPointer = dragPointerRef.current;
      if (!dragPointer || dragPointer.pointerId !== event.pointerId) {
        return;
      }

      const target = dropZoneRef.current;
      const didDrag =
        draggedFileRef.current?.file === dragPointer.payload.file &&
        draggedFileRef.current?.source === dragPointer.payload.source;

      if (
        didDrag &&
        target &&
        canDropWorkingTreeFile({
          busy,
          payload: dragPointer.payload,
          target
        })
      ) {
        if (target === 'staged') {
          onStageFile(dragPointer.payload.file);
        } else if (target === 'unstaged') {
          onUnstageFile(dragPointer.payload.file);
        } else {
          onStashFile(dragPointer.payload.file);
        }
      }

      clearDragState();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [busy, onStageFile, onStashFile, onUnstageFile]);

  const handleFilePointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    payload: WorkingTreeDragPayload
  ): void => {
    if (busy || event.button !== 0) {
      return;
    }

    const target = event.target;
    if (target instanceof Element && target.closest('[data-working-tree-no-drag="true"]')) {
      return;
    }

    event.preventDefault();
    window.getSelection()?.removeAllRanges();

    dragPointerRef.current = {
      payload,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY
    };
  };

  const renderDropPreview = (target: WorkingTreeDropZone): JSX.Element | null => {
    if (!draggedFile) {
      return null;
    }

    return (
      <div className="working-tree-drop-split">
        <div className="working-tree-drop-split__pane working-tree-drop-split__pane--source">
          <div className="working-tree-drop-split__eyebrow">From</div>
          <div className="working-tree-drop-split__file" title={draggedFile.file}>
            <GripVertical size={12} />
            <GitFilePathLabel path={draggedFile.file} />
          </div>
        </div>
        <div className="working-tree-drop-split__flow" aria-hidden="true">
          <span className="working-tree-drop-split__arrow">→</span>
        </div>
        <div className="working-tree-drop-split__pane working-tree-drop-split__pane--target">
          <div className="working-tree-drop-split__eyebrow">{getWorkingTreeDropActionLabel(target)}</div>
          <div className="working-tree-drop-split__title">{getWorkingTreeDropZoneLabel(target)}</div>
        </div>
      </div>
    );
  };

  const renderWorkingFileRow = (
    item: WorkingFile,
    source: WorkingTreeDragSource,
    actionLabel: 'Stage' | 'Unstage',
    onAction: (file: string) => void
  ): JSX.Element => {
    const isDragSource = draggedFile?.file === item.file && draggedFile.source === source;
    const dragTitle = source === 'unstaged' ? 'Drag to stage or stash' : 'Drag to unstage or stash';
    const area: WorkingTreeDiffArea = source === 'unstaged' ? 'unstaged' : 'staged';
    const isActive = activeWorkingTreeDiff?.file === item.file && activeWorkingTreeDiff.area === area;
    const statusPresentation = getWorkingFileStatusPresentation(item);

    return (
      <div
        key={`${source}-${item.file}`}
        role="button"
        tabIndex={0}
        className={`git-operation-panel__file-row commit-detail-panel__file-button mb-1 flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition ${
          isDragSource ? 'is-drag-source' : ''
        } ${isActive ? 'is-active text-white' : ''}`}
        onPointerDown={(event) => handleFilePointerDown(event, { file: item.file, source })}
        onClick={() => onOpenWorkingTreeDiff(item.file, area)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }

          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpenWorkingTreeDiff(item.file, area);
          }
        }}
        title={dragTitle}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={`git-file-card__status-icon git-file-card__status-icon--${statusPresentation.tone}`}
            aria-hidden="true"
            title={statusPresentation.label}
          >
            {statusPresentation.icon}
          </span>
          <div className={`git-operation-panel__file-name commit-detail-panel__file-name min-w-0 flex-1 text-xs font-medium ${isActive ? 'text-white' : ''}`}>
            <GitFilePathLabel path={item.file} />
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <button
            type="button"
            data-working-tree-no-drag="true"
            className="button button-secondary !px-2 !py-1 text-[11px]"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              onAction(item.file);
            }}
          >
            {actionLabel}
          </button>
        </div>
      </div>
    );
  };

  const unstagedDropCandidate = draggedFile
    ? canDropWorkingTreeFile({ busy, payload: draggedFile, target: 'unstaged' })
    : false;
  const stagedDropCandidate = draggedFile
    ? canDropWorkingTreeFile({ busy, payload: draggedFile, target: 'staged' })
    : false;
  const stashDropCandidate = draggedFile
    ? canDropWorkingTreeFile({ busy, payload: draggedFile, target: 'stash' })
    : false;

  const dragHint = draggedFile
    ? dropZone
      ? `${draggedFile.file} を ${getWorkingTreeDropActionLabel(dropZone)} へドロップ`
      : draggedFile.source === 'unstaged'
        ? 'Staged Files または Stash Area にドロップ'
        : 'Unstaged Files または Stash Area にドロップ'
    : null;

  const dragPreviewPortal =
    draggedFile && dragPreviewPosition && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="working-tree-drag-preview"
            style={{
              left: `${dragPreviewPosition.x + 18}px`,
              top: `${dragPreviewPosition.y + 18}px`
            }}
          >
            <div className="working-tree-drag-preview__title">
              <GripVertical size={13} />
              <GitFilePathLabel path={draggedFile.file} />
            </div>
            <div className="working-tree-drag-preview__hint">{dragHint}</div>
          </div>,
          document.body
        )
      : null;
  const columnCount = resolveGitOperationPanelColumnCount(containerWidth);
  const bucketGridClass =
    columnCount === 4
      ? 'git-operation-panel__grid--4'
      : columnCount === 2
        ? 'git-operation-panel__grid--2'
        : 'git-operation-panel__grid--1';

  return (
    <>
      <section
        ref={rootRef}
        className={`panel git-operation-panel flex h-full min-h-0 flex-col p-3 ${draggedFile ? 'is-dragging' : ''}`}
      >
        <div className="mb-2 flex items-center justify-between gap-2 px-2">
          <div className="section-title">Git Operations</div>
          {headerAccessory}
        </div>

        {dragHint ? <div className={`git-operation-panel__hint px-2 ${draggedFile ? 'is-active' : ''}`}>{dragHint}</div> : null}

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 pb-2" data-controller-panel-drag-ignore="true">
          <div className={`git-operation-panel__grid grid min-h-0 gap-3 ${bucketGridClass}`}>
            <div className="flex min-h-0 min-w-0 flex-col">
              <div className="mb-1 flex items-center justify-between px-1 text-xs text-ink-subtle">
                <span>Unstaged Files ({unstaged.length})</span>
                {unstaged.length > 0 ? (
                  <button
                    className="button button-secondary !px-2 !py-1 text-[11px]"
                    type="button"
                    disabled={busy}
                    onClick={onStageAll}
                  >
                    Stage all
                  </button>
                ) : null}
              </div>
              <div
                data-working-tree-drop-zone="unstaged"
                className={`drop-zone min-h-[148px] flex-1 overflow-auto ${unstagedDropCandidate ? 'is-drop-candidate' : ''} ${dropZone === 'unstaged' ? 'is-drop-target' : ''}`}
              >
                {dropZone === 'unstaged' ? (
                  renderDropPreview('unstaged')
                ) : unstaged.length === 0 ? (
                  <div className="text-xs text-ink-subtle">未ステージの変更はありません。</div>
                ) : (
                  unstaged.map((item) => renderWorkingFileRow(item, 'unstaged', 'Stage', onStageFile))
                )}
              </div>
            </div>

            <div className="flex min-h-0 min-w-0 flex-col">
              <div className="mb-1 flex items-center justify-between px-1 text-xs text-ink-subtle">
                <span>Staged Files ({staged.length})</span>
                {staged.length > 0 ? (
                  <button
                    className="button button-secondary !px-2 !py-1 text-[11px]"
                    type="button"
                    disabled={busy}
                    onClick={onUnstageAll}
                  >
                    Unstage all
                  </button>
                ) : null}
              </div>
              <div
                data-working-tree-drop-zone="staged"
                className={`drop-zone min-h-[148px] flex-1 overflow-auto ${stagedDropCandidate ? 'is-drop-candidate' : ''} ${dropZone === 'staged' ? 'is-drop-target' : ''}`}
              >
                {dropZone === 'staged' ? (
                  renderDropPreview('staged')
                ) : staged.length === 0 ? (
                  <div className="text-xs text-ink-subtle">ステージされたファイルはありません。</div>
                ) : (
                  staged.map((item) => renderWorkingFileRow(item, 'staged', 'Unstage', onUnstageFile))
                )}
              </div>
            </div>

            <div className="flex min-h-0 min-w-0 flex-col">
              <div className="mb-1 px-1 text-xs text-ink-subtle">Stash Area</div>
              <div
                data-working-tree-drop-zone="stash"
                className={`drop-zone flex min-h-[148px] flex-1 flex-col ${stashDropCandidate ? 'is-drop-candidate' : ''} ${dropZone === 'stash' ? 'is-drop-target' : ''}`}
              >
                {dropZone === 'stash' ? (
                  renderDropPreview('stash')
                ) : (
                  <>
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-soft">
                      <UploadCloud size={16} />
                      ファイルをここにドロップしてスタッシュ
                    </div>
                    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                      {stashes.length === 0 ? (
                        <div className="text-xs text-ink-subtle">スタッシュはありません。</div>
                      ) : (
                        stashes.map((stash) => (
                          <div key={stash.id} className="rounded-lg bg-white/70 px-2 py-1.5 text-xs">
                            <div className="font-medium text-ink">{stash.id}</div>
                            <div className="truncate text-ink-subtle">{stash.message}</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {stash.files.length > 0 ? (
                                stash.files.map((file) => (
                                  <span
                                    key={`${stash.id}-${file}`}
                                    className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] text-accent"
                                    title={file}
                                  >
                                    {file}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[11px] text-ink-subtle">No file details</span>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex min-h-0 min-w-0 flex-col">
              <div className="mb-1 px-1 text-xs text-ink-subtle">Commit</div>
              <div className="flex min-h-[148px] flex-1 flex-col gap-2 rounded-2xl border border-black/10 bg-white/65 p-3">
                <div className="relative">
                  <textarea
                    className={`git-operation-panel__title-input input ${commitTitleOverflowCount > 0 ? 'is-over-limit' : ''}`}
                    placeholder="Commit summary"
                    value={commitTitle}
                    rows={1}
                    wrap="off"
                    spellCheck={false}
                    aria-invalid={commitTitleOverflowCount > 0}
                    onChange={(event) => onCommitTitleChange(event.target.value.replace(/\r?\n/g, ' '))}
                  />
                  <button
                    type="button"
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-2 text-accent transition hover:bg-accent-soft"
                    onClick={onGenerateCommitMessage}
                    disabled={busy}
                    title="AIでタイトル生成"
                  >
                    <Sparkles size={16} />
                  </button>
                </div>
                <div className={`git-operation-panel__commit-meta ${commitTitleOverflowCount > 0 ? 'is-over-limit' : ''}`}>
                  <span>
                    {commitTitleLength} / {COMMIT_TITLE_SOFT_LIMIT}
                  </span>
                  <span>{commitTitleOverflowCount > 0 ? `${commitTitleOverflowCount} chars over` : '72-char target'}</span>
                </div>
                <textarea
                  className="input min-h-20 flex-1 resize-y"
                  placeholder="Description"
                  value={commitDescription}
                  onChange={(event) => onCommitDescriptionChange(event.target.value)}
                />
                <div className="mt-auto grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={busy || staged.length === 0 || !commitTitle.trim()}
                    onClick={onCommit}
                  >
                    Commit
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={busy}
                    onClick={onPush}
                  >
                    Push
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      {dragPreviewPortal}
    </>
  );
}
