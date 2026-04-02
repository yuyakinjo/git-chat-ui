import { describe, expect, test } from "bun:test";

import {
  filterCommandPaletteItems,
  isCommandPaletteShortcut,
} from "../../../src/lib/commandPalette";

describe("filterCommandPaletteItems", () => {
  const items = [
    {
      id: "copy-current-branch-name",
      title: "Copy Current Branch Name",
      description: "Current branch: main",
      keywords: ["copy", "branch", "clipboard", "現在", "ブランチ"],
    },
    {
      id: "open-github-page",
      title: "Open GitHub Page",
      description: "Open the repository page in GitHub.",
      keywords: ["github", "open", "repository", "開く"],
    },
  ];

  test("returns every item when the query is empty", () => {
    expect(filterCommandPaletteItems(items, "")).toEqual([...items]);
  });

  test("matches title, description, and keywords with case-insensitive partial search", () => {
    expect(filterCommandPaletteItems(items, "branch")).toEqual([items[0]]);
    expect(filterCommandPaletteItems(items, "gitHub")).toEqual([items[1]]);
    expect(filterCommandPaletteItems(items, "現在")).toEqual([items[0]]);
  });

  test("requires every query token to match somewhere in the searchable text", () => {
    expect(filterCommandPaletteItems(items, "open github")).toEqual([items[1]]);
    expect(filterCommandPaletteItems(items, "copy github")).toEqual([]);
  });
});

describe("isCommandPaletteShortcut", () => {
  test("matches Cmd/Ctrl + P without modifiers", () => {
    expect(
      isCommandPaletteShortcut({
        key: "p",
        metaKey: true,
      }),
    ).toBe(true);

    expect(
      isCommandPaletteShortcut({
        key: "P",
        ctrlKey: true,
      }),
    ).toBe(true);
  });

  test("rejects unrelated keys and extra modifiers", () => {
    expect(
      isCommandPaletteShortcut({
        key: "k",
        metaKey: true,
      }),
    ).toBe(false);

    expect(
      isCommandPaletteShortcut({
        key: "p",
        metaKey: true,
        shiftKey: true,
      }),
    ).toBe(false);
  });
});
