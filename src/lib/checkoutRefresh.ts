export interface CheckoutRefreshDependencies {
  loadBranchPullRequests: () => Promise<void>;
  loadControllerSnapshot: (options: { ref?: string; includeCommits?: boolean }) => Promise<boolean>;
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
