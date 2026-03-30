import { describe, expect, test } from 'bun:test';

import type { Branch, RepositoryMutationSafety } from '../../../src/types';
import { canCheckoutBranchWithoutWorkingTreeChange, getSelfMutationBlockedReason } from '../../../src/lib/repositoryMutationSafety';

const currentBranch: Branch = {
  name: 'main',
  fullRef: 'refs/heads/main',
  type: 'local',
  commit: 'abc123'
};

const sameCommitTarget: Branch = {
  name: 'feature/new-branch',
  fullRef: 'refs/heads/feature/new-branch',
  type: 'local',
  commit: 'abc123'
};

const differentCommitTarget: Branch = {
  name: 'feature/other',
  fullRef: 'refs/heads/feature/other',
  type: 'local',
  commit: 'def456'
};

describe('getSelfMutationBlockedReason', () => {
  test('returns a reason only for the app repository in dev mode', () => {
    const mutationSafety: RepositoryMutationSafety = { isSelfRepository: true };

    expect(getSelfMutationBlockedReason(true, mutationSafety)).toContain('checkout / merge');
    expect(getSelfMutationBlockedReason(false, mutationSafety)).toBeNull();
    expect(getSelfMutationBlockedReason(true, { isSelfRepository: false })).toBeNull();
  });
});

describe('canCheckoutBranchWithoutWorkingTreeChange', () => {
  test('allows branch checkout when the target points to the same commit', () => {
    expect(canCheckoutBranchWithoutWorkingTreeChange(currentBranch, sameCommitTarget)).toBe(true);
  });

  test('blocks branch checkout when the target commit differs or current branch is unknown', () => {
    expect(canCheckoutBranchWithoutWorkingTreeChange(currentBranch, differentCommitTarget)).toBe(false);
    expect(canCheckoutBranchWithoutWorkingTreeChange(null, sameCommitTarget)).toBe(false);
  });
});
