import { describe, expect, test } from 'bun:test';

import { describeGitError } from './errors';

describe('describeGitError', () => {
  test('maps invalid gh auth message', () => {
    const parsed = describeGitError(
      'Failed to log in to github.com account yuyakinjo. The token in default is invalid. gh auth login -h github.com',
      'Pull Request の準備に失敗しました。'
    );

    expect(parsed.title).toBe('GitHub CLI の認証が必要です');
  });

  test('maps existing pull request message', () => {
    const parsed = describeGitError(
      'pull request already exists: https://github.com/example/repo/pull/12',
      'Pull Request の作成に失敗しました。'
    );

    expect(parsed.title).toBe('Pull Request は既に存在します');
  });

  test('maps missing origin remote message', () => {
    const parsed = describeGitError(
      "No such remote 'origin'",
      'Pull Request の準備に失敗しました。'
    );

    expect(parsed.title).toBe('origin remote が見つかりません');
  });

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

  test('maps merge conflicts', () => {
    const parsed = describeGitError('Automatic merge failed; fix conflicts and then commit the result.', 'ブランチマージに失敗しました。');

    expect(parsed.title).toBe('競合が発生しました');
  });

  test('maps checked out branch deletion failure', () => {
    const parsed = describeGitError(
      "error: Cannot delete branch 'main' checked out at '/tmp/example'",
      'ブランチ削除に失敗しました。'
    );

    expect(parsed.title).toBe('現在 checkout 中の branch は削除できません');
  });

  test('maps unmerged branch deletion failure', () => {
    const parsed = describeGitError(
      "error: The branch 'feature/delete-me' is not fully merged.",
      'ブランチ削除に失敗しました。'
    );

    expect(parsed.title).toBe('未マージのため削除できません');
  });

  test('keeps fallback title for unknown errors', () => {
    const parsed = describeGitError('unexpected low level failure', 'Git 操作に失敗しました。');

    expect(parsed.title).toBe('Git 操作に失敗しました。');
    expect(parsed.detail).toContain('unexpected low level failure');
  });
});
