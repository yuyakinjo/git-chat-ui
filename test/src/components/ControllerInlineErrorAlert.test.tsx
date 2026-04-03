import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ControllerInlineErrorAlert } from "../../../src/components/ControllerInlineErrorAlert";

describe("ControllerInlineErrorAlert", () => {
  test("renders copy and close actions next to the alert content", () => {
    const html = renderToStaticMarkup(
      <ControllerInlineErrorAlert
        error={{
          title: "Git 操作に失敗しました。",
          detail: "error: pathspec ': (prefix:0) AGENTS.md' did not match any file(s) known to git",
        }}
        onCopy={() => {}}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("Git 操作に失敗しました。");
    expect(html).toContain("did not match any file(s) known to git");
    expect(html).toContain('aria-label="エラー内容をクリップボードにコピー"');
    expect(html).toContain('title="エラー内容をコピー"');
    expect(html).toContain(">Copy</span>");
    expect(html).toContain('aria-label="close error"');
  });
});
