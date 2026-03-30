import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { resolveGitOperationPanelColumnCount } from '../lib/controllerPanelLayout';
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
        generatingCommitMessage={false}
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
    expect(html).toContain('git-operation-panel__grid');
    expect(html).toContain('git-operation-panel__grid--1');
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
    expect(html).toContain('git-operation-panel__file-name');
    expect(html).toContain('commit-detail-panel__file-button');
    expect(html).toContain('git-file-card__status-icon--modified');
    expect(html).toContain('git-file-card__status-icon--added');
    expect(html).toContain('data-working-tree-no-drag="true"');
    expect(html).not.toContain('git-file-card__handle');
    expect(html).not.toContain('Open Diff');
    expect(html).not.toContain('commit-detail-panel__file-action');
    expect(html).not.toContain('class="badge !bg-[#fff4d6] !text-[#a15c00]"');
    expect(html).not.toContain('class="badge !bg-[#ecfdf3] !text-[#157347]"');
  });

  test('hides bulk stage buttons when there are no target files', () => {
    const html = renderToStaticMarkup(
      <GitOperationPanel
        status={emptyStatus}
        stashes={[]}
        commitTitle=""
        commitDescription=""
        busy={false}
        generatingCommitMessage={false}
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

  test('chooses git operation column counts from panel width', () => {
    expect(resolveGitOperationPanelColumnCount(640)).toBe(1);
    expect(resolveGitOperationPanelColumnCount(980)).toBe(2);
    expect(resolveGitOperationPanelColumnCount(1240)).toBe(4);
  });

  test('renders a horizontally scrollable title field and shows overflow count when the title is too long', () => {
    const longCommitTitle =
      'refactor(commit-prompt): preserve long generated titles and show how far they exceed the limit';
    const longCommitTitleLength = Array.from(longCommitTitle.trim()).length;
    const overflowCount = longCommitTitleLength - 72;

    const html = renderToStaticMarkup(
      <GitOperationPanel
        status={status}
        stashes={stashes}
        commitTitle={longCommitTitle}
        commitDescription=""
        busy={false}
        generatingCommitMessage={false}
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

    expect(html).toContain('git-operation-panel__title-input');
    expect(html).toContain('wrap="off"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain(`${longCommitTitleLength} / 72`);
    expect(html).toContain(`${overflowCount} chars over`);
    expect(html).toContain('git-operation-panel__commit-meta is-over-limit');
  });

  test('renders a loading icon and disables the AI button while commit message generation is running', () => {
    const html = renderToStaticMarkup(
      <GitOperationPanel
        status={status}
        stashes={stashes}
        commitTitle="feat: refine ai commit button"
        commitDescription=""
        busy={true}
        generatingCommitMessage={true}
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

    expect(html).toContain('animate-spin');
    expect(html).toContain('aria-label="AIでコミット文を生成中"');
    expect(html).not.toContain('<svg aria-hidden="true"[^>]*data-lucide="sparkles"');
  });
});
