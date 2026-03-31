import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { StashDiffDetail, StashEntry } from "../../../src/types";

import { StashDiffOverlay } from "../../../src/components/StashDiffOverlay";

const stash: StashEntry = {
  id: "stash@{1}",
  relativeDate: "12 minutes ago",
  message: "WIP on main: adjust stash interactions",
  files: ["src/components/BranchTree.tsx", "src/components/ControllerView.tsx"],
};

const detail: StashDiffDetail = {
  stashId: "stash@{1}",
  files: [
    {
      file: "src/components/BranchTree.tsx",
      additions: 4,
      deletions: 1,
    },
    {
      file: "src/components/ControllerView.tsx",
      additions: 8,
      deletions: 0,
    },
  ],
  diff: `diff --git a/src/components/BranchTree.tsx b/src/components/BranchTree.tsx
index 1111111..2222222 100644
--- a/src/components/BranchTree.tsx
+++ b/src/components/BranchTree.tsx
@@ -1,3 +1,5 @@
 import { Archive } from 'lucide-react';
+import { Download } from 'lucide-react';
 
 export function BranchTree() {
diff --git a/src/components/ControllerView.tsx b/src/components/ControllerView.tsx
index 3333333..4444444 100644
--- a/src/components/ControllerView.tsx
+++ b/src/components/ControllerView.tsx
@@ -1,3 +1,4 @@
+import { StashDiffOverlay } from './StashDiffOverlay';
 export function ControllerView() {
`,
  isDiffTruncated: false,
};

describe("StashDiffOverlay", () => {
  test("renders stash diff inside a dialog-style overlay", () => {
    const html = renderToStaticMarkup(
      <StashDiffOverlay
        repoPath="/tmp/example"
        stash={stash}
        detail={detail}
        loading={false}
        onClose={() => {}}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain("Stash Diff");
    expect(html).toContain("WIP on main: adjust stash interactions");
    expect(html).toContain("stash@{1}");
    expect(html).toContain("2 files");
    expect(html).toContain("Changed Files");
    expect(html).toContain("Split View");
  });
});
