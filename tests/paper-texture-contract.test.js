import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const STYLE_FILES = [
  'desktop/src/styles.css',
  'desktop/src/react/settings/Settings.module.css',
  'desktop/src/settings.html',
];

describe('paper texture contract', () => {
  it.each(STYLE_FILES)('%s opts into texture with body.paper-texture', (rel) => {
    const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');

    expect(content).toContain('body.paper-texture');
    expect(content).not.toContain('body:not(.no-paper-texture)');
  });
});
