import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { CommitDetail } from '../../../src/types';

import { CommitDetailPanel } from '../../../src/components/CommitDetailPanel';

const detail: CommitDetail = {
  sha: 'a16eacd1234567',
  parentShas: ['1111111'],
  author: 'kinjo',
  email: 'kinjo@example.com',
  date: '2026-03-29T12:00:00.000Z',
  body: 'chore(gitignore): タスク生成物のディレクトリを無視リストに追加',
  files: [
    {
      file: '.gitignore',
      additions: 2,
      deletions: 0
    }
  ],
  diff: `diff --git a/.gitignore b/.gitignore
index 1111111..2222222 100644
--- a/.gitignore
+++ b/.gitignore
@@ -1 +1,3 @@
 node_modules
+.playwright-mcp
+tasks/
`
};

describe('CommitDetailPanel', () => {
  test('renders changed files buttons without inline diff view', () => {
    const html = renderToStaticMarkup(
      <CommitDetailPanel
        detail={detail}
        loading={false}
        activeDiffFile={null}
        onOpenFileDiff={() => {}}
      />
    );

    expect(html).toContain('Overview');
    expect(html).toContain('Changed Files');
    expect(html).toContain('Open Diff');
  });
});
