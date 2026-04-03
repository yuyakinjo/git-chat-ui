import { afterEach, describe, expect, test } from "bun:test";

import {
  addOpenCommandPaletteRequestListener,
  filterCommandPaletteItems,
  getDefaultActiveCommandPaletteItemId,
  getNextActiveCommandPaletteItemId,
  isCommandPaletteShortcut,
  parseRecentCommandPaletteItemIds,
  requestOpenCommandPalette,
  sortCommandPaletteItemsByRecency,
  updateRecentCommandPaletteItemIds,
} from "../../../src/lib/commandPalette";

const originalWindow = globalThis.window;

afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
    return;
  }

  Object.defineProperty(globalThis, "window", {
    value: originalWindow,
    configurable: true,
    writable: true,
  });
});

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

describe("command palette open requests", () => {
  test("dispatches window events to registered listeners", () => {
    const eventTarget = new EventTarget();

    Object.defineProperty(globalThis, "window", {
      value: {
        addEventListener: eventTarget.addEventListener.bind(eventTarget),
        removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
        dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
      },
      configurable: true,
      writable: true,
    });

    let count = 0;
    const dispose = addOpenCommandPaletteRequestListener(() => {
      count += 1;
    });

    requestOpenCommandPalette();
    expect(count).toBe(1);

    dispose();
    requestOpenCommandPalette();
    expect(count).toBe(1);
  });
});

describe("parseRecentCommandPaletteItemIds", () => {
  test("returns an empty list for invalid storage values", () => {
    expect(parseRecentCommandPaletteItemIds(null)).toEqual([]);
    expect(parseRecentCommandPaletteItemIds("not json")).toEqual([]);
    expect(parseRecentCommandPaletteItemIds('{"id":"open-config"}')).toEqual([]);
  });

  test("normalizes blank values and duplicate ids", () => {
    expect(
      parseRecentCommandPaletteItemIds(
        JSON.stringify(["open-config", "  ", "pull-current-branch", "open-config"]),
      ),
    ).toEqual(["open-config", "pull-current-branch"]);
  });
});

describe("updateRecentCommandPaletteItemIds", () => {
  test("moves the latest command to the front without duplicates", () => {
    expect(
      updateRecentCommandPaletteItemIds(
        ["pull-current-branch", "open-config", "push-current-branch"],
        "open-config",
      ),
    ).toEqual(["open-config", "pull-current-branch", "push-current-branch"]);
  });

  test("ignores blank command ids", () => {
    expect(updateRecentCommandPaletteItemIds(["open-config"], "   ")).toEqual(["open-config"]);
  });
});

describe("sortCommandPaletteItemsByRecency", () => {
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
      id: "open-config",
      title: "Open Config",
    },
    {
      id: "select-theme:default-light",
      title: "Theme: Default Light",
    },
  ];

  test("places recent commands first and keeps the remaining items in definition order", () => {
    expect(sortCommandPaletteItemsByRecency(items, ["open-config", "create-branch"])).toEqual([
      items[2],
      items[1],
      items[0],
      items[3],
    ]);
  });

  test("ignores unknown recent ids", () => {
    expect(sortCommandPaletteItemsByRecency(items, ["missing-command"])).toEqual([...items]);
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
