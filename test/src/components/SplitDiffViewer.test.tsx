import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { SplitDiffViewer } from '../../../src/components/SplitDiffViewer';

const additionalSyntaxSamples = [
  {
    filePath: 'src/app.js',
    line: "+export function sum(a, b) { return a + b; }"
  },
  {
    filePath: 'src/styles/site.css',
    line: '+.hero { display: grid; gap: 12px; }'
  },
  {
    filePath: 'src/index.html',
    line: '+<main class="hero">Hello</main>'
  },
  {
    filePath: 'server/main.go',
    line: '+func main() { fmt.Println("hi") }'
  },
  {
    filePath: 'src/lib.rs',
    line: '+pub fn greet() -> String { "hi".into() }'
  }
] as const;

describe('SplitDiffViewer', () => {
  test('hides the before column for added files', () => {
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
      />
    );

    expect(html).toContain('After Only');
    expect(html).toContain('>After<');
    expect(html).not.toContain('>Before<');
    expect(html).not.toContain('diff-cell--left');
    expect(html).toContain('diff-token');
  });

  test('keeps split view for modified files', () => {
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
      />
    );

    expect(html).toContain('Split View');
    expect(html).toContain('>Before<');
    expect(html).toContain('>After<');
    expect(html).toContain('diff-cell--left');
    expect(html).toContain('diff-cell__chunk--emphasis');
    expect(html).toContain('diff-token');
  });

  test('keeps plain rendering for unsupported file types', () => {
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
      />
    );

    expect(html).not.toContain('diff-token');
  });

  test('highlights additional supported file types', () => {
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
        />
      );

      expect(html).toContain('diff-token');
    }
  });
});
