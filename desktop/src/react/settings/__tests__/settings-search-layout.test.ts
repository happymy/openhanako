import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readProjectFile(pathFromRoot: string) {
  return readFileSync(join(process.cwd(), pathFromRoot), 'utf8');
}

function cssRule(source: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? '';
}

describe('settings search sidebar layout', () => {
  it('uses a 180px settings navigation rail', () => {
    const css = readProjectFile('desktop/src/react/settings/Settings.module.css');

    expect(css).toContain('--settings-nav-width: 180px;');
  });

  it('keeps the modal shell wide enough after expanding the navigation rail', () => {
    const css = readProjectFile('desktop/src/react/components/SettingsModalShell.module.css');

    expect(css).toContain('width: min(884px, calc(100vw - 2 * var(--space-24)));');
  });
});

describe('settings providers wide layout does not stretch the modal', () => {
  it('uses a flexible header main column instead of a 960px intrinsic max track', () => {
    const css = readProjectFile('desktop/src/react/settings/Settings.module.css');
    const header = cssRule(css, '.settings-header-modal');

    // Fixed px max tracks (640/960) inflate the flex item min-content and stretch
    // the 884px settings modal when providers/plugin-marketplace are marked wide.
    expect(header).toMatch(/minmax\(0,\s*1fr\)/);
    expect(header).not.toMatch(/minmax\(0,\s*640px\)/);
    expect(css).not.toMatch(
      /\.settings-panel-wide\.settings-panel-modal\s+\.settings-header-modal\s*\{[^}]*minmax\(0,\s*960px\)/,
    );
  });

  it('caps the settings modal card so content cannot grow past the designed width', () => {
    const css = readProjectFile('desktop/src/react/components/SettingsModalShell.module.css');
    const card = cssRule(css, '.card');
    const wideCard = cssRule(css, '.card[data-wide="true"]');

    expect(card).toMatch(/min-width:\s*0;/);
    expect(card).toMatch(/max-width:\s*min\(884px,\s*calc\(100vw - 2 \* var\(--space-24\)\)\);/);
    expect(wideCard).toMatch(/max-width:\s*min\(1200px,\s*calc\(100vw - var\(--space-24\) - var\(--space-24\)\)\);/);
  });
});
