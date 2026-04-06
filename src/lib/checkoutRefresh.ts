export interface CheckoutRefreshDependencies {
  loadBranchPullRequests: () => Promise<void>;
  loadControllerSnapshot: (options: { ref?: string; includeCommits?: boolean }) => Promise<boolean>;
}

export interface GraphPreservingCheckoutRefreshDependencies {
  loadBranches: () => Promise<unknown>;
  loadWorkingTreeStatus: () => Promise<void>;
  loadPullStatus: () => Promise<void>;
  loadBranchPullRequests: () => Promise<void>;
  syncFingerprint: () => Promise<void>;
}

export async function refreshAfterCheckout(
  dependencies: CheckoutRefreshDependencies,
  options: {
    ref?: string;
  } = {},
): Promise<boolean> {
  void dependencies.loadBranchPullRequests().catch(() => undefined);
  const refreshed = await dependencies.loadControllerSnapshot({
    ref: options.ref,
    includeCommits: false,
  });

  if (!refreshed) {
    return false;
  }

  void dependencies
    .loadControllerSnapshot({
      ref: options.ref,
      includeCommits: true,
    })
    .catch(() => undefined);

  return true;
}

export async function refreshAfterCheckoutPreservingGraph(
  dependencies: GraphPreservingCheckoutRefreshDependencies,
): Promise<void> {
  void dependencies.loadBranchPullRequests().catch(() => undefined);
  void dependencies.syncFingerprint().catch(() => undefined);

  await Promise.all([
    dependencies.loadBranches(),
    dependencies.loadWorkingTreeStatus(),
    dependencies.loadPullStatus(),
  ]);
}
