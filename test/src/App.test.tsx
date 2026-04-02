import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import App from "../../src/App";

describe("App", () => {
  test("renders the theme selector and keeps dashboard out of the tab choices", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('aria-label="Application theme"');
    expect(html).toContain('aria-label="repository を追加"');
    expect(html).toContain("Default Light");
    expect(html).toContain("Default Dark");
    expect(html).not.toContain("Dashboard</span>");
  });
});
