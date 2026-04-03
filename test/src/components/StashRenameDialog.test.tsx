import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { StashRenameDialog } from "../../../src/components/StashRenameDialog";

describe("StashRenameDialog", () => {
  test("renders stash rename copy and input", () => {
    const html = renderToStaticMarkup(
      <StashRenameDialog
        stashId="stash@{1}"
        initialMessage="WIP on develop"
        busy={false}
        onClose={() => {}}
        onRename={() => {}}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain("Rename Stash");
    expect(html).toContain("Stash Message");
    expect(html).toContain("WIP on feature/context-menu");
    expect(html).toContain('class="button button-primary inline-flex items-center gap-2"');
    expect(html).toContain('title="Close"');
    expect(html).not.toContain(">Close<");
    expect(html).not.toContain("Target Stash");
    expect(html).not.toContain("一覧表示される message だけ更新します");
    expect(html).not.toContain("stash の message だけを更新します");
    expect(html).not.toContain(">stash@{1}</div>");
  });
});
