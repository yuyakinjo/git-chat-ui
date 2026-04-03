import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import App from "../../src/App";

describe("App", () => {
  test("renders the theme selector and keeps dashboard out of the tab choices", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('aria-label="Application theme"');
    expect(html).toContain('title="Theme: Default Light"');
    expect(html).toContain('class="lucide lucide-sun app-theme-picker__icon"');
    expect(html).toContain(">Default Light</span>");
    expect(html).toContain('aria-label="repository を追加"');
    expect(html).toContain('title="Config (Cmd/Ctrl + ,)"');
    expect(html).toContain('aria-label="Assistant"');
    expect(html).toContain('aria-label="Palette"');
    expect(html).toContain("app-toolbar-button--disclosure");
    expect(html).toContain("☀ Default Light");
    expect(html).toContain("☾ Default Dark");
    expect(html).not.toContain("app-theme-picker__chevron");
    expect(html).not.toContain("Dashboard</span>");
    expect(html.indexOf('title="Assistant (Cmd/Ctrl + I)"')).toBeLessThan(
      html.indexOf('title="Palette (Cmd/Ctrl + P)"'),
    );
    expect(html.indexOf('title="Palette (Cmd/Ctrl + P)"')).toBeLessThan(
      html.indexOf('aria-label="Application theme"'),
    );
  });
});
