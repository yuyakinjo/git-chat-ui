import { describe, expect, test } from "bun:test";

import {
  getBranchPullDisabledReason,
  getPullCommandDisabledReason,
  shouldShowBranchPullAction,
} from "../../../src/lib/pullCommand";
import type { Branch, PullStatus } from "../../../src/types";

const currentBranch: Branch = {
  name: "main",
  fullRef: "refs/heads/main",
  type: "local",
  commit: "abc123",
};

const featureBranch: Branch = {
  name: "feature/current",
  fullRef: "refs/heads/feature/current",
  type: "local",
  commit: "def456",
};

function createPullStatus(state: PullStatus["state"], branchName = currentBranch.name): PullStatus {
  return {
    branchName,
    upstreamName: state === "noUpstream" ? null : "origin/main",
    remoteName: state === "noUpstream" ? null : "origin",
    remoteBranchName: state === "noUpstream" ? null : "main",
    aheadCount: state === "diverged" ? 1 : 0,
    behindCount: state === "behind" || state === "diverged" ? 1 : 0,
    canPull: state === "behind",
    state,
  };
}

describe("getPullCommandDisabledReason", () => {
  test("blocks while another git operation is running", () => {
    expect(getPullCommandDisabledReason(true, currentBranch, createPullStatus("behind"))).toBe(
      "Git 操作の完了を待ってから実行してください。",
    );
  });

  test("blocks when no local branch is checked out", () => {
    expect(getPullCommandDisabledReason(false, null, createPullStatus("detached"))).toBe(
      "local branch を checkout 中のときだけ使えます。",
    );
  });

  test("blocks when upstream is missing", () => {
    expect(getPullCommandDisabledReason(false, currentBranch, createPullStatus("noUpstream"))).toBe(
      "upstream branch を設定してから pull してください。",
    );
  });

  test("blocks ff-only pull when local and upstream diverged", () => {
    expect(getPullCommandDisabledReason(false, currentBranch, createPullStatus("diverged"))).toBe(
      "local branch と upstream が分岐しているため、fast-forward の pull はできません。",
    );
  });

  test("allows pull when the branch can be checked normally", () => {
    expect(getPullCommandDisabledReason(false, currentBranch, createPullStatus("behind"))).toBe(
      null,
    );
    expect(getPullCommandDisabledReason(false, currentBranch, createPullStatus("upToDate"))).toBe(
      null,
    );
  });
});

describe("getBranchPullDisabledReason", () => {
  test("blocks while pull status is still loading", () => {
    expect(getBranchPullDisabledReason(false, currentBranch, null, true)).toBe(
      "pull 状態を確認しています。",
    );
  });

  test("allows right-click pull only when the target branch is behind", () => {
    expect(
      getBranchPullDisabledReason(false, currentBranch, createPullStatus("behind"), false),
    ).toBeNull();
  });

  test("explains why the menu action is disabled for blocked pull states", () => {
    expect(
      getBranchPullDisabledReason(false, currentBranch, createPullStatus("noUpstream"), false),
    ).toBe("upstream branch を設定してから pull してください。");
    expect(
      getBranchPullDisabledReason(false, currentBranch, createPullStatus("diverged"), false),
    ).toBe("local branch と upstream が分岐しているため、fast-forward の pull はできません。");
  });

  test("treats ahead and up-to-date branches as non-pull targets", () => {
    expect(
      getBranchPullDisabledReason(
        false,
        featureBranch,
        createPullStatus("ahead", featureBranch.name),
        false,
      ),
    ).toBe("local branch が upstream より進んでいるため pull は不要です。");
    expect(
      getBranchPullDisabledReason(
        false,
        featureBranch,
        createPullStatus("upToDate", featureBranch.name),
        false,
      ),
    ).toBe("upstream に取り込む変更はありません。");
  });
});

describe("shouldShowBranchPullAction", () => {
  test("shows the action while loading so the menu can settle in place", () => {
    expect(shouldShowBranchPullAction(currentBranch, null, true)).toBe(true);
  });

  test("shows the action for behind and blocked tracking states", () => {
    expect(shouldShowBranchPullAction(currentBranch, createPullStatus("behind"))).toBe(true);
    expect(shouldShowBranchPullAction(currentBranch, createPullStatus("noUpstream"))).toBe(true);
    expect(shouldShowBranchPullAction(currentBranch, createPullStatus("diverged"))).toBe(true);
  });

  test("hides the action when pull would be a no-op", () => {
    expect(shouldShowBranchPullAction(currentBranch, createPullStatus("upToDate"))).toBe(false);
    expect(shouldShowBranchPullAction(currentBranch, createPullStatus("ahead"))).toBe(false);
  });
});
