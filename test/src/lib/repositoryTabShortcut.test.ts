import { describe, expect, test } from "bun:test";

import {
  getRepositoryTabShortcutIndex,
  getRepositoryTabShortcutLabel,
} from "../../../src/lib/repositoryTabShortcut";

describe("getRepositoryTabShortcutIndex", () => {
  test("matches Cmd/Ctrl + 1..3 without extra modifiers", () => {
    expect(
      getRepositoryTabShortcutIndex({
        key: "1",
        metaKey: true,
      }),
    ).toBe(0);

    expect(
      getRepositoryTabShortcutIndex({
        key: "2",
        ctrlKey: true,
      }),
    ).toBe(1);

    expect(
      getRepositoryTabShortcutIndex({
        key: "3",
        metaKey: true,
      }),
    ).toBe(2);
  });

  test("rejects unrelated keys and extra modifiers", () => {
    expect(
      getRepositoryTabShortcutIndex({
        key: "4",
        metaKey: true,
      }),
    ).toBeNull();

    expect(
      getRepositoryTabShortcutIndex({
        key: "1",
        metaKey: true,
        shiftKey: true,
      }),
    ).toBeNull();

    expect(
      getRepositoryTabShortcutIndex({
        key: "2",
        ctrlKey: true,
        altKey: true,
      }),
    ).toBeNull();
  });
});

describe("getRepositoryTabShortcutLabel", () => {
  test("returns labels only for the first three repository tabs", () => {
    expect(getRepositoryTabShortcutLabel(0)).toBe("Cmd/Ctrl + 1");
    expect(getRepositoryTabShortcutLabel(2)).toBe("Cmd/Ctrl + 3");
    expect(getRepositoryTabShortcutLabel(3)).toBeNull();
    expect(getRepositoryTabShortcutLabel(-1)).toBeNull();
  });
});
