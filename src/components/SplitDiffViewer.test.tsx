import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { SplitDiffViewer } from './SplitDiffViewer';

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
  });
});
