import { describe, expect, test } from "bun:test";

import { buildLaneRows } from "../../../src/lib/commitGraphLayout";

describe("buildLaneRows", () => {
  test("keeps single lane for linear history", () => {
    const layout = buildLaneRows([
      { sha: "a", parentShas: ["b"] },
      { sha: "b", parentShas: ["c"] },
      { sha: "c", parentShas: [] },
    ]);

    expect(layout.maxLanes).toBe(1);
    expect(layout.rows.map((row) => row.laneIndex)).toEqual([0, 0, 0]);
  });

  test("keeps parent linkage when commit SHA includes line-break noise", () => {
    const layout = buildLaneRows([
      { sha: "a", parentShas: ["b"] },
      { sha: "\nb", parentShas: ["c"] },
      { sha: "\nc", parentShas: [] },
    ]);

    expect(layout.maxLanes).toBe(1);
    expect(layout.rows.map((row) => row.laneIndex)).toEqual([0, 0, 0]);
  });

  test("allocates extra lane for merge parent", () => {
    const layout = buildLaneRows([
      { sha: "merge", parentShas: ["left", "right"] },
      { sha: "left", parentShas: ["base"] },
      { sha: "right", parentShas: ["base"] },
      { sha: "base", parentShas: [] },
    ]);

    expect(layout.maxLanes).toBeGreaterThanOrEqual(2);
    expect(layout.rows[0].mergeTargetLaneIndices).toEqual([1]);
  });

  test("tracks branch-off lane for first parent when parent already exists in another lane", () => {
    const layout = buildLaneRows([
      { sha: "feature-tip", parentShas: ["base"] },
      { sha: "main-tip", parentShas: ["base"] },
      { sha: "base", parentShas: [] },
    ]);

    expect(layout.maxLanes).toBeGreaterThanOrEqual(2);
    expect(layout.rows[1].laneIndex).not.toBe(layout.rows[1].primaryParentLaneIndex);
    expect(layout.rows[1].primaryParentLaneIndex).toBe(0);
  });

  test("pins the default branch's first-parent chain to lane 0 across the graph", () => {
    const layout = buildLaneRows(
      [
        { sha: "feature-tip", parentShas: ["base"] },
        { sha: "main-tip", parentShas: ["base"] },
        { sha: "base", parentShas: [] },
      ],
      { defaultBranchHeadSha: "main-tip" },
    );

    // feature-tip is a derived branch (lane 1); main-tip/base own lane 0.
    expect(layout.maxLanes).toBe(2);
    expect(layout.rows.map((row) => row.laneIndex)).toEqual([1, 0, 0]);
    // feature-tip elbows down to the default lane at its primary parent.
    expect(layout.rows[0].primaryParentLaneIndex).toBe(0);
    // main-tip stays on its own lane without an elbow.
    expect(layout.rows[1].primaryParentLaneIndex).toBeNull();
  });

  test("tracks the parent row for a branch that splits from the default lane", () => {
    const layout = buildLaneRows(
      [
        { sha: "feature-tip", parentShas: ["feature-seed"] },
        { sha: "feature-seed", parentShas: ["main-base"] },
        { sha: "main-base", parentShas: [] },
      ],
      { defaultBranchHeadSha: "main-base" },
    );

    expect(layout.rows.map((row) => row.laneIndex)).toEqual([1, 1, 0]);
    expect(layout.rows[1].primaryParentLaneIndex).toBe(0);
    expect(layout.rows[1].primaryParentRowIndex).toBe(2);
  });

  test("pins sibling branches to lane 1 and reuses it across branches that both merge back to the default lane", () => {
    const layout = buildLaneRows(
      [
        { sha: "branch-a-2", parentShas: ["branch-a-1"] },
        { sha: "branch-a-1", parentShas: ["main-base"] },
        { sha: "branch-b-2", parentShas: ["branch-b-1"] },
        { sha: "branch-b-1", parentShas: ["main-base"] },
        { sha: "main-base", parentShas: [] },
      ],
      { defaultBranchHeadSha: "main-base" },
    );

    expect(layout.maxLanes).toBe(2);
    expect(layout.rows.map((row) => row.laneIndex)).toEqual([1, 1, 1, 1, 0]);
    // Both `-1` rows elbow down to the default lane.
    expect(layout.rows[1].primaryParentLaneIndex).toBe(0);
    expect(layout.rows[3].primaryParentLaneIndex).toBe(0);
  });

  test("does not create phantom lanes for primary parents outside the visible commit list", () => {
    const layout = buildLaneRows([
      { sha: "dev-tip", parentShas: ["merge-commit"] },
      { sha: "merge-commit", parentShas: ["prev-main", "dev-base"] },
      { sha: "dev-base", parentShas: ["root"] },
      { sha: "root", parentShas: [] },
    ]);

    expect(layout.rows[1].laneIndex).toBe(0);
    const devBaseRow = layout.rows[2];
    expect(devBaseRow.laneIndex).toBe(0);
    expect(layout.maxLanes).toBeLessThanOrEqual(2);
  });

  test("reuses existing activeLanes entry for merge targets already tracked in another lane", () => {
    const layout = buildLaneRows([
      { sha: "dev-tip", parentShas: ["dev-base"] },
      { sha: "merge-commit", parentShas: ["outside-parent", "dev-base"] },
      { sha: "dev-base", parentShas: ["root"] },
      { sha: "root", parentShas: [] },
    ]);

    expect(layout.rows[2].laneIndex).toBe(0);
    expect(layout.rows[1].mergeTargetLaneIndices).toEqual([0]);
    expect(layout.maxLanes).toBeLessThanOrEqual(2);
  });

  test("keeps feature branch to the right of develop when a merge commit has an unreachable first parent", () => {
    const layout = buildLaneRows([
      { sha: "dev-3", parentShas: ["dev-2"] },
      { sha: "dev-2", parentShas: ["release"] },
      { sha: "release", parentShas: ["unreachable-main", "dev-1"] },
      { sha: "dev-1", parentShas: ["fork-point"] },
      { sha: "feat-3", parentShas: ["feat-2"] },
      { sha: "feat-2", parentShas: ["feat-1"] },
      { sha: "feat-1", parentShas: ["fork-point"] },
      { sha: "fork-point", parentShas: [] },
    ]);

    const devLane = layout.rows[3].laneIndex;
    const featLane = layout.rows[4].laneIndex;
    const forkRow = layout.rows[7];
    expect(devLane).toBe(0);
    expect(featLane).toBeGreaterThan(devLane);
    expect(forkRow.laneIndex).toBe(devLane);
  });

  test("routes sibling branches' primary parents to lane 0 when the default head appears last", () => {
    const layout = buildLaneRows(
      [
        { sha: "main-tip", parentShas: ["base"] },
        { sha: "feature-tip", parentShas: ["base"] },
        { sha: "base", parentShas: [] },
      ],
      { defaultBranchHeadSha: "base" },
    );

    expect(layout.rows[2].convergingLaneIndices).toEqual([]);
    expect(layout.rows[0].primaryParentLaneIndex).toBe(0);
    expect(layout.rows[1].primaryParentLaneIndex).toBe(0);
    expect(layout.rows[2].laneIndex).toBe(0);
  });

  test("skips merge targets whose SHA is not in the visible commit list", () => {
    const layout = buildLaneRows([
      { sha: "merge", parentShas: ["left", "outside-right"] },
      { sha: "left", parentShas: [] },
    ]);

    expect(layout.rows[0].mergeTargetLaneIndices).toEqual([]);
    expect(layout.maxLanes).toBe(1);
  });

  test("pins commits sharing the same branchTag to one lane across repeated merges", () => {
    const layout = buildLaneRows([
      { sha: "m2", parentShas: ["m1", "f2"], branchTag: "main" },
      { sha: "f2", parentShas: ["f1"], branchTag: "feature" },
      { sha: "m1", parentShas: ["m0", "f1"], branchTag: "main" },
      { sha: "f1", parentShas: ["m0"], branchTag: "feature" },
      { sha: "m0", parentShas: [], branchTag: "main" },
    ]);

    const laneByIndex = layout.rows.map((row) => row.laneIndex);
    expect(laneByIndex[0]).toBe(0);
    expect(laneByIndex[2]).toBe(0);
    expect(laneByIndex[4]).toBe(0);
    expect(laneByIndex[1]).toBe(laneByIndex[3]);
    expect(laneByIndex[1]).not.toBe(0);
    expect(layout.maxLanes).toBe(2);
  });

  test("falls back to default lane allocation when branchTag is absent", () => {
    const layout = buildLaneRows([
      { sha: "merge", parentShas: ["left", "right"] },
      { sha: "left", parentShas: ["base"] },
      { sha: "right", parentShas: ["base"] },
      { sha: "base", parentShas: [] },
    ]);

    expect(layout.rows[0].mergeTargetLaneIndices).toEqual([1]);
    expect(layout.maxLanes).toBeGreaterThanOrEqual(2);
  });

  test("reserves lane 0 even when the default branch head is outside the visible commit list", () => {
    const layout = buildLaneRows(
      [
        { sha: "feature-3", parentShas: ["feature-2"] },
        { sha: "feature-2", parentShas: ["feature-1"] },
        { sha: "feature-1", parentShas: [] },
      ],
      { defaultBranchHeadSha: "main-off-screen" },
    );

    // Every visible commit is on a derived branch, so lane 0 is kept empty.
    expect(layout.rows.every((row) => row.laneIndex >= 1)).toBe(true);
    // Every row flags lane 0 as reserved-but-empty.
    expect(layout.rows.every((row) => row.defaultLaneReservedButEmpty)).toBe(true);
    expect(layout.maxLanes).toBeGreaterThanOrEqual(2);
  });

  test("uses reservedBranchOrder to stabilise derived lane order", () => {
    // featureB appears first in the commit list, but `featureA` is reserved
    // earlier — featureA should claim lane 1 once it appears, and featureB
    // stays on its own (later) lane.
    const layout = buildLaneRows(
      [
        { sha: "b-2", parentShas: ["b-1"], branchTag: "featureB" },
        { sha: "a-2", parentShas: ["a-1"], branchTag: "featureA" },
        { sha: "b-1", parentShas: ["root"], branchTag: "featureB" },
        { sha: "a-1", parentShas: ["root"], branchTag: "featureA" },
        { sha: "root", parentShas: [], branchTag: "main" },
      ],
      {
        defaultBranchHeadSha: "root",
        reservedBranchOrder: ["featureA", "featureB"],
      },
    );

    const laneByIndex = layout.rows.map((row) => row.laneIndex);
    // row 4 is the default branch.
    expect(laneByIndex[4]).toBe(0);
    // featureA commits (rows 1, 3) share lane 1 (reserved ahead of featureB).
    expect(laneByIndex[1]).toBe(1);
    expect(laneByIndex[3]).toBe(1);
    // featureB commits (rows 0, 2) share lane 2.
    expect(laneByIndex[0]).toBe(2);
    expect(laneByIndex[2]).toBe(2);
  });

  test("does not absorb derived-branch commits into lane 0 when the default chain passes through them", () => {
    // Scenario: `main` was fast-forward merged to `feature-tip`, so
    // `main`'s first-parent chain technically passes through every feature
    // commit. Without a guard, those commits would be pinned to lane 0 and
    // the derived (feature) lane line would break mid-graph. With the guard,
    // the walk stops at the first commit already claimed by `feature`.
    const layout = buildLaneRows(
      [
        { sha: "feature-2", parentShas: ["feature-1"], branchTag: "feature" },
        { sha: "feature-1", parentShas: ["main-base"], branchTag: "feature" },
        { sha: "main-base", parentShas: [], branchTag: "main" },
      ],
      {
        defaultBranchHeadSha: "feature-2",
        defaultBranchName: "main",
        reservedBranchOrder: ["feature"],
      },
    );

    // feature commits must stay on lane 1 (their branch tag's reserved lane),
    // not be swallowed by lane 0.
    expect(layout.rows[0].laneIndex).toBe(1);
    expect(layout.rows[1].laneIndex).toBe(1);
    expect(layout.rows[2].laneIndex).toBe(0);
  });

  test("flags default-chain rows as NOT reservedButEmpty", () => {
    const layout = buildLaneRows(
      [
        { sha: "feature-tip", parentShas: ["base"] },
        { sha: "main-tip", parentShas: ["base"] },
        { sha: "base", parentShas: [] },
      ],
      { defaultBranchHeadSha: "main-tip" },
    );

    expect(layout.rows[0].defaultLaneReservedButEmpty).toBe(true); // feature-tip
    expect(layout.rows[1].defaultLaneReservedButEmpty).toBe(false); // main-tip on lane 0
    expect(layout.rows[2].defaultLaneReservedButEmpty).toBe(false); // base on lane 0
  });
});
