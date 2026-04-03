import { describe, expect, test } from "bun:test";

import type { BranchResponse } from "../../../src/types";

import {
  buildControllerPanelToggleCommandSpecs,
  resolveDefaultBranch,
} from "../../../src/lib/controllerViewUtils";

describe("resolveDefaultBranch", () => {
  test("prefers the local branch that matches remote default metadata", () => {
    const branches: BranchResponse = {
      current: "feature/refactor",
      local: [
        {
          name: "feature/refactor",
          fullRef: "refs/heads/feature/refactor",
          type: "local",
          commit: "feature-tip",
        },
        {
          name: "develop",
          fullRef: "refs/heads/develop",
          type: "local",
          commit: "develop-tip",
        },
      ],
      remote: [
        {
          name: "origin/develop",
          fullRef: "refs/remotes/origin/develop",
          type: "remote",
          commit: "develop-tip",
          isRemoteDefault: true,
        },
      ],
    };

    expect(resolveDefaultBranch(branches)?.name).toBe("develop");
  });

  test("falls back to the current local branch when no default metadata exists", () => {
    const branches: BranchResponse = {
      current: "feature/refactor",
      local: [
        {
          name: "feature/refactor",
          fullRef: "refs/heads/feature/refactor",
          type: "local",
          commit: "feature-tip",
        },
      ],
      remote: [],
    };

    expect(resolveDefaultBranch(branches)?.name).toBe("feature/refactor");
  });
});

describe("buildControllerPanelToggleCommandSpecs", () => {
  test("builds toggle commands with visibility-aware descriptions", () => {
    const specs = buildControllerPanelToggleCommandSpecs({
      commitGraph: true,
      gitOperations: false,
      commitDetail: true,
    });

    expect(specs.map((spec) => spec.title)).toEqual([
      "Toggle Commit Graph",
      "Toggle Git Operations",
      "Toggle Commit Detail",
    ]);
    expect(specs[0]?.description).toBe("Currently visible. Hide the Commit Graph panel.");
    expect(specs[1]?.description).toBe("Currently hidden. Show the Git Operations panel.");
    expect(specs[2]?.keywords).toContain("layout");
    expect(specs[2]?.keywords).toContain("commit detail");
  });
});
