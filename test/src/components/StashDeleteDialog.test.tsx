import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { StashDeleteDialog } from "../../../src/components/StashDeleteDialog";

describe("StashDeleteDialog", () => {
  test("renders stash delete confirmation copy", () => {
    const html = renderToStaticMarkup(
      <StashDeleteDialog
        stashId="stash@{0}"
        message="WIP on develop"
        busy={false}
        onClose={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain("Delete Stash");
    expect(html).toContain("WIP on develop");
    expect(html).toContain("Target Stash");
    expect(html).toContain("Delete Stash");
    expect(html).toContain('title="Close"');
    expect(html).not.toContain(">Close<");
    expect(html).not.toContain("stash@{0}</div>");
    expect(html).not.toContain("この操作は取り消せません");
  });
});
