import { describe, expect, test } from "bun:test";

import {
  refreshAfterCheckout,
  refreshAfterCheckoutPreservingGraph,
} from "../../../src/lib/checkoutRefresh";

function createDeferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

describe("refreshAfterCheckout", () => {
  test("returns after the metadata snapshot while commits continue refreshing in the background", async () => {
    const events: string[] = [];
    const pullRequestRefresh = createDeferredPromise<void>();
    const commitRefresh = createDeferredPromise<boolean>();

    const result = await refreshAfterCheckout(
      {
        loadBranchPullRequests: async () => {
          events.push("pull-requests:start");
          await pullRequestRefresh.promise;
          events.push("pull-requests:done");
        },
        loadControllerSnapshot: async (options) => {
          events.push(
            `snapshot:${options.ref ?? "HEAD"}:${options.includeCommits ? "with-commits" : "without-commits"}`,
          );
          if (options.includeCommits === false) {
            return true;
          }

          return await commitRefresh.promise;
        },
      },
      { ref: "feature/checkout-speed" },
    );

    expect(result).toBe(true);
    expect(events).toEqual([
      "pull-requests:start",
      "snapshot:feature/checkout-speed:without-commits",
      "snapshot:feature/checkout-speed:with-commits",
    ]);

    pullRequestRefresh.resolve();
    commitRefresh.resolve(true);
    await pullRequestRefresh.promise;
    await commitRefresh.promise;
    expect(events).toEqual([
      "pull-requests:start",
      "snapshot:feature/checkout-speed:without-commits",
      "snapshot:feature/checkout-speed:with-commits",
      "pull-requests:done",
    ]);
  });

  test("continues even if branch pull request refresh fails", async () => {
    const commitRefresh = createDeferredPromise<boolean>();

    await expect(
      refreshAfterCheckout(
        {
          loadBranchPullRequests: async () => {
            throw new Error("gh unavailable");
          },
          loadControllerSnapshot: async (options) => {
            if (options.includeCommits === false) {
              expect(options).toEqual({
                ref: "HEAD",
                includeCommits: false,
              });
              return true;
            }

            expect(options).toEqual({
              ref: "HEAD",
              includeCommits: true,
            });
            return await commitRefresh.promise;
          },
        },
        { ref: "HEAD" },
      ),
    ).resolves.toBe(true);

    commitRefresh.resolve(true);
    await commitRefresh.promise;
  });

  test("skips the background commit refresh when the metadata snapshot fails", async () => {
    const snapshotCalls: Array<{ ref?: string; includeCommits?: boolean }> = [];

    await expect(
      refreshAfterCheckout(
        {
          loadBranchPullRequests: async () => {},
          loadControllerSnapshot: async (options) => {
            snapshotCalls.push(options);
            return false;
          },
        },
        { ref: "refs/heads/main" },
      ),
    ).resolves.toBe(false);

    expect(snapshotCalls).toEqual([
      {
        ref: "refs/heads/main",
        includeCommits: false,
      },
    ]);
  });
});

describe("refreshAfterCheckoutPreservingGraph", () => {
  test("returns after branch, working tree, and pull status refresh while PR and fingerprint sync continue in the background", async () => {
    const events: string[] = [];
    const branchRefresh = createDeferredPromise<void>();
    const workingTreeRefresh = createDeferredPromise<void>();
    const pullStatusRefresh = createDeferredPromise<void>();
    const pullRequestRefresh = createDeferredPromise<void>();
    const fingerprintRefresh = createDeferredPromise<void>();

    const refreshPromise = refreshAfterCheckoutPreservingGraph({
      loadBranches: async () => {
        events.push("branches:start");
        await branchRefresh.promise;
        events.push("branches:done");
      },
      loadWorkingTreeStatus: async () => {
        events.push("working-tree:start");
        await workingTreeRefresh.promise;
        events.push("working-tree:done");
      },
      loadPullStatus: async () => {
        events.push("pull-status:start");
        await pullStatusRefresh.promise;
        events.push("pull-status:done");
      },
      loadBranchPullRequests: async () => {
        events.push("pull-requests:start");
        await pullRequestRefresh.promise;
        events.push("pull-requests:done");
      },
      syncFingerprint: async () => {
        events.push("fingerprint:start");
        await fingerprintRefresh.promise;
        events.push("fingerprint:done");
      },
    });

    expect(events).toEqual([
      "pull-requests:start",
      "fingerprint:start",
      "branches:start",
      "working-tree:start",
      "pull-status:start",
    ]);

    branchRefresh.resolve();
    workingTreeRefresh.resolve();
    pullStatusRefresh.resolve();
    await branchRefresh.promise;
    await workingTreeRefresh.promise;
    await pullStatusRefresh.promise;

    await expect(refreshPromise).resolves.toBeUndefined();
    expect(events).toEqual([
      "pull-requests:start",
      "fingerprint:start",
      "branches:start",
      "working-tree:start",
      "pull-status:start",
      "branches:done",
      "working-tree:done",
      "pull-status:done",
    ]);

    pullRequestRefresh.resolve();
    fingerprintRefresh.resolve();
    await pullRequestRefresh.promise;
    await fingerprintRefresh.promise;

    expect(events).toEqual([
      "pull-requests:start",
      "fingerprint:start",
      "branches:start",
      "working-tree:start",
      "pull-status:start",
      "branches:done",
      "working-tree:done",
      "pull-status:done",
      "pull-requests:done",
      "fingerprint:done",
    ]);
  });

  test("still resolves when PR and fingerprint sync fail", async () => {
    const events: string[] = [];

    await expect(
      refreshAfterCheckoutPreservingGraph({
        loadBranches: async () => {
          events.push("branches");
        },
        loadWorkingTreeStatus: async () => {
          events.push("working-tree");
        },
        loadPullStatus: async () => {
          events.push("pull-status");
        },
        loadBranchPullRequests: async () => {
          events.push("pull-requests");
          throw new Error("gh unavailable");
        },
        syncFingerprint: async () => {
          events.push("fingerprint");
          throw new Error("fingerprint unavailable");
        },
      }),
    ).resolves.toBeUndefined();

    expect(events).toEqual([
      "pull-requests",
      "fingerprint",
      "branches",
      "working-tree",
      "pull-status",
    ]);
  });
});
