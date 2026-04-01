import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { BranchResponse, CommitListItem } from "../../../src/types";

import { CommitGraph } from "../../../src/components/CommitGraph";

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

describe("CommitGraph", () => {
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
        branchContext={branchContext}
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
    expect(html).toContain("commit-graph__ref-badge-label");
    expect(html.match(/commit-graph__ref-badge-icon--local/g)?.length ?? 0).toBe(1);
    expect(html.match(/commit-graph__ref-badge-icon--remote/g)?.length ?? 0).toBe(2);
    expect(html.match(/commit-graph__ref-badge-icon--tag/g)?.length ?? 0).toBe(1);
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
        branchContext={branchContext}
      />,
    );

    expect(html).toContain("// WIP");
    expect(html).toContain("2 conflicted");
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
