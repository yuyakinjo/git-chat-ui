import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { CommitDetail } from "../../../src/types";

import { CommitDiffOverlay } from "../../../src/components/CommitDiffOverlay";

const detail: CommitDetail = {
  sha: "8726b86fe21c9a1",
  author: "kinjo",
  email: "kinjo@example.com",
  date: "2026-03-30T00:00:00.000Z",
  body: "feat(branch): remoteブランチ削除対応＆UI制限・安全性を強化",
  parentShas: ["69d0c30"],
  files: [
    {
      file: "server/gitService.test.ts",
      additions: 66,
      deletions: 1,
    },
  ],
  diff: `diff --git a/server/gitService.test.ts b/server/gitService.test.ts
index 1111111..2222222 100644
--- a/server/gitService.test.ts
+++ b/server/gitService.test.ts
@@ -1,2 +1,2 @@
-const before = 'old';
+const after = 'new';
 export default after;
`,
};

describe("CommitDiffOverlay", () => {
  test("renders focused commit diff with a copyable sha badge", () => {
    const html = renderToStaticMarkup(
      <CommitDiffOverlay
        repoPath="/tmp/example"
        detail={detail}
        filePath="server/gitService.test.ts"
        onClose={() => {}}
        onNotify={() => {}}
      />,
    );

    expect(html).toContain("diff-overlay__title");
    expect(html).toContain("diff-overlay__meta");
    expect(html).toContain("diff-overlay__meta-badge");
    expect(html).toContain('aria-label="8726b86fe21c9a1 をクリップボードにコピー"');
    expect(html).toContain("8726b86");
    expect(html).not.toContain("Focused Diff View");
    expect(html).toContain("server/gitService.test.ts");
    expect(html).toContain("Split View");
    expect(html).not.toContain("diff-workbench__sidebar");
    expect(html).not.toContain("Changed Files");
  });

  test("shows a loading state immediately when the focused file is outside the aggregate diff payload", () => {
    const html = renderToStaticMarkup(
      <CommitDiffOverlay
        repoPath="/tmp/example"
        detail={{
          ...detail,
          files: [
            {
              file: "src/focused.ts",
              additions: 5,
              deletions: 1,
            },
            ...detail.files,
          ],
        }}
        filePath="src/focused.ts"
        onClose={() => {}}
        onNotify={() => {}}
      />,
    );

    expect(html).toContain("差分を読み込み中...");
    expect(html).not.toContain("Text diff unavailable for this file.");
  });
});
