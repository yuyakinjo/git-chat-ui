import { describe, expect, mock, test } from "bun:test";

import { createTauriPlatformShell, createWebPlatformShell } from "../../../src/lib/platformShell";

describe("createWebPlatformShell", () => {
  test("opens external urls with window.open when a browser window is available", async () => {
    const open = mock(() => undefined);
    const shell = createWebPlatformShell(() => ({ open }));

    await shell.openExternalUrl("https://example.com");

    expect(open).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
  });

  test("treats syncWindowAppearance as a no-op on web", async () => {
    const shell = createWebPlatformShell(() => undefined);

    await expect(
      shell.syncWindowAppearance({
        theme: "light",
        backgroundColor: [255, 255, 255, 255],
      }),
    ).resolves.toBeUndefined();
  });
});

describe("createTauriPlatformShell", () => {
  test("delegates shell operations to Tauri commands", async () => {
    const invokeCommand = mock(
      async (_command: string, _args?: Record<string, unknown>) => undefined,
    );
    const shell = createTauriPlatformShell(invokeCommand);

    await shell.openExternalUrl("https://example.com");
    await shell.syncWindowAppearance({
      theme: "dark",
      backgroundColor: [0, 0, 0, 255],
    });

    expect(invokeCommand).toHaveBeenNthCalledWith(1, "open_external_url", {
      url: "https://example.com",
    });
    expect(invokeCommand).toHaveBeenNthCalledWith(2, "sync_window_appearance", {
      theme: "dark",
      backgroundColor: [0, 0, 0, 255],
    });
  });
});
