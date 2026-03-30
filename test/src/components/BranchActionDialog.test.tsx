import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { BranchActionDialog } from '../../../src/components/BranchActionDialog';

describe('BranchActionDialog', () => {
  test('renders merge / pull request choices', () => {
    const html = renderToStaticMarkup(
      <BranchActionDialog
        sourceBranchName="feature/dnd"
        targetBranchName="main"
        step="select-action"
        busy={false}
        mergeDisabledReason={null}
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
    expect(html).toContain('title="Close"');
    expect(html).toContain('aria-label="Close"');
    expect(html).not.toContain('>Close<');
  });

  test('renders push confirmation step', () => {
    const html = renderToStaticMarkup(
      <BranchActionDialog
        sourceBranchName="feature/dnd"
        targetBranchName="main"
        step="confirm-push"
        busy={false}
        mergeDisabledReason={null}
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
    expect(html).toContain('title="Close"');
    expect(html).not.toContain('>Close<');
  });

  test('shows a disabled merge reason when merge is blocked', () => {
    const html = renderToStaticMarkup(
      <BranchActionDialog
        sourceBranchName="feature/dnd"
        targetBranchName="main"
        step="select-action"
        busy={false}
        mergeDisabledReason="開発モードではアプリ自身の repo を merge できません。"
        onClose={() => {}}
        onMerge={() => {}}
        onPreparePullRequest={() => {}}
        onConfirmPushAndCreatePullRequest={() => {}}
        onBack={() => {}}
      />
    );

    expect(html).toContain('Merge is unavailable here');
    expect(html).toContain('disabled=""');
  });
});
