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

/**
 * Reverse parent→child relationship used when a child's committer date is
 * older than its parent's (rebase/amend). In display order (date desc) the
 * parent appears above the child, which inverts the usual "child draws curve
 * down to parent" rendering. The parent row keeps a list of such children so
 * it can draw a downward curve to each child instead.
 */
export interface InverseChild {
  childRowIndex: number;
  childLaneIndex: number;
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
   * Children whose primary parent is THIS row but who appear BELOW this row in
   * the (date-desc) sort order. Renderers draw an inverse parent→child curve
   * for each entry, extending the parent's SVG downward.
   */
  inverseChildren: InverseChild[];
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
  // ADR-0001 の lane 予約は「同じ branchTag のコミットが reserved lane を後で回収する」
  // 前提だが、後続の同タグコミットが既に別 lane の merge parent として placed されて
  // いるケースでは回収が起きず、reserved lane が span 終端まで「誰にも使われない
  // 縦線 (phantom)」として残る。各行末で reserved 状態の lane を記録しておき、
  // post-pass で claim されなかった span を行ごとの active/incoming/outgoing から除去する。
  const reservedLaneIndicesByRow: Array<Set<number>> = [];

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
        // primary parent が rebase/amend で committer date 逆転している場合、
        // ソート順では親 (rowIndex 小) が子 (rowIndex 大) より前に処理される。
        // 旧コードは `> rowIndex` ガードで親が下方向にいるケースのみ
        // primaryParentRowIndex を採用していたが、それだと render 側で
        // targetY が確定できず、curve が「線分の途中」に着地して破損する。
        // 親の rowIndex を常に採用し、render 側で「親が上」ケースを正しく
        // 水平線として描画する。
        primaryParentRowIndex = rowIndexBySha.get(primaryParent) ?? null;
        activeLanes[laneIndex] = CLOSED_LANE_TOKEN;
      } else if (
        !isDefaultChainCommit &&
        existingPrimaryParentLaneIndex !== -1
      ) {
        primaryParentLaneIndex = existingPrimaryParentLaneIndex;
        primaryParentRowIndex = rowIndexBySha.get(primaryParent) ?? null;
        activeLanes[laneIndex] = CLOSED_LANE_TOKEN;
      } else if (!isDefaultChainCommit && !rowIndexBySha.has(primaryParent)) {
        activeLanes[laneIndex] = null;
        primaryParentUnreachable = true;
      } else if (
        !isDefaultChainCommit &&
        (rowIndexBySha.get(primaryParent) ?? rowIndex) < rowIndex
      ) {
        // rebase/amend で committer date が逆転し、primary parent が sort 順で
        // 自分より前 (= 表示上「上」) にあるケース。親は既に処理済みのため
        // activeLanes には残っておらず、existingPrimaryParentLaneIndex でも
        // 拾えないが、rowIndexBySha からは引ける。親 lane を記録しつつ自分の
        // lane を閉じることで、render 側で親側 SVG から子に向けて inverse
        // parent→child curve を描画させる。
        const matchingPrimaryParentRowIndex = rowIndexBySha.get(primaryParent) as number;
        primaryParentLaneIndex =
          rows[matchingPrimaryParentRowIndex]?.laneIndex ?? null;
        primaryParentRowIndex = matchingPrimaryParentRowIndex;
        activeLanes[laneIndex] = CLOSED_LANE_TOKEN;
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
    //
    // ただし、同じ tag が複数の disjoint chain として並走するケース (例: feature
    // branch の tip から second-parent 再帰で塗られた複数 chain) では、既に他 lane
    // で同 tag の予約が継続中の場合がある。その状態でこちらも追加で予約すると
    // tag の最終行までずっと複数 lane が活性扱いとなり、本来途切れるべき lane で
    // 縦線が継続描画されてしまう。同 tag の予約は 1 lane に集約する。
    if (
      commitTag !== "" &&
      laneIndex >= 0 &&
      (branchTagLastRow.get(commitTag) ?? -1) > rowIndex
    ) {
      const currentSlot = activeLanes[laneIndex];
      if (currentSlot === null || isClosedLaneToken(currentSlot)) {
        const hasOtherReservation = activeLanes.some(
          (slot, slotIdx) =>
            slotIdx !== laneIndex &&
            isReservedLaneToken(slot) &&
            parseReservedTag(slot) === commitTag,
        );
        if (!hasOtherReservation) {
          activeLanes[laneIndex] = reservedLaneToken(commitTag);
        }
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
      inverseChildren: [],
      defaultLaneReservedButEmpty,
    });
    const reservedNow = new Set<number>();
    for (let slotIdx = 0; slotIdx < activeLanes.length; slotIdx += 1) {
      if (isReservedLaneToken(activeLanes[slotIdx])) {
        reservedNow.add(slotIdx);
      }
    }
    reservedLaneIndicesByRow.push(reservedNow);
  }

  // Post-pass: 誰にも claim されなかった reserved lane span を行から除去する。
  // span = ある lane が reserved 状態で連続している行範囲。span 開始行は
  // reservation を作った行 (= その行は commit が同 lane を使っているので line は
  // 真実)。span 内 (開始行を除く) で `rows[r].laneIndex === lane` となる行が
  // 1 つでもあれば「claim された」とみなして除去しない。1 つも無ければ phantom
  // 扱いで span 内 (開始行を除く) の active/incoming/outgoing から lane を消す。
  // 開始行については outgoingLaneIndices のみトリム — incoming は前 row から
  // 引き継いだ実線で、laneIndex は commit ノード自身が使う本物の lane だから残す。
  const phantomLaneByRow = new Map<number, Set<number>>();
  const seenLanes = new Set<number>();
  for (const reservedSet of reservedLaneIndicesByRow) {
    for (const laneIdx of reservedSet) {
      seenLanes.add(laneIdx);
    }
  }
  for (const laneIdx of seenLanes) {
    let spanStart: number | null = null;
    for (let rowIdx = 0; rowIdx <= rows.length; rowIdx += 1) {
      const isReservedAtRow =
        rowIdx < rows.length && reservedLaneIndicesByRow[rowIdx]?.has(laneIdx);
      if (isReservedAtRow && spanStart === null) {
        spanStart = rowIdx;
      } else if (!isReservedAtRow && spanStart !== null) {
        const spanEnd = rowIdx - 1;
        let claimed = false;
        // 中間 claim: span 内 (開始行を除く) に lane を laneIndex とするコミットがある。
        for (let r = spanStart + 1; r <= spanEnd; r += 1) {
          if (rows[r].laneIndex === laneIdx) {
            claimed = true;
            break;
          }
        }
        // 境界 claim: span 終了の理由が「次行のコミットが予約を回収した」ケース。
        // この場合は ADR-0001 の本来の意図どおり中央行で縦線を引きたいので残す。
        if (
          !claimed &&
          rowIdx < rows.length &&
          rows[rowIdx].laneIndex === laneIdx
        ) {
          claimed = true;
        }
        if (!claimed) {
          // span 開始行: outgoing からだけ除去 (下方向の線をカットする)。
          // ただし開始行で primary parent elbow 由来で既に hasOutgoingRaw が
          // false 化される場合は無害。
          const startSet = phantomLaneByRow.get(spanStart) ?? new Set<number>();
          startSet.add(laneIdx);
          phantomLaneByRow.set(spanStart, startSet);
          for (let r = spanStart + 1; r <= spanEnd; r += 1) {
            const set = phantomLaneByRow.get(r) ?? new Set<number>();
            set.add(laneIdx);
            phantomLaneByRow.set(r, set);
          }
        }
        spanStart = null;
      }
    }
  }
  if (phantomLaneByRow.size > 0) {
    for (const [rowIdx, phantoms] of phantomLaneByRow) {
      const row = rows[rowIdx];
      // lane ごとに「span 開始行か continuation 行か」を判定する。
      // - continuation (前行も同じ phantom lane): active/incoming/outgoing 全部から除去。
      // - span 開始行 (前行は持っていない): commit ノード自身の incoming/laneIndex は
      //   本物なので残し、outgoing だけ除去して下方向の線をカットする。
      const continuationLanes = new Set<number>();
      for (const laneIdx of phantoms) {
        if (rowIdx > 0 && phantomLaneByRow.get(rowIdx - 1)?.has(laneIdx)) {
          continuationLanes.add(laneIdx);
        }
      }
      rows[rowIdx] = {
        ...row,
        activeLaneIndices:
          continuationLanes.size > 0
            ? row.activeLaneIndices.filter((l) => !continuationLanes.has(l))
            : row.activeLaneIndices,
        incomingLaneIndices:
          continuationLanes.size > 0
            ? row.incomingLaneIndices.filter((l) => !continuationLanes.has(l))
            : row.incomingLaneIndices,
        outgoingLaneIndices: row.outgoingLaneIndices.filter((l) => !phantoms.has(l)),
      };
    }
  }

  // Post-pass: collect inverse children. For each row whose primaryParentRowIndex
  // points to an EARLIER row (parent above), record this row as an inverse child
  // of that parent. Parent then draws a downward curve to its inverse children.
  const inverseChildrenByParentIdx = new Map<number, InverseChild[]>();
  for (let childIdx = 0; childIdx < rows.length; childIdx += 1) {
    const childRow = rows[childIdx];
    const parentIdx = childRow.primaryParentRowIndex;
    if (parentIdx === null || parentIdx >= childIdx) {
      continue;
    }
    // Skip cases where parent and child share the same lane — the existing
    // primary lane vertical line already connects them visually.
    if (childRow.primaryParentLaneIndex === childRow.laneIndex) {
      continue;
    }
    const list = inverseChildrenByParentIdx.get(parentIdx) ?? [];
    list.push({ childRowIndex: childIdx, childLaneIndex: childRow.laneIndex });
    inverseChildrenByParentIdx.set(parentIdx, list);
  }
  for (const [parentIdx, list] of inverseChildrenByParentIdx) {
    rows[parentIdx] = { ...rows[parentIdx], inverseChildren: list };
  }

  return {
    rows,
    maxLanes,
  };
}
