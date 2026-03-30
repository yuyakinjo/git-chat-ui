import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ControllerView } from '../../../src/components/ControllerView';

describe('ControllerView', () => {
  test('uses the panel slot itself as the reorder drag source without rendering a dedicated handle button', () => {
    const html = renderToStaticMarkup(
      <ControllerView
        repository={{
          name: 'git-chat-ui',
          path: '/tmp/git-chat-ui'
        }}
        appConfig={null}
        onNotify={() => {}}
        onCurrentBranchChange={() => {}}
      />
    );

    expect(html).toContain('data-controller-panel-drop-id="commitGraph"');
    expect(html).toContain('data-controller-panel-drag-source-id="commitGraph"');
    expect(html).toContain('data-controller-panel-drop-id="gitOperations"');
    expect(html).toContain('data-controller-panel-drag-source-id="gitOperations"');
    expect(html).toContain('data-controller-panel-drop-id="commitDetail"');
    expect(html).toContain('data-controller-panel-drag-source-id="commitDetail"');
    expect(html).not.toContain('controller-panel-slot__handle');
    expect(html).not.toContain('右上の handle をドラッグしてパネル位置を入れ替えます。');
  });
});
