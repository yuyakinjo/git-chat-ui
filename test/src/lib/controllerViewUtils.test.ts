import { describe, expect, test } from "bun:test";

import type { BranchResponse } from "../../../src/types";

import { resolveDefaultBranch } from "../../../src/lib/controllerViewUtils";

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
