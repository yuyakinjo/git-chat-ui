import { describe, expect, test } from 'bun:test';

import type { Branch } from '../types';

import { canDeleteBranch, getBranchDeleteDisabledReason } from './branchDelete';

const localBranch: Branch = {
  name: 'feature/delete-me',
  fullRef: 'refs/heads/feature/delete-me',
  type: 'local',
  commit: 'abc1234'
};

describe('branchDelete', () => {
  test('allows deleting a non-current local branch', () => {
    expect(canDeleteBranch(localBranch, 'main')).toBe(true);
    expect(getBranchDeleteDisabledReason(localBranch, 'main')).toBeNull();
  });

  test('blocks deleting the checked out branch', () => {
    expect(canDeleteBranch(localBranch, 'feature/delete-me')).toBe(false);
    expect(getBranchDeleteDisabledReason(localBranch, 'feature/delete-me')).toBe(
      '現在 checkout 中の branch は削除できません。'
    );
  });

  test('blocks deleting remote branches', () => {
    const remoteBranch: Branch = {
      ...localBranch,
      name: 'origin/feature/delete-me',
      fullRef: 'refs/remotes/origin/feature/delete-me',
      type: 'remote'
    };

    expect(canDeleteBranch(remoteBranch, 'main')).toBe(false);
    expect(getBranchDeleteDisabledReason(remoteBranch, 'main')).toBe('local branch のみ削除できます。');
  });
});
