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

function normalizeSha(sha: string | null | undefined): string {
  return sha?.trim() ?? "";
}

/**
 * Walk each branch tip's first-parent chain and tag every commit it passes
 * through with that branch's name (unless another, higher-priority branch
 * already claimed the commit). The result is a SHA → branch-name map that
 * `buildLaneRows` can use to keep same-named branches on one lane.
 */
export function buildCommitBranchColoring(input: BranchColoringInput): Map<string, string> {
  const coloring = new Map<string, string>();
  if (input.commits.length === 0 || input.branchTips.length === 0) {
    return coloring;
  }

  const commitIndexBySha = new Map<string, number>();
  input.commits.forEach((commit, index) => {
    const sha = normalizeSha(commit.sha);
    if (sha && !commitIndexBySha.has(sha)) {
      commitIndexBySha.set(sha, index);
    }
  });

  for (const branch of input.branchTips) {
    const branchName = branch.name.trim();
    const tipSha = normalizeSha(branch.sha);
    if (!branchName || !tipSha) {
      continue;
    }

    let cursorSha: string | null = tipSha;
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
      coloring.set(cursorSha, branchName);

      const commit = input.commits[index];
      const nextSha = commit.parentShas[0] ? normalizeSha(commit.parentShas[0]) : "";
      cursorSha = nextSha && commitIndexBySha.has(nextSha) ? nextSha : null;
    }
  }

  return coloring;
}
