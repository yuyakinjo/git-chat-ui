import { describe, expect, test } from "bun:test";

import { withPromiseTimeout } from "../../../src/lib/promiseTimeout";

describe("withPromiseTimeout", () => {
  test("resolves when the promise settles before the timeout", async () => {
    await expect(withPromiseTimeout(Promise.resolve("ok"), 50, "timed out")).resolves.toBe("ok");
  });

  test("rejects with the provided message after the timeout", async () => {
    await expect(
      withPromiseTimeout(new Promise<string>(() => {}), 10, "timed out"),
    ).rejects.toThrow("timed out");
  });
});
