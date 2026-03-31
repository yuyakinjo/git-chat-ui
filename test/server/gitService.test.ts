import { describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  applyStash,
  appendFileToStash,
  createBranch,
  deleteBranch,
  getBranches,
  getBranchDiffDetail,
  getBranchDiffFileDetail,
  getCommitDetail,
  getCommitFileDiffDetail,
  getDiffSnippet,
  getPullStatus,
  getStashDiffDetail,
  getStashDiffFileDetail,
  getStashes,
  getWorkingTreeDiffDetail,
  mergeBranches,
  normalizeGithubRemoteUrl,
  popStash,
  pullCurrentBranch,
  renameStash,
  resolveRepositories,
} from "../../server/gitService";

const execFileAsync = promisify(execFile);

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function createRemoteDeleteFixture(): Promise<{ rootDir: string; repoPath: string }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "git-chat-ui-delete-remote-"));
  const originPath = path.join(rootDir, "origin.git");
  const repoPath = path.join(rootDir, "worktree");

  await runGit(["init", "--bare", originPath], rootDir);
  await runGit(["clone", originPath, repoPath], rootDir);
  await runGit(["config", "user.name", "Test User"], repoPath);
  await runGit(["config", "user.email", "test@example.com"], repoPath);

  await runGit(["checkout", "-b", "main"], repoPath);
  await fs.writeFile(path.join(repoPath, "README.md"), "root\n");
  await runGit(["add", "README.md"], repoPath);
  await runGit(["commit", "-m", "init"], repoPath);
  await runGit(["push", "-u", "origin", "main"], repoPath);
  await runGit(["symbolic-ref", "HEAD", "refs/heads/main"], originPath);
  await runGit(["remote", "set-head", "origin", "--auto"], repoPath);

  await runGit(["checkout", "-b", "feature/remote-delete"], repoPath);
  await fs.writeFile(path.join(repoPath, "feature.txt"), "feature\n");
  await runGit(["add", "feature.txt"], repoPath);
  await runGit(["commit", "-m", "feature"], repoPath);
  await runGit(["push", "-u", "origin", "feature/remote-delete"], repoPath);
  await runGit(["checkout", "main"], repoPath);

  return { rootDir, repoPath };
}

async function createWorkingTreeDiffFixture(): Promise<{ rootDir: string; repoPath: string }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "git-chat-ui-working-tree-diff-"));
  const repoPath = path.join(rootDir, "repo");

  await runGit(["init", "-b", "main", repoPath], rootDir);
  await runGit(["config", "user.name", "Test User"], repoPath);
  await runGit(["config", "user.email", "test@example.com"], repoPath);

  await fs.writeFile(path.join(repoPath, "README.md"), "line 1\nline 2\n");
  await runGit(["add", "README.md"], repoPath);
  await runGit(["commit", "-m", "init"], repoPath);

  await fs.writeFile(path.join(repoPath, "README.md"), "line 1\nline changed\nline 3\n");

  return { rootDir, repoPath };
}

async function createMergeFixture(): Promise<{ rootDir: string; repoPath: string }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "git-chat-ui-merge-"));
  const repoPath = path.join(rootDir, "repo");

  await runGit(["init", "-b", "main", repoPath], rootDir);
  await runGit(["config", "user.name", "Test User"], repoPath);
  await runGit(["config", "user.email", "test@example.com"], repoPath);

  await fs.writeFile(path.join(repoPath, "README.md"), "root\n");
  await runGit(["add", "README.md"], repoPath);
  await runGit(["commit", "-m", "init"], repoPath);

  await runGit(["checkout", "-b", "feature/dnd-merge"], repoPath);
  await fs.writeFile(path.join(repoPath, "feature.txt"), "feature\n");
  await runGit(["add", "feature.txt"], repoPath);
  await runGit(["commit", "-m", "feature"], repoPath);

  return { rootDir, repoPath };
}

