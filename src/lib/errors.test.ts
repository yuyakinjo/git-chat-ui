import { describe, expect, test } from 'bun:test';

import { describeGitError } from './errors';

describe('describeGitError', () => {
  test('maps push rejection to friendly title', () => {
    const parsed = describeGitError('failed to push some refs to origin', 'Git操作に失敗しました。');

    expect(parsed.title).toBe('Push が拒否されました');
  });

  test('maps checkout overwrite message', () => {
    const parsed = describeGitError(
      'Your local changes to the following files would be overwritten by checkout',
      'ブランチ切り替えに失敗しました。'
    );

    expect(parsed.title).toBe('未コミット変更が衝突しています');
  });

  test('keeps fallback title for unknown errors', () => {
    const parsed = describeGitError('unexpected low level failure', 'Git 操作に失敗しました。');

    expect(parsed.title).toBe('Git 操作に失敗しました。');
    expect(parsed.detail).toContain('unexpected low level failure');
  });
});
