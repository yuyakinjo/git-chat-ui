import { Copy, ExternalLink } from "lucide-react";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CommandPalette } from "../../../src/components/CommandPalette";

describe("CommandPalette", () => {
  test("renders the search UI and commands", () => {
    const html = renderToStaticMarkup(
      <CommandPalette
        open
        onClose={() => {}}
        commands={[
          {
            id: "copy-current-branch-name",
            title: "Copy Current Branch Name",
            description: "Current branch: main",
            keywords: ["copy", "branch"],
            icon: Copy,
            onSelect: () => {},
          },
          {
            id: "open-github-page",
            title: "Open GitHub Page",
            description: "Open the repository page in GitHub.",
            keywords: ["github", "open"],
            icon: ExternalLink,
            disabledReason: "GitHub remote を解決できたときだけ使えます。",
            onSelect: () => {},
          },
        ]}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain("Command Palette");
    expect(html).toContain("Search commands");
    expect(html).toContain("Copy Current Branch Name");
    expect(html).toContain("Open GitHub Page");
    expect(html).not.toContain("Cmd/Ctrl + P");
    expect(html).not.toContain("Arrow keys to move, Enter to run, Esc to close");
    expect(html).toContain("Unavailable");
  });
});
