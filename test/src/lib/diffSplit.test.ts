import { describe, expect, test } from "bun:test";

import { findSingleFilePatch, splitUnifiedDiffByFile } from "../../../src/lib/diffSplit";

const MULTI_FILE_DIFF = `diff --git a/alpha.txt b/alpha.txt
index 1111111..2222222 100644
--- a/alpha.txt
+++ b/alpha.txt
@@ -1 +1 @@
-hello
+hello world
diff --git a/beta.txt b/beta.txt
index 3333333..4444444 100644
--- a/beta.txt
+++ b/beta.txt
@@ -1,2 +1,2 @@
 line a
-line b
+line B
`;

describe("splitUnifiedDiffByFile", () => {
  test("splits a multi-file unified diff into per-file chunks", () => {
    const chunks = splitUnifiedDiffByFile(MULTI_FILE_DIFF);

    expect(chunks.map((chunk) => chunk.headerPath)).toEqual(["alpha.txt", "beta.txt"]);
    expect(chunks[0].patch.startsWith("diff --git a/alpha.txt b/alpha.txt")).toBe(true);
    expect(chunks[1].patch.startsWith("diff --git a/beta.txt b/beta.txt")).toBe(true);
    expect(chunks[0].patch.includes("diff --git a/beta.txt")).toBe(false);
  });

  test("returns empty array for empty or non-git diff input", () => {
    expect(splitUnifiedDiffByFile("")).toEqual([]);
    expect(splitUnifiedDiffByFile("   \n")).toEqual([]);
    expect(splitUnifiedDiffByFile("no diff header here")).toEqual([]);
  });
});

describe("findSingleFilePatch", () => {
  test("returns the patch chunk matching the given file path", () => {
    const patch = findSingleFilePatch(MULTI_FILE_DIFF, {
      displayPath: "beta.txt",
      newPath: "beta.txt",
      oldPath: "beta.txt",
    });

    expect(patch).not.toBeNull();
    expect(patch!.startsWith("diff --git a/beta.txt b/beta.txt")).toBe(true);
    expect(patch!.includes("alpha.txt")).toBe(false);
  });

  test("returns null when no matching file chunk is found", () => {
    const patch = findSingleFilePatch(MULTI_FILE_DIFF, {
      displayPath: "gamma.txt",
      newPath: "gamma.txt",
      oldPath: "gamma.txt",
    });

    expect(patch).toBeNull();
  });
});
