export const APP_THEME_OPTIONS = [
  { id: 'default-light', label: 'Default Light' },
  { id: 'default-dark', label: 'Default Dark' }
] as const;

export type AppThemeId = (typeof APP_THEME_OPTIONS)[number]['id'];
export type NativeWindowTheme = 'light' | 'dark';
export type NativeWindowAppearance = {
  theme: NativeWindowTheme;
  backgroundColor: [number, number, number, number];
};

export const DEFAULT_APP_THEME: AppThemeId = 'default-light';

const APP_THEME_IDS = new Set<AppThemeId>(APP_THEME_OPTIONS.map((theme) => theme.id));
const NATIVE_WINDOW_APPEARANCE_BY_THEME: Record<AppThemeId, NativeWindowAppearance> = {
  'default-light': {
    theme: 'light',
    backgroundColor: [241, 243, 248, 255]
  },
  'default-dark': {
    theme: 'dark',
    backgroundColor: [7, 11, 18, 255]
  }
};

export function normalizeAppTheme(value: string | null | undefined): AppThemeId {
  if (value && APP_THEME_IDS.has(value as AppThemeId)) {
    return value as AppThemeId;
  }

  return DEFAULT_APP_THEME;
}

export function getAppThemeLabel(themeId: AppThemeId): string {
  return APP_THEME_OPTIONS.find((theme) => theme.id === themeId)?.label ?? APP_THEME_OPTIONS[0].label;
}

export function getNativeWindowAppearance(themeId: AppThemeId): NativeWindowAppearance {
  const appearance = NATIVE_WINDOW_APPEARANCE_BY_THEME[normalizeAppTheme(themeId)];

  return {
    theme: appearance.theme,
    backgroundColor: [...appearance.backgroundColor] as [number, number, number, number]
  };
}
