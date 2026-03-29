import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { BranchActionDialog } from './BranchActionDialog';

describe('BranchActionDialog', () => {
  test('renders merge / pull request choices', () => {
    const html = renderToStaticMarkup(
      <BranchActionDialog
        sourceBranchName="feature/dnd"
        targetBranchName="main"
        step="select-action"
        busy={false}
        onClose={() => {}}
        onMerge={() => {}}
        onPreparePullRequest={() => {}}
        onConfirmPushAndCreatePullRequest={() => {}}
        onBack={() => {}}
      />
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('feature/dnd -&gt; main');
    expect(html).toContain('Merge');
    expect(html).toContain('Pull Request');
    expect(html).toContain('Cancel');
  });

  test('renders push confirmation step', () => {
    const html = renderToStaticMarkup(
      <BranchActionDialog
        sourceBranchName="feature/dnd"
        targetBranchName="main"
        step="confirm-push"
        busy={false}
        onClose={() => {}}
        onMerge={() => {}}
        onPreparePullRequest={() => {}}
        onConfirmPushAndCreatePullRequest={() => {}}
        onBack={() => {}}
      />
    );

    expect(html).toContain('Push Required');
    expect(html).toContain('Push and Create PR');
    expect(html).toContain('Back');
  });
});
