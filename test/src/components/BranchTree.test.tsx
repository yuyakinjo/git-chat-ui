import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { BranchResponse, PullStatus, StashEntry } from "../../../src/types";

import { BranchTree } from "../../../src/components/BranchTree";

const branches: BranchResponse = {
  current: "main",
  local: [
    {
      name: "main",
      fullRef: "refs/heads/main",
      type: "local",
      commit: "abc1234",
    },
  ],
  remote: [
    {
      name: "origin/main",
      fullRef: "refs/remotes/origin/main",
      type: "remote",
      commit: "abc1234",
      isRemoteDefault: true,
    },
  ],
};

const branchesWithVisibleRemoteLeaf: BranchResponse = {
  current: "main",
  local: branches.local,
  remote: [
    {
      name: "origin",
      fullRef: "refs/remotes/origin",
      type: "remote",
      commit: "abc1234",
    },
  ],
};

const branchesWithRemoteHeadAlias: BranchResponse = {
  current: "main",
  local: branches.local,
  remote: [
    {
      name: "origin/main",
      fullRef: "refs/remotes/origin/main",
      type: "remote",
      commit: "abc1234",
      isRemoteDefault: true,
    },
    {
      name: "origin",
      fullRef: "refs/remotes/origin/HEAD",
      type: "remote",
      commit: "abc1234",
    },
  ],
};

const stashes: StashEntry[] = [
  {
    id: "stash@{0}",
    sha: "stash0sha",
    parentSha: "abc1234",
    date: "2026-04-07T10:00:00+09:00",
    message: "WIP on develop",
    files: ["src/components/BranchTree.tsx"],
  },
  {
    id: "stash@{1}",
    sha: "stash1sha",
    parentSha: "def5678",
    date: "2026-04-07T09:55:00+09:00",
    message: "Auto stash before cherry pick",
    files: ["src/components/ControllerView.tsx"],
  },
];

const behindPullStatus: PullStatus = {
  branchName: "main",
  upstreamName: "origin/main",
  remoteName: "origin",
  remoteBranchName: "main",
  aheadCount: 0,
  behindCount: 1,
  canPull: true,
  state: "behind",
};

