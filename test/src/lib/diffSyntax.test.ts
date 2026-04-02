import { describe, expect, test } from "bun:test";

import {
  getDiffSyntaxCacheKey,
  highlightDiffSyntaxLineSync,
  resolveDiffSyntaxTheme,
} from "../../../src/lib/diffSyntax";

describe("diffSyntax", () => {
  test("maps app themes to light/dark syntax themes", () => {
    expect(resolveDiffSyntaxTheme("default-light")).toBe("light");
    expect(resolveDiffSyntaxTheme("paper-light")).toBe("light");
    expect(resolveDiffSyntaxTheme("default-dark")).toBe("dark");
    expect(resolveDiffSyntaxTheme("graphite-dark")).toBe("dark");
    expect(resolveDiffSyntaxTheme("unexpected")).toBe("light");
    expect(resolveDiffSyntaxTheme(null)).toBe("light");
  });

  test("includes the active theme in syntax cache keys", () => {
    expect(getDiffSyntaxCacheKey("light", "ts", "const value = 1;")).not.toBe(
      getDiffSyntaxCacheKey("dark", "ts", "const value = 1;"),
    );
  });

  test("uses different token colors for light and dark diff themes", () => {
    const line = "import path from 'node:path';";
    const lightTokens = highlightDiffSyntaxLineSync(line, "ts", "light");
    const darkTokens = highlightDiffSyntaxLineSync(line, "ts", "dark");

    expect(lightTokens.map((token) => token.content).join("")).toBe(line);
    expect(darkTokens.map((token) => token.content).join("")).toBe(line);
    expect(lightTokens).not.toEqual(darkTokens);
    expect(
      lightTokens.some(
        (token, index) =>
          token.color !== darkTokens[index]?.color || token.bgColor !== darkTokens[index]?.bgColor,
      ),
    ).toBe(true);
  });
});
