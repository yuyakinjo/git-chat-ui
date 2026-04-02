import { describe, expect, test } from "bun:test";

import {
  APP_THEME_OPTIONS,
  DEFAULT_APP_THEME,
  getAppThemeLabel,
  getAppThemeMode,
  getNativeWindowAppearance,
  normalizeAppTheme,
} from "../../../src/lib/appTheme";

describe("appTheme", () => {
  test("falls back to Default Light for unknown values", () => {
    expect(normalizeAppTheme("")).toBe(DEFAULT_APP_THEME);
    expect(normalizeAppTheme("midnight")).toBe(DEFAULT_APP_THEME);
    expect(normalizeAppTheme(null)).toBe(DEFAULT_APP_THEME);
  });

  test("returns labels for known theme ids", () => {
    expect(getAppThemeLabel("default-light")).toBe("☀ Default Light");
    expect(getAppThemeLabel("paper-light")).toBe("☀ Paper Light");
    expect(getAppThemeLabel("default-dark")).toBe("☾ Default Dark");
    expect(getAppThemeLabel("graphite-dark")).toBe("☾ Graphite Dark");
  });

  test("exposes two light themes and two dark themes", () => {
    expect(APP_THEME_OPTIONS.map((theme) => theme.id)).toEqual([
      "default-light",
      "paper-light",
      "default-dark",
      "graphite-dark",
    ]);
    expect(APP_THEME_OPTIONS.map((theme) => theme.mode)).toEqual([
      "light",
      "light",
      "dark",
      "dark",
    ]);
  });

  test("resolves the light or dark mode for each theme", () => {
    expect(getAppThemeMode("default-light")).toBe("light");
    expect(getAppThemeMode("paper-light")).toBe("light");
    expect(getAppThemeMode("default-dark")).toBe("dark");
    expect(getAppThemeMode("graphite-dark")).toBe("dark");
  });

  test("returns native window appearance for each theme", () => {
    expect(getNativeWindowAppearance("default-light")).toEqual({
      theme: "light",
      backgroundColor: [241, 243, 248, 255],
    });
    expect(getNativeWindowAppearance("paper-light")).toEqual({
      theme: "light",
      backgroundColor: [246, 241, 232, 255],
    });
    expect(getNativeWindowAppearance("default-dark")).toEqual({
      theme: "dark",
      backgroundColor: [7, 11, 18, 255],
    });
    expect(getNativeWindowAppearance("graphite-dark")).toEqual({
      theme: "dark",
      backgroundColor: [18, 21, 27, 255],
    });
  });
});
