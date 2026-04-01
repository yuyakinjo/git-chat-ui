import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { BranchCreateDialog } from "../../../src/components/BranchCreateDialog";

describe("BranchCreateDialog", () => {
  test("renders branch creation copy and input", () => {
    const html = renderToStaticMarkup(
      <BranchCreateDialog
        baseBranchName="feature/base"
        busy={false}
        onClose={() => {}}
        onCreate={() => {}}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain("Create Branch");
    expect(html).toContain("feature/base");
    expect(html).toContain("New Branch Name");
    expect(html).toContain("feature/context-menu");
    expect(html).not.toContain("Base Branch");
    expect(html).not.toContain("checkout は行いません");
    expect(html).not.toContain("右クリックした local branch を base にして");
    expect(html).not.toContain("作成後に切り替えたい場合は");
    expect(html).toContain('title="Close"');
    expect(html).toContain('aria-label="Close"');
    expect(html).not.toContain(">Close<");

    const submitButtonMarkup = html.match(/<button[^>]*type="submit"[^>]*>.*?<\/button>/)?.[0];
    expect(submitButtonMarkup).toBeDefined();
    expect(submitButtonMarkup).toContain("inline-flex items-center gap-2");
    expect(submitButtonMarkup?.indexOf("lucide-plus")).toBeLessThan(
      submitButtonMarkup?.indexOf("Create Branch") ?? Infinity,
    );
  });

  test("uses a scroll-safe layout without truncating the branch name", () => {
    const html = renderToStaticMarkup(
      <BranchCreateDialog
        baseBranchName="feature/really/long/branch/name/that/should/stay/visible/in/the/dialog"
        busy={false}
        onClose={() => {}}
        onCreate={() => {}}
      />,
    );

    expect(html).toContain("max-h-full");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("break-all text-base font-semibold text-ink");
  });
});
