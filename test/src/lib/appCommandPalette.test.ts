import { describe, expect, test } from "bun:test";

import { buildAppCommandPaletteActionSpecs } from "../../../src/lib/appCommandPalette";

describe("buildAppCommandPaletteActionSpecs", () => {
  test("includes an Open Config command before theme commands", () => {
    const commands = buildAppCommandPaletteActionSpecs("default-light");

    expect(commands[0]).toMatchObject({
      id: "open-config",
      action: "openConfig",
      title: "Open Config",
    });
    expect(commands.slice(1).map((command) => command.id)).toEqual([
      "select-theme:default-light",
      "select-theme:paper-light",
      "select-theme:default-dark",
      "select-theme:graphite-dark",
    ]);
  });

  test("marks the current theme in the command descriptions", () => {
    const commands = buildAppCommandPaletteActionSpecs("graphite-dark");
    const graphiteCommand = commands.find((command) => command.id === "select-theme:graphite-dark");
    const paperCommand = commands.find((command) => command.id === "select-theme:paper-light");

    expect(graphiteCommand).toMatchObject({
      action: "selectTheme",
      description: "現在の theme: ☾ Graphite Dark",
      themeId: "graphite-dark",
    });
    expect(paperCommand).toMatchObject({
      action: "selectTheme",
      description: "☀ Paper Light に切り替えます。",
      themeId: "paper-light",
    });
  });
});
