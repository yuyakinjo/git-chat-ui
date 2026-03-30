import { describe, expect, test } from 'bun:test';

const globalsCss = await Bun.file(new URL('./globals.css', import.meta.url)).text();

function getSection(startMarker: string, endMarker: string): string {
  const start = globalsCss.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);

  const end = globalsCss.indexOf(endMarker, start + startMarker.length);
  expect(end).toBeGreaterThan(start);

  return globalsCss.slice(start, end);
}

describe('globals.css', () => {
  test('branch context menu uses theme tokens instead of a fixed light palette', () => {
    const menuSection = getSection('.branch-context-menu {', '.commit-row {');

    expect(menuSection).toContain('border: 1px solid var(--surface-border-strong);');
    expect(menuSection).toContain(
      'background: linear-gradient(148deg, rgb(var(--theme-elevated-strong-rgb) / 0.94), rgb(var(--theme-elevated-rgb) / 0.9));'
    );
    expect(menuSection).toContain('color: var(--text-primary);');
    expect(menuSection).toContain('background: var(--list-hover-bg);');
    expect(menuSection).toContain('border-top: 1px solid var(--surface-border);');
    expect(menuSection).not.toContain('rgba(255, 255, 255, 0.97)');
    expect(menuSection).not.toContain('rgba(244, 247, 252, 0.95)');
  });

  test('wip row defines dedicated dark theme contrast overrides', () => {
    const wipSection = getSection('.wip-row {', '.wip-node {');

    expect(wipSection).toContain('.wip-row__badge {');
    expect(wipSection).toContain('.wip-row__primary {');
    expect(wipSection).toContain('.wip-row__meta {');
    expect(wipSection).toContain("body[data-theme='default-dark'] .wip-row {");
    expect(wipSection).toContain("body[data-theme='default-dark'] .wip-row__badge {");
    expect(wipSection).toContain("body[data-theme='default-dark'] .wip-row__meta {");
    expect(wipSection).toContain('background: linear-gradient(90deg, rgb(120 53 15 / 0.34), rgb(68 64 60 / 0.42)) !important;');
    expect(wipSection).toContain('color: rgb(254 243 199 / 0.82);');
  });
});
