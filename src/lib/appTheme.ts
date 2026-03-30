export const APP_THEME_OPTIONS = [
  { id: 'default-light', label: 'Default Light' },
  { id: 'default-dark', label: 'Default Dark' }
] as const;

export type AppThemeId = (typeof APP_THEME_OPTIONS)[number]['id'];

export const DEFAULT_APP_THEME: AppThemeId = 'default-light';

const APP_THEME_IDS = new Set<AppThemeId>(APP_THEME_OPTIONS.map((theme) => theme.id));

export function normalizeAppTheme(value: string | null | undefined): AppThemeId {
  if (value && APP_THEME_IDS.has(value as AppThemeId)) {
    return value as AppThemeId;
  }

  return DEFAULT_APP_THEME;
}

export function getAppThemeLabel(themeId: AppThemeId): string {
  return APP_THEME_OPTIONS.find((theme) => theme.id === themeId)?.label ?? APP_THEME_OPTIONS[0].label;
}
