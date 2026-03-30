import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { BranchCreateDialog } from './BranchCreateDialog';

describe('BranchCreateDialog', () => {
  test('renders branch creation copy and input', () => {
    const html = renderToStaticMarkup(
      <BranchCreateDialog
        baseBranchName="feature/base"
        busy={false}
        onClose={() => {}}
        onCreate={() => {}}
      />
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('Create Branch');
    expect(html).toContain('feature/base');
    expect(html).toContain('New Branch Name');
    expect(html).toContain('feature/context-menu');
    expect(html).toContain('checkout は行いません');
  });
});
