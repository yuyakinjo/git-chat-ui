import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ControllerView } from "../../../src/components/ControllerView";
import {
  CONTROLLER_PANEL_ORDER_STORAGE_KEY,
  CONTROLLER_PANEL_VISIBILITY_STORAGE_KEY,
} from "../../../src/lib/controllerViewUtils";

const originalWindow = globalThis.window;

afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
    return;
  }

  Object.defineProperty(globalThis, "window", {
    value: originalWindow,
    configurable: true,
    writable: true,
  });
});

describe("ControllerView", () => {
  test("uses the panel slot itself as the reorder drag source without rendering a dedicated handle button", () => {
    const html = renderToStaticMarkup(
      <ControllerView
        repository={{
          name: "git-chat-ui",
          path: "/tmp/git-chat-ui",
        }}
        appConfig={null}
        onNotify={() => {}}
        onCurrentBranchChange={() => {}}
      />,
    );

    expect(html).toContain('data-controller-panel-drop-id="commitGraph"');
    expect(html).toContain('data-controller-panel-drag-source-id="commitGraph"');
    expect(html).toContain('data-controller-panel-drop-id="gitOperations"');
    expect(html).toContain('data-controller-panel-drag-source-id="gitOperations"');
    expect(html).toContain('data-controller-panel-drop-id="commitDetail"');
    expect(html).toContain('data-controller-panel-drag-source-id="commitDetail"');
    expect(html).toContain("controller-panels-grid");
    expect(html).toContain('class="lucide lucide-cloud-upload"');
    expect(html).toContain('class="lucide lucide-archive"');
    expect(html).toContain('class="lucide lucide-git-commit-horizontal"');
    expect(html).toContain(">Stash</span>");
    expect(html).toContain(">Push</span>");
    expect(html).toContain(">Commit</span>");
    expect(html).not.toContain("git-operation-panel__commit-actions");
    expect(html).not.toContain("controller-panel-slot__handle");
    expect(html).not.toContain("branch-list-item__pr-link");
    expect(html).not.toContain("Command Palette");
    expect(html).not.toContain("右上の handle をドラッグしてパネル位置を入れ替えます。");
    expect(html).toContain("controller-activity-glow controller-activity-glow--idle");
    expect(html).toContain("controller-layout-picker__trigger");
    expect(html).toContain('class="lucide lucide-panels-top-left controller-layout-picker__icon"');
    expect(html).toContain(">Layout</span>");
    expect(html).toContain("controller-layout-picker__checkbox");
    expect(html).not.toContain("controller-layout-picker__chevron");
    expect(html).toContain("Commit Graph");
    expect(html).toContain("Git Operations");
    expect(html).toContain("Commit Detail");
    expect(html.indexOf(">Stash</span>")).toBeLessThan(html.indexOf(">Push</span>"));
    expect(html.indexOf(">Push</span>")).toBeLessThan(html.indexOf(">Commit</span>"));
  });

  test("restores panel visibility from localStorage and keeps the layout picker available", () => {
    const storage = new Map<string, string>([
      [
        CONTROLLER_PANEL_VISIBILITY_STORAGE_KEY,
        JSON.stringify({
          commitGraph: false,
          gitOperations: true,
          commitDetail: false,
        }),
      ],
      [
        CONTROLLER_PANEL_ORDER_STORAGE_KEY,
        JSON.stringify(["commitGraph", "gitOperations", "commitDetail"]),
      ],
    ]);

    Object.defineProperty(globalThis, "window", {
      value: {
        localStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: () => {},
        },
      },
      configurable: true,
      writable: true,
    });

    const html = renderToStaticMarkup(
      <ControllerView
        repository={{
          name: "git-chat-ui",
          path: "/tmp/git-chat-ui",
        }}
        appConfig={null}
        onNotify={() => {}}
        onCurrentBranchChange={() => {}}
      />,
    );

    expect(html).toContain('controller-layout-picker__summary">1/3<');
    expect(html).not.toContain('data-controller-panel-drop-id="commitGraph"');
    expect(html).toContain('data-controller-panel-drop-id="gitOperations"');
    expect(html).not.toContain('data-controller-panel-drop-id="commitDetail"');
    expect(html).not.toContain("controller-panels-empty");
  });

  test("shows an empty state when every panel is hidden", () => {
    const storage = new Map<string, string>([
      [
        CONTROLLER_PANEL_VISIBILITY_STORAGE_KEY,
        JSON.stringify({
          commitGraph: false,
          gitOperations: false,
          commitDetail: false,
        }),
      ],
    ]);

    Object.defineProperty(globalThis, "window", {
      value: {
        localStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: () => {},
        },
      },
      configurable: true,
      writable: true,
    });

    const html = renderToStaticMarkup(
      <ControllerView
        repository={{
          name: "git-chat-ui",
          path: "/tmp/git-chat-ui",
        }}
        appConfig={null}
        onNotify={() => {}}
        onCurrentBranchChange={() => {}}
      />,
    );

    expect(html).toContain("No panels selected");
    expect(html).toContain("Open Layout and check the panels you want to show.");
    expect(html).not.toContain('data-controller-panel-drop-id="commitGraph"');
    expect(html).not.toContain('data-controller-panel-drop-id="gitOperations"');
    expect(html).not.toContain('data-controller-panel-drop-id="commitDetail"');
  });
});