async function createPullFixture(): Promise<{
  rootDir: string;
  repoPath: string;
  collaboratorPath: string;
}> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "git-chat-ui-pull-"));
  const originPath = path.join(rootDir, "origin.git");
  const repoPath = path.join(rootDir, "local");

  await runGit(["init", "--bare", originPath], rootDir);
  await runGit(["clone", originPath, repoPath], rootDir);
  await runGit(["config", "user.name", "Test User"], repoPath);
  await runGit(["config", "user.email", "test@example.com"], repoPath);

  await runGit(["checkout", "-b", "main"], repoPath);
  await fs.writeFile(path.join(repoPath, "README.md"), "root\n");
  await runGit(["add", "README.md"], repoPath);
  await runGit(["commit", "-m", "init"], repoPath);
  await runGit(["push", "-u", "origin", "main"], repoPath);
  await runGit(["symbolic-ref", "HEAD", "refs/heads/main"], originPath);
  await runGit(["remote", "set-head", "origin", "--auto"], repoPath);

  const collaboratorPath = path.join(rootDir, "collaborator");
  await runGit(["clone", originPath, collaboratorPath], rootDir);
  await runGit(["config", "user.name", "Test User"], collaboratorPath);
  await runGit(["config", "user.email", "test@example.com"], collaboratorPath);
  await runGit(["checkout", "main"], collaboratorPath);

  return { rootDir, repoPath, collaboratorPath };
}

async function createBranchDiffFixture(): Promise<{ rootDir: string; repoPath: string }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "git-chat-ui-branch-diff-"));
  const repoPath = path.join(rootDir, "repo");

  await runGit(["init", "-b", "main", repoPath], rootDir);
  await runGit(["config", "user.name", "Test User"], repoPath);
  await runGit(["config", "user.email", "test@example.com"], repoPath);

  const baseLines = Array.from({ length: 3200 }, (_, index) => `base line ${index}`).join("\n");
  await fs.writeFile(path.join(repoPath, "big.txt"), `${baseLines}\n`);
  await fs.mkdir(path.join(repoPath, "src"), { recursive: true });
  await fs.writeFile(path.join(repoPath, "src", "app.ts"), "export const version = 'base';\n");
  await runGit(["add", "big.txt", "src/app.ts"], repoPath);
  await runGit(["commit", "-m", "init"], repoPath);

  await runGit(["checkout", "-b", "feature/syntax"], repoPath);
  const featureLines = Array.from({ length: 3200 }, (_, index) => `feature line ${index}`).join(
    "\n",
  );
  await fs.writeFile(path.join(repoPath, "big.txt"), `${featureLines}\n`);
  await fs.writeFile(path.join(repoPath, "src", "app.ts"), "export const version = 'feature';\n");
  await runGit(["add", "big.txt", "src/app.ts"], repoPath);
  await runGit(["commit", "-m", "feature"], repoPath);

  return { rootDir, repoPath };
}

async function createStashFixture(): Promise<{ rootDir: string; repoPath: string }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "git-chat-ui-stash-rename-"));
  const repoPath = path.join(rootDir, "repo");

  await runGit(["init", "-b", "main", repoPath], rootDir);
  await runGit(["config", "user.name", "Test User"], repoPath);
  await runGit(["config", "user.email", "test@example.com"], repoPath);

  await fs.writeFile(path.join(repoPath, "README.md"), "root\n");
  await fs.writeFile(path.join(repoPath, "alpha.txt"), "alpha base\n");
  await fs.writeFile(path.join(repoPath, "beta.txt"), "beta base\n");
  await runGit(["add", "README.md"], repoPath);
  await runGit(["add", "alpha.txt"], repoPath);
  await runGit(["add", "beta.txt"], repoPath);
  await runGit(["commit", "-m", "init"], repoPath);

  await fs.writeFile(path.join(repoPath, "alpha.txt"), "alpha updated\n");
  await runGit(["stash", "push", "-m", "first stash", "--", "alpha.txt"], repoPath);

  await fs.writeFile(path.join(repoPath, "beta.txt"), "beta updated\n");
  await runGit(["stash", "push", "-m", "second stash", "--", "beta.txt"], repoPath);

  return { rootDir, repoPath };
}

