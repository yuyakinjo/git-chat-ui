import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkingTreeDiscardDialog } from "../../../src/components/WorkingTreeDiscardDialog";

describe("WorkingTreeDiscardDialog", () => {
  test("renders restore confirmation copy without relying on browser confirm", () => {
    const html = renderToStaticMarkup(
      <WorkingTreeDiscardDialog
        target={{ file: "src/App.tsx", mode: "restore" }}
        busy={false}
        onClose={() => {}}
        onDiscard={() => {}}
      />,
    );

    expect(html).toContain('aria-label="working tree discard confirmation"');
    expect(html).toContain("Discard Changes");
    expect(html).toContain("src/App.tsx");
    expect(html).toContain("このパスを HEAD の状態に戻します。");
    expect(html).toContain("Discard Changes");
    expect(html).not.toContain("window.confirm");
  });

  test("renders delete copy for paths that do not exist in HEAD", () => {
    const html = renderToStaticMarkup(
      <WorkingTreeDiscardDialog
        target={{ file: "notes.txt", mode: "delete" }}
        busy={true}
        onClose={() => {}}
        onDiscard={() => {}}
      />,
    );

    expect(html).toContain("notes.txt");
    expect(html).toContain("ファイルまたはディレクトリ自体が削除されます。");
    expect(html).toContain("Discarding...");
  });
});
