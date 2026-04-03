export type AppThemePickerInteraction = "keyboard" | "pointer" | null;

export function shouldCollapseAppThemePickerOnSelect(
  interaction: AppThemePickerInteraction,
): boolean {
  return interaction === "pointer";
}
