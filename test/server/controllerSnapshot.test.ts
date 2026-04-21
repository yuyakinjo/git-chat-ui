import { describe, expect, mock, test } from "bun:test";

import { createControllerSnapshotLoader } from "../../server/git/controllerSnapshot.js";

const branches = {
  current: "main",
  local: [
    {
      name: "main",
      fullRef: "refs/heads/main",
      type: "local" as const,
      commit: "1111111",
    },
    {
      name: "feature/cache",
      fullRef: "refs/heads/feature/cache",
      type: "local" as const,
      commit: "2222222",
    },
  ],
  remote: [
    {
      name: "origin/main",
      fullRef: "refs/remotes/origin/main",
      type: "remote" as const,
      commit: "1111111",
      isRemoteDefault: true,
    },
  ],
};

const workingTreeStatus = {
  conflicted: [],
  staged: [],
  unstaged: [],
};

const stashes = [
  {
    id: "stash@{0}",
    sha: "def5678",
    parentSha: "abc1234",
    date: "2026-04-07T10:00:00+09:00",
    message: "WIP on main",
    files: ["README.md"],
  },
];

const pullStatus = {
  branchName: "main",
  upstreamName: "origin/main",
  remoteName: "origin",
  remoteBranchName: "main",
  aheadCount: 0,
  behindCount: 0,
  canPull: false,
  state: "upToDate" as const,
};

const commitResponse = {
  commits: [
    {
      sha: "1111111",
      parentShas: [],
      author: "Test User",
      date: "2026-04-03T00:00:00.000Z",
      subject: "init",
      decoration: "(HEAD -> main, origin/main)",
    },
  ],
  hasMore: false,
};

describe("createControllerSnapshotLoader", () => {
  test("reuses cached snapshots when the fingerprint and request signature are unchanged", async () => {
    const dependencies = {
      getRepositoryFingerprint: mock(async (_repoPath: string) => "fingerprint-1"),
      getBranches: mock(async (_repoPath: string) => branches),
      getWorkingTreeStatus: mock(async (_repoPath: string) => workingTreeStatus),
      getStashes: mock(async (_repoPath: string) => stashes),
      getPullStatus: mock(async (_repoPath: string, _branchName?: string) => pullStatus),
      getCommits: mock(
        async (_options: {
          repoPath: string;
          ref?: string;
          compareRefs?: string[];
          limit: number;
          offset: number;
        }) => commitResponse,
      ),
    };

    const loadControllerSnapshot = createControllerSnapshotLoader(dependencies);

    const first = await loadControllerSnapshot({ repoPath: "/tmp/repo" });
    const second = await loadControllerSnapshot({ repoPath: "/tmp/repo" });

    expect(first).toEqual(second);
    expect(dependencies.getRepositoryFingerprint).toHaveBeenCalledTimes(2);
    expect(dependencies.getBranches).toHaveBeenCalledTimes(1);
    expect(dependencies.getWorkingTreeStatus).toHaveBeenCalledTimes(1);
    expect(dependencies.getStashes).toHaveBeenCalledTimes(1);
    expect(dependencies.getPullStatus).toHaveBeenCalledTimes(1);
    expect(dependencies.getCommits).toHaveBeenCalledTimes(1);
  });

  test("can skip commit loading for status-only refreshes", async () => {
    const dependencies = {
      getRepositoryFingerprint: mock(async (_repoPath: string) => "fingerprint-1"),
      getBranches: mock(async (_repoPath: string) => branches),
      getWorkingTreeStatus: mock(async (_repoPath: string) => workingTreeStatus),
      getStashes: mock(async (_repoPath: string) => stashes),
      getPullStatus: mock(async (_repoPath: string, _branchName?: string) => pullStatus),
      getCommits: mock(
        async (_options: {
          repoPath: string;
          ref?: string;
          compareRefs?: string[];
          limit: number;
          offset: number;
        }) => commitResponse,
      ),
    };

    const loadControllerSnapshot = createControllerSnapshotLoader(dependencies);
    const snapshot = await loadControllerSnapshot({
      repoPath: "/tmp/repo",
      includeCommits: false,
    });

    expect(snapshot.commits).toBeNull();
    expect(snapshot.logRef).toBe("refs/heads/main");
    expect(snapshot.compareRefs).toEqual([
      "refs/heads/feature/cache",
      "refs/remotes/origin/main",
    ]);
    expect(dependencies.getCommits).not.toHaveBeenCalled();
  });
});
