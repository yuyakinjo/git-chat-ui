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
}

export const ANON_TAG_PREFIX = "__anon__";
export const ORPHAN_TAG_PREFIX = "__orphan__";

function normalizeSha(sha: string | null | undefined): string {
  return sha?.trim() ?? "";
}

/**
 * Walks branch tips on first-parent chains first (as before), then fills in
 * two more passes so `buildLaneRows` can reserve a lane for every commit:
 *
 *  1. Merge-source anonymous history: every merge commit's second+ parents
 *     are walked via first-parent; uncolored commits along the way share a
 *     synthetic `__anon__<mergeShortSha>` tag so the whole merged-in history
 *     sits on a single lane.
 *  2. Orphan history: any remaining uncolored commit starts its own
 *     `__orphan__<shortSha>` chain, propagated via first-parent.
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

  const walkFirstParentChain = (startSha: string, tag: string): void => {
    let cursorSha: string | null = startSha;
    const guard = new Set<string>();
    while (cursorSha !== null) {
      if (guard.has(cursorSha)) {
        break;
      }
      guard.add(cursorSha);
      const index = commitIndexBySha.get(cursorSha);
      if (index === undefined) {
        break;
      }
      if (coloring.has(cursorSha)) {
        break;
      }
      coloring.set(cursorSha, tag);
      const chainCommit = input.commits[index];
      const nextSha = chainCommit.parentShas[0] ? normalizeSha(chainCommit.parentShas[0]) : "";
      cursorSha = nextSha && commitIndexBySha.has(nextSha) ? nextSha : null;
    }
  };

  for (const branch of input.branchTips) {
    const branchName = branch.name.trim();
    const tipSha = normalizeSha(branch.sha);
    if (!branchName || !tipSha) {
      continue;
    }
    walkFirstParentChain(tipSha, branchName);
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
      walkFirstParentChain(mergeParentSha, anonTag);
    }
  }

  for (const commit of input.commits) {
    const sha = normalizeSha(commit.sha);
    if (!sha || coloring.has(sha)) {
      continue;
    }
    walkFirstParentChain(sha, `${ORPHAN_TAG_PREFIX}${sha.slice(0, 8)}`);
  }

  return coloring;
}
