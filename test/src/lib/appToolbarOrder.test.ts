import { describe, expect, test } from "bun:test";

import {
  DEFAULT_APP_TOOLBAR_ITEM_ORDER,
  getVisibleAppToolbarItemOrder,
  normalizeAppToolbarItemOrder,
  swapAppToolbarItems,
} from "../../../src/lib/appToolbarOrder";

describe("appToolbarOrder", () => {
  test("uses assistant-first as the default toolbar order", () => {
    expect(DEFAULT_APP_TOOLBAR_ITEM_ORDER).toEqual([
      "assistant",
      "commandPalette",
      "layout",
      "theme",
      "github",
      "config",
    ]);
  });

  test("normalizes persisted order and restores missing toolbar items", () => {
    expect(
      normalizeAppToolbarItemOrder(["layout", "theme", "layout", "unknown", "assistant"]),
    ).toEqual(["layout", "theme", "assistant", "commandPalette", "github", "config"]);
  });

  test("filters visible toolbar items without losing the stored order", () => {
    expect(
      getVisibleAppToolbarItemOrder(
        ["layout", "theme", "assistant", "commandPalette", "github", "config"],
        new Set(["commandPalette", "assistant", "theme", "config"]),
      ),
    ).toEqual(["theme", "assistant", "commandPalette", "config"]);
  });

  test("swaps toolbar items in place and leaves unknown swaps untouched", () => {
    expect(swapAppToolbarItems(DEFAULT_APP_TOOLBAR_ITEM_ORDER, "layout", "assistant")).toEqual([
      "layout",
      "commandPalette",
      "assistant",
      "theme",
      "github",
      "config",
    ]);

    expect(swapAppToolbarItems(["theme", "config", "assistant"], "theme", "theme")).toEqual([
      "theme",
      "config",
      "assistant",
    ]);
  });
});
