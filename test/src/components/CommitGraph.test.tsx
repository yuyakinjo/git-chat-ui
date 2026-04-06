import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildCommitRefBadges,
  buildDefaultBranchAnchorLaneIndices,
  buildPrimaryParentCurvePath,
  DEFAULT_BRANCH_LANE_COLOR,
  getLaneDisplayOffset,
  LEFT_BRANCH_LANE_COLORS,
  laneX,
  parseCommitRefLabels,
  RIGHT_BRANCH_LANE_COLORS,
  laneColor,
  resolveCommitGraphStyleMetrics,
} from "../../../src/components/CommitGraphHelpers";
import type { BranchResponse, CommitListItem } from "../../../src/types";

import {
  CommitGraph,
  resolveCommitEnterAnimationTargets,
} from "../../../src/components/CommitGraph";
import { buildLaneRows } from "../../../src/lib/commitGraphLayout";

function roundGraphCoordinate(value: number): number {
  return Math.round(value * 10) / 10;
}

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

const checkedOutMainBranchingCommits: CommitListItem[] = [
  {
    sha: "feature-tip",
    parentShas: ["feature-seed"],
    author: "kinjo",
    date: "2026-03-30T12:00:00.000Z",
    subject: "feat: branch tip",
    decoration: "(test-branch-1)",
  },
  {
    sha: "feature-seed",
    parentShas: ["main-base"],
    author: "kinjo",
    date: "2026-03-29T12:00:00.000Z",
    subject: "feat: branch seed",
    decoration: "",
  },
  {
    sha: "main-base",
    parentShas: [],
    author: "kinjo",
    date: "2026-03-28T12:00:00.000Z",
    subject: "chore: main base",
    decoration: "(HEAD -> main, origin/main, origin/HEAD)",
  },
];

const checkedOutMainBranchContext: BranchResponse = {
  current: "main",
  local: [
    {
      name: "main",
      fullRef: "refs/heads/main",
      type: "local",
      commit: "main-base",
    },
  ],
  remote: [
    {
      name: "origin/main",
      fullRef: "refs/remotes/origin/main",
      type: "remote",
      commit: "main-base",
      isRemoteDefault: true,
    },
  ],
};

const stackedCheckedOutBranchCommitsBase: CommitListItem[] = [
  {
    sha: "main-tip",
    parentShas: ["main-base"],
    author: "kinjo",
    date: "2026-03-31T16:30:00.000Z",
    subject: "chore: main tip",
    decoration: "(main, origin/main, origin/HEAD)",
  },
  {
    sha: "test-branch-3-tip",
    parentShas: ["test-branch-3-seed"],
    author: "kinjo",
    date: "2026-03-31T16:00:00.000Z",
    subject: "feat: branch 3 tip",
    decoration: "(test-branch-3)",
  },
  {
    sha: "test-branch-2-tip",
    parentShas: ["test-branch-2-seed"],
    author: "kinjo",
    date: "2026-03-31T15:00:00.000Z",
    subject: "feat: branch 2 tip",
    decoration: "(test-branch-2)",
  },
  {
    sha: "test-branch-1-tip",
    parentShas: ["test-branch-1-seed"],
    author: "kinjo",
    date: "2026-03-31T14:00:00.000Z",
    subject: "feat: branch 1 tip",
    decoration: "(test-branch-1)",
  },
  {
    sha: "test-branch-3-seed",
    parentShas: ["main-base"],
    author: "kinjo",
    date: "2026-03-31T13:00:00.000Z",
    subject: "feat: branch 3 seed",
    decoration: "",
  },
  {
    sha: "test-branch-2-seed",
    parentShas: ["main-base"],
    author: "kinjo",
    date: "2026-03-31T12:00:00.000Z",
    subject: "feat: branch 2 seed",
    decoration: "",
  },
  {
    sha: "test-branch-1-seed",
    parentShas: ["main-base"],
    author: "kinjo",
    date: "2026-03-31T11:00:00.000Z",
    subject: "feat: branch 1 seed",
    decoration: "",
  },
  {
    sha: "main-base",
    parentShas: ["root"],
    author: "kinjo",
    date: "2026-03-31T10:00:00.000Z",
    subject: "chore: main base",
    decoration: "",
  },
  {
    sha: "root",
    parentShas: [],
    author: "kinjo",
    date: "2026-03-31T09:00:00.000Z",
    subject: "chore: root",
    decoration: "",
  },
];

function buildStackedCheckedOutBranchCommits(currentBranchName: string): CommitListItem[] {
  return stackedCheckedOutBranchCommitsBase.map((commit) => {
    if (commit.sha !== `${currentBranchName}-tip`) {
      return commit;
    }

    return {
      ...commit,
      decoration: `(HEAD -> ${currentBranchName})`,
    };
  });
}

