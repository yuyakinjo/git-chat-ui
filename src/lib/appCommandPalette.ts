import {
  APP_THEME_OPTIONS,
  getAppThemeLabel,
  normalizeAppTheme,
  type AppThemeId,
} from "./appTheme";
import type { SearchableCommandPaletteItem } from "./commandPalette";

export type AppCommandPaletteActionSpec =
  | (SearchableCommandPaletteItem & {
      action: "openConfig";
    })
  | (SearchableCommandPaletteItem & {
      action: "selectTheme";
      themeId: AppThemeId;
    });

export function buildAppCommandPaletteActionSpecs(
  currentThemeId: AppThemeId | null | undefined,
): AppCommandPaletteActionSpec[] {
  const normalizedCurrentThemeId = normalizeAppTheme(currentThemeId);

  return [
    {
      id: "open-config",
      action: "openConfig",
      title: "Open Config",
      description: "設定画面を開きます。",
      keywords: ["config", "settings", "preferences", "setting", "open", "設定", "環境設定"],
    },
    ...APP_THEME_OPTIONS.map((theme) => ({
      id: `select-theme:${theme.id}`,
      action: "selectTheme" as const,
      themeId: theme.id,
      title: `Theme: ${getAppThemeLabel(theme.id)}`,
      description:
        theme.id === normalizedCurrentThemeId
          ? `現在の theme: ${getAppThemeLabel(theme.id)}`
          : `${getAppThemeLabel(theme.id)} に切り替えます。`,
      keywords: [
        "theme",
        "appearance",
        "color",
        "mode",
        theme.id,
        theme.mode,
        getAppThemeLabel(theme.id),
        "テーマ",
        "見た目",
        "切り替え",
      ],
    })),
  ];
}
