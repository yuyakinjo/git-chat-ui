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

  test("keeps later sibling branches on distinct lanes after earlier branches split back to main", () => {
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

    expect(layout.maxLanes).toBe(3);
    expect(layout.rows.map((row) => row.laneIndex)).toEqual([1, 1, 2, 2, 0]);
    expect(layout.rows[1].outgoingLaneIndices).toEqual([0]);
    expect(layout.rows[3].outgoingLaneIndices).toEqual([0]);
  });
});
