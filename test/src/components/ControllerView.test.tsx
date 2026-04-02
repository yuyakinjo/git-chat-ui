import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ControllerView } from "../../../src/components/ControllerView";

describe("ControllerView", () => {
  test("uses the panel slot itself as the reorder drag source without rendering a dedicated handle button", () => {
    const html = renderToStaticMarkup(
      <ControllerView
        repository={{
          name: "git-chat-ui",
          path: "/tmp/git-chat-ui",
        }}
        appConfig={null}
        onNotify={() => {}}
        onCurrentBranchChange={() => {}}
      />,
    );

    expect(html).toContain('data-controller-panel-drop-id="commitGraph"');
    expect(html).toContain('data-controller-panel-drag-source-id="commitGraph"');
    expect(html).toContain('data-controller-panel-drop-id="gitOperations"');
    expect(html).toContain('data-controller-panel-drag-source-id="gitOperations"');
    expect(html).toContain('data-controller-panel-drop-id="commitDetail"');
    expect(html).toContain('data-controller-panel-drag-source-id="commitDetail"');
    expect(html).toContain("controller-panels-grid");
    expect(html).toContain('class="lucide lucide-cloud-upload"');
    expect(html).toContain('class="lucide lucide-git-commit-horizontal"');
    expect(html).toContain(">Push</span>");
    expect(html).toContain(">Commit</span>");
    expect(html).not.toContain("git-operation-panel__commit-actions");
    expect(html).not.toContain("controller-panel-slot__handle");
    expect(html).not.toContain("branch-list-item__pr-link");
    expect(html).not.toContain("右上の handle をドラッグしてパネル位置を入れ替えます。");
  });
});
