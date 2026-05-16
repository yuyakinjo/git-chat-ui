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
  /**
   * Default branch tip. Its first-parent ancestor chain is pinned to lane 0
   * across the entire graph. When provided but the tip's chain is not visible
   * in `commits`, lane 0 is still reserved (kept empty) so column width stays
   * stable while scrolling.
   */
  defaultBranchHeadSha?: string | null;
  /**
   * Name of the default branch. Used to stop the first-parent walk when it
   * crosses into a commit already claimed by a different branch (e.g. a
   * feature branch that was fast-forward merged into main). Without this,
   * commits on the derived branch would be absorbed into lane 0 and the
   * derived lane line would visually break.
   */
  defaultBranchName?: string | null;
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
  /**
   * True when a default branch was declared but this row is not on the
   * default chain. Renderers may use this to keep lane 0 visually reserved
   * even when no line passes through.
   */
  defaultLaneReservedButEmpty: boolean;
}

export interface LaneLayout {
  rows: LaneRow[];
  maxLanes: number;
}

const CLOSED_LANE_TOKEN = "__closed_lane__";
const RESERVED_LANE_PREFIX = "__reserved_lane__:";

function normalizeSha(sha: string | null | undefined): string {
  return sha?.trim() ?? "";
}

function isClosedLaneToken(value: string | null): boolean {
  return value === CLOSED_LANE_TOKEN;
}

function reservedLaneToken(tag: string): string {
  return `${RESERVED_LANE_PREFIX}${tag}`;
}

function isReservedLaneToken(value: string | null): value is string {
  return value !== null && value.startsWith(RESERVED_LANE_PREFIX);
}

