import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { BranchResponse } from '../types';

import { BranchTree } from './BranchTree';

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

describe('BranchTree', () => {
  test('does not render the idle branch operation hint', () => {
    const html = renderToStaticMarkup(
      <BranchTree
        branches={branches}
        selectedBranchName="main"
        busy={false}
        onSelectBranch={() => {}}
        onCheckoutBranch={() => {}}
        onBranchDrop={() => {}}
        onRequestCreateBranch={() => {}}
        onRequestDeleteBranch={() => {}}
      />
    );

    expect(html).toContain('Branch List');
    expect(html).toContain('main');
    expect(html).not.toContain('右クリックで branch 作成 / 削除。local branch は別の local branch にドロップできます。');
  });
});
