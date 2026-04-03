import { describe, expect, test } from "bun:test";

import { hasInlineDiffForPath, parseUnifiedDiff } from "../../../src/lib/diff";

describe("parseUnifiedDiff", () => {
  test("pairs delete and add lines into split rows", () => {
    const files = parseUnifiedDiff(`diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,4 @@
 import React from 'react';
-import { oldFn } from '../../../src/lib/old';
+import { newFn } from '../../../src/lib/new';
 const value = 1;
 export default value;
`);

    expect(files).toHaveLength(1);
    expect(files[0]?.displayPath).toBe("src/app.ts");
    expect(files[0]?.kind).toBe("modified");
    expect(files[0]?.hunks[0]?.rows).toEqual([
      {
        kind: "context",
        left: { kind: "context", lineNumber: 1, content: "import React from 'react';" },
        right: { kind: "context", lineNumber: 1, content: "import React from 'react';" },
      },
      {
        kind: "change",
        left: {
          kind: "delete",
          lineNumber: 2,
          content: "import { oldFn } from '../../../src/lib/old';",
        },
        right: {
          kind: "add",
          lineNumber: 2,
          content: "import { newFn } from '../../../src/lib/new';",
        },
      },
      {
        kind: "context",
        left: { kind: "context", lineNumber: 3, content: "const value = 1;" },
        right: { kind: "context", lineNumber: 3, content: "const value = 1;" },
      },
      {
        kind: "context",
        left: { kind: "context", lineNumber: 4, content: "export default value;" },
        right: { kind: "context", lineNumber: 4, content: "export default value;" },
      },
    ]);
  });

  test("marks newly added files from dev null headers", () => {
    const files = parseUnifiedDiff(`diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const title = 'hello';
+export const ready = true;
`);

    expect(files).toHaveLength(1);
    expect(files[0]?.kind).toBe("added");
    expect(files[0]?.displayPath).toBe("src/new.ts");
    expect(files[0]?.hunks[0]?.rows).toEqual([
      {
        kind: "add",
        left: null,
        right: { kind: "add", lineNumber: 1, content: "export const title = 'hello';" },
      },
      {
        kind: "add",
        left: null,
        right: { kind: "add", lineNumber: 2, content: "export const ready = true;" },
      },
    ]);
  });

  test("tracks renamed files using rename metadata", () => {
    const files = parseUnifiedDiff(`diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 98%
rename from src/old-name.ts
rename to src/new-name.ts
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1 +1 @@
-export const name = 'old';
+export const name = 'new';
`);

    expect(files).toHaveLength(1);
    expect(files[0]?.kind).toBe("renamed");
    expect(files[0]?.displayPath).toBe("src/new-name.ts");
    expect(files[0]?.previousPath).toBe("src/old-name.ts");
  });

  test("keeps the same file key for the same path across aggregate and focused diffs", () => {
    const aggregateFiles = parseUnifiedDiff(`diff --git a/src/first.ts b/src/first.ts
index 1111111..2222222 100644
--- a/src/first.ts
+++ b/src/first.ts
@@ -1 +1 @@
-old
+new
diff --git a/src/second.ts b/src/second.ts
index 3333333..4444444 100644
--- a/src/second.ts
+++ b/src/second.ts
@@ -1 +1 @@
-before
+after
`);
    const focusedFiles = parseUnifiedDiff(`diff --git a/src/second.ts b/src/second.ts
index 3333333..4444444 100644
--- a/src/second.ts
+++ b/src/second.ts
@@ -1 +1 @@
-before
+after
`);

    expect(aggregateFiles[1]?.displayPath).toBe("src/second.ts");
    expect(aggregateFiles[1]?.key).toBe("src/second.ts");
    expect(focusedFiles[0]?.displayPath).toBe("src/second.ts");
    expect(focusedFiles[0]?.key).toBe("src/second.ts");
  });

  test("reports whether the selected file already has inline diff content", () => {
    const files = parseUnifiedDiff(`diff --git a/src/visible.ts b/src/visible.ts
index 1111111..2222222 100644
--- a/src/visible.ts
+++ b/src/visible.ts
@@ -1 +1 @@
-old
+new
`);

    expect(hasInlineDiffForPath(files, "src/visible.ts")).toBe(true);
    expect(hasInlineDiffForPath(files, "src/missing.ts")).toBe(false);
    expect(hasInlineDiffForPath(files, null)).toBe(false);
  });
});
