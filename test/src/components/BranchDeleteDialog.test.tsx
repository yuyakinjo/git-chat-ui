import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { BranchDeleteDialog } from "../../../src/components/BranchDeleteDialog";

describe("BranchDeleteDialog", () => {
  test("renders branch delete confirmation copy", () => {
    const html = renderToStaticMarkup(
      <BranchDeleteDialog
        branchName="feature/delete-me"
        branchType="local"
        busy={false}
        forceDelete={false}
        onClose={() => {}}
        onForceDeleteChange={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain("Delete Branch");
    expect(html).toContain("feature/delete-me");
    expect(html).toContain("この操作は取り消せません");
    expect(html).toContain("Cancel");
    expect(html).toContain('title="Close"');
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain("Force delete を使う");
    expect(html).toContain("max-h-[calc(100vh-24px)]");
    expect(html).toContain("overflow-y-auto");
    expect(html).not.toContain(">Close<");
  });

  test("renders remote delete confirmation copy", () => {
    const html = renderToStaticMarkup(
      <BranchDeleteDialog
        branchName="origin/feature/delete-me"
        branchType="remote"
        busy={false}
        forceDelete={false}
        onClose={() => {}}
        onForceDeleteChange={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(html).toContain("remote branch を削除します。");
    expect(html).toContain("remote-tracking ref も prune します。");
    expect(html).not.toContain("Force delete を使う");
  });

  test("renders force delete state for local branches", () => {
    const html = renderToStaticMarkup(
      <BranchDeleteDialog
        branchName="feature/delete-me"
        branchType="local"
        busy={false}
        forceDelete
        onClose={() => {}}
        onForceDeleteChange={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(html).toContain("Force Delete Branch");
    expect(html).toContain("squash / rebase 後の掃除");
  });
});
