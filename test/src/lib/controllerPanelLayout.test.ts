import { describe, expect, test } from "bun:test";

import {
  resolveCollapsedControllerPanelsGridClassName,
  resolveGitOperationPanelColumnCount,
  shouldRenderGitOperationsPanel,
  shouldSplitCommitDetailPanel,
} from "../../../src/lib/controllerPanelLayout";
import type { WorkingTreeStatus } from "../../../src/types";

describe("controllerPanelLayout", () => {
  test("uses a single column git operation layout in narrow panels", () => {
    expect(resolveGitOperationPanelColumnCount(640)).toBe(1);
  });

  test("uses a three column git operation layout in medium panels", () => {
    expect(resolveGitOperationPanelColumnCount(980)).toBe(3);
  });

  test("uses a four column git operation layout only in wide panels", () => {
    expect(resolveGitOperationPanelColumnCount(1240)).toBe(4);
  });

  test("splits commit detail only when the panel is wide enough", () => {
    expect(shouldSplitCommitDetailPanel(880)).toBe(false);
    expect(shouldSplitCommitDetailPanel(980)).toBe(true);
  });

  test("keeps git operations visible until the working tree status has loaded", () => {
    expect(shouldRenderGitOperationsPanel(null)).toBe(true);
  });

  test("hides git operations only when the working tree is fully empty", () => {
    const emptyStatus: WorkingTreeStatus = {
      conflicted: [],
      staged: [],
      unstaged: [],
    };
    const conflictedOnlyStatus: WorkingTreeStatus = {
      conflicted: [
        {
          file: "src/conflict.txt",
          statusLabel: "Both Modified",
          x: "U",
          y: "U",
        },
      ],
      staged: [],
      unstaged: [],
    };

    expect(shouldRenderGitOperationsPanel(emptyStatus)).toBe(false);
    expect(shouldRenderGitOperationsPanel(conflictedOnlyStatus)).toBe(true);
  });

  test("picks the collapsed grid class from the remaining panel order", () => {
    expect(
      resolveCollapsedControllerPanelsGridClassName([
        "commitGraph",
        "gitOperations",
        "commitDetail",
      ]),
    ).toBe("controller-panels-grid--without-git-operations-graph-detail");
    expect(
      resolveCollapsedControllerPanelsGridClassName([
        "gitOperations",
        "commitDetail",
        "commitGraph",
      ]),
    ).toBe("controller-panels-grid--without-git-operations-detail-graph");
  });
});
