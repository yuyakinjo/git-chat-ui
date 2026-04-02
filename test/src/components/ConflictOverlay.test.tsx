import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { ConflictFileDetail, ConflictSummary } from "../../../src/types";

import { ConflictOverlay } from "../../../src/components/ConflictOverlay";

const summary: ConflictSummary = {
  contextType: "mergeSession",
  operation: "merge",
  sessionId: "session-1",
  sourceBranch: "feature/conflict",
  targetBranch: "main",
  files: [
    {
      file: "src/conflict.txt",
      x: "U",
      y: "U",
      statusLabel: "Both Modified",
    },
  ],
};

const detail: ConflictFileDetail = {
  file: "src/conflict.txt",
  x: "U",
  y: "U",
  statusLabel: "Both Modified",
  merged: { isBinary: false, content: "<<<<<<< ours\nours\n=======\ntheirs\n>>>>>>> theirs\n" },
  base: { isBinary: false, content: "base\n" },
  ours: { isBinary: false, content: "ours\n" },
  theirs: { isBinary: false, content: "theirs\n" },
};

describe("ConflictOverlay", () => {
  test("renders file tabs, resolution actions, and merge-session controls", () => {
    const html = renderToStaticMarkup(
      <ConflictOverlay
        summary={summary}
        activeFilePath="src/conflict.txt"
        detail={detail}
        loading={false}
        busy={false}
        onSelectFile={() => {}}
        onResolve={() => {}}
        onCompleteMergeSession={() => {}}
        onAbortMergeSession={() => {}}
        onClose={() => {}}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain("Conflict Viewer");
    expect(html).toContain("feature/conflict -&gt; main");
    expect(html).toContain(">Compare<");
    expect(html).toContain("Take Ours");
    expect(html).toContain("Take Theirs");
    expect(html).toContain("Mark Resolved");
    expect(html).toContain("Abort Merge");
    expect(html).toContain("Complete Merge");
    expect(html).toContain(">Merged<");
    expect(html).toContain(">Base<");
    expect(html).toContain(">Ours<");
    expect(html).toContain(">Theirs<");
    expect(html).toContain("Both Modified");
    expect(html).toContain("src/conflict.txt");
    expect(html).toContain("Current File");
    expect(html).toContain("Mark Resolved で stage します。");
  });

  test("shows the resolved-empty state when no conflicted files remain", () => {
    const html = renderToStaticMarkup(
      <ConflictOverlay
        summary={{ ...summary, files: [] }}
        activeFilePath={null}
        detail={null}
        loading={false}
        busy={false}
        onSelectFile={() => {}}
        onResolve={() => {}}
        onCompleteMergeSession={() => {}}
        onAbortMergeSession={() => {}}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("未解消の conflict はありません。");
    expect(html).toContain("Complete Merge で target branch を更新できます。");
  });
});
