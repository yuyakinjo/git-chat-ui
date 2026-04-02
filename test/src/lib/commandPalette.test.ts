import { describe, expect, test } from "bun:test";

import {
  filterCommandPaletteItems,
  getDefaultActiveCommandPaletteItemId,
  getNextActiveCommandPaletteItemId,
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

describe("getDefaultActiveCommandPaletteItemId", () => {
  const items = [
    {
      id: "copy-current-branch-name",
      title: "Copy Current Branch Name",
    },
    {
      id: "open-github-page",
      title: "Open GitHub Page",
    },
  ];

  test("does not preselect a command for an empty query", () => {
    expect(getDefaultActiveCommandPaletteItemId(items, "")).toBeNull();
    expect(getDefaultActiveCommandPaletteItemId(items, "   ")).toBeNull();
  });

  test("selects the first filtered command after the user starts typing", () => {
    expect(getDefaultActiveCommandPaletteItemId([items[1]], "git")).toBe("open-github-page");
  });
});

describe("getNextActiveCommandPaletteItemId", () => {
  const items = [
    {
      id: "copy-current-branch-name",
      title: "Copy Current Branch Name",
    },
    {
      id: "create-branch",
      title: "Create Branch",
    },
    {
      id: "open-github-page",
      title: "Open GitHub Page",
    },
  ];

  test("starts from the first or last command when nothing is active yet", () => {
    expect(getNextActiveCommandPaletteItemId(items, null, 1)).toBe("copy-current-branch-name");
    expect(getNextActiveCommandPaletteItemId(items, null, -1)).toBe("open-github-page");
  });

  test("wraps through the filtered commands", () => {
    expect(getNextActiveCommandPaletteItemId(items, "copy-current-branch-name", -1)).toBe(
      "open-github-page",
    );
    expect(getNextActiveCommandPaletteItemId(items, "open-github-page", 1)).toBe(
      "copy-current-branch-name",
    );
  });
});
