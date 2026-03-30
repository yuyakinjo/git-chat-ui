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
    expect(canDeleteBranch(localBranch, 'main', 'main')).toBe(true);
    expect(getBranchDeleteDisabledReason(localBranch, 'main', 'main')).toBeNull();
  });

  test('blocks deleting the checked out branch', () => {
    expect(canDeleteBranch(localBranch, 'feature/delete-me', 'main')).toBe(false);
    expect(getBranchDeleteDisabledReason(localBranch, 'feature/delete-me', 'main')).toBe(
      '現在 checkout 中の branch は削除できません。'
    );
  });

  test('allows deleting non-default remote branches', () => {
    const remoteBranch: Branch = {
      ...localBranch,
      name: 'origin/feature/delete-me',
      fullRef: 'refs/remotes/origin/feature/delete-me',
      type: 'remote'
    };

    expect(canDeleteBranch(remoteBranch, 'main', 'main')).toBe(true);
    expect(getBranchDeleteDisabledReason(remoteBranch, 'main', 'main')).toBeNull();
  });

  test('blocks deleting remote default branches', () => {
    const remoteDefaultBranch: Branch = {
      ...localBranch,
      name: 'origin/main',
      fullRef: 'refs/remotes/origin/main',
      type: 'remote'
    };

    expect(canDeleteBranch(remoteDefaultBranch, 'feature/delete-me', 'main')).toBe(false);
    expect(getBranchDeleteDisabledReason(remoteDefaultBranch, 'feature/delete-me', 'main')).toBe(
      'remote の default branch は削除できません。'
    );
  });
});
