import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SplitDiffViewer } from "../../../src/components/SplitDiffViewer";

const additionalSyntaxSamples = [
  {
    filePath: "src/app.js",
    line: "+export function sum(a, b) { return a + b; }",
  },
  {
    filePath: "src/styles/site.css",
    line: "+.hero { display: grid; gap: 12px; }",
  },
  {
    filePath: "src/index.html",
    line: '+<main class="hero">Hello</main>',
  },
  {
    filePath: "server/main.go",
    line: '+func main() { fmt.Println("hi") }',
  },
  {
    filePath: "src/lib.rs",
    line: '+pub fn greet() -> String { "hi".into() }',
  },
] as const;

describe("SplitDiffViewer", () => {
  test("hides the before column for added files", () => {
    const html = renderToStaticMarkup(
      <SplitDiffViewer
        diff={`diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const title = 'hello';
+export const ready = true;
`}
        preferredFilePath="src/new.ts"
      />,
    );

    expect(html).toContain("After Only");
    expect(html).toContain(">After<");
    expect(html).not.toContain(">Before<");
    expect(html).not.toContain("diff-cell--left");
    expect(html).toContain("diff-token");
  });

  test("keeps split view for modified files", () => {
    const html = renderToStaticMarkup(
      <SplitDiffViewer
        diff={`diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,2 @@
-const title = 'old';
+const title = 'new';
 export default title;
`}
        preferredFilePath="src/app.ts"
      />,
    );

    expect(html).toContain("Split View");
    expect(html).toContain(">Before<");
    expect(html).toContain(">After<");
    expect(html).toContain("diff-cell--left");
    expect(html).toContain("diff-cell__chunk--emphasis");
    expect(html).toContain("diff-token");
  });

  test("keeps plain rendering for unsupported file types", () => {
    const html = renderToStaticMarkup(
      <SplitDiffViewer
        diff={`diff --git a/notes.txt b/notes.txt
index 1111111..2222222 100644
--- a/notes.txt
+++ b/notes.txt
@@ -1 +1 @@
-hello old
+hello new
`}
        preferredFilePath="notes.txt"
      />,
    );

    expect(html).not.toContain("diff-token");
  });

  test("highlights additional supported file types", () => {
    for (const sample of additionalSyntaxSamples) {
      const html = renderToStaticMarkup(
        <SplitDiffViewer
          diff={`diff --git a/${sample.filePath} b/${sample.filePath}
new file mode 100644
--- /dev/null
+++ b/${sample.filePath}
@@ -0,0 +1 @@
${sample.line}
`}
          preferredFilePath={sample.filePath}
        />,
      );

      expect(html).toContain("diff-token");
    }
  });

  test("lists all file stats even when the diff body is truncated before later files", () => {
    const html = renderToStaticMarkup(
      <SplitDiffViewer
        diff={`diff --git a/src/visible.ts b/src/visible.ts
index 1111111..2222222 100644
--- a/src/visible.ts
+++ b/src/visible.ts
@@ -1 +1 @@
-old
+new
`}
        files={[
          {
            file: "src/visible.ts",
            additions: 1,
            deletions: 1,
          },
          {
            file: "src/missing.ts",
            additions: 12,
            deletions: 3,
          },
        ]}
        isDiffTruncated
      />,
    );

    expect(html).toContain("src/visible.ts");
    expect(html).toContain("src/missing.ts");
    expect(html).toContain("Changed");
    expect(html).toContain("Truncated");
  });

  test("renders a selected file diff while keeping the full changed-files list", () => {
    const html = renderToStaticMarkup(
      <SplitDiffViewer
        diff={`diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-export const version = 'base';
+export const version = 'feature';
`}
        files={[
          {
            file: "src/app.ts",
            additions: 1,
            deletions: 1,
          },
          {
            file: "big.txt",
            additions: 3200,
            deletions: 3200,
          },
        ]}
        isDiffTruncated
      />,
    );

    expect(html).toContain("src/app.ts");
    expect(html).toContain("big.txt");
    expect(html).toContain("diff-row--change");
    expect(html).not.toContain("Text diff unavailable for this file.");
  });

  test("prefers the requested file path over the first file when focused diff content is shown", () => {
    const html = renderToStaticMarkup(
      <SplitDiffViewer
        diff={`diff --git a/src/focused.ts b/src/focused.ts
index 1111111..2222222 100644
--- a/src/focused.ts
+++ b/src/focused.ts
@@ -1 +1 @@
-base
+feature
`}
        files={[
          {
            file: "src/first.ts",
            additions: 3,
            deletions: 1,
          },
          {
            file: "src/focused.ts",
            additions: 1,
            deletions: 1,
          },
        ]}
        preferredFilePath="src/focused.ts"
      />,
    );

    expect(html).toContain("src/first.ts");
    expect(html).toContain("src/focused.ts");
    expect(html).toContain('diff-file__path">src/focused.ts<');
    expect(html).toContain("diff-workbench__file-tab is-active");
    expect(html).not.toContain("Text diff unavailable for this file.");
  });

  test("can hide the changed-files sidebar for single-file overlays", () => {
    const html = renderToStaticMarkup(
      <SplitDiffViewer
        diff={`diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-export const version = 'base';
+export const version = 'feature';
`}
        files={[
          {
            file: "src/app.ts",
            additions: 1,
            deletions: 1,
          },
          {
            file: "src/other.ts",
            additions: 2,
            deletions: 0,
          },
        ]}
        preferredFilePath="src/app.ts"
        showFileList={false}
      />,
    );

    expect(html).toContain("diff-workbench--single-file");
    expect(html).not.toContain("diff-workbench__sidebar");
    expect(html).not.toContain("Changed Files");
    expect(html).toContain("src/app.ts");
    expect(html).toContain("Split View");
  });

  test("shows the active file loading message for stats-only rows while a file diff is being fetched", () => {
    const html = renderToStaticMarkup(
      <SplitDiffViewer
        diff={`diff --git a/src/visible.ts b/src/visible.ts
index 1111111..2222222 100644
--- a/src/visible.ts
+++ b/src/visible.ts
@@ -1 +1 @@
-old
+new
`}
        files={[
          {
            file: "src/missing.ts",
            additions: 12,
            deletions: 3,
          },
          {
            file: "src/visible.ts",
            additions: 1,
            deletions: 1,
          },
        ]}
        activeFileLoading
        activeFileLoadingMessage="差分を読み込み中..."
      />,
    );

    expect(html).toContain("差分を読み込み中...");
    expect(html).not.toContain("Text diff unavailable for this file.");
  });
});
