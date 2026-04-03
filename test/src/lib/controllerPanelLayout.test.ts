import { describe, expect, test } from "bun:test";

import {
  resolveGitOperationPanelColumnCount,
  shouldSplitCommitDetailPanel,
} from "../../../src/lib/controllerPanelLayout";

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
    expect(shouldSplitCommitDetailPanel(720)).toBe(false);
    expect(shouldSplitCommitDetailPanel(760)).toBe(true);
    expect(shouldSplitCommitDetailPanel(1120)).toBe(true);
  });
});
