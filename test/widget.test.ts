import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { renderWidget, widgetCommand, WIDGET_ID } from '../src/widget.js';

const original = process.env.LILCAL_DATA;
afterEach(() => {
  if (original === undefined) delete process.env.LILCAL_DATA;
  else process.env.LILCAL_DATA = original;
});

describe('plasma widget package', () => {
  it('renders the package with an absolute, quoted command in the config default', () => {
    process.env.LILCAL_DATA = "./it's data/items.json";
    const dir = mkdtempSync(join(tmpdir(), 'lilcal-widget-test-'));
    try {
      const pkg = renderWidget(join(dir, WIDGET_ID));
      const metadata = JSON.parse(readFileSync(join(pkg, 'metadata.json'), 'utf8')) as { KPlugin: { Id: string } };
      expect(metadata.KPlugin.Id).toBe(WIDGET_ID);
      const config = readFileSync(join(pkg, 'contents', 'config', 'main.xml'), 'utf8');
      expect(config).not.toContain('__LILCAL_COMMAND__');
      expect(config).toContain(`LILCAL_DATA=${resolve("./it's data/items.json")}`.replace("'", "'\\''").replace(/&/g, '&amp;'));
      expect(config).toContain(`'${resolve('src/cli.ts')}'`);
      expect(widgetCommand()).toMatch(/^env 'LILCAL_DATA=.*' 'LILCAL_PI=.*' '.*' '.*cli\.ts'$/);
      const qml = readFileSync(join(pkg, 'contents', 'ui', 'main.qml'), 'utf8');
      expect(qml).toContain('status --json');
      expect(qml).toContain('" pi "');
      expect(qml).toContain('media-playback-start');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
