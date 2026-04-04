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
  test("returns after the controller snapshot without waiting for branch pull requests", async () => {
    const events: string[] = [];
    const pullRequestRefresh = createDeferredPromise<void>();

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
          return true;
        },
      },
      { ref: "feature/checkout-speed" },
    );

    expect(result).toBe(true);
    expect(events).toEqual(["pull-requests:start", "snapshot:feature/checkout-speed:with-commits"]);

    pullRequestRefresh.resolve();
    await pullRequestRefresh.promise;
    expect(events).toEqual([
      "pull-requests:start",
      "snapshot:feature/checkout-speed:with-commits",
      "pull-requests:done",
    ]);
  });

  test("continues even if branch pull request refresh fails", async () => {
    await expect(
      refreshAfterCheckout(
        {
          loadBranchPullRequests: async () => {
            throw new Error("gh unavailable");
          },
          loadControllerSnapshot: async (options) => {
            expect(options).toEqual({
              ref: "HEAD",
              includeCommits: true,
            });
            return true;
          },
        },
        { ref: "HEAD" },
      ),
    ).resolves.toBe(true);
  });
});
