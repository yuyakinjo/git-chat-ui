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
    }
  ],
  staged: [
    {
      file: 'src/components/ControllerView.tsx',
      x: 'M',
      y: ' ',
      statusLabel: 'Modified'
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
        onGenerateTitle={() => {}}
        onCommit={() => {}}
        onPush={() => {}}
      />
    );

    expect(html).toContain('Unstaged Files (1)');
    expect(html).toContain('Staged Files (1)');
    expect(html).toContain('Stash Area');
    expect(html).toContain('Commit');
    expect(html).toContain('min-[760px]:grid-cols-2');
    expect(html).toContain('min-[1280px]:grid-cols-4');
    expect(html).toContain('rounded-2xl border border-black/10 bg-white/65 p-3');
  });
});
