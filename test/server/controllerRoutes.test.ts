import { describe, expect, mock, test } from "bun:test";

import { createControllerRouter } from "../../server/routes/controller.js";
import { DEFAULT_APP_CONFIG } from "../../shared/config.js";
import { invokeJsonRoute } from "./routeHarness";

const snapshot = {
  fingerprint: "fingerprint-1",
  branches: {
    current: "main",
    local: [],
    remote: [],
  },
  logRef: "refs/heads/main",
  compareRefs: ["refs/heads/feature/cache"],
  commits: null,
  workingTreeStatus: {
    conflicted: [],
    staged: [],
    unstaged: [],
  },
  stashes: [],
  pullStatus: {
    branchName: "main",
    upstreamName: "origin/main",
    remoteName: "origin",
    remoteBranchName: "main",
    aheadCount: 0,
    behindCount: 0,
    canPull: false,
    state: "upToDate" as const,
  },
};

describe("createControllerRouter", () => {
  test("parses snapshot query params and delegates to the snapshot loader", async () => {
    const getControllerSnapshot = mock(
      async (_options: {
        repoPath: string;
        ref?: string;
        compareRefs?: string[];
        offset?: number;
        limit?: number;
        includeCommits?: boolean;
      }) => snapshot,
    );

    await expect(
      invokeJsonRoute(
        createControllerRouter({
          getControllerSnapshot,
          readConfig: async () => ({ ...DEFAULT_APP_CONFIG }),
        }),
        "get",
        "/api/controller/snapshot",
        {
          query: {
            repoPath: "/tmp/repo",
            ref: "refs/heads/main",
            compareRef: ["refs/heads/feature/cache", "refs/heads/release"],
            offset: "10",
            limit: "150",
            includeCommits: "false",
          },
        },
      ),
    ).resolves.toEqual({
      statusCode: 200,
      body: snapshot,
    });

    expect(getControllerSnapshot).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      ref: "refs/heads/main",
      compareRefs: ["refs/heads/feature/cache", "refs/heads/release"],
      offset: 10,
      limit: 150,
      includeCommits: false,
    });
  });
});
