export interface CommitForLane {
  sha: string;
  parentShas: string[];
  /**
   * Optional named-branch tag. Commits sharing the same tag are pinned to the
   * same lane so repeatedly-merged branches stay visually coherent.
   */
  branchTag?: string | null;
}

export interface LaneLayoutOptions {
  reservedHeadSha?: string | null;
}

export interface LaneRow {
  laneIndex: number;
  activeLaneIndices: number[];
  incomingLaneIndices: number[];
  outgoingLaneIndices: number[];
  primaryParentLaneIndex: number | null;
  primaryParentRowIndex: number | null;
  mergeTargetLaneIndices: number[];
  convergingLaneIndices: number[];
}

export interface LaneLayout {
  rows: LaneRow[];
  maxLanes: number;
}

const CLOSED_LANE_TOKEN = "__closed_lane__";

function normalizeSha(sha: string | null | undefined): string {
  return sha?.trim() ?? "";
}

function isClosedLaneToken(value: string | null): boolean {
  return value === CLOSED_LANE_TOKEN;
}

function collectActiveLaneIndices(activeLanes: Array<string | null>): number[] {
  return activeLanes.reduce<number[]>((accumulator, sha, index) => {
    if (sha && !isClosedLaneToken(sha)) {
      accumulator.push(index);
    }
    return accumulator;
  }, []);
}

