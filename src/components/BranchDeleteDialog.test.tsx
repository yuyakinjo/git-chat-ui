import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { BranchDeleteDialog } from './BranchDeleteDialog';

describe('BranchDeleteDialog', () => {
  test('renders branch delete confirmation copy', () => {
    const html = renderToStaticMarkup(
      <BranchDeleteDialog branchName="feature/delete-me" busy={false} onClose={() => {}} onDelete={() => {}} />
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('Delete Branch');
    expect(html).toContain('feature/delete-me');
    expect(html).toContain('この操作は取り消せません');
    expect(html).toContain('Cancel');
  });
});
