import { describe, expect, test } from "bun:test";

import {
  EMPTY_WORKING_TREE_SELECTION,
  getWorkingTreeDragFiles,
  isWorkingTreeSelectionEmpty,
  resolveWorkingTreeSelection,
  shouldClearWorkingTreeInteractionOnEscape,
} from "../../../src/lib/workingTreeSelection";
import type { WorkingTreeStatus } from "../../../src/types";

const status: WorkingTreeStatus = {
  conflicted: [],
  unstaged: [
    { file: "a.ts", x: "M", y: " ", statusLabel: "Modified" },
    { file: "b.ts", x: "M", y: " ", statusLabel: "Modified" },
    { file: "c.ts", x: "M", y: " ", statusLabel: "Modified" },
    { file: "d.ts", x: "M", y: " ", statusLabel: "Modified" },
  ],
  staged: [
    { file: "s1.ts", x: "M", y: " ", statusLabel: "Modified" },
    { file: "s2.ts", x: "M", y: " ", statusLabel: "Modified" },
  ],
};

describe("workingTreeSelection", () => {
  test("selects a contiguous range from the current anchor when shift-clicking", () => {
    const anchorSelection = resolveWorkingTreeSelection({
      items: status.unstaged,
      source: "unstaged",
      clickedFile: "b.ts",
      currentSelection: EMPTY_WORKING_TREE_SELECTION,
      shiftKey: false,
      multiSelectKey: false,
    });

    const rangeSelection = resolveWorkingTreeSelection({
      items: status.unstaged,
      source: "unstaged",
      clickedFile: "d.ts",
      currentSelection: anchorSelection,
      shiftKey: true,
      multiSelectKey: false,
    });

    expect(rangeSelection).toEqual({
      source: "unstaged",
      files: ["b.ts", "c.ts", "d.ts"],
      anchorFile: "b.ts",
    });
  });

  test("toggles individual files with the multi-select modifier while preserving list order", () => {
    const first = resolveWorkingTreeSelection({
      items: status.unstaged,
      source: "unstaged",
      clickedFile: "c.ts",
      currentSelection: EMPTY_WORKING_TREE_SELECTION,
      shiftKey: false,
      multiSelectKey: false,
    });

    const second = resolveWorkingTreeSelection({
      items: status.unstaged,
      source: "unstaged",
      clickedFile: "a.ts",
      currentSelection: first,
      shiftKey: false,
      multiSelectKey: true,
    });

    const third = resolveWorkingTreeSelection({
      items: status.unstaged,
      source: "unstaged",
      clickedFile: "c.ts",
      currentSelection: second,
      shiftKey: false,
      multiSelectKey: true,
    });

    expect(second).toEqual({
      source: "unstaged",
      files: ["a.ts", "c.ts"],
      anchorFile: "a.ts",
    });
    expect(third).toEqual({
      source: "unstaged",
      files: ["a.ts"],
      anchorFile: "a.ts",
    });
  });

  test("resets to the clicked file when switching buckets", () => {
    const unstagedSelection = resolveWorkingTreeSelection({
      items: status.unstaged,
      source: "unstaged",
      clickedFile: "b.ts",
      currentSelection: EMPTY_WORKING_TREE_SELECTION,
      shiftKey: false,
      multiSelectKey: false,
    });

    const stagedSelection = resolveWorkingTreeSelection({
      items: status.staged,
      source: "staged",
      clickedFile: "s2.ts",
      currentSelection: unstagedSelection,
      shiftKey: false,
      multiSelectKey: true,
    });

    expect(stagedSelection).toEqual({
      source: "staged",
      files: ["s2.ts"],
      anchorFile: "s2.ts",
    });
  });

  test("drags the whole selected set only when the grabbed row is already selected", () => {
    const selected = {
      source: "unstaged" as const,
      files: ["b.ts", "c.ts"],
      anchorFile: "b.ts",
    };

    expect(
      getWorkingTreeDragFiles({
        items: status.unstaged,
        source: "unstaged",
        clickedFile: "c.ts",
        currentSelection: selected,
      }),
    ).toEqual(["b.ts", "c.ts"]);

    expect(
      getWorkingTreeDragFiles({
        items: status.unstaged,
        source: "unstaged",
        clickedFile: "a.ts",
        currentSelection: selected,
      }),
    ).toEqual(["a.ts"]);
  });

  test("treats empty selection and active drag independently for Escape handling", () => {
    expect(isWorkingTreeSelectionEmpty(EMPTY_WORKING_TREE_SELECTION)).toBe(true);
    expect(
      shouldClearWorkingTreeInteractionOnEscape({
        selection: EMPTY_WORKING_TREE_SELECTION,
        isDragging: false,
      }),
    ).toBe(false);

    expect(
      shouldClearWorkingTreeInteractionOnEscape({
        selection: {
          source: "staged",
          files: ["s1.ts"],
          anchorFile: "s1.ts",
        },
        isDragging: false,
      }),
    ).toBe(true);

    expect(
      shouldClearWorkingTreeInteractionOnEscape({
        selection: EMPTY_WORKING_TREE_SELECTION,
        isDragging: true,
      }),
    ).toBe(true);
  });
});
