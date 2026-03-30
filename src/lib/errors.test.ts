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

  test('maps missing AI provider for commit generation', () => {
    const parsed = describeGitError(
      'No AI provider is configured for commit message generation.',
      'コミット文生成に失敗しました。'
    );

    expect(parsed.title).toBe('AI token が未設定です');
  });

  test('maps missing staged changes for commit generation', () => {
    const parsed = describeGitError(
      'No staged changes are available for commit message generation.',
      'コミット文生成に失敗しました。'
    );

    expect(parsed.title).toBe('ステージ済みの変更がありません');
  });

  test('maps provider failures for commit generation', () => {
    const parsed = describeGitError(
      'Commit message generation failed for OpenAI. OpenAI: OpenAI API returned status 401.',
      'コミット文生成に失敗しました。'
    );

    expect(parsed.title).toBe('AI でコミット文を生成できませんでした');
    expect(parsed.detail).toContain('token とネットワーク状態');
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

  test('maps protected default remote branch deletion failure', () => {
    const parsed = describeGitError(
      "Default branch 'main' on remote 'origin' cannot be deleted.",
      'ブランチ削除に失敗しました。'
    );

    expect(parsed.title).toBe('デフォルト branch は削除できません');
  });

  test('maps duplicate branch creation failure', () => {
    const parsed = describeGitError(
      "fatal: a branch named 'feature/context-menu' already exists",
      'ブランチ作成に失敗しました。'
    );

    expect(parsed.title).toBe('同名の branch は既に存在します');
  });

  test('maps invalid branch creation failure', () => {
    const parsed = describeGitError('fatal: not a valid branch name', 'ブランチ作成に失敗しました。');

    expect(parsed.title).toBe('branch 名が不正です');
  });

  test('keeps fallback title for unknown errors', () => {
    const parsed = describeGitError('unexpected low level failure', 'Git 操作に失敗しました。');

    expect(parsed.title).toBe('Git 操作に失敗しました。');
    expect(parsed.detail).toContain('unexpected low level failure');
  });
});
