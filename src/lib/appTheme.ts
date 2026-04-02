export const APP_THEME_OPTIONS = [
  {
    id: "default-light",
    label: "☀ Default Light",
    mode: "light",
    backgroundColor: [241, 243, 248, 255],
  },
  {
    id: "paper-light",
    label: "☀ Paper Light",
    mode: "light",
    backgroundColor: [246, 241, 232, 255],
  },
  {
    id: "default-dark",
    label: "☾ Default Dark",
    mode: "dark",
    backgroundColor: [7, 11, 18, 255],
  },
  {
    id: "graphite-dark",
    label: "☾ Graphite Dark",
    mode: "dark",
    backgroundColor: [18, 21, 27, 255],
  },
] as const;

export type AppThemeId = (typeof APP_THEME_OPTIONS)[number]["id"];
export type NativeWindowTheme = "light" | "dark";
export type NativeWindowAppearance = {
  theme: NativeWindowTheme;
  backgroundColor: [number, number, number, number];
};

export const DEFAULT_APP_THEME: AppThemeId = "default-light";

const APP_THEME_BY_ID = new Map<AppThemeId, (typeof APP_THEME_OPTIONS)[number]>(
  APP_THEME_OPTIONS.map((theme) => [theme.id, theme]),
);

function getAppThemeDefinition(themeId: string | null | undefined) {
  return APP_THEME_BY_ID.get(normalizeAppTheme(themeId));
}

export function normalizeAppTheme(value: string | null | undefined): AppThemeId {
  if (value && APP_THEME_BY_ID.has(value as AppThemeId)) {
    return value as AppThemeId;
  }

  return DEFAULT_APP_THEME;
}

export function getAppThemeLabel(themeId: AppThemeId): string {
  return getAppThemeDefinition(themeId)?.label ?? APP_THEME_OPTIONS[0].label;
}

export function getAppThemeMode(themeId: string | null | undefined): NativeWindowTheme {
  return getAppThemeDefinition(themeId)?.mode ?? APP_THEME_OPTIONS[0].mode;
}

export function getNativeWindowAppearance(themeId: AppThemeId): NativeWindowAppearance {
  const theme = getAppThemeDefinition(themeId) ?? APP_THEME_OPTIONS[0];

  return {
    theme: theme.mode,
    backgroundColor: [...theme.backgroundColor] as [number, number, number, number],
  };
}
