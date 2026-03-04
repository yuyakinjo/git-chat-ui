export interface CommitForLane {
  sha: string;
  parentShas: string[];
}

export interface LaneRow {
  laneIndex: number;
  activeLaneIndices: number[];
  incomingLaneIndices: number[];
  outgoingLaneIndices: number[];
  primaryParentLaneIndex: number | null;
  mergeTargetLaneIndices: number[];
}

export interface LaneLayout {
  rows: LaneRow[];
  maxLanes: number;
}

function collectActiveLaneIndices(activeLanes: Array<string | null>): number[] {
  return activeLanes.reduce<number[]>((accumulator, sha, index) => {
    if (sha) {
      accumulator.push(index);
    }
    return accumulator;
  }, []);
}

export function buildLaneRows(commits: CommitForLane[]): LaneLayout {
  const activeLanes: Array<string | null> = [];
  const rows: LaneRow[] = [];
  let maxLanes = 1;

  for (const commit of commits) {
    const incomingLaneIndices = collectActiveLaneIndices(activeLanes);
    const commitSha = commit.sha.trim();
    const parentShas = commit.parentShas.map((sha) => sha.trim()).filter(Boolean);
    let laneIndex = activeLanes.findIndex((sha) => sha === commitSha);
    let primaryParentLaneIndex: number | null = null;

    if (laneIndex === -1) {
      laneIndex = activeLanes.findIndex((sha) => sha === null);
      if (laneIndex === -1) {
        activeLanes.push(commitSha);
        laneIndex = activeLanes.length - 1;
      } else {
        activeLanes[laneIndex] = commitSha;
      }
    }

    const before = collectActiveLaneIndices(activeLanes);
    const mergeTargetLaneIndices: number[] = [];

    if (parentShas.length === 0) {
      activeLanes[laneIndex] = null;
    } else {
      const primaryParent = parentShas[0];
      const existingPrimaryParentLaneIndex = activeLanes.findIndex(
        (sha, index) => index !== laneIndex && sha === primaryParent
      );
      if (existingPrimaryParentLaneIndex !== -1) {
        primaryParentLaneIndex = existingPrimaryParentLaneIndex;
      }

      activeLanes[laneIndex] = parentShas[0];

      for (let index = 1; index < parentShas.length; index += 1) {
        const targetLaneIndex = laneIndex + index;
        activeLanes.splice(targetLaneIndex, 0, parentShas[index]);
        mergeTargetLaneIndices.push(targetLaneIndex);
      }
    }

    while (activeLanes.length > 0 && activeLanes[activeLanes.length - 1] === null) {
      activeLanes.pop();
    }

    const after = collectActiveLaneIndices(activeLanes);

    const laneSet = new Set<number>([...before, ...after, laneIndex]);
    const activeLaneIndices = [...laneSet].sort((left, right) => left - right);

    const mergeMax = mergeTargetLaneIndices.length > 0 ? Math.max(...mergeTargetLaneIndices) + 1 : 0;
    maxLanes = Math.max(maxLanes, activeLanes.length, laneIndex + 1, mergeMax);

    rows.push({
      laneIndex,
      activeLaneIndices,
      incomingLaneIndices,
      outgoingLaneIndices: after,
      primaryParentLaneIndex,
      mergeTargetLaneIndices
    });
  }

  return {
    rows,
    maxLanes
  };
}
