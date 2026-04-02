import { describe, expect, test } from "bun:test";

const globalsCss = await Bun.file(
  new URL("../../../src/styles/globals.css", import.meta.url),
).text();

function getSection(startMarker: string, endMarker: string): string {
  const start = globalsCss.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);

  const end = globalsCss.indexOf(endMarker, start + startMarker.length);
  expect(end).toBeGreaterThan(start);

  return globalsCss.slice(start, end);
}

describe("globals.css", () => {
  test("app shell keeps the header-to-panel gap aligned with panel spacing", () => {
    const shellSection = getSection(".app-shell {", ".app-tabbar {");
    const tabbarSection = getSection(".app-tabbar {", ".panel {");

    expect(shellSection).toContain("gap: 12px;");
    expect(tabbarSection).toContain("padding: 10px 12px 0;");
  });

  test("app tabbar uses a segmented repository selector instead of browser-style tabs", () => {
    const tabbarSection = getSection(".app-tabbar {", ".panel {");

    expect(tabbarSection).toContain(".app-tab-toggle {");
    expect(tabbarSection).toContain("border-radius: 18px;");
    expect(tabbarSection).toContain("gap: 0;");
    expect(tabbarSection).toContain("overflow: hidden;");
    expect(tabbarSection).toContain("padding: 0;");
    expect(tabbarSection).toContain(".app-tab-toggle__option {");
    expect(tabbarSection).toContain("gap: 8px;");
    expect(tabbarSection).toContain("background: rgb(var(--theme-overlay-rgb) / 0.08);");
    expect(tabbarSection).toContain(".app-tab-toggle__option.is-active {");
    expect(tabbarSection).toContain("rgb(var(--color-accent) / 0.24)");
    expect(tabbarSection).toContain(".app-tab-toggle__option.is-active {");
    expect(tabbarSection).toContain(".app-tab-toggle__trigger {");
    expect(tabbarSection).toContain("min-height: 36px;");
    expect(tabbarSection).toContain(".app-tab-toggle__text {");
    expect(tabbarSection).toContain(".app-tab__close {");
    expect(tabbarSection).toContain("margin-right: 6px;");
    expect(tabbarSection).not.toContain("border-bottom:");
    expect(tabbarSection).not.toContain(".app-tabbar__actions::before {");
    expect(tabbarSection).not.toContain("0 0 0 1px rgb(var(--theme-border-rgb) / 0.18)");
    expect(tabbarSection).not.toContain(".app-tab--browser {");
    expect(tabbarSection).not.toContain(".app-tab--repository {");
  });

  test("controller panel rows give git operations more height at medium widths", () => {
    const controllerPanelSection = getSection(
      ".controller-panels-grid {",
      ".controller-panel-slot {",
    );

    expect(controllerPanelSection).toContain("transition: grid-template-rows 320ms ease;");
    expect(controllerPanelSection).toContain(
      "grid-template-rows: minmax(0, 1.3fr) minmax(320px, 1.15fr) minmax(170px, 0.72fr);",
    );
    expect(controllerPanelSection).toContain(
      ".controller-panels-grid--without-git-operations-graph-detail {",
    );
    expect(controllerPanelSection).toContain(
      "grid-template-rows: minmax(0, 1.3fr) minmax(260px, 1.87fr);",
    );
    expect(controllerPanelSection).toContain(
      ".controller-panels-grid--without-git-operations-detail-graph {",
    );
    expect(controllerPanelSection).toContain(
      "grid-template-rows: minmax(260px, 1.87fr) minmax(0, 1.3fr);",
    );
    expect(controllerPanelSection).toContain("@media (max-width: 1320px) {");
    expect(controllerPanelSection).toContain(
      "grid-template-rows: minmax(0, 1.08fr) minmax(340px, 1.18fr) minmax(150px, 0.56fr);",
    );
    expect(controllerPanelSection).toContain(
      "grid-template-rows: minmax(0, 1.08fr) minmax(280px, 1.74fr);",
    );
    expect(controllerPanelSection).toContain(
      "grid-template-rows: minmax(280px, 1.74fr) minmax(0, 1.08fr);",
    );
    expect(controllerPanelSection).toContain("@media (max-width: 1100px) {");
    expect(controllerPanelSection).toContain(
      "grid-template-rows: minmax(280px, 1.08fr) minmax(320px, 1.1fr) minmax(170px, 0.62fr);",
    );
    expect(controllerPanelSection).toContain(
      "grid-template-rows: minmax(240px, 1.08fr) minmax(320px, 1.72fr);",
    );
    expect(controllerPanelSection).toContain(
      "grid-template-rows: minmax(320px, 1.72fr) minmax(240px, 1.08fr);",
    );
  });

  test("controller panel slots fade git operations out before the grid collapses", () => {
    const controllerPanelSection = getSection(
      ".controller-panels-grid {",
      ".controller-panel-drop-split {",
    );

    expect(controllerPanelSection).toContain(".controller-panel-slot--hiding {");
    expect(controllerPanelSection).toContain("pointer-events: none;");
    expect(controllerPanelSection).toContain(".controller-panel-slot--hiding .panel {");
    expect(controllerPanelSection).toContain("opacity: 0;");
    expect(controllerPanelSection).toContain("transform: translateY(-10px) scale(0.985);");
    expect(controllerPanelSection).toContain("filter: saturate(0.86);");
    expect(controllerPanelSection).toContain("transition-duration: 320ms;");
  });

  test("git operation panel uses a stacked staged/stash column and expands commit in wider layouts", () => {
    const gitOperationSection = getSection(
      ".git-operation-panel__grid {",
      ".git-operation-panel__file-row {",
    );

    expect(gitOperationSection).toContain(".git-operation-panel__stacked-buckets {");
    expect(gitOperationSection).toContain("gap: 12px;");
    expect(gitOperationSection).toContain(".git-operation-panel__grid--fit-height {");
    expect(gitOperationSection).toContain("grid-template-rows: minmax(0, 1fr);");
    expect(gitOperationSection).toContain(".git-operation-panel__grid--3 {");
    expect(gitOperationSection).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(gitOperationSection).toContain(".git-operation-panel__stacked-buckets--split {");
    expect(gitOperationSection).toContain("height: 100%;");
    expect(gitOperationSection).toContain("grid-template-rows: minmax(0, 3fr) minmax(0, 1fr);");
    expect(gitOperationSection).toContain(
      ".git-operation-panel__stacked-buckets--split .git-operation-panel__stacked-bucket {",
    );
    expect(gitOperationSection).toContain("overflow: hidden;");
    expect(gitOperationSection).toContain(
      ".git-operation-panel__stacked-buckets--split .drop-zone {",
    );
    expect(gitOperationSection).toContain("min-height: 0;");
    expect(gitOperationSection).toContain(".git-operation-panel__commit-column--full {");
    expect(gitOperationSection).toContain("grid-column: 1 / -1;");
    expect(gitOperationSection).toContain(".git-operation-panel__commit-column--span-2 {");
    expect(gitOperationSection).toContain("grid-column: span 2 / span 2;");
    expect(gitOperationSection).toContain(".git-operation-panel__commit-card {");
    expect(gitOperationSection).toContain("overflow: hidden;");
    expect(gitOperationSection).toContain(".git-operation-panel__commit-card--medium {");
    expect(gitOperationSection).toContain("padding: 10px;");
    expect(gitOperationSection).toContain(".git-operation-panel__commit-card--compact {");
    expect(gitOperationSection).toContain("padding: 8px;");
    expect(gitOperationSection).toContain(".git-operation-panel__commit-body {");
    expect(gitOperationSection).toContain("overflow: auto;");
    expect(gitOperationSection).toContain(".git-operation-panel__description-input {");
    expect(gitOperationSection).toContain("max-height: 100%;");
    expect(gitOperationSection).toContain("flex: 1 1 80px;");
    expect(gitOperationSection).toContain(".git-operation-panel__description-input--compact {");
    expect(gitOperationSection).toContain("min-height: 44px;");
    expect(gitOperationSection).toContain("flex: 0 0 auto;");
    expect(gitOperationSection).toContain(".git-operation-panel__description-input--expanded {");
    expect(gitOperationSection).toContain("flex-basis: 132px;");
    expect(gitOperationSection).toContain(".git-operation-panel__commit-actions {");
    expect(gitOperationSection).toContain("display: flex;");
    expect(gitOperationSection).toContain("justify-content: flex-end;");
    expect(gitOperationSection).not.toContain(".git-operation-panel__commit-actions--two {");
    expect(gitOperationSection).toContain(".git-operation-panel__drop-zone-empty {");
    expect(gitOperationSection).toContain("line-height: 1;");
    expect(gitOperationSection).toContain("transform: translateY(-1px);");
  });

  test("branch context menu uses theme tokens instead of a fixed light palette", () => {
    const menuSection = getSection(".branch-context-menu {", ".commit-row {");

    expect(menuSection).toContain("border: 1px solid var(--surface-border-strong);");
    expect(menuSection).toContain("rgb(var(--theme-elevated-strong-rgb) / 0.94)");
    expect(menuSection).toContain("rgb(var(--theme-elevated-rgb) / 0.9)");
    expect(menuSection).toContain("color: var(--text-primary);");
    expect(menuSection).toContain("background: var(--list-hover-bg);");
    expect(menuSection).toContain("border-top: 1px solid var(--surface-border);");
    expect(menuSection).not.toContain("rgba(255, 255, 255, 0.97)");
    expect(menuSection).not.toContain("rgba(244, 247, 252, 0.95)");
  });

  test("branch rows expose dedicated local and remote icon styles with dark-theme overrides", () => {
    const branchBadgeSection = getSection(".branch-list-item__content {", ".branch-tree__hint {");

    expect(branchBadgeSection).toContain(".branch-list-item {");
    expect(branchBadgeSection).toContain(".branch-list-item__trigger {");
    expect(branchBadgeSection).toContain(".branch-list-item__pr-link {");
    expect(branchBadgeSection).toContain("width: 24px;");
    expect(branchBadgeSection).toContain("height: 24px;");
    expect(branchBadgeSection).toContain(".branch-list-item__icon {");
    expect(branchBadgeSection).toContain(".branch-list-item__icon--local {");
    expect(branchBadgeSection).toContain("rgb(29 78 216 / 0.92)");
    expect(branchBadgeSection).toContain(".branch-list-item__icon--remote {");
    expect(branchBadgeSection).toContain("rgb(15 118 110 / 0.96)");
    expect(branchBadgeSection).toContain(".branch-list-item__header {");
    expect(branchBadgeSection).toContain(".list-item.active .branch-list-item__icon {");
    expect(branchBadgeSection).toContain(".list-item.active .branch-list-item__pr-link {");
    expect(branchBadgeSection).toContain(
      'body[data-theme="default-dark"] .branch-list-item__icon--local {',
    );
    expect(branchBadgeSection).toContain(
      'body[data-theme="default-dark"] .branch-list-item__icon--remote {',
    );
    expect(branchBadgeSection).not.toContain(".branch-list-item__ref-badge {");
  });

  test("branch tree keeps stashes in a dedicated footer below the main branch scroll area", () => {
    const stashFooterSection = getSection(".branch-tree__body {", ".branch-tree__stash-item {");

    expect(stashFooterSection).toContain(".branch-tree__branch-scroll {");
    expect(stashFooterSection).toContain("flex: 1 1 auto;");
    expect(stashFooterSection).toContain("overflow-y: auto;");
    expect(stashFooterSection).toContain(".branch-tree__stash-section {");
    expect(stashFooterSection).toContain("flex-shrink: 0;");
    expect(stashFooterSection).toContain("margin-top: 16px;");
    expect(stashFooterSection).toContain(".branch-tree__stash-list {");
    expect(stashFooterSection).toContain("max-height: min(40vh, 240px);");
  });

  test("config commit prompt textarea can shrink within the panel and wrap long lines", () => {
    const promptSection = getSection(".config-view__commit-title-prompt {", ".button {");

    expect(promptSection).toContain("min-width: 0;");
    expect(promptSection).toContain("max-width: 100%;");
    expect(promptSection).toContain("white-space: pre-wrap;");
    expect(promptSection).toContain("overflow-wrap: anywhere;");
    expect(promptSection).toContain("word-break: break-word;");
  });

  test("input-select strips native select chrome and adds the shared chevron affordance", () => {
    const inputSection = getSection(".input {", ".config-view__commit-title-prompt {");

    expect(inputSection).toContain(".input-select {");
    expect(inputSection).toContain("appearance: none;");
    expect(inputSection).toContain("-webkit-appearance: none;");
    expect(inputSection).toContain("padding-right: 40px;");
    expect(inputSection).toContain("background-image:");
    expect(inputSection).toContain(".input-select:disabled {");
    expect(inputSection).toContain("cursor: not-allowed;");
  });

  test("config view combobox renders an integrated control and elevated option menu", () => {
    const inputSection = getSection(".input {", ".config-view__commit-title-prompt {");

    expect(inputSection).toContain(".config-view__combobox {");
    expect(inputSection).toContain(".config-view__combobox-control {");
    expect(inputSection).toContain(".config-view__combobox-control:focus-within,");
    expect(inputSection).toContain(".config-view__combobox-input {");
    expect(inputSection).toContain(".config-view__combobox-toggle {");
    expect(inputSection).toContain(".config-view__combobox-menu {");
    expect(inputSection).toContain("backdrop-filter: blur(18px) saturate(170%);");
    expect(inputSection).toContain(".config-view__combobox-option.is-selected {");
    expect(inputSection).toContain(".config-view__combobox-empty {");
  });

  test("working tree context menu uses the same theme tokens as floating branch actions", () => {
    const menuSection = getSection(".working-tree-context-menu {", ".branch-context-menu {");

    expect(menuSection).toContain("border: 1px solid var(--surface-border-strong);");
    expect(menuSection).toContain("rgb(var(--theme-elevated-strong-rgb) / 0.94)");
    expect(menuSection).toContain("rgb(var(--theme-elevated-rgb) / 0.9)");
    expect(menuSection).toContain("color: var(--text-primary);");
    expect(menuSection).not.toContain("rgba(255, 255, 255, 0.97)");
    expect(menuSection).not.toContain("rgba(244, 247, 252, 0.95)");
  });

  test("wip row removes its default highlight while keeping dedicated hover and dark-theme overrides", () => {
    const wipSection = getSection(".wip-row {", ".wip-node {");

    expect(wipSection).toContain("background: transparent !important;");
    expect(wipSection).toContain(".wip-row__badge {");
    expect(wipSection).toContain(".wip-row__primary {");
    expect(wipSection).toContain(".wip-row__meta {");
    expect(wipSection).toContain(".wip-row:hover {");
    expect(wipSection).toContain("background: rgb(255 251 235 / 0.72) !important;");
    expect(wipSection).toContain('body[data-theme="default-dark"] .wip-row {');
    expect(wipSection).toContain('body[data-theme="default-dark"] .wip-row:hover {');
    expect(wipSection).toContain('body[data-theme="default-dark"] .wip-row__badge {');
    expect(wipSection).toContain('body[data-theme="default-dark"] .wip-row__meta {');
    expect(wipSection).toContain(
      "background: linear-gradient(90deg, rgb(120 53 15 / 0.2), rgb(68 64 60 / 0.24)) !important;",
    );
    expect(wipSection).toContain("color: rgb(254 243 199 / 0.82);");
  });

  test("commit graph ref badges reserve space for icons and keep themed variants", () => {
    const refBadgeSection = getSection(".commit-graph__ref-badge {", ".commit-row:hover {");

    expect(refBadgeSection).toContain("gap: 4px;");
    expect(refBadgeSection).toContain(".commit-graph__ref-badge-icon {");
    expect(refBadgeSection).toContain("flex-shrink: 0;");
    expect(refBadgeSection).toContain(".commit-graph__ref-badge-label {");
    expect(refBadgeSection).toContain("min-width: 0;");
    expect(refBadgeSection).toContain(".commit-graph__ref-badge--head {");
    expect(refBadgeSection).toContain(".commit-graph__ref-badge--tag {");
    expect(refBadgeSection).toContain(
      'body[data-theme="default-dark"] .commit-graph__ref-badge--head {',
    );
    expect(refBadgeSection).toContain(
      'body[data-theme="default-dark"] .commit-graph__ref-badge--tag {',
    );
  });

  test("commit nodes support cached author avatars without losing the fallback node styling", () => {
    const commitNodeSection = getSection(".commit-node {", ".wip-row {");

    expect(commitNodeSection).toContain("overflow: hidden;");
    expect(commitNodeSection).toContain("pointer-events: none;");
    expect(commitNodeSection).toContain(".commit-node--avatar {");
    expect(commitNodeSection).toContain("width: 24px;");
    expect(commitNodeSection).toContain(".commit-node__avatar {");
    expect(commitNodeSection).toContain("object-fit: cover;");
  });

  test("wip node uses a hollow dashed ring instead of a filled core", () => {
    const wipNodeSection = getSection(".wip-node {", "@keyframes wip-pulse {");

    expect(wipNodeSection).toContain("color: #0071e3;");
    expect(wipNodeSection).toContain(".wip-node-ring {");
    expect(wipNodeSection).toContain("fill: none;");
    expect(wipNodeSection).toContain("stroke: currentColor;");
    expect(wipNodeSection).not.toContain(".wip-node-core {");
  });

  test("diff viewer defaults to a light palette and scopes dark styling to explicit dark-theme overrides", () => {
    const diffSection = getSection(".diff-workbench {", ".diff-empty-state,");

    expect(globalsCss).toContain("--diff-surface: #f7faff;");
    expect(globalsCss).toContain("--diff-text: #11233f;");
    expect(diffSection).toContain("rgb(var(--theme-elevated-rgb) / 0.96)");
    expect(diffSection).toContain("rgb(var(--theme-elevated-strong-rgb) / 0.88)");
    expect(diffSection).toContain("background: rgb(var(--theme-elevated-rgb) / 0.72);");
    expect(diffSection).toContain('body[data-theme="default-dark"] .diff-workbench__sidebar {');
    expect(diffSection).toContain(
      'body[data-theme="default-dark"] .diff-workbench__file-tab.is-active {',
    );
    expect(diffSection).toContain('body[data-theme="default-dark"] .diff-file__columns {');
  });

  test("branch action dialog renders PR refs as pills with a reduced-motion-safe arrow animation", () => {
    const branchActionSection = getSection(
      ".branch-action-dialog__ref-flow {",
      ".git-operation-panel__hint {",
    );

    expect(branchActionSection).toContain(".branch-action-dialog__ref-pill {");
    expect(branchActionSection).toContain("border: 1px solid rgb(var(--theme-border-rgb) / 0.12);");
    expect(branchActionSection).toContain(".branch-action-dialog__ref-label {");
    expect(branchActionSection).toContain(".branch-action-dialog__ref-value {");
    expect(branchActionSection).toContain(".branch-action-dialog__ref-arrow svg {");
    expect(branchActionSection).toContain(
      "animation: branch-action-dialog-arrow 1.8s ease-in-out infinite;",
    );
    expect(branchActionSection).toContain("@keyframes branch-action-dialog-arrow {");
    expect(branchActionSection).toContain(
      'body[data-theme="default-dark"] .branch-action-dialog__ref-pill {',
    );
    expect(branchActionSection).toContain("@media (prefers-reduced-motion: reduce) {");
    expect(branchActionSection).toContain(".branch-action-dialog__ref-arrow svg {");
    expect(branchActionSection).toContain("animation: none;");
  });

  test("AI title generation button advertises clickability and switches to a progress cursor while loading", () => {
    const titleActionSection = getSection(
      ".git-operation-panel__title-action {",
      ".git-operation-panel__title-input.is-over-limit {",
    );

    expect(titleActionSection).toContain("cursor: pointer;");
    expect(titleActionSection).toContain(".git-operation-panel__title-action--generating {");
    expect(titleActionSection).toContain("cursor: progress;");
    expect(titleActionSection).toContain(".git-operation-panel__title-action:disabled {");
    expect(titleActionSection).toContain("cursor: not-allowed;");
  });

  test("commit button animates its icon only while the action is enabled and respects reduced motion", () => {
    const gitOperationSection = getSection(
      "@keyframes commit-submit-breathe {",
      ".git-operation-panel__title-input.is-over-limit {",
    );

    expect(gitOperationSection).toContain(".git-operation-panel__commit-submit-icon {");
    expect(gitOperationSection).toContain("transform-origin: center;");
    expect(gitOperationSection).toContain("transform: scale(1.18);");
    expect(gitOperationSection).toContain("drop-shadow(0 0 18px rgba(166, 214, 255, 0.2))");
    expect(gitOperationSection).toContain(".git-operation-panel__commit-actions");
    expect(gitOperationSection).toContain(".button:not(:disabled)");
    expect(gitOperationSection).toContain(
      "animation: commit-submit-breathe 2.2s ease-in-out infinite;",
    );
    expect(gitOperationSection).toContain("@media (prefers-reduced-motion: reduce) {");
    expect(gitOperationSection).toContain(".git-operation-panel__commit-actions");
    expect(gitOperationSection).toContain("animation: none;");
  });
});
