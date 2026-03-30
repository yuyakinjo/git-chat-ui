import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { StashEntry, WorkingTreeStatus } from '../types';

import { GitOperationPanel } from './GitOperationPanel';

const status: WorkingTreeStatus = {
  unstaged: [
    {
      file: 'src/components/GitOperationPanel.tsx',
      x: 'M',
      y: ' ',
      statusLabel: 'Modified'
    },
    {
      file: 'src/lib/workingTreeDragDrop.ts',
      x: '?',
      y: '?',
      statusLabel: 'Untracked'
    }
  ],
  staged: [
    {
      file: 'src/components/ControllerView.tsx',
      x: 'M',
      y: ' ',
      statusLabel: 'Modified'
    },
    {
      file: 'src/lib/workingTreeDragDrop.test.ts',
      x: 'A',
      y: ' ',
      statusLabel: 'Added'
    }
  ]
};

const stashes: StashEntry[] = [
  {
    id: 'stash@{0}',
    relativeDate: '2 minutes ago',
    message: 'WIP on layout',
    files: ['src/styles/globals.css']
  }
];

const emptyStatus: WorkingTreeStatus = {
  unstaged: [],
  staged: []
};

describe('GitOperationPanel', () => {
  test('renders change buckets and commit controls in a shared responsive grid', () => {
    const html = renderToStaticMarkup(
      <GitOperationPanel
        status={status}
        stashes={stashes}
        commitTitle="feat: align git buckets horizontally"
        commitDescription=""
        busy={false}
        onCommitTitleChange={() => {}}
        onCommitDescriptionChange={() => {}}
        onStageFile={() => {}}
        onUnstageFile={() => {}}
        onStageAll={() => {}}
        onUnstageAll={() => {}}
        onStashFile={() => {}}
        activeWorkingTreeDiff={null}
        onOpenWorkingTreeDiff={() => {}}
        onGenerateCommitMessage={() => {}}
        onCommit={() => {}}
        onPush={() => {}}
      />
    );

    expect(html).toContain('Unstaged Files (2)');
    expect(html).toContain('Staged Files (2)');
    expect(html).toContain('Stage all');
    expect(html).toContain('Unstage all');
    expect(html).toContain('Stash Area');
    expect(html).toContain('Commit');
    expect(html).toContain('min-[760px]:grid-cols-2');
    expect(html).toContain('min-[1280px]:grid-cols-4');
    expect(html).toContain('rounded-2xl border border-black/10 bg-white/65 p-3');
    expect(html).toContain('data-controller-panel-drag-ignore="true"');
    expect(html).not.toContain('ファイルをドラッグして移動');
    expect(html).toContain('data-working-tree-drop-zone="unstaged"');
    expect(html).toContain('data-working-tree-drop-zone="staged"');
    expect(html).toContain('data-working-tree-drop-zone="stash"');
    expect(html).toContain('git-file-path-label__directory">src/components/');
    expect(html).toContain('git-file-path-label__name">GitOperationPanel.tsx');
    expect(html).toContain('git-file-path-label__name">ControllerView.tsx');
    expect(html).toContain('git-file-path-label__name">workingTreeDragDrop.ts');
    expect(html).toContain('Modified');
    expect(html).toContain('Added');
    expect(html).toContain('git-file-path-label');
    expect(html).toContain('commit-detail-panel__file-button');
    expect(html).toContain('git-file-card__status-icon--modified');
    expect(html).toContain('git-file-card__status-icon--added');
    expect(html).toContain('Open Diff');
    expect(html).toContain('data-working-tree-no-drag="true"');
    expect(html).not.toContain('git-file-card__handle');
  });

  test('hides bulk stage buttons when there are no target files', () => {
    const html = renderToStaticMarkup(
      <GitOperationPanel
        status={emptyStatus}
        stashes={[]}
        commitTitle=""
        commitDescription=""
        busy={false}
        onCommitTitleChange={() => {}}
        onCommitDescriptionChange={() => {}}
        onStageFile={() => {}}
        onUnstageFile={() => {}}
        onStageAll={() => {}}
        onUnstageAll={() => {}}
        onStashFile={() => {}}
        activeWorkingTreeDiff={null}
        onOpenWorkingTreeDiff={() => {}}
        onGenerateCommitMessage={() => {}}
        onCommit={() => {}}
        onPush={() => {}}
      />
    );

    expect(html).toContain('Unstaged Files (0)');
    expect(html).toContain('Staged Files (0)');
    expect(html).toContain('未ステージの変更はありません。');
    expect(html).toContain('ステージされたファイルはありません。');
    expect(html).not.toContain('Stage all');
    expect(html).not.toContain('Unstage all');
  });
});
