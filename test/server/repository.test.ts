import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { runGit } from "../../server/git/command.js";
import { getRepositoryFingerprint } from "../../server/git/repository.js";

async function createRepositoryFixture(): Promise<{ rootDir: string; repoPath: string }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "git-chat-ui-repository-"));
  const repoPath = path.join(rootDir, "repo");

  await runGit(["init", "-b", "main", repoPath], rootDir);
  await runGit(["config", "user.name", "Test User"], repoPath);
  await runGit(["config", "user.email", "test@example.com"], repoPath);

  await fs.writeFile(path.join(repoPath, "README.md"), "base\n");
  await runGit(["add", "README.md"], repoPath);
  await runGit(["commit", "-m", "init"], repoPath);

  return { rootDir, repoPath };
}

describe("getRepositoryFingerprint", () => {
  test("changes when files are added inside an existing untracked directory", async () => {
    const fixture = await createRepositoryFixture();
    const scratchDir = path.join(fixture.repoPath, "scratch");

    try {
      await fs.mkdir(scratchDir);
      await fs.writeFile(path.join(scratchDir, "a.txt"), "alpha\n");

      const firstFingerprint = await getRepositoryFingerprint(fixture.repoPath);

      await fs.writeFile(path.join(scratchDir, "b.txt"), "beta\n");

      const secondFingerprint = await getRepositoryFingerprint(fixture.repoPath);

      expect(secondFingerprint).not.toBe(firstFingerprint);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});