describe("BranchTree", () => {
  test("hides the stash footer entirely when there are no stashes", () => {
    const html = renderToStaticMarkup(
      <BranchTree
        branches={branches}
        branchPullRequests={{}}
        branchPullStatuses={{}}
        branchPullStatusLoading={{}}
        stashes={[]}
        collapsed={false}
        selectedBranchName="main"
        stashMutationBlockedReason={null}
        busy={false}
        onToggleCollapsed={() => {}}
        onSelectBranch={() => {}}
        onCheckoutBranch={() => {}}
        onBranchDrop={() => {}}
        onOpenStashDiff={() => {}}
        onRequestRenameStash={() => {}}
        onRequestDeleteStash={() => {}}
        onRequestApplyStash={() => {}}
        onRequestPopStash={() => {}}
        onOpenBranchPullRequest={() => {}}
        onRequestCreateBranch={() => {}}
        onRequestDeleteBranch={() => {}}
        loadBranchPullStatus={async () => null}
        onRequestPullBranch={() => {}}
      />,
    );

    expect(html).toContain("Branch List");
    expect(html).toContain("branch-tree__branch-scroll");
    expect(html).not.toContain("Stashes");
    expect(html).not.toContain("branch-tree__stash-section");
    expect(html).not.toContain("branch-tree__expand-count");
    expect(html).not.toContain("No stashes");
  });

  test("renders a collapsed summary rail with local, remote, and stash counts", () => {
    const html = renderToStaticMarkup(
      <BranchTree
        branches={branches}
        branchPullRequests={{}}
        branchPullStatuses={{}}
        branchPullStatusLoading={{}}
        stashes={stashes}
        collapsed
        selectedBranchName="main"
        stashMutationBlockedReason={null}
        busy={false}
        onToggleCollapsed={() => {}}
        onSelectBranch={() => {}}
        onCheckoutBranch={() => {}}
        onBranchDrop={() => {}}
        onOpenStashDiff={() => {}}
        onRequestRenameStash={() => {}}
        onRequestDeleteStash={() => {}}
        onRequestApplyStash={() => {}}
        onRequestPopStash={() => {}}
        onOpenBranchPullRequest={() => {}}
        onRequestCreateBranch={() => {}}
        onRequestDeleteBranch={() => {}}
        loadBranchPullStatus={async () => null}
        onRequestPullBranch={() => {}}
      />,
    );

    expect(html).toContain("branch-tree--collapsed");
    expect(html).toContain('title="Local branches: 1"');
    expect(html).toContain('title="Remote branches: 1"');
    expect(html).toContain('title="Stashes: 2"');
    expect(html).toContain("branch-tree__summary-item");
    expect(html).not.toContain("branch-tree__branch-scroll");
    expect(html).not.toContain("branch-tree__stash-section");
  });

  test("renders stashes in a dedicated footer below the branch scroll area", () => {
    const html = renderToStaticMarkup(
      <BranchTree
        branches={branches}
        branchPullRequests={{}}
        branchPullStatuses={{}}
        branchPullStatusLoading={{}}
        stashes={stashes}
        collapsed={false}
        selectedBranchName="main"
        stashMutationBlockedReason={null}
        busy={false}
        onToggleCollapsed={() => {}}
        onSelectBranch={() => {}}
        onCheckoutBranch={() => {}}
        onBranchDrop={() => {}}
        onOpenStashDiff={() => {}}
        onRequestRenameStash={() => {}}
        onRequestDeleteStash={() => {}}
        onRequestApplyStash={() => {}}
        onRequestPopStash={() => {}}
        onOpenBranchPullRequest={() => {}}
        onRequestCreateBranch={() => {}}
        onRequestDeleteBranch={() => {}}
        loadBranchPullStatus={async () => null}
        onRequestPullBranch={() => {}}
      />,
    );

    expect(html).toContain("Branch List");
    expect(html).toContain("main");
    expect(html).toContain("Stashes");
    expect(html).toContain("1 file • 2026/04/07 @");
    expect(html).toContain("1 file • 2026/04/07 @");
    expect(html).toContain("WIP on develop");
    expect(html).toContain("Auto stash before cherry pick");
    expect(html).not.toContain("stash@{0}");
    expect(html).not.toContain("stash@{1}");
    expect(html).toContain("branch-tree__body");
    expect(html).toContain("branch-tree__branch-scroll");
    expect(html).toContain("branch-tree__stash-section");
    expect(html.indexOf("branch-tree__branch-scroll")).toBeLessThan(
      html.indexOf("branch-tree__stash-section"),
    );
    expect(html).not.toContain(
      "右クリックで branch 作成 / 削除。local branch は別の local branch にドロップできます。",
    );
  });

  test("renders distinct local and remote icons in branch rows without ref badges", () => {
    const html = renderToStaticMarkup(
      <BranchTree
        branches={branchesWithVisibleRemoteLeaf}
        branchPullRequests={{}}
        branchPullStatuses={{}}
        branchPullStatusLoading={{}}
        stashes={stashes}
        collapsed={false}
        selectedBranchName="main"
        stashMutationBlockedReason={null}
        busy={false}
        onToggleCollapsed={() => {}}
        onSelectBranch={() => {}}
        onCheckoutBranch={() => {}}
        onBranchDrop={() => {}}
        onOpenStashDiff={() => {}}
        onRequestRenameStash={() => {}}
        onRequestDeleteStash={() => {}}
        onRequestApplyStash={() => {}}
        onRequestPopStash={() => {}}
        onOpenBranchPullRequest={() => {}}
        onRequestCreateBranch={() => {}}
        onRequestDeleteBranch={() => {}}
        loadBranchPullStatus={async () => null}
        onRequestPullBranch={() => {}}
      />,
    );

    expect(html).toContain("branch-list-item__icon branch-list-item__icon--local");
    expect(html).toContain("branch-list-item__icon branch-list-item__icon--remote");
    expect(html).not.toContain("branch-list-item__ref-badge");
    expect(html).not.toContain('aria-label="Local ref"');
    expect(html).not.toContain('aria-label="Remote ref"');
  });

  test("hides remote HEAD aliases from the branch list and collapsed counts", () => {
    const expandedHtml = renderToStaticMarkup(
      <BranchTree
        branches={branchesWithRemoteHeadAlias}
        branchPullRequests={{}}
        branchPullStatuses={{}}
        branchPullStatusLoading={{}}
        stashes={[]}
        collapsed={false}
        selectedBranchName="main"
        stashMutationBlockedReason={null}
        busy={false}
        onToggleCollapsed={() => {}}
        onSelectBranch={() => {}}
        onCheckoutBranch={() => {}}
        onBranchDrop={() => {}}
        onOpenStashDiff={() => {}}
        onRequestRenameStash={() => {}}
        onRequestDeleteStash={() => {}}
        onRequestApplyStash={() => {}}
        onRequestPopStash={() => {}}
        onOpenBranchPullRequest={() => {}}
        onRequestCreateBranch={() => {}}
        onRequestDeleteBranch={() => {}}
        loadBranchPullStatus={async () => null}
        onRequestPullBranch={() => {}}
      />,
    );
    const collapsedHtml = renderToStaticMarkup(
      <BranchTree
        branches={branchesWithRemoteHeadAlias}
        branchPullRequests={{}}
        branchPullStatuses={{}}
        branchPullStatusLoading={{}}
        stashes={[]}
        collapsed
        selectedBranchName="main"
        stashMutationBlockedReason={null}
        busy={false}
        onToggleCollapsed={() => {}}
        onSelectBranch={() => {}}
        onCheckoutBranch={() => {}}
        onBranchDrop={() => {}}
        onOpenStashDiff={() => {}}
        onRequestRenameStash={() => {}}
        onRequestDeleteStash={() => {}}
        onRequestApplyStash={() => {}}
        onRequestPopStash={() => {}}
        onOpenBranchPullRequest={() => {}}
        onRequestCreateBranch={() => {}}
        onRequestDeleteBranch={() => {}}
        loadBranchPullStatus={async () => null}
        onRequestPullBranch={() => {}}
      />,
    );

    expect(expandedHtml).not.toContain("branch-list-item__icon branch-list-item__icon--remote");
    expect(collapsedHtml).toContain('title="Remote branches: 1"');
  });

  test("renders pull request actions only for local branches that have an open pull request", () => {
    const html = renderToStaticMarkup(
      <BranchTree
        branches={branchesWithVisibleRemoteLeaf}
        branchPullRequests={{
          main: {
            url: "https://github.com/example/repo/pull/42",
            hasConflicts: true,
          },
        }}
        branchPullStatuses={{}}
        branchPullStatusLoading={{}}
        stashes={stashes}
        collapsed={false}
        selectedBranchName="main"
        stashMutationBlockedReason={null}
        busy={false}
        onToggleCollapsed={() => {}}
        onSelectBranch={() => {}}
        onCheckoutBranch={() => {}}
        onBranchDrop={() => {}}
        onOpenStashDiff={() => {}}
        onRequestRenameStash={() => {}}
        onRequestDeleteStash={() => {}}
        onRequestApplyStash={() => {}}
        onRequestPopStash={() => {}}
        onOpenBranchPullRequest={() => {}}
        onRequestCreateBranch={() => {}}
        onRequestDeleteBranch={() => {}}
        loadBranchPullStatus={async () => null}
        onRequestPullBranch={() => {}}
      />,
    );

    expect(html).toContain("branch-list-item__actions");
    expect(html).toContain("branch-list-item__pr-warning");
    expect(html).toContain("branch-list-item__pr-link");
    expect(html).toContain('aria-label="main の Pull Request は conflict しています"');
    expect(html).toContain('aria-label="main の Pull Request を開く"');
    expect(html).toContain('title="https://github.com/example/repo/pull/42"');
    expect(html).not.toContain('aria-label="origin の Pull Request を開く"');
  });

  test("renders an inline pull action when a local branch is behind upstream", () => {
    const html = renderToStaticMarkup(
      <BranchTree
        branches={branches}
        branchPullRequests={{}}
        branchPullStatuses={{ main: behindPullStatus }}
        branchPullStatusLoading={{ main: false }}
        stashes={[]}
        collapsed={false}
        selectedBranchName="main"
        stashMutationBlockedReason={null}
        busy={false}
        onToggleCollapsed={() => {}}
        onSelectBranch={() => {}}
        onCheckoutBranch={() => {}}
        onBranchDrop={() => {}}
        onOpenStashDiff={() => {}}
        onRequestRenameStash={() => {}}
        onRequestDeleteStash={() => {}}
        onRequestApplyStash={() => {}}
        onRequestPopStash={() => {}}
        onOpenBranchPullRequest={() => {}}
        onRequestCreateBranch={() => {}}
        onRequestDeleteBranch={() => {}}
        loadBranchPullStatus={async () => behindPullStatus}
        onRequestPullBranch={() => {}}
      />,
    );

    expect(html).toContain("branch-list-item__pull-link");
    expect(html).toContain("branch-list-item__pull-count");
    expect(html).toContain('aria-label="main に upstream の 1 commit を pull"');
    expect(html).toContain(">1</span>");
  });
});
