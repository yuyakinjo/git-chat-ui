import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { BranchDeleteDialog } from '../../../src/components/BranchDeleteDialog';

describe('BranchDeleteDialog', () => {
  test('renders branch delete confirmation copy', () => {
    const html = renderToStaticMarkup(
      <BranchDeleteDialog
        branchName="feature/delete-me"
        branchType="local"
        busy={false}
        onClose={() => {}}
        onDelete={() => {}}
      />
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('Delete Branch');
    expect(html).toContain('feature/delete-me');
    expect(html).toContain('この操作は取り消せません');
    expect(html).toContain('Cancel');
    expect(html).toContain('title="Close"');
    expect(html).toContain('aria-label="Close"');
    expect(html).not.toContain('>Close<');
  });

  test('renders remote delete confirmation copy', () => {
    const html = renderToStaticMarkup(
      <BranchDeleteDialog
        branchName="origin/feature/delete-me"
        branchType="remote"
        busy={false}
        onClose={() => {}}
        onDelete={() => {}}
      />
    );

    expect(html).toContain('remote branch を削除します。');
    expect(html).toContain('remote-tracking ref も prune します。');
  });
});
