import { describe, expect, test } from 'bun:test';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  createBranch,
  deleteBranch,
  getBranches,
  getDiffSnippet,
  getStashes,
  getWorkingTreeDiffDetail,
  normalizeGithubRemoteUrl,
  renameStash,
  resolveRepositories
} from '../../server/gitService';

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
  await runGit(['symbolic-ref', 'HEAD', 'refs/heads/main'], originPath);
  await runGit(['remote', 'set-head', 'origin', '--auto'], repoPath);

  await runGit(['checkout', '-b', 'feature/remote-delete'], repoPath);
  await fs.writeFile(path.join(repoPath, 'feature.txt'), 'feature\n');
  await runGit(['add', 'feature.txt'], repoPath);
  await runGit(['commit', '-m', 'feature'], repoPath);
  await runGit(['push', '-u', 'origin', 'feature/remote-delete'], repoPath);
  await runGit(['checkout', 'main'], repoPath);

  return { rootDir, repoPath };
}

async function createWorkingTreeDiffFixture(): Promise<{ rootDir: string; repoPath: string }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-chat-ui-working-tree-diff-'));
  const repoPath = path.join(rootDir, 'repo');

  await runGit(['init', '-b', 'main', repoPath], rootDir);
  await runGit(['config', 'user.name', 'Test User'], repoPath);
  await runGit(['config', 'user.email', 'test@example.com'], repoPath);

  await fs.writeFile(path.join(repoPath, 'README.md'), 'line 1\nline 2\n');
  await runGit(['add', 'README.md'], repoPath);
  await runGit(['commit', '-m', 'init'], repoPath);

  await fs.writeFile(path.join(repoPath, 'README.md'), 'line 1\nline changed\nline 3\n');

  return { rootDir, repoPath };
}

async function createStashFixture(): Promise<{ rootDir: string; repoPath: string }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-chat-ui-stash-rename-'));
  const repoPath = path.join(rootDir, 'repo');

  await runGit(['init', '-b', 'main', repoPath], rootDir);
  await runGit(['config', 'user.name', 'Test User'], repoPath);
  await runGit(['config', 'user.email', 'test@example.com'], repoPath);

  await fs.writeFile(path.join(repoPath, 'README.md'), 'root\n');
  await fs.writeFile(path.join(repoPath, 'alpha.txt'), 'alpha base\n');
  await fs.writeFile(path.join(repoPath, 'beta.txt'), 'beta base\n');
  await runGit(['add', 'README.md'], repoPath);
  await runGit(['add', 'alpha.txt'], repoPath);
  await runGit(['add', 'beta.txt'], repoPath);
  await runGit(['commit', '-m', 'init'], repoPath);

  await fs.writeFile(path.join(repoPath, 'alpha.txt'), 'alpha updated\n');
  await runGit(['stash', 'push', '-m', 'first stash', '--', 'alpha.txt'], repoPath);

  await fs.writeFile(path.join(repoPath, 'beta.txt'), 'beta updated\n');
  await runGit(['stash', 'push', '-m', 'second stash', '--', 'beta.txt'], repoPath);

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

describe('resolveRepositories', () => {
  test('returns only valid repositories, preserving input order and removing duplicates', async () => {
    const first = await createWorkingTreeDiffFixture();
    const second = await createRemoteDeleteFixture();
    const missingPath = path.join(first.rootDir, 'missing');

    try {
      const [resolvedSecondPath, resolvedFirstPath] = await Promise.all([
        fs.realpath(second.repoPath),
        fs.realpath(first.repoPath)
      ]);
      const repositories = await resolveRepositories([
        second.repoPath,
        missingPath,
        first.repoPath,
        second.repoPath
      ]);

      expect(repositories).toEqual([
        {
          name: path.basename(resolvedSecondPath),
          path: resolvedSecondPath
        },
        {
          name: path.basename(resolvedFirstPath),
          path: resolvedFirstPath
        }
      ]);
    } finally {
      await fs.rm(first.rootDir, { recursive: true, force: true });
      await fs.rm(second.rootDir, { recursive: true, force: true });
    }
  });
});

