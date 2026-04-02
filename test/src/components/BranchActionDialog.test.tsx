import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { BranchActionDialog } from "../../../src/components/BranchActionDialog";

describe("BranchActionDialog", () => {
  test("renders merge / pull request choices", () => {
    const html = renderToStaticMarkup(
      <BranchActionDialog
        sourceBranchName="feature/dnd"
        targetBranchName="main"
        step="select-action"
        busy={false}
        mergeDisabledReason={null}
        onClose={() => {}}
        onMerge={() => {}}
        onPreparePullRequest={() => {}}
        onConfirmPushAndCreatePullRequest={() => {}}
        onBack={() => {}}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain("Merge");
    expect(html).toContain("Pull Request");
    expect(html).toContain("This Repo");
    expect(html).toContain("Direct Update");
    expect(html).toContain("GitHub");
    expect(html).toContain("Review Flow");
    expect(html).toContain("feature/dnd</span> の変更を、この");
    expect(html).toContain("main</span> に今すぐ取り込みます。");
    expect(html).toContain("レビュー待ちや GitHub 上の PR は作らず");
    expect(html).toContain(
      'GitHub 上に <span class="font-medium text-ink">feature/dnd</span> から',
    );
    expect(html).toContain("main</span> 向けの Pull Request を作成します。");
    expect(html).toContain("レビューや CI を通してから merge したいときはこちらです。");
    expect(html).toContain("source branch が未");
    expect(html).toContain("push なら先に push します。");
    expect(html).toContain("branch-action-dialog__ref-flow");
    expect(html).toContain(">base<");
    expect(html).toContain(">head<");
    expect(html).toContain("lucide-arrow-left");
    expect(html).toContain("Cancel");
    expect(html).toContain('title="Close"');
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain("lucide-git-pull-request-arrow");
    expect(html).toContain("lucide-git-merge");
    expect(html).toContain("max-h-[calc(100%-24px)]");
    expect(html).toContain("overflow-y-auto");
    expect(html).not.toContain("feature/dnd -&gt; main");
    expect(html).not.toContain("ドロップしたブランチに対して進める操作を選んでください。");
    expect(html).not.toContain("head:");
    expect(html).not.toContain(">Close<");
  });

  test("renders push confirmation step", () => {
    const html = renderToStaticMarkup(
      <BranchActionDialog
        sourceBranchName="feature/dnd"
        targetBranchName="main"
        step="confirm-push"
        busy={false}
        mergeDisabledReason={null}
        onClose={() => {}}
        onMerge={() => {}}
        onPreparePullRequest={() => {}}
        onConfirmPushAndCreatePullRequest={() => {}}
        onBack={() => {}}
      />,
    );

    expect(html).toContain("Push Required");
    expect(html).toContain("feature/dnd -&gt; main");
    expect(html).toContain("source branch を push してから Pull Request を作成します。");
    expect(html).toContain("Pull Request は GitHub 上の提案なので、まず");
    expect(html).toContain("feature/dnd</span> を remote に");
    expect(html).toContain("push する必要があります。");
    expect(html).toContain('push 後に <span class="font-medium text-ink">main</span> 向けの');
    expect(html).toContain("Pull Request を作成します。");
    expect(html).toContain("Push and Create PR");
    expect(html).toContain("Back");
    expect(html).toContain('title="Close"');
    expect(html).toContain("overflow-y-auto");
    expect(html).not.toContain(">Close<");
  });

  test("shows a disabled merge reason when merge is blocked", () => {
    const html = renderToStaticMarkup(
      <BranchActionDialog
        sourceBranchName="feature/dnd"
        targetBranchName="main"
        step="select-action"
        busy={false}
        mergeDisabledReason="開発モードではアプリ自身の repo を merge できません。"
        onClose={() => {}}
        onMerge={() => {}}
        onPreparePullRequest={() => {}}
        onConfirmPushAndCreatePullRequest={() => {}}
        onBack={() => {}}
      />,
    );

    expect(html).toContain("Merge is unavailable here");
    expect(html).toContain('disabled=""');
  });
});