function parseReservedTag(value: string): string {
  return value.slice(RESERVED_LANE_PREFIX.length);
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
  const defaultHeadSha = normalizeSha(options.defaultBranchHeadSha);
  const defaultBranchName = options.defaultBranchName?.trim() ?? "";
  const hasDefaultBranch = defaultHeadSha !== "";

  const rowIndexBySha = new Map(
    commits.map((commit, index) => [normalizeSha(commit.sha), index] satisfies [string, number]),
  );
  const branchTagBySha = new Map<string, string>();
  // ADR-0001: 各 branchTag が最後に出現する行を pre-pass で計算しておく。
  // 同じ tag の disjoint chain が default chain を挟んで現れる場合、上のチェーンの
  // lane を中間行で CLOSE せず予約継続するため (span 内なら reservedLaneToken を
  // activeLanes に残し、span 終了で null にリセット)。
  const branchTagLastRow = new Map<string, number>();
  for (const [index, commit] of commits.entries()) {
    const sha = normalizeSha(commit.sha);
    const tag = commit.branchTag?.trim();
    if (sha && tag) {
      branchTagBySha.set(sha, tag);
      branchTagLastRow.set(tag, index);
    }
  }

  // Pre-pass 1: collect the default branch's first-parent chain (the SHAs
  // that will be pinned to lane 0). If the tip itself is outside `commits`
  // the set stays empty, but lane 0 is still reserved via `hasDefaultBranch`.
  //
  // Commits already claimed by another branch tag (e.g. feature commits the
  // default branch fast-forwarded through) are skipped — the walk steps over
  // them and continues up the parent chain, so the derived lane keeps its
  // vertical line intact but the default lane still reaches its true base.
  const defaultChainShas = new Set<string>();
  if (hasDefaultBranch) {
    let cursor: string | null = defaultHeadSha;
    const guard = new Set<string>();
    while (cursor !== null) {
      const current: string = cursor;
      if (guard.has(current)) {
        break;
      }
      guard.add(current);
      const commitIndex: number | undefined = rowIndexBySha.get(current);
      if (commitIndex === undefined) {
        break;
      }
      const tag = branchTagBySha.get(current);
      const claimedByOtherBranch =
        !!tag && !!defaultBranchName && tag !== defaultBranchName;
      if (!claimedByOtherBranch) {
        defaultChainShas.add(current);
      }
      const chainCommit = commits[commitIndex];
      const nextSha: string = chainCommit.parentShas[0]
        ? normalizeSha(chainCommit.parentShas[0])
        : "";
      cursor = nextSha && rowIndexBySha.has(nextSha) ? nextSha : null;
    }
  }

  // Initialize activeLanes. Lane 0 is reserved for the default chain when
  // `hasDefaultBranch`; all other lanes grow on demand and are reclaimed as
  // soon as they fall out of use (left-pack policy — no pre-reservation).
  const activeLanes: Array<string | null> = [];
  if (hasDefaultBranch) {
    activeLanes.push(null);
  }
  const minLanes = activeLanes.length;

  const rows: LaneRow[] = [];
  let maxLanes = Math.max(minLanes, 1);

  /**
   * Finds an empty slot at or after `startIndex`. Lane 0 is never returned
   * when `hasDefaultBranch` is true (it's permanently reserved for the
   * default chain).
   */
  const pickFreeLane = (startIndex: number): number => {
    const from = Math.max(startIndex, hasDefaultBranch ? 1 : 0);
    for (let j = from; j < activeLanes.length; j++) {
      if (activeLanes[j] === null) {
        return j;
      }
    }
    return -1;
  };

  for (const [rowIndex, commit] of commits.entries()) {
    for (let i = 0; i < activeLanes.length; i++) {
      const slot = activeLanes[i];
      if (isClosedLaneToken(slot)) {
        activeLanes[i] = null;
      } else if (isReservedLaneToken(slot)) {
        // ADR-0001: reserved lane の span が終わっていれば解放する。
        // (branchTag の最終出現行を超えた時点で free 扱いに戻す)
        const reservedTag = parseReservedTag(slot);
        if ((branchTagLastRow.get(reservedTag) ?? -1) < rowIndex) {
          activeLanes[i] = null;
        }
      }
    }

    const incomingLaneIndices = collectActiveLaneIndices(activeLanes);
    const commitSha = normalizeSha(commit.sha);
    const commitTag = commit.branchTag?.trim() ?? "";
    const parentShas = commit.parentShas.map((sha) => normalizeSha(sha)).filter(Boolean);
    const isDefaultChainCommit = defaultChainShas.has(commitSha);

    let laneIndex = activeLanes.findIndex((sha) => sha === commitSha);
    let primaryParentLaneIndex: number | null = null;
    let primaryParentRowIndex: number | null = null;

    if (isDefaultChainCommit) {
      // Default chain commits always occupy lane 0. If lane 0 was parked
      // with a stale value (e.g. merge noise), clobber it; this is fine
      // because the default chain is walked from tip downward.
      laneIndex = 0;
      while (activeLanes.length < 1) {
        activeLanes.push(null);
      }
      activeLanes[0] = commitSha;
    } else if (laneIndex === -1) {
      // ADR-0001: 同じ branchTag のチェーンが disjoint で出現した場合、上のチェーンが
      // 残した reserved lane をここで再利用する (上下で同じ lane 番号を保つ)。
      const reservedLaneIndex =
        commitTag !== ""
          ? activeLanes.findIndex(
              (slot) => isReservedLaneToken(slot) && parseReservedTag(slot) === commitTag,
            )
          : -1;
      if (reservedLaneIndex !== -1) {
        laneIndex = reservedLaneIndex;
        activeLanes[reservedLaneIndex] = commitSha;
      } else {
        const freeLane = pickFreeLane(0);
        if (freeLane !== -1) {
          laneIndex = freeLane;
          activeLanes[freeLane] = commitSha;
        } else {
          activeLanes.push(commitSha);
          laneIndex = activeLanes.length - 1;
        }
      }
    }

    const convergingLaneIndices: number[] = [];
    for (let j = 0; j < activeLanes.length; j++) {
      if (j !== laneIndex && activeLanes[j] === commitSha) {
        convergingLaneIndices.push(j);
        activeLanes[j] = CLOSED_LANE_TOKEN;
      }
    }

    const mergeTargetLaneIndices: number[] = [];

    if (parentShas.length === 0) {
      activeLanes[laneIndex] = null;
    } else {
      const primaryParent = parentShas[0];
      const primaryParentIsOnDefaultChain = defaultChainShas.has(primaryParent);
      const existingPrimaryParentLaneIndex = activeLanes.findIndex(
        (sha, index) => index !== laneIndex && sha === primaryParent,
      );
      let primaryParentUnreachable = false;

      if (
        !isDefaultChainCommit &&
        primaryParentIsOnDefaultChain
      ) {
        // Derived commit whose primary parent lives on the default chain:
        // draw an elbow to lane 0 (default lane) rather than continuing the
        // derived lane downward.
        primaryParentLaneIndex = 0;
        const matchingPrimaryParentRowIndex = rowIndexBySha.get(primaryParent) ?? null;
        primaryParentRowIndex =
          matchingPrimaryParentRowIndex !== null && matchingPrimaryParentRowIndex > rowIndex
            ? matchingPrimaryParentRowIndex
            : null;
        activeLanes[laneIndex] = CLOSED_LANE_TOKEN;
      } else if (
        !isDefaultChainCommit &&
        existingPrimaryParentLaneIndex !== -1
      ) {
        primaryParentLaneIndex = existingPrimaryParentLaneIndex;
        const matchingPrimaryParentRowIndex = rowIndexBySha.get(primaryParent) ?? null;
        primaryParentRowIndex =
          matchingPrimaryParentRowIndex !== null && matchingPrimaryParentRowIndex > rowIndex
            ? matchingPrimaryParentRowIndex
            : null;
        activeLanes[laneIndex] = CLOSED_LANE_TOKEN;
      } else if (!isDefaultChainCommit && !rowIndexBySha.has(primaryParent)) {
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
        const mergeParentIsOnDefaultChain = defaultChainShas.has(mergeParentSha);
        const existingMergeParentLaneIndex = activeLanes.findIndex(
          (sha, j) => j !== laneIndex && sha === mergeParentSha,
        );
        if (existingMergeParentLaneIndex !== -1) {
          mergeTargetLaneIndices.push(existingMergeParentLaneIndex);
          continue;
        }
        if (mergeParentIsOnDefaultChain) {
          // Merging a default-chain commit back into a derived branch: the
          // target lane is lane 0 but we do not seed it (the default chain
          // walker owns it). Recording the target draws the merge curve.
          mergeTargetLaneIndices.push(0);
          continue;
        }
        if (primaryParentUnreachable && activeLanes[laneIndex] === null) {
          activeLanes[laneIndex] = mergeParentSha;
          primaryParentUnreachable = false;
          continue;
        }
        let targetLaneIndex = pickFreeLane(laneIndex + 1);
        if (targetLaneIndex === -1) {
          activeLanes.push(mergeParentSha);
          targetLaneIndex = activeLanes.length - 1;
        } else {
          activeLanes[targetLaneIndex] = mergeParentSha;
        }
        mergeTargetLaneIndices.push(targetLaneIndex);
      }

      if (primaryParentUnreachable && activeLanes[laneIndex] === null) {
        activeLanes[laneIndex] = CLOSED_LANE_TOKEN;
      }
    }

    // ADR-0001: この commit が branchTag を持ち、まだ後続行に同 tag のコミットが
    // 残っているなら、本来 lane を閉じる/解放する代わりに reserved token に置換し、
    // 中央の default chain 行を貫通する縦線を維持する。
    if (
      commitTag !== "" &&
      laneIndex >= 0 &&
      (branchTagLastRow.get(commitTag) ?? -1) > rowIndex
    ) {
      const currentSlot = activeLanes[laneIndex];
      if (currentSlot === null || isClosedLaneToken(currentSlot)) {
        activeLanes[laneIndex] = reservedLaneToken(commitTag);
      }
    }

    while (
      activeLanes.length > minLanes &&
      (activeLanes[activeLanes.length - 1] === null ||
        isClosedLaneToken(activeLanes[activeLanes.length - 1]))
    ) {
      activeLanes.pop();
    }

    const before = incomingLaneIndices;
    const after = collectActiveLaneIndices(activeLanes);

    const laneSet = new Set<number>([...before, ...after, laneIndex]);
    const activeLaneIndices = [...laneSet].sort((left, right) => left - right);

    const mergeMax =
      mergeTargetLaneIndices.length > 0 ? Math.max(...mergeTargetLaneIndices) + 1 : 0;
    maxLanes = Math.max(maxLanes, activeLanes.length, laneIndex + 1, mergeMax);

    const defaultLaneReservedButEmpty =
      hasDefaultBranch && !isDefaultChainCommit && laneIndex !== 0;

    rows.push({
      laneIndex,
      activeLaneIndices,
      incomingLaneIndices,
      outgoingLaneIndices: after,
      primaryParentLaneIndex,
      primaryParentRowIndex,
      mergeTargetLaneIndices,
      convergingLaneIndices,
      defaultLaneReservedButEmpty,
    });
  }

  return {
    rows,
    maxLanes,
  };
}
