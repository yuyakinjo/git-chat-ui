import { describe, expect, test } from 'bun:test';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { deleteBranch, normalizeGithubRemoteUrl } from './gitService';

const execFileAsync = promisify(execFile);

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

async function createRemoteDeleteFixture(): Promise<{ rootDir: string; repoPath: string }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-chat-ui-delete-remote-'));
  const originPath = path.join(rootDir, 'origin.git');
  const repoPath = path.join(rootDir, 'worktree');

  await runGit(['init', '--bare', originPath], rootDir);
  await runGit(['clone', originPath, repoPath], rootDir);
  await runGit(['config', 'user.name', 'Test User'], repoPath);
  await runGit(['config', 'user.email', 'test@example.com'], repoPath);

  await runGit(['checkout', '-b', 'main'], repoPath);
  await fs.writeFile(path.join(repoPath, 'README.md'), 'root\n');
  await runGit(['add', 'README.md'], repoPath);
  await runGit(['commit', '-m', 'init'], repoPath);
  await runGit(['push', '-u', 'origin', 'main'], repoPath);

  await runGit(['checkout', '-b', 'feature/remote-delete'], repoPath);
  await fs.writeFile(path.join(repoPath, 'feature.txt'), 'feature\n');
  await runGit(['add', 'feature.txt'], repoPath);
  await runGit(['commit', '-m', 'feature'], repoPath);
  await runGit(['push', '-u', 'origin', 'feature/remote-delete'], repoPath);
  await runGit(['checkout', 'main'], repoPath);

  return { rootDir, repoPath };
}

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

describe('deleteBranch', () => {
  test('deletes remote branches and prunes local tracking refs', async () => {
    const fixture = await createRemoteDeleteFixture();

    try {
      await deleteBranch(fixture.repoPath, 'origin/feature/remote-delete', 'remote');

      expect(await runGit(['ls-remote', '--heads', 'origin', 'feature/remote-delete'], fixture.repoPath)).toBe('');
      expect(await runGit(['branch', '-r', '--list', 'origin/feature/remote-delete'], fixture.repoPath)).toBe('');
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  test('rejects deleting the remote default branch', async () => {
    const fixture = await createRemoteDeleteFixture();

    try {
      await expect(deleteBranch(fixture.repoPath, 'origin/main', 'remote')).rejects.toThrow(
        "Default branch 'main' on remote 'origin' cannot be deleted."
      );
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});
