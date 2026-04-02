import type { WorkingFile } from "../types";
import type { WorkingTreeDragSource } from "./workingTreeDragDrop";

export interface WorkingTreeSelectionState {
  source: WorkingTreeDragSource | null;
  files: string[];
  anchorFile: string | null;
}

export const EMPTY_WORKING_TREE_SELECTION: WorkingTreeSelectionState = {
  source: null,
  files: [],
  anchorFile: null,
};

function getOrderedFiles(items: readonly WorkingFile[]): string[] {
  return items.map((item) => item.file).filter((file) => file.trim().length > 0);
}

function getOrderedSelection(items: readonly WorkingFile[], files: readonly string[]): string[] {
  const selected = new Set(files);
  return getOrderedFiles(items).filter((file) => selected.has(file));
}

export function isWorkingTreeMultiSelectModifier(event: {
  metaKey?: boolean;
  ctrlKey?: boolean;
}): boolean {
  return Boolean(event.metaKey || event.ctrlKey);
}

export function isWorkingTreeFileSelected(
  selection: WorkingTreeSelectionState,
  source: WorkingTreeDragSource,
  file: string,
): boolean {
  return selection.source === source && selection.files.includes(file);
}

export function isWorkingTreeSelectionEmpty(selection: WorkingTreeSelectionState): boolean {
  return selection.source === null || selection.files.length === 0;
}

export function shouldClearWorkingTreeInteractionOnEscape(options: {
  selection: WorkingTreeSelectionState;
  isDragging: boolean;
}): boolean {
  const { selection, isDragging } = options;
  return !isWorkingTreeSelectionEmpty(selection) || isDragging;
}

export function resolveWorkingTreeSelection(options: {
  items: readonly WorkingFile[];
  source: WorkingTreeDragSource;
  clickedFile: string;
  currentSelection: WorkingTreeSelectionState;
  shiftKey: boolean;
  multiSelectKey: boolean;
}): WorkingTreeSelectionState {
  const { items, source, clickedFile, currentSelection, shiftKey, multiSelectKey } = options;
  const orderedFiles = getOrderedFiles(items);
  const clickedIndex = orderedFiles.indexOf(clickedFile);

  if (clickedIndex < 0) {
    return {
      source,
      files: [clickedFile],
      anchorFile: clickedFile,
    };
  }

  const hasSameSourceSelection = currentSelection.source === source;
  const currentFiles = hasSameSourceSelection ? getOrderedSelection(items, currentSelection.files) : [];

  if (shiftKey && hasSameSourceSelection && currentSelection.anchorFile) {
    const anchorIndex = orderedFiles.indexOf(currentSelection.anchorFile);
    if (anchorIndex >= 0) {
      const [start, end] =
        anchorIndex <= clickedIndex ? [anchorIndex, clickedIndex] : [clickedIndex, anchorIndex];
      return {
        source,
        files: orderedFiles.slice(start, end + 1),
        anchorFile: currentSelection.anchorFile,
      };
    }
  }

  if (multiSelectKey) {
    if (currentFiles.includes(clickedFile)) {
      const nextFiles = currentFiles.filter((file) => file !== clickedFile);
      const nextAnchor = nextFiles.includes(currentSelection.anchorFile ?? "")
        ? currentSelection.anchorFile
        : (nextFiles.at(-1) ?? null);
      return {
        source: nextFiles.length > 0 ? source : null,
        files: nextFiles,
        anchorFile: nextAnchor,
      };
    }

    const selected = new Set(currentFiles);
    selected.add(clickedFile);
    return {
      source,
      files: orderedFiles.filter((file) => selected.has(file)),
      anchorFile: clickedFile,
    };
  }

  return {
    source,
    files: [clickedFile],
    anchorFile: clickedFile,
  };
}

export function getWorkingTreeDragFiles(options: {
  items: readonly WorkingFile[];
  source: WorkingTreeDragSource;
  clickedFile: string;
  currentSelection: WorkingTreeSelectionState;
}): string[] {
  const { items, source, clickedFile, currentSelection } = options;
  if (!isWorkingTreeFileSelected(currentSelection, source, clickedFile)) {
    return [clickedFile];
  }

  const orderedSelection = getOrderedSelection(items, currentSelection.files);
  return orderedSelection.length > 0 ? orderedSelection : [clickedFile];
}