describe("normalizeGithubRemoteUrl", () => {
  test("normalizes ssh origin urls", () => {
    expect(normalizeGithubRemoteUrl("git@github.com:yuyakinjo/git-chat-ui.git")).toBe(
      "https://github.com/yuyakinjo/git-chat-ui",
    );
  });

  test("normalizes https origin urls", () => {
    expect(normalizeGithubRemoteUrl("https://github.com/yuyakinjo/git-chat-ui.git")).toBe(
      "https://github.com/yuyakinjo/git-chat-ui",
    );
  });

  test("returns null for non github remotes", () => {
    expect(normalizeGithubRemoteUrl("git@gitlab.com:yuyakinjo/git-chat-ui.git")).toBeNull();
  });
});

describe("resolveRepositories", () => {
  test("returns only valid repositories, preserving input order and removing duplicates", async () => {
    const first = await createWorkingTreeDiffFixture();
    const second = await createRemoteDeleteFixture();
    const missingPath = path.join(first.rootDir, "missing");

    try {
      const [resolvedSecondPath, resolvedFirstPath] = await Promise.all([
        fs.realpath(second.repoPath),
        fs.realpath(first.repoPath),
      ]);
      const repositories = await resolveRepositories([
        second.repoPath,
        missingPath,
        first.repoPath,
        second.repoPath,
      ]);

      expect(repositories).toEqual([
        {
          name: path.basename(resolvedSecondPath),
          path: resolvedSecondPath,
        },
        {
          name: path.basename(resolvedFirstPath),
          path: resolvedFirstPath,
        },
      ]);
    } finally {
      await fs.rm(first.rootDir, { recursive: true, force: true });
      await fs.rm(second.rootDir, { recursive: true, force: true });
    }
  });
});

