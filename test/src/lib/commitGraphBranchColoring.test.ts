import { describe, expect, test } from "bun:test";

import {
  ANON_TAG_PREFIX,
  buildCommitBranchColoring,
  ORPHAN_TAG_PREFIX,
} from "../../../src/lib/commitGraphBranchColoring";

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

  test("tags every uncolored commit with an orphan synthetic tag when no branch tips are provided", () => {
    const coloring = buildCommitBranchColoring({
      commits: [
        { sha: "a", parentShas: ["b"] },
        { sha: "b", parentShas: [] },
      ],
      branchTips: [],
    });

    // Both commits receive an orphan chain tag; since 'a' is walked first,
    // 'a' and 'b' share the same __orphan__a tag via first-parent walk.
    const tagA = coloring.get("a");
    const tagB = coloring.get("b");
    expect(tagA?.startsWith(ORPHAN_TAG_PREFIX)).toBe(true);
    expect(tagB).toBe(tagA);
  });

  test("propagates merge-source anonymous tag down the removed feature branch", () => {
    // `feat-1` / `feat-2` were merged into main via `m-merge`. The feature
    // ref has been deleted, so no branch tip reaches those commits — they
    // should inherit a synthetic __anon__<mergeSha> tag so the lane layout
    // can treat them as a single derived branch.
    const coloring = buildCommitBranchColoring({
      commits: [
        { sha: "m-tip", parentShas: ["m-merge"] },
        { sha: "m-merge", parentShas: ["m-base", "feat-2"] },
        { sha: "feat-2", parentShas: ["feat-1"] },
        { sha: "feat-1", parentShas: ["m-base"] },
        { sha: "m-base", parentShas: [] },
      ],
      branchTips: [{ name: "main", sha: "m-tip" }],
    });

    expect(coloring.get("m-tip")).toBe("main");
    expect(coloring.get("m-merge")).toBe("main");
    expect(coloring.get("m-base")).toBe("main");
    const anonTag = coloring.get("feat-2");
    expect(anonTag?.startsWith(ANON_TAG_PREFIX)).toBe(true);
    // The whole feature first-parent chain shares the same synthetic tag.
    expect(coloring.get("feat-1")).toBe(anonTag);
  });

  test("does not override a claimed branch tag when traversing merge parents", () => {
    // `feat-1` is already reached by the `feature` branch tip before the
    // merge walk runs, so the anonymous walk should leave it alone.
    const coloring = buildCommitBranchColoring({
      commits: [
        { sha: "m-merge", parentShas: ["m-base", "feat-2"] },
        { sha: "feat-2", parentShas: ["feat-1"] },
        { sha: "feat-1", parentShas: ["m-base"] },
        { sha: "m-base", parentShas: [] },
      ],
      branchTips: [
        { name: "main", sha: "m-merge" },
        { name: "feature", sha: "feat-2" },
      ],
    });

    expect(coloring.get("feat-2")).toBe("feature");
    expect(coloring.get("feat-1")).toBe("feature");
    expect(coloring.get("m-merge")).toBe("main");
    expect(coloring.get("m-base")).toBe("main");
  });

  test("returns empty map when commits array is empty", () => {
    const coloring = buildCommitBranchColoring({
      commits: [],
      branchTips: [{ name: "main", sha: "a" }],
    });
    expect(coloring.size).toBe(0);
  });
});
