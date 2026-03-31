import type { NativeWindowAppearance } from "./appTheme";
import { invokeCommand, isTauriRuntime } from "./tauriRuntime";

export interface PlatformShell {
  openExternalUrl(url: string): Promise<void>;
  syncWindowAppearance(appearance: NativeWindowAppearance): Promise<void>;
}

type TauriCommandInvoker = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

type BrowserWindowLike = {
  open(url?: string | URL, target?: string, features?: string): unknown;
};

function resolveBrowserWindow(): BrowserWindowLike | undefined {
  return typeof window !== "undefined" ? window : undefined;
}

export function createWebPlatformShell(
  getWindow: () => BrowserWindowLike | undefined = resolveBrowserWindow,
): PlatformShell {
  return {
    async openExternalUrl(url) {
      getWindow()?.open(url, "_blank", "noopener,noreferrer");
    },

    async syncWindowAppearance() {
      // Web has no native window appearance bridge.
    },
  };
}

export function createTauriPlatformShell(
  invokeCommandImpl: TauriCommandInvoker = invokeCommand,
): PlatformShell {
  return {
    async openExternalUrl(url) {
      await invokeCommandImpl("open_external_url", { url });
    },

    async syncWindowAppearance(appearance) {
      await invokeCommandImpl("sync_window_appearance", appearance);
    },
  };
}

const webPlatformShell = createWebPlatformShell();
const tauriPlatformShell = createTauriPlatformShell();

export function getPlatformShell(): PlatformShell {
  return isTauriRuntime() ? tauriPlatformShell : webPlatformShell;
}
