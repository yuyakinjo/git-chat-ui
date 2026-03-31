import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { WorkingTreeDiffDetail } from "../../../src/types";

import { WorkingTreeDiffOverlay } from "../../../src/components/WorkingTreeDiffOverlay";

const detail: WorkingTreeDiffDetail = {
  file: "src/components/CommitDetailPanel.tsx",
  area: "unstaged",
  files: [
    {
      file: "src/components/CommitDetailPanel.tsx",
      additions: 3,
      deletions: 1,
    },
  ],
  diff: `diff --git a/src/components/CommitDetailPanel.tsx b/src/components/CommitDetailPanel.tsx
index 1111111..2222222 100644
--- a/src/components/CommitDetailPanel.tsx
+++ b/src/components/CommitDetailPanel.tsx
@@ -1,4 +1,6 @@
 import { CalendarClock } from 'lucide-react';
+import { Expand } from 'lucide-react';
 
 export function Panel() {
-  return null;
+  return <div>changed</div>;
 }
`,
  isDiffTruncated: false,
};

describe("WorkingTreeDiffOverlay", () => {
  test("renders working tree diff inside a dialog-style overlay", () => {
    const html = renderToStaticMarkup(
      <WorkingTreeDiffOverlay
        detail={detail}
        loading={false}
        filePath={detail.file}
        area={detail.area}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("diff-overlay__title");
    expect(html).not.toContain("Working Tree Diff");
    expect(html).toContain("WIP");
    expect(html).toContain("Unstaged");
    expect(html).toContain("diff-overlay__meta");
    expect(html).toContain("Split View");
    expect(html).not.toContain("diff-workbench__sidebar");
    expect(html).not.toContain("Changed Files");
  });
});
