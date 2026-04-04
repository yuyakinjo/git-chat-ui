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
  return await dependencies.loadControllerSnapshot({
    ref: options.ref,
    includeCommits: true,
  });
}
