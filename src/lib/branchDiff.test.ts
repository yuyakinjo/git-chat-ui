import { describe, expect, test } from 'bun:test';

import type { Branch, BranchDiffDetail } from '../types';

import { canCompareCurrentBranch, getBranchDiffButtonLabel, isCurrentBranchDiffDetail } from './branchDiff';

const mainBranch: Branch = {
  name: 'main',
  fullRef: 'refs/heads/main',
  type: 'local',
  commit: '1111111'
};

const featureBranch: Branch = {
  name: 'feature/file-list',
  fullRef: 'refs/heads/feature/file-list',
  type: 'local',
  commit: '2222222'
};

describe('canCompareCurrentBranch', () => {
  test('returns true for a checked out non-default branch', () => {
    expect(canCompareCurrentBranch(featureBranch, mainBranch)).toBe(true);
  });

  test('returns false for the default branch itself', () => {
    expect(canCompareCurrentBranch(mainBranch, mainBranch)).toBe(false);
  });
});

describe('isCurrentBranchDiffDetail', () => {
  test('matches detail refs against current base and target branches', () => {
    const detail: BranchDiffDetail = {
      baseRef: 'refs/heads/main',
      targetRef: 'feature/file-list',
      mergeBaseSha: 'abc1234',
      files: [],
      diff: '',
      isDiffTruncated: false
    };

    expect(isCurrentBranchDiffDetail(detail, mainBranch, featureBranch)).toBe(true);
  });

  test('returns false when diff detail belongs to a different target branch', () => {
    const detail: BranchDiffDetail = {
      baseRef: 'refs/heads/main',
      targetRef: 'feature/other',
      mergeBaseSha: 'abc1234',
      files: [],
      diff: '',
      isDiffTruncated: false
    };

    expect(isCurrentBranchDiffDetail(detail, mainBranch, featureBranch)).toBe(false);
  });
});

describe('getBranchDiffButtonLabel', () => {
  test('describes the default branch comparison target', () => {
    expect(getBranchDiffButtonLabel('main')).toBe('Diffs vs main');
  });
});
