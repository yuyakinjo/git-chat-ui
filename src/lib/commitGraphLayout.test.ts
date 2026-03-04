import { describe, expect, test } from 'bun:test';

import { buildLaneRows } from './commitGraphLayout';

describe('buildLaneRows', () => {
  test('keeps single lane for linear history', () => {
    const layout = buildLaneRows([
      { sha: 'a', parentShas: ['b'] },
      { sha: 'b', parentShas: ['c'] },
      { sha: 'c', parentShas: [] }
    ]);

    expect(layout.maxLanes).toBe(1);
    expect(layout.rows.map((row) => row.laneIndex)).toEqual([0, 0, 0]);
  });

  test('keeps parent linkage when commit SHA includes line-break noise', () => {
    const layout = buildLaneRows([
      { sha: 'a', parentShas: ['b'] },
      { sha: '\nb', parentShas: ['c'] },
      { sha: '\nc', parentShas: [] }
    ]);

    expect(layout.maxLanes).toBe(1);
    expect(layout.rows.map((row) => row.laneIndex)).toEqual([0, 0, 0]);
  });

  test('allocates extra lane for merge parent', () => {
    const layout = buildLaneRows([
      { sha: 'merge', parentShas: ['left', 'right'] },
      { sha: 'left', parentShas: ['base'] },
      { sha: 'right', parentShas: ['base'] },
      { sha: 'base', parentShas: [] }
    ]);

    expect(layout.maxLanes).toBeGreaterThanOrEqual(2);
    expect(layout.rows[0].mergeTargetLaneIndices).toEqual([1]);
  });

  test('tracks branch-off lane for first parent when parent already exists in another lane', () => {
    const layout = buildLaneRows([
      { sha: 'feature-tip', parentShas: ['base'] },
      { sha: 'main-tip', parentShas: ['base'] },
      { sha: 'base', parentShas: [] }
    ]);

    expect(layout.maxLanes).toBeGreaterThanOrEqual(2);
    expect(layout.rows[1].laneIndex).not.toBe(layout.rows[1].primaryParentLaneIndex);
    expect(layout.rows[1].primaryParentLaneIndex).toBe(0);
  });
});
