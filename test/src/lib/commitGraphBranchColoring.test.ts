import { describe, expect, test } from "bun:test";

import { buildCommitBranchColoring } from "../../../src/lib/commitGraphBranchColoring";

describe("buildCommitBranchColoring", () => {
  test("paints a linear history with a single branch tag", () => {
    const coloring = buildCommitBranchColoring({
      commits: [
        { sha: "a", parentShas: ["b"] },
        { sha: "b", parentShas: ["c"] },
        { sha: "c", parentShas: [] },
      ],
      branchTips: [{ name: "main", sha: "a" }],
    });

    expect(coloring.get("a")).toBe("main");
    expect(coloring.get("b")).toBe("main");
    expect(coloring.get("c")).toBe("main");
  });

  test("higher-priority branch claims shared commits before lower-priority branch", () => {
    const coloring = buildCommitBranchColoring({
      commits: [
        { sha: "feat-tip", parentShas: ["shared"] },
        { sha: "main-tip", parentShas: ["shared"] },
        { sha: "shared", parentShas: [] },
      ],
      branchTips: [
        { name: "main", sha: "main-tip" },
        { name: "feat", sha: "feat-tip" },
      ],
    });

    expect(coloring.get("main-tip")).toBe("main");
    expect(coloring.get("shared")).toBe("main");
    expect(coloring.get("feat-tip")).toBe("feat");
  });

  test("keeps the same branch tag across multiple merges along first-parent chain", () => {
    // feature branch gets merged into mainline twice; mainline chain should
    // remain tagged as "main" through both merges.
    const coloring = buildCommitBranchColoring({
      commits: [
        { sha: "m2", parentShas: ["m1", "f2"] },
        { sha: "f2", parentShas: ["f1"] },
        { sha: "m1", parentShas: ["m0", "f1"] },
        { sha: "f1", parentShas: ["m0"] },
        { sha: "m0", parentShas: [] },
      ],
      branchTips: [
        { name: "main", sha: "m2" },
        { name: "feature", sha: "f2" },
      ],
    });

    expect(coloring.get("m2")).toBe("main");
    expect(coloring.get("m1")).toBe("main");
    expect(coloring.get("m0")).toBe("main");
    expect(coloring.get("f2")).toBe("feature");
    expect(coloring.get("f1")).toBe("feature");
  });

  test("ignores branches whose tip is outside the visible commit list", () => {
    const coloring = buildCommitBranchColoring({
      commits: [
        { sha: "a", parentShas: ["b"] },
        { sha: "b", parentShas: [] },
      ],
      branchTips: [
        { name: "main", sha: "a" },
        { name: "ghost", sha: "not-in-list" },
      ],
    });

    expect(coloring.get("a")).toBe("main");
    expect(coloring.get("b")).toBe("main");
    expect(coloring.has("not-in-list")).toBe(false);
  });

  test("returns empty map when no branch tips provided", () => {
    const coloring = buildCommitBranchColoring({
      commits: [{ sha: "a", parentShas: [] }],
      branchTips: [],
    });
    expect(coloring.size).toBe(0);
  });
});
