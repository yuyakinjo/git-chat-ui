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

  test("reserves the checked out lane when its head first appears below sibling branches", () => {
    const layout = buildLaneRows(
      [
        { sha: "main-tip", parentShas: ["base"] },
        { sha: "feature-tip", parentShas: ["base"] },
        { sha: "base", parentShas: [] },
      ],
      { reservedHeadSha: "feature-tip" },
    );

    expect(layout.maxLanes).toBe(2);
    expect(layout.rows.map((row) => row.laneIndex)).toEqual([1, 0, 0]);
    expect(layout.rows[1].primaryParentLaneIndex).toBeNull();
    expect(layout.rows[2].incomingLaneIndices).toEqual([0, 1]);
  });

  test("tracks the parent row for a branch that splits from the reserved checked out lane", () => {
    const layout = buildLaneRows(
      [
        { sha: "feature-tip", parentShas: ["feature-seed"] },
        { sha: "feature-seed", parentShas: ["main-base"] },
        { sha: "main-base", parentShas: [] },
      ],
      { reservedHeadSha: "main-base" },
    );

    expect(layout.rows.map((row) => row.laneIndex)).toEqual([1, 1, 0]);
    expect(layout.rows[1].primaryParentLaneIndex).toBe(0);
    expect(layout.rows[1].primaryParentRowIndex).toBe(2);
  });

  test("reuses closed lanes for later sibling branches after earlier branches split back to main", () => {
    const layout = buildLaneRows(
      [
        { sha: "branch-a-2", parentShas: ["branch-a-1"] },
        { sha: "branch-a-1", parentShas: ["main-base"] },
        { sha: "branch-b-2", parentShas: ["branch-b-1"] },
        { sha: "branch-b-1", parentShas: ["main-base"] },
        { sha: "main-base", parentShas: [] },
      ],
      { reservedHeadSha: "main-base" },
    );

    expect(layout.maxLanes).toBe(2);
    expect(layout.rows.map((row) => row.laneIndex)).toEqual([1, 1, 1, 1, 0]);
    expect(layout.rows[1].outgoingLaneIndices).toEqual([0]);
    expect(layout.rows[3].outgoingLaneIndices).toEqual([0]);
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

  test("provides empty convergingLaneIndices when branches merge via primaryParentLaneIndex", () => {
    const layout = buildLaneRows(
      [
        { sha: "main-tip", parentShas: ["base"] },
        { sha: "feature-tip", parentShas: ["base"] },
        { sha: "base", parentShas: [] },
      ],
      { reservedHeadSha: "base" },
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
    // m2 and m1 are merge commits on "main"; f2, f1 belong to "feature" and
    // were each merged into main. Without branchTag hints, the two merges
    // would park f2 and f1 on different lanes. With tags, both feature
    // commits land on the same reserved lane.
    const layout = buildLaneRows([
      { sha: "m2", parentShas: ["m1", "f2"], branchTag: "main" },
      { sha: "f2", parentShas: ["f1"], branchTag: "feature" },
      { sha: "m1", parentShas: ["m0", "f1"], branchTag: "main" },
      { sha: "f1", parentShas: ["m0"], branchTag: "feature" },
      { sha: "m0", parentShas: [], branchTag: "main" },
    ]);

    const laneByIndex = layout.rows.map((row) => row.laneIndex);
    // main commits stay on lane 0
    expect(laneByIndex[0]).toBe(0); // m2
    expect(laneByIndex[2]).toBe(0); // m1
    expect(laneByIndex[4]).toBe(0); // m0
    // feature commits share the same lane (reserved by tag)
    expect(laneByIndex[1]).toBe(laneByIndex[3]);
    expect(laneByIndex[1]).not.toBe(0);
    expect(layout.maxLanes).toBe(2);
  });

  test("falls back to default lane allocation when branchTag is absent", () => {
    // Regression: the new reservation logic must not affect commits that
    // have no branchTag — they should behave like the legacy algorithm.
    const layout = buildLaneRows([
      { sha: "merge", parentShas: ["left", "right"] },
      { sha: "left", parentShas: ["base"] },
      { sha: "right", parentShas: ["base"] },
      { sha: "base", parentShas: [] },
    ]);

    expect(layout.rows[0].mergeTargetLaneIndices).toEqual([1]);
    expect(layout.maxLanes).toBeGreaterThanOrEqual(2);
  });
});
