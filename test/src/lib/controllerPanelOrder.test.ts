import { describe, expect, test } from "bun:test";

import {
  canSwapControllerPanel,
  getVisibleControllerPanelOrder,
  normalizeControllerPanelVisibility,
  normalizeControllerPanelOrder,
  swapControllerPanels,
  toggleControllerPanelVisibility,
} from "../../../src/lib/controllerPanelOrder";

describe("controllerPanelOrder", () => {
  test("normalizes invalid, duplicate, and missing panel ids", () => {
    expect(normalizeControllerPanelOrder(["gitOperations", "invalid", "gitOperations"])).toEqual([
      "gitOperations",
      "commitGraph",
      "commitDetail",
    ]);
  });

  test("rejects swaps while busy or when source/target are missing", () => {
    expect(
      canSwapControllerPanel({
        busy: true,
        sourceId: "commitGraph",
        targetId: "gitOperations",
      }),
    ).toBe(false);

    expect(
      canSwapControllerPanel({
        busy: false,
        sourceId: "commitGraph",
        targetId: null,
      }),
    ).toBe(false);
  });

  test("rejects swapping the same panel id", () => {
    expect(
      canSwapControllerPanel({
        busy: false,
        sourceId: "commitGraph",
        targetId: "commitGraph",
      }),
    ).toBe(false);
  });

  test("swaps source and target positions in the current order", () => {
    expect(
      swapControllerPanels(
        ["commitGraph", "gitOperations", "commitDetail"],
        "commitGraph",
        "commitDetail",
      ),
    ).toEqual(["commitDetail", "gitOperations", "commitGraph"]);
  });

  test("normalizes partial persisted visibility state", () => {
    expect(
      normalizeControllerPanelVisibility({
        gitOperations: false,
        invalid: true,
      }),
    ).toEqual({
      commitGraph: true,
      gitOperations: false,
      commitDetail: true,
    });
  });

  test("filters panel order using the current visibility state", () => {
    expect(
      getVisibleControllerPanelOrder(["commitGraph", "gitOperations", "commitDetail"], {
        commitGraph: false,
        gitOperations: true,
        commitDetail: false,
      }),
    ).toEqual(["gitOperations"]);
  });

  test("toggles one panel without changing the others", () => {
    expect(
      toggleControllerPanelVisibility(
        {
          commitGraph: true,
          gitOperations: false,
          commitDetail: true,
        },
        "gitOperations",
      ),
    ).toEqual({
      commitGraph: true,
      gitOperations: true,
      commitDetail: true,
    });
  });
});
