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
    expect(html).toContain("stash@{1}");
    expect(html).toContain("Stash Message");
    expect(html).toContain("WIP on feature/context-menu");
    expect(html).toContain("一覧表示される message だけ更新します");
    expect(html).toContain('title="Close"');
    expect(html).not.toContain(">Close<");
  });
});
