import { describe, expect, test } from "bun:test";

import { isConfigShortcut } from "../../../src/lib/configShortcut";

describe("isConfigShortcut", () => {
  test("matches Cmd/Ctrl + comma without extra modifiers", () => {
    expect(
      isConfigShortcut({
        key: ",",
        metaKey: true,
      }),
    ).toBe(true);

    expect(
      isConfigShortcut({
        key: ",",
        ctrlKey: true,
      }),
    ).toBe(true);
  });

  test("rejects unrelated keys and extra modifiers", () => {
    expect(
      isConfigShortcut({
        key: "p",
        metaKey: true,
      }),
    ).toBe(false);

    expect(
      isConfigShortcut({
        key: ",",
        metaKey: true,
        shiftKey: true,
      }),
    ).toBe(false);

    expect(
      isConfigShortcut({
        key: ",",
        ctrlKey: true,
        altKey: true,
      }),
    ).toBe(false);
  });
});
