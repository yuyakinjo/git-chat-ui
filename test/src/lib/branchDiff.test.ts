import { describe, expect, test } from "bun:test";

import type { Branch, BranchDiffDetail, BranchResponse } from "../../../src/types";

import {
  canCompareCurrentBranch,
  getBranchDiffBaseLabel,
  getBranchDiffButtonLabel,
  getBranchDiffButtonTooltip,
  isCurrentBranchDiffDetail,
  resolveBranchDiffBaseBranch,
} from "../../../src/lib/branchDiff";

const mainBranch: Branch = {
  name: "main",
  fullRef: "refs/heads/main",
  type: "local",
  commit: "1111111",
};

const featureBranch: Branch = {
  name: "feature/file-list",
  fullRef: "refs/heads/feature/file-list",
  type: "local",
  commit: "2222222",
};

const remoteMainBranch: Branch = {
  name: "origin/main",
  fullRef: "refs/remotes/origin/main",
  type: "remote",
  commit: "3333333",
  isRemoteDefault: true,
};

describe("canCompareCurrentBranch", () => {
  test("returns true for a checked out non-default branch", () => {
    expect(canCompareCurrentBranch(featureBranch, mainBranch)).toBe(true);
  });

  test("returns true for the default branch itself so the dialog can still be opened", () => {
    expect(canCompareCurrentBranch(mainBranch, mainBranch)).toBe(true);
  });

  test("returns false when no diff base is available", () => {
    expect(canCompareCurrentBranch(featureBranch, null)).toBe(false);
  });
});

describe("resolveBranchDiffBaseBranch", () => {
  test("falls back to the remote default branch when no local main exists", () => {
    const branches: BranchResponse = {
      current: "feature/file-list",
      local: [featureBranch],
      remote: [remoteMainBranch],
    };

    expect(resolveBranchDiffBaseBranch(branches)).toEqual(remoteMainBranch);
  });
});

describe("isCurrentBranchDiffDetail", () => {
  test("matches detail refs against current base and target branches", () => {
    const detail: BranchDiffDetail = {
      baseRef: "refs/heads/main",
      targetRef: "feature/file-list",
      mergeBaseSha: "abc1234",
      files: [],
      diff: "",
      isDiffTruncated: false,
    };

    expect(isCurrentBranchDiffDetail(detail, mainBranch, featureBranch)).toBe(true);
  });

  test("returns false when diff detail belongs to a different target branch", () => {
    const detail: BranchDiffDetail = {
      baseRef: "refs/heads/main",
      targetRef: "feature/other",
      mergeBaseSha: "abc1234",
      files: [],
      diff: "",
      isDiffTruncated: false,
    };

    expect(isCurrentBranchDiffDetail(detail, mainBranch, featureBranch)).toBe(false);
  });
});

describe("getBranchDiffButtonLabel", () => {
  test("describes the default branch comparison target", () => {
    expect(getBranchDiffButtonLabel("main")).toBe("Diffs vs main");
  });
});

describe("getBranchDiffButtonTooltip", () => {
  test("describes opening the branch diff against the base branch", () => {
    expect(getBranchDiffButtonTooltip("main", false)).toBe(
      "現在のブランチと main の差分を表示する",
    );
  });

  test("describes closing the open branch diff", () => {
    expect(getBranchDiffButtonTooltip("main", true)).toBe("main との差分表示を閉じる");
  });
});

describe("getBranchDiffBaseLabel", () => {
  test("strips the remote prefix from the diff base label", () => {
    expect(getBranchDiffBaseLabel(remoteMainBranch)).toBe("main");
  });
});
