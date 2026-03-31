import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { BranchDiffDetail } from "../../../src/types";

import { BranchDiffOverlay } from "../../../src/components/BranchDiffOverlay";

const detail: BranchDiffDetail = {
  baseRef: "refs/heads/main",
  targetRef: "refs/heads/feature/dialog",
  mergeBaseSha: "abc1234",
  files: [
    {
      file: "src/app.tsx",
      additions: 10,
      deletions: 4,
    },
  ],
  diff: `diff --git a/src/app.tsx b/src/app.tsx
index 1111111..2222222 100644
--- a/src/app.tsx
+++ b/src/app.tsx
@@ -1 +1 @@
-old
+new
`,
  isDiffTruncated: false,
};

describe("BranchDiffOverlay", () => {
  test("renders branch diff inside a dialog-style overlay", () => {
    const html = renderToStaticMarkup(
      <BranchDiffOverlay
        repoPath="/tmp/example"
        detail={detail}
        loading={false}
        baseBranchName="main"
        targetBranchName="feature/dialog"
        onClose={() => {}}
        onNotify={() => {}}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain("Diffs");
    expect(html).toContain("feature/dialog vs main");
    expect(html).toContain("1 files");
    expect(html).toContain('aria-label="Merge base abc1234 をクリップボードにコピー"');
    expect(html).toContain("Filter changed files by path");
  });
});
