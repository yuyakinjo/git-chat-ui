import type { NativeWindowTheme } from "./appTheme";

export function shouldRenderAppThemePickerDivider(
  previousThemeMode: NativeWindowTheme | null,
  nextThemeMode: NativeWindowTheme,
): boolean {
  return previousThemeMode !== null && previousThemeMode !== nextThemeMode;
}