export function buildLaneRows(
  commits: CommitForLane[],
  options: LaneLayoutOptions = {},
): LaneLayout {
  const reservedHeadSha = normalizeSha(options.reservedHeadSha);
  const rowIndexBySha = new Map(
    commits.map((commit, index) => [normalizeSha(commit.sha), index] satisfies [string, number]),
  );
  const branchTagBySha = new Map<string, string>();
  for (const commit of commits) {
    const sha = normalizeSha(commit.sha);
    const tag = commit.branchTag?.trim();
    if (sha && tag) {
      branchTagBySha.set(sha, tag);
    }
  }
  const reservedLanesByBranchTag = new Map<string, number>();
  const reservedHeadRowIndex = reservedHeadSha
    ? commits.findIndex((commit) => normalizeSha(commit.sha) === reservedHeadSha)
    : -1;
  const activeLanes: Array<string | null> =
    reservedHeadRowIndex > 0 && reservedHeadSha ? [reservedHeadSha] : [];
  const rows: LaneRow[] = [];
  let maxLanes = 1;

  /**
   * Returns the lane reserved for `tag` if that lane is currently free
   * (null or closed), otherwise -1. Callers may then place the target SHA
   * on that lane to keep the branch on a consistent column.
   */
  const pickFreeReservedLane = (tag: string | null): number => {
    if (!tag) {
      return -1;
    }
    const reserved = reservedLanesByBranchTag.get(tag);
    if (reserved === undefined) {
      return -1;
    }
    if (reserved >= activeLanes.length) {
      return -1;
    }
    const occupant = activeLanes[reserved];
    if (occupant === null || isClosedLaneToken(occupant)) {
      return reserved;
    }
    return -1;
  };

  for (const [rowIndex, commit] of commits.entries()) {
    for (let i = 0; i < activeLanes.length; i++) {
      if (isClosedLaneToken(activeLanes[i])) {
        activeLanes[i] = null;
      }
    }

    const incomingLaneIndices = collectActiveLaneIndices(activeLanes);
    const commitSha = normalizeSha(commit.sha);
    const commitBranchTag = branchTagBySha.get(commitSha) ?? null;
    const parentShas = commit.parentShas.map((sha) => normalizeSha(sha)).filter(Boolean);
    let laneIndex = activeLanes.findIndex((sha) => sha === commitSha);
    let primaryParentLaneIndex: number | null = null;
    let primaryParentRowIndex: number | null = null;

    if (laneIndex === -1) {
      const reservedLane = pickFreeReservedLane(commitBranchTag);
      if (reservedLane !== -1) {
        laneIndex = reservedLane;
        activeLanes[reservedLane] = commitSha;
      } else {
        laneIndex = activeLanes.findIndex((sha) => sha === null);
        if (laneIndex === -1) {
          activeLanes.push(commitSha);
          laneIndex = activeLanes.length - 1;
        } else {
          activeLanes[laneIndex] = commitSha;
        }
      }
    }

    if (commitBranchTag && !reservedLanesByBranchTag.has(commitBranchTag)) {
      reservedLanesByBranchTag.set(commitBranchTag, laneIndex);
    }

    const before = collectActiveLaneIndices(activeLanes);
    const mergeTargetLaneIndices: number[] = [];
    const isReservedLaneCommit =
      reservedHeadRowIndex > 0 && laneIndex === 0 && activeLanes[0] === commitSha;

    const convergingLaneIndices: number[] = [];
    for (let j = 0; j < activeLanes.length; j++) {
      if (j !== laneIndex && activeLanes[j] === commitSha) {
        convergingLaneIndices.push(j);
        activeLanes[j] = CLOSED_LANE_TOKEN;
      }
    }

    if (parentShas.length === 0) {
      activeLanes[laneIndex] = null;
    } else {
      const primaryParent = parentShas[0];
      const existingPrimaryParentLaneIndex = activeLanes.findIndex(
        (sha, index) => index !== laneIndex && sha === primaryParent,
      );
      let primaryParentUnreachable = false;
      if (!isReservedLaneCommit && existingPrimaryParentLaneIndex !== -1) {
        primaryParentLaneIndex = existingPrimaryParentLaneIndex;
        const matchingPrimaryParentRowIndex = rowIndexBySha.get(primaryParent) ?? null;
        primaryParentRowIndex =
          matchingPrimaryParentRowIndex !== null && matchingPrimaryParentRowIndex > rowIndex
            ? matchingPrimaryParentRowIndex
            : null;
        activeLanes[laneIndex] = CLOSED_LANE_TOKEN;
      } else if (!isReservedLaneCommit && !rowIndexBySha.has(primaryParent)) {
        activeLanes[laneIndex] = null;
        primaryParentUnreachable = true;
      } else {
        activeLanes[laneIndex] = primaryParent;
      }

      for (let index = 1; index < parentShas.length; index += 1) {
        const mergeParentSha = parentShas[index];
        if (!rowIndexBySha.has(mergeParentSha)) {
          continue;
        }
        const mergeParentBranchTag = branchTagBySha.get(mergeParentSha) ?? null;
        const existingMergeParentLaneIndex = activeLanes.findIndex(
          (sha, j) => j !== laneIndex && sha === mergeParentSha,
        );
        if (existingMergeParentLaneIndex !== -1) {
          mergeTargetLaneIndices.push(existingMergeParentLaneIndex);
          continue;
        }
        if (primaryParentUnreachable && activeLanes[laneIndex] === null) {
          activeLanes[laneIndex] = mergeParentSha;
          primaryParentUnreachable = false;
          continue;
        }
        let targetLaneIndex = pickFreeReservedLane(mergeParentBranchTag);
        if (targetLaneIndex === -1) {
          for (let j = laneIndex + 1; j < activeLanes.length; j++) {
            if (activeLanes[j] === null) {
              targetLaneIndex = j;
              break;
            }
          }
        }
        if (targetLaneIndex === -1) {
          activeLanes.push(mergeParentSha);
          targetLaneIndex = activeLanes.length - 1;
        } else {
          activeLanes[targetLaneIndex] = mergeParentSha;
        }
        if (mergeParentBranchTag && !reservedLanesByBranchTag.has(mergeParentBranchTag)) {
          reservedLanesByBranchTag.set(mergeParentBranchTag, targetLaneIndex);
        }
        mergeTargetLaneIndices.push(targetLaneIndex);
      }

      if (primaryParentUnreachable && activeLanes[laneIndex] === null) {
        activeLanes[laneIndex] = CLOSED_LANE_TOKEN;
      }
    }

    while (
      activeLanes.length > 0 &&
      (activeLanes[activeLanes.length - 1] === null ||
        isClosedLaneToken(activeLanes[activeLanes.length - 1]))
    ) {
      activeLanes.pop();
    }

    const after = collectActiveLaneIndices(activeLanes);

    const laneSet = new Set<number>([...before, ...after, laneIndex]);
    const activeLaneIndices = [...laneSet].sort((left, right) => left - right);

    const mergeMax =
      mergeTargetLaneIndices.length > 0 ? Math.max(...mergeTargetLaneIndices) + 1 : 0;
    maxLanes = Math.max(maxLanes, activeLanes.length, laneIndex + 1, mergeMax);

    rows.push({
      laneIndex,
      activeLaneIndices,
      incomingLaneIndices,
      outgoingLaneIndices: after,
      primaryParentLaneIndex,
      primaryParentRowIndex,
      mergeTargetLaneIndices,
      convergingLaneIndices,
    });
  }

  return {
    rows,
    maxLanes,
  };
}
