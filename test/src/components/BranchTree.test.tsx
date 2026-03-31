import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { BranchResponse, StashEntry } from '../../../src/types';

import { BranchTree } from '../../../src/components/BranchTree';

const branches: BranchResponse = {
  current: 'main',
  local: [
    {
      name: 'main',
      fullRef: 'refs/heads/main',
      type: 'local',
      commit: 'abc1234'
    }
  ],
  remote: [
    {
      name: 'origin/main',
      fullRef: 'refs/remotes/origin/main',
      type: 'remote',
      commit: 'abc1234',
      isRemoteDefault: true
    }
  ]
};

const stashes: StashEntry[] = [
  {
    id: 'stash@{0}',
    relativeDate: '2 minutes ago',
    message: 'WIP on develop',
    files: ['src/components/BranchTree.tsx']
  },
  {
    id: 'stash@{1}',
    relativeDate: '5 minutes ago',
    message: 'Auto stash before cherry pick',
    files: ['src/components/ControllerView.tsx']
  }
];

describe('BranchTree', () => {
  test('does not render the idle branch operation hint', () => {
    const html = renderToStaticMarkup(
      <BranchTree
        branches={branches}
        stashes={stashes}
        selectedBranchName="main"
        busy={false}
        onSelectBranch={() => {}}
        onCheckoutBranch={() => {}}
        onBranchDrop={() => {}}
        onOpenStashDiff={() => {}}
        onRequestRenameStash={() => {}}
        onRequestApplyStash={() => {}}
        onRequestPopStash={() => {}}
        onRequestCreateBranch={() => {}}
        onRequestDeleteBranch={() => {}}
      />
    );

    expect(html).toContain('Branch List');
    expect(html).toContain('main');
    expect(html).toContain('Stashes');
    expect(html).toContain('1 file • 2 minutes ago');
    expect(html).toContain('1 file • 5 minutes ago');
    expect(html).toContain('WIP on develop');
    expect(html).toContain('Auto stash before cherry pick');
    expect(html).not.toContain('stash@{0}');
    expect(html).not.toContain('stash@{1}');
    expect(html).not.toContain('右クリックで branch 作成 / 削除。local branch は別の local branch にドロップできます。');
  });
});
