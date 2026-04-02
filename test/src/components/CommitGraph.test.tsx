import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildCommitRefBadges,
  buildDefaultBranchAnchorLaneIndices,
  DEFAULT_BRANCH_LANE_COLOR,
  LEFT_BRANCH_LANE_COLORS,
  laneX,
  parseCommitRefLabels,
  RIGHT_BRANCH_LANE_COLORS,
  laneColor,
} from "../../../src/components/CommitGraphHelpers";
import type { BranchResponse, CommitListItem } from "../../../src/types";

import { CommitGraph } from "../../../src/components/CommitGraph";
import { buildLaneRows } from "../../../src/lib/commitGraphLayout";

const commits: CommitListItem[] = [
  {
    sha: "abc1234",
    parentShas: ["def5678"],
    author: "kinjo",
    date: "2026-03-29T12:00:00.000Z",
    subject: "feat: sample graph node",
    decoration: "(HEAD -> main, tag: v1.2.0, origin/main, origin/HEAD)",
  },
  {
    sha: "def5678",
    parentShas: [],
    author: "kinjo",
    date: "2026-03-28T12:00:00.000Z",
    subject: "chore: base commit",
    decoration: "",
  },
];

const branchContext: BranchResponse = {
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

const commitRefScopeContext = {
  localRefNames: new Set(branchContext.local.map((branch) => branch.name)),
  remoteRefNames: new Set(branchContext.remote.map((branch) => branch.name)),
  remoteNames: new Set(
    branchContext.remote.map((branch) => branch.name.split("/", 1)[0]).filter(Boolean),
  ),
};

const nonHeadFirstCommits: CommitListItem[] = [
  {
    sha: "main-tip",
    parentShas: ["base"],
    author: "kinjo",
    date: "2026-03-30T12:00:00.000Z",
    subject: "chore: main tip",
    decoration: "(main, origin/main, origin/HEAD)",
  },
  {
    sha: "feature-tip",
    parentShas: ["base"],
    author: "kinjo",
    date: "2026-03-29T12:00:00.000Z",
    subject: "feat: current branch tip",
    decoration: "(HEAD -> fix-merge-dialog)",
  },
  {
    sha: "base",
    parentShas: [],
    author: "kinjo",
    date: "2026-03-28T12:00:00.000Z",
    subject: "chore: base commit",
    decoration: "",
  },
];

const nonHeadFirstBranchContext: BranchResponse = {
  current: "fix-merge-dialog",
  local: [
    {
      name: "fix-merge-dialog",
      fullRef: "refs/heads/fix-merge-dialog",
      type: "local",
      commit: "feature-tip",
    },
    {
      name: "main",
      fullRef: "refs/heads/main",
      type: "local",
      commit: "main-tip",
    },
  ],
  remote: [
    {
      name: "origin/main",
      fullRef: "refs/remotes/origin/main",
      type: "remote",
      commit: "main-tip",
      isRemoteDefault: true,
    },
  ],
};

const continuedDefaultBranchCommits: CommitListItem[] = [
  {
    sha: "main-tip",
    parentShas: ["base"],
    author: "kinjo",
    date: "2026-03-31T12:00:00.000Z",
    subject: "chore: main tip",
    decoration: "(HEAD -> main, origin/main, origin/HEAD)",
  },
  {
    sha: "feature-3",
    parentShas: ["feature-2"],
    author: "kinjo",
    date: "2026-03-30T12:00:00.000Z",
    subject: "feat: side branch 3",
    decoration: "",
  },
  {
    sha: "feature-2",
    parentShas: ["feature-1"],
    author: "kinjo",
    date: "2026-03-29T12:00:00.000Z",
    subject: "feat: side branch 2",
    decoration: "",
  },
  {
    sha: "feature-1",
    parentShas: ["base"],
    author: "kinjo",
    date: "2026-03-28T12:00:00.000Z",
    subject: "feat: side branch 1",
    decoration: "",
  },
  {
    sha: "base",
    parentShas: ["root"],
    author: "kinjo",
    date: "2026-03-27T12:00:00.000Z",
    subject: "chore: base",
    decoration: "",
  },
  {
    sha: "root",
    parentShas: [],
    author: "kinjo",
    date: "2026-03-26T12:00:00.000Z",
    subject: "chore: root",
    decoration: "",
  },
];

const continuedDefaultBranchContext: BranchResponse = {
  current: "main",
  local: [
    {
      name: "main",
      fullRef: "refs/heads/main",
      type: "local",
      commit: "main-tip",
    },
  ],
  remote: [
    {
      name: "origin/main",
      fullRef: "refs/remotes/origin/main",
      type: "remote",
      commit: "main-tip",
      isRemoteDefault: true,
    },
  ],
};

function extractCommitRowMarkup(html: string, sha: string): string {
  const startToken = `data-commit-sha="${sha}"`;
  const startIndex = html.indexOf(startToken);
  if (startIndex === -1) {
    throw new Error(`Commit row not found for ${sha}`);
  }

  const nextIndex = html.indexOf('data-commit-sha="', startIndex + startToken.length);
  return html.slice(startIndex, nextIndex === -1 ? html.length : nextIndex);
}

function extractWipRowMarkup(html: string): string {
  const startToken = 'class="wip-row commit-row"';
  const startIndex = html.indexOf(startToken);
  if (startIndex === -1) {
    throw new Error("WIP row not found");
  }

  const nextIndex = html.indexOf('data-commit-sha="', startIndex + startToken.length);
  return html.slice(startIndex, nextIndex === -1 ? html.length : nextIndex);
}

describe("CommitGraph", () => {
  test("uses the widened lane spacing", () => {
    expect(laneX(1) - laneX(0)).toBe(27);
  });

  test("anchors lane colors around the default branch lane", () => {
    const branchyCommits: CommitListItem[] = [
      {
        sha: "feature-tip",
        parentShas: ["base"],
        author: "kinjo",
        date: "2026-03-30T12:00:00.000Z",
        subject: "feat: feature branch",
        decoration: "(HEAD -> feature)",
      },
      {
        sha: "main-tip",
        parentShas: ["base"],
        author: "kinjo",
        date: "2026-03-29T12:00:00.000Z",
        subject: "chore: main tip",
        decoration: "(main, origin/main)",
      },
      {
        sha: "base",
        parentShas: [],
        author: "kinjo",
        date: "2026-03-28T12:00:00.000Z",
        subject: "chore: base",
        decoration: "",
      },
    ];
    const layout = buildLaneRows(branchyCommits);
    const anchors = buildDefaultBranchAnchorLaneIndices(branchyCommits, layout.rows, "main-tip");

    expect(anchors).toEqual([1, 1, 0]);
    expect(laneColor(1, anchors[1])).toBe(DEFAULT_BRANCH_LANE_COLOR);
    expect(laneColor(0, anchors[0])).toBe(LEFT_BRANCH_LANE_COLORS[0]);
    expect(laneColor(1, anchors[2])).toBe(RIGHT_BRANCH_LANE_COLORS[0]);
  });

  test("merges local refs and matching origin refs into a single badge model", () => {
    const badges = buildCommitRefBadges(
      parseCommitRefLabels("(HEAD -> main, tag: v1.2.0, origin/main, origin/HEAD)"),
      commitRefScopeContext,
    );

    expect(badges).toEqual([
      {
        type: "head",
        name: "main",
        scopes: ["local", "remote"],
        title: "main, origin/main",
      },
      {
        type: "tag",
        name: "v1.2.0",
        scopes: ["tag"],
        title: "v1.2.0",
      },
      {
        type: "branch",
        name: "origin/HEAD",
        scopes: ["remote"],
        title: "origin/HEAD",
      },
    ]);
  });

  test("renders the WIP marker as a hollow dashed circle in detailed mode", () => {
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={commits}
        mode="detailed"
        activeCommitSha={null}
        highlightedCommitSha={null}
        checkedOutCommitSha={null}
        scrollToCommitSha={null}
        onScrollToCommitHandled={() => {}}
        hasMore={false}
        loading={false}
        loadingMore={false}
        busy={false}
        wipStagedCount={1}
        wipUnstagedCount={2}
        wipConflictedCount={0}
        onSelectWip={() => {}}
        onSelectCommit={() => {}}
        onCheckoutCommit={() => {}}
        onCheckoutBranchRef={() => {}}
        onLoadMore={() => {}}
        onNotify={() => {}}
        branchContext={continuedDefaultBranchContext}
      />,
    );

    const wipConnectorMatch = html.match(
      /class="wip-row__lane-line wip-row__lane-line--connector"[^>]*x1="([^"]+)"[^>]*y1="([^"]+)"[^>]*x2="([^"]+)"[^>]*y2="([^"]+)"/,
    );
    const firstCommitLaneMatch = html.match(
      /data-commit-sha="abc1234"[\s\S]*?class="commit-graph__lane-line"[^>]*x1="([^"]+)"[^>]*y1="([^"]+)"[^>]*x2="([^"]+)"[^>]*y2="([^"]+)"/,
    );

    expect(html).not.toContain("wip-row__lane-line--stub");
    expect(wipConnectorMatch?.[2]).toBe("24");
    expect(wipConnectorMatch?.[4]).toBe("33");
    expect(firstCommitLaneMatch?.[2]).toBe("-1");
    expect(firstCommitLaneMatch?.[4]).toBe("33");
    expect(html).toContain('class="wip-node-ring"');
    expect(html).toContain('stroke-dasharray="2 3"');
    expect(html).not.toContain('class="wip-node-core"');
    expect(html).toContain('class="wip-row__badge');
    expect(html).toContain('class="wip-row__primary');
    expect(html).toContain('class="wip-row__meta');
    expect(html).toContain("commit-graph__header");
    expect(html).toContain("commit-graph__cell--primary");
    expect(html).toContain("commit-graph__ref-badge--head");
    expect(html).toContain("commit-graph__ref-badge--tag");
    expect(html).toContain("commit-graph__ref-badge-icon");
    expect(html).toContain("commit-graph__ref-badge-icons");
    expect(html).toContain("commit-graph__ref-badge-done");
    expect(html).toContain("commit-graph__ref-badge-label");
    expect(html.match(/class="commit-graph__ref-badge /g)?.length ?? 0).toBe(3);
    expect(html.match(/commit-graph__ref-badge-done/g)?.length ?? 0).toBe(1);
    expect(html.match(/commit-graph__ref-badge-icon--local/g)?.length ?? 0).toBe(1);
    expect(html.match(/commit-graph__ref-badge-icon--remote/g)?.length ?? 0).toBe(2);
    expect(html.match(/commit-graph__ref-badge-icon--tag/g)?.length ?? 0).toBe(1);
    expect(html).toContain('title="main, origin/main"');
    expect(html).toMatch(
      /commit-graph__ref-badge-done[\s\S]*commit-graph__ref-badge-label truncate">main<\/span>[\s\S]*commit-graph__ref-badge-icons/,
    );
    expect(html).not.toContain(">origin/main</span>");
    expect(html).toContain("origin/HEAD");
    expect(html).toContain('data-controller-panel-drag-ignore="true"');
    expect(html).not.toContain("Detailed lane mode (branch / merge)");
  });

  test("renders the WIP row when conflicts exist without staged or unstaged files", () => {
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={commits}
        mode="detailed"
        activeCommitSha={null}
        highlightedCommitSha={null}
        checkedOutCommitSha={null}
        scrollToCommitSha={null}
        onScrollToCommitHandled={() => {}}
        hasMore={false}
        loading={false}
        loadingMore={false}
        busy={false}
        wipStagedCount={0}
        wipUnstagedCount={0}
        wipConflictedCount={2}
        onSelectWip={() => {}}
        onSelectCommit={() => {}}
        onCheckoutCommit={() => {}}
        onCheckoutBranchRef={() => {}}
        onLoadMore={() => {}}
        onNotify={() => {}}
        branchContext={continuedDefaultBranchContext}
      />,
    );

    expect(html).toContain("// WIP");
    expect(html).toContain("2 conflicted");
  });

  test("anchors the WIP row above the checked out commit even when it is not the first visible row", () => {
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={nonHeadFirstCommits}
        mode="detailed"
        activeCommitSha={null}
        highlightedCommitSha={null}
        checkedOutCommitSha="feature-tip"
        scrollToCommitSha={null}
        onScrollToCommitHandled={() => {}}
        hasMore={false}
        loading={false}
        loadingMore={false}
        busy={false}
        wipStagedCount={1}
        wipUnstagedCount={0}
        wipConflictedCount={0}
        onSelectWip={() => {}}
        onSelectCommit={() => {}}
        onCheckoutCommit={() => {}}
        onCheckoutBranchRef={() => {}}
        onLoadMore={() => {}}
        onNotify={() => {}}
        branchContext={nonHeadFirstBranchContext}
      />,
    );

    const wipConnectorMatch = html.match(
      /class="wip-row__lane-line wip-row__lane-line--connector"[^>]*x1="([^"]+)"/,
    );
    const firstCommitLaneMatch = html.match(
      /data-commit-sha="main-tip"[\s\S]*?class="commit-graph__lane-line"[^>]*x1="([^"]+)"[^>]*y1="([^"]+)"/,
    );

    expect(html.indexOf("chore: main tip")).toBeLessThan(html.indexOf("// WIP"));
    expect(html.indexOf("// WIP")).toBeLessThan(html.indexOf("feat: current branch tip"));
    expect(wipConnectorMatch?.[1]).toBe(String(laneX(1)));
    expect(firstCommitLaneMatch?.[2]).toBe("17.1");
  });

  test("keeps sibling lanes continuous through an inserted WIP row", () => {
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={nonHeadFirstCommits}
        mode="detailed"
        activeCommitSha={null}
        highlightedCommitSha={null}
        checkedOutCommitSha="feature-tip"
        scrollToCommitSha={null}
        onScrollToCommitHandled={() => {}}
        hasMore={false}
        loading={false}
        loadingMore={false}
        busy={false}
        wipStagedCount={1}
        wipUnstagedCount={0}
        wipConflictedCount={0}
        onSelectWip={() => {}}
        onSelectCommit={() => {}}
        onCheckoutCommit={() => {}}
        onCheckoutBranchRef={() => {}}
        onLoadMore={() => {}}
        onNotify={() => {}}
        branchContext={nonHeadFirstBranchContext}
      />,
    );

    const wipRowHtml = extractWipRowMarkup(html);
    const passthroughLanePattern = new RegExp(
      `class="wip-row__lane-line wip-row__lane-line--passthrough"[^>]*x1="${laneX(0)}"[^>]*y1="-1"[^>]*x2="${laneX(0)}"[^>]*y2="33"[^>]*stroke="${DEFAULT_BRANCH_LANE_COLOR}"`,
    );

    expect(wipRowHtml).toMatch(passthroughLanePattern);
  });

  test("renders the SHA column as a copyable button", () => {
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={commits}
        mode="detailed"
        activeCommitSha={null}
        highlightedCommitSha={null}
        checkedOutCommitSha={null}
        scrollToCommitSha={null}
        onScrollToCommitHandled={() => {}}
        hasMore={false}
        loading={false}
        loadingMore={false}
        busy={false}
        wipStagedCount={0}
        wipUnstagedCount={0}
        wipConflictedCount={0}
        onSelectWip={() => {}}
        onSelectCommit={() => {}}
        onCheckoutCommit={() => {}}
        onCheckoutBranchRef={() => {}}
        onLoadMore={() => {}}
        onNotify={() => {}}
        branchContext={branchContext}
      />,
    );

    expect(html).toContain('title="abc1234 をコピー"');
    expect(html).toContain('aria-label="abc1234 をクリップボードにコピー"');
    expect(html).toContain(">abc1234</span></button>");
  });

  test("keeps the default branch lane emphasized through sibling branch rows", () => {
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={continuedDefaultBranchCommits}
        mode="detailed"
        activeCommitSha={null}
        highlightedCommitSha={null}
        checkedOutCommitSha="main-tip"
        scrollToCommitSha={null}
        onScrollToCommitHandled={() => {}}
        hasMore={false}
        loading={false}
        loadingMore={false}
        busy={false}
        wipStagedCount={0}
        wipUnstagedCount={0}
        wipConflictedCount={0}
        onSelectWip={() => {}}
        onSelectCommit={() => {}}
        onCheckoutCommit={() => {}}
        onCheckoutBranchRef={() => {}}
        onLoadMore={() => {}}
        onNotify={() => {}}
        branchContext={continuedDefaultBranchContext}
      />,
    );

    const featureRowHtml = extractCommitRowMarkup(html, "feature-3");
    const defaultLanePattern = new RegExp(
      `class="commit-graph__lane-line"[^>]*x1="${laneX(0)}"[^>]*x2="${laneX(0)}"[^>]*stroke="${DEFAULT_BRANCH_LANE_COLOR}"[^>]*stroke-width="2.2"[^>]*opacity="0.85"`,
    );

    expect(featureRowHtml).toMatch(defaultLanePattern);
  });

  test("keeps a branched lane at full strength after the split point", () => {
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={continuedDefaultBranchCommits}
        mode="detailed"
        activeCommitSha={null}
        highlightedCommitSha={null}
        checkedOutCommitSha="main-tip"
        scrollToCommitSha={null}
        onScrollToCommitHandled={() => {}}
        hasMore={false}
        loading={false}
        loadingMore={false}
        busy={false}
        wipStagedCount={0}
        wipUnstagedCount={0}
        wipConflictedCount={0}
        onSelectWip={() => {}}
        onSelectCommit={() => {}}
        onCheckoutCommit={() => {}}
        onCheckoutBranchRef={() => {}}
        onLoadMore={() => {}}
        onNotify={() => {}}
        branchContext={continuedDefaultBranchContext}
      />,
    );

    const baseRowHtml = extractCommitRowMarkup(html, "base");
    const branchedLanePattern = new RegExp(
      `class="commit-graph__lane-line"[^>]*x1="${laneX(1)}"[^>]*x2="${laneX(1)}"[^>]*stroke="${RIGHT_BRANCH_LANE_COLORS[0]}"[^>]*stroke-width="2.2"[^>]*opacity="0.85"`,
    );

    expect(baseRowHtml).toMatch(branchedLanePattern);
  });

  test("renders author avatars on commit nodes when cached sources are available", () => {
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={commits}
        commitAuthorAvatars={{
          abc1234: "data:image/png;base64,avatar",
        }}
        mode="detailed"
        activeCommitSha={null}
        highlightedCommitSha={null}
        checkedOutCommitSha={null}
        scrollToCommitSha={null}
        onScrollToCommitHandled={() => {}}
        hasMore={false}
        loading={false}
        loadingMore={false}
        busy={false}
        wipStagedCount={0}
        wipUnstagedCount={0}
        wipConflictedCount={0}
        onSelectWip={() => {}}
        onSelectCommit={() => {}}
        onCheckoutCommit={() => {}}
        onCheckoutBranchRef={() => {}}
        onLoadMore={() => {}}
        onNotify={() => {}}
        branchContext={branchContext}
      />,
    );

    expect(html).toContain('class="absolute block commit-node commit-node--avatar');
    expect(html).toContain('src="data:image/png;base64,avatar"');
    expect(html).toContain('class="commit-node__avatar"');
  });
});
