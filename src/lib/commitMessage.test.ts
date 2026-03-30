import { describe, expect, test } from 'bun:test';

import type { WorkingTreeStatus } from '../types';

import { getCommitMessageFiles } from './commitMessage';

describe('getCommitMessageFiles', () => {
  test('uses only staged files for commit message generation', () => {
    const status: WorkingTreeStatus = {
      staged: [
        { file: 'src/App.tsx', x: 'M', y: ' ', statusLabel: 'Modified' },
        { file: 'src/lib/api.ts', x: 'A', y: ' ', statusLabel: 'Added' }
      ],
      unstaged: [
        { file: 'src/components/ControllerView.tsx', x: 'M', y: ' ', statusLabel: 'Modified' },
        { file: 'src/App.tsx', x: 'M', y: ' ', statusLabel: 'Modified' }
      ]
    };

    expect(getCommitMessageFiles(status)).toEqual(['src/App.tsx', 'src/lib/api.ts']);
  });
});