describe("createBranch", () => {
  test("creates a new local branch from the selected base branch without switching HEAD", async () => {
    const fixture = await createRemoteDeleteFixture();

    try {
      const baseSha = await runGit(["rev-parse", "feature/remote-delete"], fixture.repoPath);

      await createBranch(fixture.repoPath, "feature/remote-delete", "feature/context-menu");

      expect(await runGit(["rev-parse", "feature/context-menu"], fixture.repoPath)).toBe(baseSha);
      expect(await runGit(["branch", "--show-current"], fixture.repoPath)).toBe("main");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  test("rejects duplicate local branch names", async () => {
    const fixture = await createRemoteDeleteFixture();

    try {
      await expect(createBranch(fixture.repoPath, "main", "feature/remote-delete")).rejects.toThrow(
        "Local branch 'feature/remote-delete' already exists.",
      );
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});

describe("mergeBranches", () => {
  test("merges into a non-current target branch without switching HEAD", async () => {
    const fixture = await createMergeFixture();

    try {
      const featureSha = await runGit(["rev-parse", "feature/dnd-merge"], fixture.repoPath);

      await mergeBranches(fixture.repoPath, "feature/dnd-merge", "main");

      expect(await runGit(["branch", "--show-current"], fixture.repoPath)).toBe(
        "feature/dnd-merge",
      );
      expect(await runGit(["rev-parse", "main"], fixture.repoPath)).toBe(featureSha);
      expect(await fs.readFile(path.join(fixture.repoPath, "feature.txt"), "utf8")).toBe(
        "feature\n",
      );
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});

describe("getPullStatus", () => {
  test("reports behind counts against the tracked upstream branch", async () => {
    const fixture = await createPullFixture();

    try {
      await fs.writeFile(path.join(fixture.collaboratorPath, "README.md"), "root\nremote update\n");
      await runGit(["commit", "-am", "remote update"], fixture.collaboratorPath);
      await runGit(["push", "origin", "main"], fixture.collaboratorPath);
      await runGit(["fetch", "origin"], fixture.repoPath);

      await expect(getPullStatus(fixture.repoPath)).resolves.toEqual({
        branchName: "main",
        upstreamName: "origin/main",
        remoteName: "origin",
        remoteBranchName: "main",
        aheadCount: 0,
        behindCount: 1,
        canPull: true,
        state: "behind",
      });
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});

describe("pullCurrentBranch", () => {
  test("fast-forwards the current branch to the tracked upstream branch", async () => {
    const fixture = await createPullFixture();

    try {
      await fs.writeFile(path.join(fixture.collaboratorPath, "README.md"), "root\nremote update\n");
      await runGit(["commit", "-am", "remote update"], fixture.collaboratorPath);
      await runGit(["push", "origin", "main"], fixture.collaboratorPath);

      await pullCurrentBranch(fixture.repoPath);

      expect(await runGit(["branch", "--show-current"], fixture.repoPath)).toBe("main");
      expect(await runGit(["rev-parse", "HEAD"], fixture.repoPath)).toBe(
        await runGit(["rev-parse", "origin/main"], fixture.repoPath),
      );
      expect(await fs.readFile(path.join(fixture.repoPath, "README.md"), "utf8")).toContain(
        "remote update",
      );
      await expect(getPullStatus(fixture.repoPath)).resolves.toMatchObject({
        behindCount: 0,
        canPull: false,
        state: "upToDate",
      });
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});

describe("renameStash", () => {
  test("renames the selected stash without changing stack order", async () => {
    const fixture = await createStashFixture();

    try {
      const before = await getStashes(fixture.repoPath);
      expect(before.map((stash) => stash.message)).toEqual([
        "On main: second stash",
        "On main: first stash",
      ]);

      await renameStash(fixture.repoPath, "stash@{1}", "Renamed first stash");

      const after = await getStashes(fixture.repoPath);
      expect(after.map((stash) => stash.id)).toEqual(["stash@{0}", "stash@{1}"]);
      expect(after.map((stash) => stash.message)).toEqual([
        "On main: second stash",
        "Renamed first stash",
      ]);
      expect(after[0]?.files).toEqual(["beta.txt"]);
      expect(after[1]?.files).toEqual(["alpha.txt"]);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});

describe("appendFileToStash", () => {
  test("replaces the selected stash entry with a combined stash while preserving stack order", async () => {
    const fixture = await createStashFixture();

    try {
      await fs.writeFile(path.join(fixture.repoPath, "README.md"), "root\nappended line\n");

      await appendFileToStash(fixture.repoPath, "stash@{1}", "README.md");

      const stashes = await getStashes(fixture.repoPath);
      expect(stashes.map((stash) => stash.id)).toEqual(["stash@{0}", "stash@{1}"]);
      expect(stashes.map((stash) => stash.message)).toEqual([
        "On main: second stash",
        "On main: first stash",
      ]);
      expect(stashes[0]?.files).toEqual(["beta.txt"]);
      expect([...(stashes[1]?.files ?? [])].sort()).toEqual(["README.md", "alpha.txt"]);

      const detail = await getStashDiffDetail(fixture.repoPath, "stash@{1}");
      expect(detail.files.map((file) => file.file).sort()).toEqual(["README.md", "alpha.txt"]);
      expect(detail.diff).toContain("diff --git a/README.md b/README.md");
      expect(detail.diff).toContain("+appended line");
      expect(detail.diff).toContain("diff --git a/alpha.txt b/alpha.txt");
      expect(detail.diff).toContain("+alpha updated");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});

describe("getStashDiffDetail", () => {
  test("returns diff detail for the selected stash entry", async () => {
    const fixture = await createStashFixture();

    try {
      const detail = await getStashDiffDetail(fixture.repoPath, "stash@{0}");

      expect(detail.stashId).toBe("stash@{0}");
      expect(detail.files).toEqual([
        {
          file: "beta.txt",
          additions: 1,
          deletions: 1,
        },
      ]);
      expect(detail.diff).toContain("diff --git a/beta.txt b/beta.txt");
      expect(detail.diff).toContain("+beta updated");
      expect(detail.isDiffTruncated).toBe(false);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});

describe("getStashDiffFileDetail", () => {
  test("returns diff detail for a selected file inside the stash", async () => {
    const fixture = await createStashFixture();

    try {
      const detail = await getStashDiffFileDetail(fixture.repoPath, "stash@{0}", "beta.txt");

      expect(detail.stashId).toBe("stash@{0}");
      expect(detail.file).toBe("beta.txt");
      expect(detail.diff).toContain("diff --git a/beta.txt b/beta.txt");
      expect(detail.diff).toContain("+beta updated");
      expect(detail.isDiffTruncated).toBe(false);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});

describe("applyStash", () => {
  test("applies the selected stash without removing it from the stack", async () => {
    const fixture = await createStashFixture();

    try {
      await applyStash(fixture.repoPath, "stash@{1}");

      const stashes = await getStashes(fixture.repoPath);
      expect(stashes.map((stash) => stash.id)).toEqual(["stash@{0}", "stash@{1}"]);
      expect(await runGit(["status", "--porcelain"], fixture.repoPath)).toContain("alpha.txt");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});

describe("popStash", () => {
  test("applies the selected stash and removes it from the stack", async () => {
    const fixture = await createStashFixture();

    try {
      await popStash(fixture.repoPath, "stash@{0}");

      const stashes = await getStashes(fixture.repoPath);
      expect(stashes.map((stash) => stash.id)).toEqual(["stash@{0}"]);
      expect(stashes.map((stash) => stash.message)).toEqual(["On main: first stash"]);
      expect(await runGit(["status", "--porcelain"], fixture.repoPath)).toContain("beta.txt");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});

describe("getWorkingTreeDiffDetail", () => {
  test("returns unstaged diff detail for a changed file", async () => {
    const fixture = await createWorkingTreeDiffFixture();

    try {
      const detail = await getWorkingTreeDiffDetail({
        repoPath: fixture.repoPath,
        file: "README.md",
        area: "unstaged",
      });

      expect(detail.file).toBe("README.md");
      expect(detail.area).toBe("unstaged");
      expect(detail.files).toEqual([
        {
          file: "README.md",
          additions: 2,
          deletions: 1,
        },
      ]);
      expect(detail.diff).toContain("diff --git a/README.md b/README.md");
      expect(detail.diff).toContain("+line changed");
      expect(detail.isDiffTruncated).toBe(false);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  test("returns unstaged diff detail for an untracked added file", async () => {
    const fixture = await createWorkingTreeDiffFixture();

    try {
      await fs.writeFile(path.join(fixture.repoPath, "notes.txt"), "alpha\nbeta\n");

      const detail = await getWorkingTreeDiffDetail({
        repoPath: fixture.repoPath,
        file: "notes.txt",
        area: "unstaged",
      });

      expect(detail.file).toBe("notes.txt");
      expect(detail.area).toBe("unstaged");
      expect(detail.files).toEqual([
        {
          file: "notes.txt",
          additions: 2,
          deletions: 0,
        },
      ]);
      expect(detail.diff).toContain("diff --git a/notes.txt b/notes.txt");
      expect(detail.diff).toContain("--- /dev/null");
      expect(detail.diff).toContain("+alpha");
      expect(detail.diff).toContain("+beta");
      expect(detail.isDiffTruncated).toBe(false);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});

describe("getBranchDiffFileDetail", () => {
  test("returns a selected file diff even when the aggregate branch diff is truncated earlier", async () => {
    const fixture = await createBranchDiffFixture();

    try {
      const overall = await getBranchDiffDetail({
        repoPath: fixture.repoPath,
        baseRef: "main",
        targetRef: "feature/syntax",
      });

      expect(overall.isDiffTruncated).toBe(true);
      expect(overall.files.some((file) => file.file === "src/app.ts")).toBe(true);
      expect(overall.diff).not.toContain("diff --git a/src/app.ts b/src/app.ts");

      const detail = await getBranchDiffFileDetail({
        repoPath: fixture.repoPath,
        baseRef: "main",
        targetRef: "feature/syntax",
        file: "src/app.ts",
      });

      expect(detail.file).toBe("src/app.ts");
      expect(detail.diff).toContain("diff --git a/src/app.ts b/src/app.ts");
      expect(detail.diff).toContain("+export const version = 'feature';");
      expect(detail.isDiffTruncated).toBe(false);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});

describe("getCommitFileDiffDetail", () => {
  test("returns a selected file diff even when the aggregate commit diff is truncated earlier", async () => {
    const fixture = await createBranchDiffFixture();

    try {
      const sha = await runGit(["rev-parse", "HEAD"], fixture.repoPath);
      const overall = await getCommitDetail(fixture.repoPath, sha);

      expect(overall.files.some((file) => file.file === "src/app.ts")).toBe(true);
      expect(overall.diff).not.toContain("diff --git a/src/app.ts b/src/app.ts");

      const detail = await getCommitFileDiffDetail(fixture.repoPath, sha, "src/app.ts");

      expect(detail.sha).toBe(sha);
      expect(detail.file).toBe("src/app.ts");
      expect(detail.diff).toContain("diff --git a/src/app.ts b/src/app.ts");
      expect(detail.diff).toContain("+export const version = 'feature';");
      expect(detail.isDiffTruncated).toBe(false);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});

describe("getDiffSnippet", () => {
  test("includes untracked added files in the generated snippet", async () => {
    const fixture = await createWorkingTreeDiffFixture();

    try {
      await fs.writeFile(path.join(fixture.repoPath, "notes.txt"), "alpha\nbeta\n");

      const snippet = await getDiffSnippet(fixture.repoPath, ["README.md", "notes.txt"]);

      expect(snippet).toContain("diff --git a/README.md b/README.md");
      expect(snippet).toContain("diff --git a/notes.txt b/notes.txt");
      expect(snippet).toContain("+++ b/notes.txt");
      expect(snippet).toContain("+alpha");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});

describe("deleteBranch", () => {
  test("deletes merged local branches with safe delete", async () => {
    const fixture = await createRemoteDeleteFixture();

    try {
      await runGit(["checkout", "-b", "feature/local-merged-delete"], fixture.repoPath);
      await fs.writeFile(path.join(fixture.repoPath, "merged.txt"), "merged\n");
      await runGit(["add", "merged.txt"], fixture.repoPath);
      await runGit(["commit", "-m", "merged local branch"], fixture.repoPath);
      await runGit(["checkout", "main"], fixture.repoPath);
      await runGit(["merge", "feature/local-merged-delete"], fixture.repoPath);

      await deleteBranch(fixture.repoPath, "feature/local-merged-delete", "local");

      expect(
        await runGit(["branch", "--list", "feature/local-merged-delete"], fixture.repoPath),
      ).toBe("");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  test("force deletes unmerged local branches when requested", async () => {
    const fixture = await createRemoteDeleteFixture();

    try {
      await deleteBranch(fixture.repoPath, "feature/remote-delete", "local", true);

      expect(await runGit(["branch", "--list", "feature/remote-delete"], fixture.repoPath)).toBe(
        "",
      );
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  test("marks remote default branches in branch listings", async () => {
    const fixture = await createRemoteDeleteFixture();

    try {
      const branches = await getBranches(fixture.repoPath);
      expect(branches.remote.find((branch) => branch.name === "origin/main")?.isRemoteDefault).toBe(
        true,
      );
      expect(
        branches.remote.find((branch) => branch.name === "origin/feature/remote-delete")
          ?.isRemoteDefault,
      ).toBeUndefined();
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  test("deletes remote branches and prunes local tracking refs", async () => {
    const fixture = await createRemoteDeleteFixture();

    try {
      await deleteBranch(fixture.repoPath, "origin/feature/remote-delete", "remote");

      expect(
        await runGit(["ls-remote", "--heads", "origin", "feature/remote-delete"], fixture.repoPath),
      ).toBe("");
      expect(
        await runGit(["branch", "-r", "--list", "origin/feature/remote-delete"], fixture.repoPath),
      ).toBe("");
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });

  test("rejects deleting the remote default branch", async () => {
    const fixture = await createRemoteDeleteFixture();

    try {
      await expect(deleteBranch(fixture.repoPath, "origin/main", "remote")).rejects.toThrow(
        "Default branch 'main' on remote 'origin' cannot be deleted.",
      );
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});