describe('createBranch', () => {
  test('creates a new local branch from the selected base branch without switching HEAD', async () => {
    const fixture = await createRemoteDeleteFixture();

    try {
      const baseSha = await runGit(['rev-parse', 'feature/remote-delete'], fixture.repoPath);

      await createBranch(fixture.repoPath, 'feature/remote-delete', 'feature/context-menu');

      expect(await runGit(['rev-parse', 'feature/context-menu'], fixture.repoPath)).toBe(baseSha);
      expect(await runGit(['branch', '--show-current'], fixture.repoPath)).toBe('main');
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  test('rejects duplicate local branch names', async () => {
    const fixture = await createRemoteDeleteFixture();

    try {
      await expect(createBranch(fixture.repoPath, 'main', 'feature/remote-delete')).rejects.toThrow(
        "Local branch 'feature/remote-delete' already exists."
      );
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});

describe('renameStash', () => {
  test('renames the selected stash without changing stack order', async () => {
    const fixture = await createStashFixture();

    try {
      const before = await getStashes(fixture.repoPath);
      expect(before.map((stash) => stash.message)).toEqual(['On main: second stash', 'On main: first stash']);

      await renameStash(fixture.repoPath, 'stash@{1}', 'Renamed first stash');

      const after = await getStashes(fixture.repoPath);
      expect(after.map((stash) => stash.id)).toEqual(['stash@{0}', 'stash@{1}']);
      expect(after.map((stash) => stash.message)).toEqual(['On main: second stash', 'Renamed first stash']);
      expect(after[0]?.files).toEqual(['beta.txt']);
      expect(after[1]?.files).toEqual(['alpha.txt']);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});

describe('getWorkingTreeDiffDetail', () => {
  test('returns unstaged diff detail for a changed file', async () => {
    const fixture = await createWorkingTreeDiffFixture();

    try {
      const detail = await getWorkingTreeDiffDetail({
        repoPath: fixture.repoPath,
        file: 'README.md',
        area: 'unstaged'
      });

      expect(detail.file).toBe('README.md');
      expect(detail.area).toBe('unstaged');
      expect(detail.files).toEqual([
        {
          file: 'README.md',
          additions: 2,
          deletions: 1
        }
      ]);
      expect(detail.diff).toContain('diff --git a/README.md b/README.md');
      expect(detail.diff).toContain('+line changed');
      expect(detail.isDiffTruncated).toBe(false);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  test('returns unstaged diff detail for an untracked added file', async () => {
    const fixture = await createWorkingTreeDiffFixture();

    try {
      await fs.writeFile(path.join(fixture.repoPath, 'notes.txt'), 'alpha\nbeta\n');

      const detail = await getWorkingTreeDiffDetail({
        repoPath: fixture.repoPath,
        file: 'notes.txt',
        area: 'unstaged'
      });

      expect(detail.file).toBe('notes.txt');
      expect(detail.area).toBe('unstaged');
      expect(detail.files).toEqual([
        {
          file: 'notes.txt',
          additions: 2,
          deletions: 0
        }
      ]);
      expect(detail.diff).toContain('diff --git a/notes.txt b/notes.txt');
      expect(detail.diff).toContain('--- /dev/null');
      expect(detail.diff).toContain('+alpha');
      expect(detail.diff).toContain('+beta');
      expect(detail.isDiffTruncated).toBe(false);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});

describe('getDiffSnippet', () => {
  test('includes untracked added files in the generated snippet', async () => {
    const fixture = await createWorkingTreeDiffFixture();

    try {
      await fs.writeFile(path.join(fixture.repoPath, 'notes.txt'), 'alpha\nbeta\n');

      const snippet = await getDiffSnippet(fixture.repoPath, ['README.md', 'notes.txt']);

      expect(snippet).toContain('diff --git a/README.md b/README.md');
      expect(snippet).toContain('diff --git a/notes.txt b/notes.txt');
      expect(snippet).toContain('+++ b/notes.txt');
      expect(snippet).toContain('+alpha');
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});

describe('deleteBranch', () => {
  test('marks remote default branches in branch listings', async () => {
    const fixture = await createRemoteDeleteFixture();

    try {
      const branches = await getBranches(fixture.repoPath);
      expect(branches.remote.find((branch) => branch.name === 'origin/main')?.isRemoteDefault).toBe(true);
      expect(branches.remote.find((branch) => branch.name === 'origin/feature/remote-delete')?.isRemoteDefault).toBeUndefined();
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

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
