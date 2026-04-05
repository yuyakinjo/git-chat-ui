import { describe, expect, test } from "bun:test";

import { refreshAfterCheckout } from "../../../src/lib/checkoutRefresh";

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
