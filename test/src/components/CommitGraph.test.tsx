import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { CommitListItem } from "../../../src/types";

import { CommitGraph } from "../../../src/components/CommitGraph";

const commits: CommitListItem[] = [
  {
    sha: "abc1234",
    parentShas: ["def5678"],
    author: "kinjo",
    date: "2026-03-29T12:00:00.000Z",
    subject: "feat: sample graph node",
    decoration: "(HEAD -> main, origin/main)",
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
      />,
    );

    expect(html).toContain('class="wip-node-ring"');
    expect(html).toContain('stroke-dasharray="2 3"');
    expect(html).not.toContain('class="wip-node-core"');
    expect(html).toContain('class="wip-row__badge');
    expect(html).toContain('class="wip-row__primary');
    expect(html).toContain('class="wip-row__meta');
    expect(html).toContain("commit-graph__header");
    expect(html).toContain("commit-graph__cell--primary");
    expect(html).toContain("commit-graph__ref-badge--head");
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
      />,
    );

    expect(html).toContain('title="abc1234 をコピー"');
    expect(html).toContain('aria-label="abc1234 をクリップボードにコピー"');
    expect(html).toContain(">abc1234</span></button>");
  });
});
