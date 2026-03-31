import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import App from "../../src/App";

describe("App", () => {
  test("renders the theme selector with the default light and dark themes", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('aria-label="Application theme"');
    expect(html).toContain("Default Light");
    expect(html).toContain("Default Dark");
  });
});
