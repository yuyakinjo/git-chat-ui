export interface BranchColoringCommit {
  sha: string;
  parentShas: string[];
}

export interface BranchTip {
  name: string;
  sha: string;
}

export interface BranchColoringInput {
  commits: BranchColoringCommit[];
  /**
   * Branch tips ordered by priority (most important first).
   * The first branch in the list claims its commits first; later branches
   * only paint commits that have not been claimed yet.
   */
  branchTips: BranchTip[];
  /**
   * Name of the default branch (e.g. "main"). Tip walks for branches matching
   * this name stay first-parent only so the default chain does not absorb
   * the histories merged into it. Non-default tips recurse through merge
   * second-parents within their reachable history — this keeps feature
   * branches with internal sub-feature merges on a single branchTag and
   * avoids the "same branch, visually split across the default chain"
   * problem (see docs/adr/0001).
   */
  defaultBranchName?: string | null;
}

export const ANON_TAG_PREFIX = "__anon__";
export const ORPHAN_TAG_PREFIX = "__orphan__";

function normalizeSha(sha: string | null | undefined): string {
  return sha?.trim() ?? "";
}

/**
 * Walks branch tips first, then fills in fallback chains so `buildLaneRows`
 * can reserve a lane for every commit:
 *
 *  1. Branch tip walk: non-default tips recurse through merge second-parents
 *     within their reachable history (same tag), so feature branches with
 *     internal merges stay on one lane. Default branch tip stays first-parent
 *     only — recursing it would absorb every merged-in feature history.
 *  2. Merge-source anonymous history: any uncolored commit reachable from a
 *     merge commit's second+ parent gets `__anon__<mergeShortSha>` so it lands
 *     on a single derived lane.
 *  3. Orphan history: leftover uncolored commits get `__orphan__<shortSha>`.
 */
export function buildCommitBranchColoring(input: BranchColoringInput): Map<string, string> {
  const coloring = new Map<string, string>();
  if (input.commits.length === 0) {
    return coloring;
  }

  const commitIndexBySha = new Map<string, number>();
  input.commits.forEach((commit, index) => {
    const sha = normalizeSha(commit.sha);
    if (sha && !commitIndexBySha.has(sha)) {
      commitIndexBySha.set(sha, index);
    }
  });

  /**
   * Walk first-parent chain starting at `startSha`, painting commits with
   * `tag`. When `recurseSecondParents` is true, queue every merge commit's
   * second+ parents as additional first-parent walks under the same tag —
   * this is how non-default branch tips claim their entire reachable history
   * (sub-feature merges, internal back-merges) as one tag.
   *
   * Walks stop at: already-colored commits, missing commits, or first-parent
   * dead ends. So an existing higher-priority tag (e.g. default chain) acts
   * as a natural fence — the recursion will not invade it.
   */
  const walkBranchHistory = (
    startSha: string,
    tag: string,
    recurseSecondParents: boolean,
  ): void => {
    const pending: string[] = [startSha];
    const visited = new Set<string>();
    while (pending.length > 0) {
      let cursorSha: string | null = pending.pop() ?? null;
      while (cursorSha !== null) {
        if (visited.has(cursorSha)) {
          break;
        }
        visited.add(cursorSha);
        const index = commitIndexBySha.get(cursorSha);
        if (index === undefined) {
          break;
        }
        if (coloring.has(cursorSha)) {
          break;
        }
        coloring.set(cursorSha, tag);
        const chainCommit = input.commits[index];
        if (recurseSecondParents) {
          for (let i = 1; i < chainCommit.parentShas.length; i += 1) {
            const secondParentSha = normalizeSha(chainCommit.parentShas[i]);
            if (
              secondParentSha &&
              commitIndexBySha.has(secondParentSha) &&
              !visited.has(secondParentSha) &&
              !coloring.has(secondParentSha)
            ) {
              pending.push(secondParentSha);
            }
          }
        }
        const nextSha = chainCommit.parentShas[0] ? normalizeSha(chainCommit.parentShas[0]) : "";
        cursorSha = nextSha && commitIndexBySha.has(nextSha) ? nextSha : null;
      }
    }
  };

  const defaultBranchName = input.defaultBranchName?.trim() ?? "";
  const hasDefaultBranch = defaultBranchName !== "";

  for (const branch of input.branchTips) {
    const branchName = branch.name.trim();
    const tipSha = normalizeSha(branch.sha);
    if (!branchName || !tipSha) {
      continue;
    }
    // Recurse through merge second-parents only when a default branch is
    // declared AND this tip is NOT it. Without a declared default, every
    // tip stays first-parent only (preserves the legacy `__anon__` fallback
    // for merge sources). With a declared default, non-default tips paint
    // their entire reachable history with one tag.
    const shouldRecurse = hasDefaultBranch && branchName !== defaultBranchName;
    walkBranchHistory(tipSha, branchName, shouldRecurse);
  }

  for (const commit of input.commits) {
    const parentShas = commit.parentShas;
    if (parentShas.length <= 1) {
      continue;
    }
    const mergeCommitSha = normalizeSha(commit.sha);
    if (!mergeCommitSha) {
      continue;
    }
    const anonTag = `${ANON_TAG_PREFIX}${mergeCommitSha.slice(0, 8)}`;
    for (let i = 1; i < parentShas.length; i++) {
      const mergeParentSha = normalizeSha(parentShas[i]);
      if (!mergeParentSha || !commitIndexBySha.has(mergeParentSha)) {
        continue;
      }
      if (coloring.has(mergeParentSha)) {
        continue;
      }
      walkBranchHistory(mergeParentSha, anonTag, false);
    }
  }

  for (const commit of input.commits) {
    const sha = normalizeSha(commit.sha);
    if (!sha || coloring.has(sha)) {
      continue;
    }
    walkBranchHistory(sha, `${ORPHAN_TAG_PREFIX}${sha.slice(0, 8)}`, false);
  }

  return coloring;
}