function buildStackedCheckedOutBranchContext(currentBranchName: string): BranchResponse {
  return {
    current: currentBranchName,
    local: [
      {
        name: "test-branch-1",
        fullRef: "refs/heads/test-branch-1",
        type: "local",
        commit: "test-branch-1-tip",
      },
      {
        name: "test-branch-2",
        fullRef: "refs/heads/test-branch-2",
        type: "local",
        commit: "test-branch-2-tip",
      },
      {
        name: "test-branch-3",
        fullRef: "refs/heads/test-branch-3",
        type: "local",
        commit: "test-branch-3-tip",
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
}

const rightBranchOffCommits: CommitListItem[] = [
  {
    sha: "left-tip",
    parentShas: ["left-seed"],
    author: "kinjo",
    date: "2026-03-31T12:00:00.000Z",
    subject: "feat: left branch tip",
    decoration: "",
  },
  {
    sha: "right-tip",
    parentShas: ["right-seed"],
    author: "kinjo",
    date: "2026-03-30T12:00:00.000Z",
    subject: "feat: right branch tip",
    decoration: "",
  },
  {
    sha: "right-seed",
    parentShas: ["main-base"],
    author: "kinjo",
    date: "2026-03-29T12:00:00.000Z",
    subject: "feat: right branch seed",
    decoration: "",
  },
  {
    sha: "left-seed",
    parentShas: ["main-base"],
    author: "kinjo",
    date: "2026-03-28T18:00:00.000Z",
    subject: "feat: left branch seed",
    decoration: "",
  },
  {
    sha: "main-base",
    parentShas: [],
    author: "kinjo",
    date: "2026-03-28T12:00:00.000Z",
    subject: "chore: main base",
    decoration: "(HEAD -> main, origin/main, origin/HEAD)",
  },
];

const stackedBranchOffCommits: CommitListItem[] = [
  {
    sha: "c-tip",
    parentShas: ["c-seed"],
    author: "kinjo",
    date: "2026-03-31T16:00:00.000Z",
    subject: "feat: branch c tip",
    decoration: "",
  },
  {
    sha: "b-tip",
    parentShas: ["b-seed"],
    author: "kinjo",
    date: "2026-03-31T15:00:00.000Z",
    subject: "feat: branch b tip",
    decoration: "",
  },
  {
    sha: "a-tip",
    parentShas: ["a-seed"],
    author: "kinjo",
    date: "2026-03-31T14:00:00.000Z",
    subject: "feat: branch a tip",
    decoration: "",
  },
  {
    sha: "c-seed",
    parentShas: ["b-seed"],
    author: "kinjo",
    date: "2026-03-31T13:00:00.000Z",
    subject: "feat: branch c seed",
    decoration: "",
  },
  {
    sha: "b-seed",
    parentShas: ["a-seed"],
    author: "kinjo",
    date: "2026-03-31T12:00:00.000Z",
    subject: "feat: branch b seed",
    decoration: "",
  },
  {
    sha: "a-seed",
    parentShas: ["main-base"],
    author: "kinjo",
    date: "2026-03-31T11:00:00.000Z",
    subject: "feat: branch a seed",
    decoration: "",
  },
  {
    sha: "main-base",
    parentShas: [],
    author: "kinjo",
    date: "2026-03-31T10:00:00.000Z",
    subject: "chore: main base",
    decoration: "(HEAD -> main, origin/main, origin/HEAD)",
  },
];

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

function extractLaneLineSignatures(markup: string): string[] {
  return [
    ...markup.matchAll(
      /class="[^"]*lane-line[^"]*"[^>]*x1="([^"]+)"[^>]*y1="([^"]+)"[^>]*x2="([^"]+)"[^>]*y2="([^"]+)"/g,
    ),
  ].map((match) => `${match[1]}:${match[2]}:${match[3]}:${match[4]}`);
}

describe("CommitGraph", () => {
  test("uses the widened lane spacing", () => {
    expect(laneX(1) - laneX(0)).toBe(27);
  });

  test("uses standard lane display offsets for Japanese Express", () => {
    expect(getLaneDisplayOffset(0, "japaneseExpress")).toBe(0);
    expect(getLaneDisplayOffset(1, "japaneseExpress")).toBe(1);
    expect(getLaneDisplayOffset(2, "japaneseExpress")).toBe(2);
    expect(laneColor(0, 1, "japaneseExpress")).toBe(LEFT_BRANCH_LANE_COLORS[0]);
    expect(laneColor(2, 1, "japaneseExpress")).toBe(RIGHT_BRANCH_LANE_COLORS[0]);
  });

  test("builds branch-off paths that round slightly into the parent node edge", () => {
    expect(
      buildPrimaryParentCurvePath({
        sourceLaneIndex: 1,
        targetLaneIndex: 0,
        targetY: 48,
        targetJoinX: laneX(0) + 3.8,
      }),
    ).toBe(
      `M ${laneX(1)} 16 L ${laneX(1)} 44 Q ${laneX(1)} 48, ${laneX(1) - 4} 48 L ${laneX(0) + 3.8} 48`,
    );
  });

  test("builds reverse branch-off paths for origin-to-head pulses", () => {
    expect(
      buildPrimaryParentCurvePath({
        sourceLaneIndex: 1,
        targetLaneIndex: 0,
        targetY: 48,
        targetJoinX: laneX(0) + 3.8,
        reverse: true,
      }),
    ).toBe(
      `M ${laneX(0) + 3.8} 48 L ${laneX(1) - 4} 48 Q ${laneX(1)} 48, ${laneX(1)} 44 L ${laneX(1)} 16`,
    );
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
    ]);
  });

  test("leaves the refs cell empty when a commit has no refs", () => {
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={commits}
        mode="detailed"
        graphStyle="standard"
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

    const rowHtml = extractCommitRowMarkup(html, "def5678");

    expect(rowHtml).not.toContain('class="text-ink-subtle">-</span>');
    expect(rowHtml).not.toContain("commit-graph__ref-badge");
    expect(rowHtml).toContain("chore: base commit");
  });

  test("renders the current local branch badge as head even if the decoration is stale", () => {
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={[
          {
            ...nonHeadFirstCommits[0],
            decoration: "(main, origin/main, origin/HEAD)",
          },
          {
            ...nonHeadFirstCommits[1],
            decoration: "(fix-merge-dialog)",
          },
          nonHeadFirstCommits[2],
        ]}
        mode="detailed"
        graphStyle="standard"
        activeCommitSha={null}
        highlightedCommitSha={null}
        checkedOutCommitSha="feature-tip"
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
        branchContext={nonHeadFirstBranchContext}
      />,
    );

    const featureRowHtml = extractCommitRowMarkup(html, "feature-tip");
    const mainRowHtml = extractCommitRowMarkup(html, "main-tip");

    expect(featureRowHtml).toContain("commit-graph__ref-badge-done");
    expect(featureRowHtml).toContain("fix-merge-dialog");
    expect(mainRowHtml).not.toContain("commit-graph__ref-badge-done");
  });

  test("keeps existing rows visible while loading more commits", () => {
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={commits}
        mode="detailed"
        graphStyle="standard"
        activeCommitSha={null}
        highlightedCommitSha={null}
        checkedOutCommitSha={null}
        scrollToCommitSha={null}
        onScrollToCommitHandled={() => {}}
        hasMore={true}
        loading={false}
        loadingMore={true}
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

    expect(html).toContain("feat: sample graph node");
    expect(html).toContain("chore: base commit");
    expect(html).toContain("さらに読み込み中...");
    expect(html).not.toContain("コミットを読み込み中...");
  });

  test("targets only appended commit rows for enter animations", () => {
    expect(resolveCommitEnterAnimationTargets(["a", "b"], 0)).toEqual(["a", "b"]);
    expect(resolveCommitEnterAnimationTargets(["a", "b", "c", "d"], 2)).toEqual(["c", "d"]);
    expect(resolveCommitEnterAnimationTargets(["a", "b"], 4)).toEqual([]);
  });

  test("renders the WIP marker as a hollow dashed circle in detailed mode", () => {
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={commits}
        mode="detailed"
        graphStyle="standard"
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
        onJumpToCommit={async () => false}
        branchContext={continuedDefaultBranchContext}
      />,
    );

    const wipConnectorMatch = html.match(
      /class="wip-row__lane-line wip-row__lane-line--connector"[^>]*x1="([^"]+)"[^>]*y1="([^"]+)"[^>]*x2="([^"]+)"[^>]*y2="([^"]+)"/,
    );
    const firstCommitLaneMatch = html.match(
      /data-commit-sha="abc1234"[\s\S]*?class="commit-graph__lane-line"[^>]*x1="([^"]+)"[^>]*y1="([^"]+)"[^>]*x2="([^"]+)"[^>]*y2="([^"]+)"/,
    );
    const wipRowHtml = extractWipRowMarkup(html);
    const firstCommitRowHtml = extractCommitRowMarkup(html, "abc1234");
    const baseRowHtml = extractCommitRowMarkup(html, "def5678");

    expect(html).not.toContain("wip-row__lane-line--stub");
    expect(wipConnectorMatch?.[2]).toBe("24");
    expect(wipConnectorMatch?.[4]).toBe("33");
    expect(firstCommitLaneMatch?.[2]).toBe("-1");
    expect(firstCommitLaneMatch?.[4]).toBe("33");
    expect(wipRowHtml).toMatch(
      /class="wip-row__lane-line wip-row__lane-line--connector"[^>]*stroke-dasharray="0 5"[^>]*stroke-dashoffset="0"/,
    );
    expect(firstCommitRowHtml).toMatch(
      new RegExp(
        `class="commit-graph__lane-line"[^>]*x1="${laneX(0)}"[^>]*stroke-dasharray="0 5"[^>]*stroke-dashoffset="2"`,
      ),
    );
    expect(html).toContain('class="wip-node-ring"');
    expect(html).toContain('stroke-dasharray="2 3"');
    expect(wipRowHtml).toMatch(
      new RegExp(`class="wip-node[^"]*"[^>]*style="[^"]*color:${DEFAULT_BRANCH_LANE_COLOR}`),
    );
    expect(html).not.toContain('class="wip-node-core"');
    expect(html).toContain('class="wip-row__badge');
    expect(html).toContain('class="wip-row__primary');
    expect(html).toContain('class="wip-row__meta');
    expect(html).toContain("commit-graph__header");
    expect(html).toContain("commit-graph__sha-jump-trigger");
    expect(html).toContain('title="SHA を入力して commit に移動"');
    expect(html).toContain('class="commit-graph__columns"');
    expect(html.match(/commit-graph__column-header/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(html).toContain('class="commit-graph__column-label">Refs</span>');
    expect(html).toContain('class="commit-graph__column-label">Date</span>');
    expect(html).toContain('class="commit-graph__column-label">Message</span>');
    expect(html).toContain('class="commit-graph__column-label">Author</span>');
    expect(html).toContain("commit-graph__cell--primary");
    expect(html).toContain("commit-graph__ref-badge--tag");
    expect(html).toContain("commit-graph__ref-badge-icon");
    expect(html).toContain("commit-graph__ref-badge-icons");
    expect(html).toContain("commit-graph__ref-badge-label");
    expect(html.match(/class="commit-graph__ref-badge /g)?.length ?? 0).toBe(2);
    expect(html.match(/commit-graph__ref-badge-done/g)?.length ?? 0).toBe(0);
    expect(html.match(/commit-graph__ref-badge-icon--local/g)?.length ?? 0).toBe(1);
    expect(html.match(/commit-graph__ref-badge-icon--remote/g)?.length ?? 0).toBe(1);
    expect(html.match(/commit-graph__ref-badge-icon--tag/g)?.length ?? 0).toBe(1);
    expect(html).toContain('title="main, origin/main"');
    expect(html).not.toContain(">origin/main</span>");
    expect(html).not.toContain("origin/HEAD");
    expect(baseRowHtml).not.toContain('text-ink-subtle">-</span>');
    expect(html).toContain('data-controller-panel-drag-ignore="true"');
    expect(html).not.toContain("Detailed lane mode (branch / merge)");
  });

  test("clips detailed lane SVG overflow so rounded caps do not bleed past row bounds", () => {
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={commits}
        mode="detailed"
        graphStyle="standard"
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

    const wipRowHtml = extractWipRowMarkup(html);
    const firstCommitRowHtml = extractCommitRowMarkup(html, "abc1234");

    expect(wipRowHtml).toContain('overflow="hidden"');
    expect(firstCommitRowHtml).toContain('overflow="hidden"');
  });

  test("renders the WIP row when conflicts exist without staged or unstaged files", () => {
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={commits}
        mode="detailed"
        graphStyle="standard"
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

  test("keeps the WIP row at the top even when the checked out commit is lower in the list", () => {
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={nonHeadFirstCommits}
        mode="detailed"
        graphStyle="standard"
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
    const mainRowHtml = extractCommitRowMarkup(html, "main-tip");

    expect(html.indexOf("// WIP")).toBeLessThan(html.indexOf("chore: main tip"));
    expect(html.indexOf("// WIP")).toBeLessThan(html.indexOf("feat: current branch tip"));
    expect(wipConnectorMatch?.[1]).toBe(String(laneX(0)));
    expect(mainRowHtml).toMatch(new RegExp(`class="commit-graph__lane-line"[^>]*x1="${laneX(0)}"`));
    expect(mainRowHtml).not.toMatch(
      new RegExp(`class="commit-graph__lane-line"[^>]*x1="${laneX(1)}"`),
    );
  });

  test("does not draw sibling passthrough lanes on the topmost commit row", () => {
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={nonHeadFirstCommits}
        mode="detailed"
        graphStyle="standard"
        activeCommitSha={null}
        highlightedCommitSha={null}
        checkedOutCommitSha="feature-tip"
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
        branchContext={nonHeadFirstBranchContext}
      />,
    );

    const mainRowHtml = extractCommitRowMarkup(html, "main-tip");

    expect(mainRowHtml).toMatch(new RegExp(`class="commit-graph__lane-line"[^>]*x1="${laneX(0)}"`));
    expect(mainRowHtml).not.toMatch(
      new RegExp(`class="commit-graph__lane-line"[^>]*x1="${laneX(1)}"`),
    );
  });

  test("draws the default-branch incoming segment above the non-anchor branch row", () => {
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={nonHeadFirstCommits}
        mode="detailed"
        graphStyle="standard"
        activeCommitSha={null}
        highlightedCommitSha={null}
        checkedOutCommitSha="feature-tip"
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
        branchContext={nonHeadFirstBranchContext}
      />,
    );

    const featureRowHtml = extractCommitRowMarkup(html, "feature-tip");

    expect(featureRowHtml).toMatch(
      new RegExp(
        `class="commit-graph__lane-line"[^>]*x1="${laneX(0)}"[^>]*y1="-1"[^>]*x2="${laneX(0)}"[^>]*y2="33"`,
      ),
    );
    expect(featureRowHtml).toContain("<path");
  });

  test("does not draw sibling passthrough lanes on the topmost WIP row", () => {
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={nonHeadFirstCommits}
        mode="detailed"
        graphStyle="standard"
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
    expect(wipRowHtml).not.toContain("wip-row__lane-line--passthrough");
  });

  test("draws branch-off curves to the checked out main commit row instead of the lane midpoint", () => {
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={checkedOutMainBranchingCommits}
        mode="detailed"
        graphStyle="standard"
        activeCommitSha={null}
        highlightedCommitSha={null}
        checkedOutCommitSha="main-base"
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
        branchContext={checkedOutMainBranchContext}
      />,
    );

    const featureSeedRowHtml = extractCommitRowMarkup(html, "feature-seed");

    expect(featureSeedRowHtml).toMatch(
      new RegExp(
        `class="commit-graph__lane-line"[^>]*x1="${laneX(1)}"[^>]*y1="-1"[^>]*x2="${laneX(1)}"[^>]*y2="14\\.9"`,
      ),
    );
    expect(featureSeedRowHtml).toContain(
      `d="M ${laneX(1)} 16 L ${laneX(1)} 44 Q ${laneX(1)} 48, ${laneX(1) - 4} 48 L ${laneX(0) + 3.8} 48"`,
    );
    expect(featureSeedRowHtml).toMatch(new RegExp(`stroke="${RIGHT_BRANCH_LANE_COLORS[0]}"`));
  });

  test("renders the SHA column as a copyable button", () => {
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={commits}
        mode="detailed"
        graphStyle="standard"
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
    expect(html).toContain('class="commit-graph__column-label">SHA</span>');
    expect(html).toContain(">abc1234</span></button>");
  });

  test("keeps the default branch lane emphasized through sibling branch rows", () => {
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={continuedDefaultBranchCommits}
        mode="detailed"
        graphStyle="standard"
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

  test("does not keep a branched lane below the split point", () => {
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={continuedDefaultBranchCommits}
        mode="detailed"
        graphStyle="standard"
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

    expect(baseRowHtml).not.toMatch(branchedLanePattern);
  });

  test("renders author avatars on commit nodes when cached sources are available", () => {
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={commits}
        commitAuthorAvatars={{
          abc1234: "data:image/png;base64,avatar",
        }}
        mode="detailed"
        graphStyle="standard"
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

  test("keeps Japanese Express lane lines stable when only the checked out commit changes", () => {
    const featureCheckedHtml = renderToStaticMarkup(
      <CommitGraph
        commits={nonHeadFirstCommits}
        mode="detailed"
        graphStyle="japaneseExpress"
        activeCommitSha={null}
        highlightedCommitSha={null}
        checkedOutCommitSha="feature-tip"
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
        branchContext={nonHeadFirstBranchContext}
      />,
    );
    const mainCheckedHtml = renderToStaticMarkup(
      <CommitGraph
        commits={nonHeadFirstCommits}
        mode="detailed"
        graphStyle="japaneseExpress"
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
        branchContext={nonHeadFirstBranchContext}
      />,
    );

    const featureCheckedMainRowHtml = extractCommitRowMarkup(featureCheckedHtml, "main-tip");
    const mainCheckedMainRowHtml = extractCommitRowMarkup(mainCheckedHtml, "main-tip");
    const featureCheckedFeatureRowHtml = extractCommitRowMarkup(featureCheckedHtml, "feature-tip");
    const mainCheckedFeatureRowHtml = extractCommitRowMarkup(mainCheckedHtml, "feature-tip");

    expect(featureCheckedHtml).toContain('data-commit-graph-style="japaneseExpress"');
    expect(featureCheckedHtml).toContain('stroke-width="4.4"');
    expect(extractLaneLineSignatures(featureCheckedMainRowHtml)).toEqual(
      extractLaneLineSignatures(mainCheckedMainRowHtml),
    );
    expect(extractLaneLineSignatures(featureCheckedFeatureRowHtml)).toEqual(
      extractLaneLineSignatures(mainCheckedFeatureRowHtml),
    );
    expect(featureCheckedFeatureRowHtml).toContain("commit-node-head-glow");
    expect(mainCheckedFeatureRowHtml).not.toContain("commit-node-head-glow");
    expect(mainCheckedMainRowHtml).toContain("commit-node-head-glow");
  });

  test("anchors the Japanese Express WIP row to the default branch lane even when checkout changes", () => {
    const metrics = resolveCommitGraphStyleMetrics("japaneseExpress");
    const minLaneDisplayOffset = Math.min(
      getLaneDisplayOffset(0, "japaneseExpress"),
      getLaneDisplayOffset(1, "japaneseExpress"),
    );
    const mainLaneX = laneX(0, {
      style: "japaneseExpress",
      minLaneDisplayOffset,
      laneGap: metrics.laneGap,
      lanePadding: metrics.lanePadding,
    });
    const featureLaneX = laneX(1, {
      style: "japaneseExpress",
      minLaneDisplayOffset,
      laneGap: metrics.laneGap,
      lanePadding: metrics.lanePadding,
    });
    const featureCheckedHtml = renderToStaticMarkup(
      <CommitGraph
        commits={checkedOutMainBranchingCommits}
        mode="detailed"
        graphStyle="japaneseExpress"
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
        branchContext={checkedOutMainBranchContext}
      />,
    );
    const mainCheckedHtml = renderToStaticMarkup(
      <CommitGraph
        commits={checkedOutMainBranchingCommits}
        mode="detailed"
        graphStyle="japaneseExpress"
        activeCommitSha={null}
        highlightedCommitSha={null}
        checkedOutCommitSha="main-base"
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
        branchContext={checkedOutMainBranchContext}
      />,
    );

    const featureCheckedWipRowHtml = extractWipRowMarkup(featureCheckedHtml);
    const mainCheckedWipRowHtml = extractWipRowMarkup(mainCheckedHtml);
    const featureCheckedTipRowHtml = extractCommitRowMarkup(featureCheckedHtml, "feature-tip");
    const mainCheckedTipRowHtml = extractCommitRowMarkup(mainCheckedHtml, "feature-tip");

    expect(featureCheckedWipRowHtml).toMatch(
      new RegExp(
        `class="wip-row__lane-line wip-row__lane-line--connector"[^>]*x1="${mainLaneX}"[^>]*x2="${mainLaneX}"[^>]*stroke-dasharray="0 8"[^>]*stroke-dashoffset="0"`,
      ),
    );
    expect(featureCheckedWipRowHtml).not.toContain(`x1="${featureLaneX}"`);
    expect(extractLaneLineSignatures(featureCheckedWipRowHtml)).toEqual(
      extractLaneLineSignatures(mainCheckedWipRowHtml),
    );
    expect(extractLaneLineSignatures(featureCheckedTipRowHtml)).toEqual(
      extractLaneLineSignatures(mainCheckedTipRowHtml),
    );
    expect(featureCheckedWipRowHtml).toMatch(
      new RegExp(`class="wip-node[^"]*"[^>]*style="[^"]*color:${DEFAULT_BRANCH_LANE_COLOR}`),
    );
  });

  test("keeps stacked Japanese Express lane lines stable across branch checkouts", () => {
    const baselineBranchName = "test-branch-1";
    const baselineHtml = renderToStaticMarkup(
      <CommitGraph
        commits={buildStackedCheckedOutBranchCommits(baselineBranchName)}
        mode="detailed"
        graphStyle="japaneseExpress"
        activeCommitSha={null}
        highlightedCommitSha={null}
        checkedOutCommitSha={`${baselineBranchName}-tip`}
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
        branchContext={buildStackedCheckedOutBranchContext(baselineBranchName)}
      />,
    );
    const baselineLaneSignatures = new Map(
      stackedCheckedOutBranchCommitsBase.map((commit) => [
        commit.sha,
        extractLaneLineSignatures(extractCommitRowMarkup(baselineHtml, commit.sha)),
      ]),
    );

    for (const currentBranchName of ["test-branch-2", "test-branch-3"]) {
      const html = renderToStaticMarkup(
        <CommitGraph
          commits={buildStackedCheckedOutBranchCommits(currentBranchName)}
          mode="detailed"
          graphStyle="japaneseExpress"
          activeCommitSha={null}
          highlightedCommitSha={null}
          checkedOutCommitSha={`${currentBranchName}-tip`}
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
          branchContext={buildStackedCheckedOutBranchContext(currentBranchName)}
        />,
      );

      for (const commit of stackedCheckedOutBranchCommitsBase) {
        expect(extractLaneLineSignatures(extractCommitRowMarkup(html, commit.sha))).toEqual(
          baselineLaneSignatures.get(commit.sha) ?? [],
        );
      }
    }
  });

  test("overlaps Japanese Express avatar parent nodes enough to keep the branch attached to the icon edge", () => {
    const metrics = resolveCommitGraphStyleMetrics("japaneseExpress");
    const minLaneDisplayOffset = Math.min(
      getLaneDisplayOffset(0, "japaneseExpress"),
      getLaneDisplayOffset(1, "japaneseExpress"),
    );
    const mainLaneX = laneX(0, {
      style: "japaneseExpress",
      minLaneDisplayOffset,
      laneGap: metrics.laneGap,
      lanePadding: metrics.lanePadding,
    });
    const featureLaneX = laneX(1, {
      style: "japaneseExpress",
      minLaneDisplayOffset,
      laneGap: metrics.laneGap,
      lanePadding: metrics.lanePadding,
    });
    const expectedOverlap = Math.max(2, Math.min(4, metrics.avatarNodeSize * 0.12));
    const expectedJoinX = roundGraphCoordinate(mainLaneX - expectedOverlap);
    const expectedStemJoinX = mainLaneX - expectedOverlap;
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={checkedOutMainBranchingCommits}
        commitAuthorAvatars={{
          "main-base": "data:image/png;base64,avatar-parent",
        }}
        mode="detailed"
        graphStyle="japaneseExpress"
        activeCommitSha={null}
        highlightedCommitSha={null}
        checkedOutCommitSha="main-base"
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
        branchContext={checkedOutMainBranchContext}
      />,
    );

    const featureSeedRowHtml = extractCommitRowMarkup(html, "feature-seed");
    const mainBaseRowHtml = extractCommitRowMarkup(html, "main-base");

    expect(featureSeedRowHtml).toContain(
      `d="M ${featureLaneX} 16 L ${featureLaneX} 44 Q ${featureLaneX} 48, ${featureLaneX - 4} 48 L ${expectedJoinX} 48"`,
    );
    expect(mainBaseRowHtml).toContain(
      `class="commit-graph__lane-line" x1="${featureLaneX}" y1="16" x2="${expectedStemJoinX}" y2="16"`,
    );
    expect(mainBaseRowHtml).toContain('src="data:image/png;base64,avatar-parent"');
  });

  test("keeps a right-side Japanese Express branch attached to the main avatar edge", () => {
    const metrics = resolveCommitGraphStyleMetrics("japaneseExpress");
    const minLaneDisplayOffset = Math.min(
      getLaneDisplayOffset(0, "japaneseExpress"),
      getLaneDisplayOffset(1, "japaneseExpress"),
      getLaneDisplayOffset(2, "japaneseExpress"),
    );
    const mainLaneX = laneX(0, {
      style: "japaneseExpress",
      minLaneDisplayOffset,
      laneGap: metrics.laneGap,
      lanePadding: metrics.lanePadding,
    });
    const rightLaneX = laneX(2, {
      style: "japaneseExpress",
      minLaneDisplayOffset,
      laneGap: metrics.laneGap,
      lanePadding: metrics.lanePadding,
    });
    const expectedOverlap = Math.max(2, Math.min(4, metrics.avatarNodeSize * 0.12));
    const expectedRightJoinX = roundGraphCoordinate(mainLaneX - expectedOverlap);
    const expectedRightStemJoinX = mainLaneX - expectedOverlap;
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={rightBranchOffCommits}
        commitAuthorAvatars={{
          "main-base": "data:image/png;base64,avatar-parent",
        }}
        mode="detailed"
        graphStyle="japaneseExpress"
        activeCommitSha={null}
        highlightedCommitSha={null}
        checkedOutCommitSha="main-base"
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
        branchContext={checkedOutMainBranchContext}
      />,
    );

    const rightSeedRowHtml = extractCommitRowMarkup(html, "right-seed");
    const mainBaseRowHtml = extractCommitRowMarkup(html, "main-base");

    expect(rightSeedRowHtml).toContain(
      `d="M ${rightLaneX} 16 L ${rightLaneX} 76 Q ${rightLaneX} 80, ${rightLaneX - 4} 80 L ${expectedRightJoinX} 80"`,
    );
    expect(mainBaseRowHtml).toContain(
      `class="commit-graph__lane-line" x1="${rightLaneX}" y1="16" x2="${expectedRightStemJoinX}" y2="16"`,
    );
  });

  test("keeps stacked Japanese Express sibling branches sprouting from their source rows", () => {
    const metrics = resolveCommitGraphStyleMetrics("japaneseExpress");
    const minLaneDisplayOffset = Math.min(
      getLaneDisplayOffset(0, "japaneseExpress"),
      getLaneDisplayOffset(1, "japaneseExpress"),
      getLaneDisplayOffset(2, "japaneseExpress"),
      getLaneDisplayOffset(3, "japaneseExpress"),
    );
    const mainLaneX = laneX(0, {
      style: "japaneseExpress",
      minLaneDisplayOffset,
      laneGap: metrics.laneGap,
      lanePadding: metrics.lanePadding,
    });
    const laneOneX = laneX(1, {
      style: "japaneseExpress",
      minLaneDisplayOffset,
      laneGap: metrics.laneGap,
      lanePadding: metrics.lanePadding,
    });
    const laneTwoX = laneX(2, {
      style: "japaneseExpress",
      minLaneDisplayOffset,
      laneGap: metrics.laneGap,
      lanePadding: metrics.lanePadding,
    });
    const laneThreeX = laneX(3, {
      style: "japaneseExpress",
      minLaneDisplayOffset,
      laneGap: metrics.laneGap,
      lanePadding: metrics.lanePadding,
    });
    const expectedOverlap = Math.max(2, Math.min(4, metrics.avatarNodeSize * 0.12));
    const expectedMainJoinX = roundGraphCoordinate(mainLaneX - expectedOverlap);
    const expectedMainStemJoinX = mainLaneX - expectedOverlap;
    const primaryParentJoinInset = Math.max(1, Math.min(3, metrics.nodeSize * 0.18));
    const expectedCSeedJoinX = roundGraphCoordinate(
      laneTwoX - (metrics.nodeSize / 2 - primaryParentJoinInset),
    );
    const expectedBSeedJoinX = roundGraphCoordinate(
      laneThreeX - (metrics.nodeSize / 2 - primaryParentJoinInset),
    );
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={stackedBranchOffCommits}
        commitAuthorAvatars={{
          "main-base": "data:image/png;base64,avatar-parent",
        }}
        mode="detailed"
        graphStyle="japaneseExpress"
        activeCommitSha={null}
        highlightedCommitSha={null}
        checkedOutCommitSha="main-base"
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
        branchContext={checkedOutMainBranchContext}
      />,
    );

    const cSeedRowHtml = extractCommitRowMarkup(html, "c-seed");
    const bSeedRowHtml = extractCommitRowMarkup(html, "b-seed");
    const aSeedRowHtml = extractCommitRowMarkup(html, "a-seed");
    const mainBaseRowHtml = extractCommitRowMarkup(html, "main-base");

    expect(cSeedRowHtml).toContain(
      `d="M ${laneOneX} 16 L ${laneOneX} 44 Q ${laneOneX} 48, ${laneOneX + 4} 48 L ${expectedCSeedJoinX} 48"`,
    );
    expect(bSeedRowHtml).toContain(
      `d="M ${laneTwoX} 16 L ${laneTwoX} 44 Q ${laneTwoX} 48, ${laneTwoX + 4} 48 L ${expectedBSeedJoinX} 48"`,
    );
    expect(aSeedRowHtml).toContain(
      `d="M ${laneThreeX} 16 L ${laneThreeX} 44 Q ${laneThreeX} 48, ${laneThreeX - 4} 48 L ${expectedMainJoinX} 48"`,
    );
    expect(bSeedRowHtml).toContain(
      `class="commit-graph__lane-line" x1="${laneOneX}" y1="16" x2="${expectedCSeedJoinX}" y2="16"`,
    );
    expect(aSeedRowHtml).toContain(
      `class="commit-graph__lane-line" x1="${laneTwoX}" y1="16" x2="${expectedBSeedJoinX}" y2="16"`,
    );
    expect(mainBaseRowHtml).toContain(
      `class="commit-graph__lane-line" x1="${laneThreeX}" y1="16" x2="${expectedMainStemJoinX}" y2="16"`,
    );
    expect(mainBaseRowHtml).not.toContain(`x1="${laneOneX}" y1="16" x2="`);
    expect(mainBaseRowHtml).not.toContain(`x1="${laneTwoX}" y1="16" x2="`);
  });

  test("keeps stacked Japanese Express WIP on the standard anchor while source stems stay on commit rows", () => {
    const metrics = resolveCommitGraphStyleMetrics("japaneseExpress");
    const minLaneDisplayOffset = Math.min(
      getLaneDisplayOffset(0, "japaneseExpress"),
      getLaneDisplayOffset(1, "japaneseExpress"),
      getLaneDisplayOffset(2, "japaneseExpress"),
      getLaneDisplayOffset(3, "japaneseExpress"),
    );
    const mainLaneX = laneX(0, {
      style: "japaneseExpress",
      minLaneDisplayOffset,
      laneGap: metrics.laneGap,
      lanePadding: metrics.lanePadding,
    });
    const laneOneX = laneX(1, {
      style: "japaneseExpress",
      minLaneDisplayOffset,
      laneGap: metrics.laneGap,
      lanePadding: metrics.lanePadding,
    });
    const laneTwoX = laneX(2, {
      style: "japaneseExpress",
      minLaneDisplayOffset,
      laneGap: metrics.laneGap,
      lanePadding: metrics.lanePadding,
    });
    const laneThreeX = laneX(3, {
      style: "japaneseExpress",
      minLaneDisplayOffset,
      laneGap: metrics.laneGap,
      lanePadding: metrics.lanePadding,
    });
    const html = renderToStaticMarkup(
      <CommitGraph
        commits={stackedBranchOffCommits}
        commitAuthorAvatars={{
          "main-base": "data:image/png;base64,avatar-parent",
        }}
        mode="detailed"
        graphStyle="japaneseExpress"
        activeCommitSha={null}
        highlightedCommitSha={null}
        checkedOutCommitSha="main-base"
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
        branchContext={checkedOutMainBranchContext}
      />,
    );

    const wipRowHtml = extractWipRowMarkup(html);
    const aSeedRowHtml = extractCommitRowMarkup(html, "a-seed");
    const mainBaseRowHtml = extractCommitRowMarkup(html, "main-base");

    expect(wipRowHtml).toMatch(
      new RegExp(
        `class="wip-row__lane-line wip-row__lane-line--connector"[^>]*x1="${mainLaneX}"[^>]*x2="${mainLaneX}"`,
      ),
    );
    expect(wipRowHtml).not.toContain(`x1="${laneOneX}"`);
    expect(wipRowHtml).not.toContain(`x1="${laneTwoX}"`);
    expect(aSeedRowHtml).toContain(`x1="${laneTwoX}" y1="16" x2="`);
    expect(mainBaseRowHtml).toContain(`x1="${laneThreeX}" y1="16" x2="`);
    expect(mainBaseRowHtml).not.toContain(`x1="${laneOneX}" y1="16" x2="`);
    expect(mainBaseRowHtml).not.toContain(`x1="${laneTwoX}" y1="16" x2="`);
  });
});
