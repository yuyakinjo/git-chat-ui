import { describe, expect, test } from 'bun:test';

import { normalizeGithubRemoteUrl } from './gitService';

describe('normalizeGithubRemoteUrl', () => {
  test('normalizes ssh origin urls', () => {
    expect(normalizeGithubRemoteUrl('git@github.com:yuyakinjo/git-chat-ui.git')).toBe(
      'https://github.com/yuyakinjo/git-chat-ui'
    );
  });

  test('normalizes https origin urls', () => {
    expect(normalizeGithubRemoteUrl('https://github.com/yuyakinjo/git-chat-ui.git')).toBe(
      'https://github.com/yuyakinjo/git-chat-ui'
    );
  });

  test('returns null for non github remotes', () => {
    expect(normalizeGithubRemoteUrl('git@gitlab.com:yuyakinjo/git-chat-ui.git')).toBeNull();
  });
});
