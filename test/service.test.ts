import { afterEach, describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { unitText } from '../src/service.js';

const original = { PATH: process.env.PATH, LILCAL_PI: process.env.LILCAL_PI, LILCAL_DATA: process.env.LILCAL_DATA };
afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('task service environment', () => {
  it('captures executable search and data paths for background runs', () => {
    process.env.PATH = '/custom/bin:/usr/bin';
    process.env.LILCAL_PI = './pi wrapper';
    process.env.LILCAL_DATA = './calendar data/items.json';
    const unit = unitText();
    expect(unit).toContain('Environment="PATH=/custom/bin:/usr/bin"');
    expect(unit).toContain(`Environment="LILCAL_PI=${resolve('./pi wrapper')}"`);
    expect(unit).toContain(`Environment="LILCAL_DATA=${resolve('./calendar data/items.json')}"`);
    expect(unit).toContain('KillMode=control-group');
  });

  it('escapes systemd specifiers and quotes without expanding environment dollars', () => {
    process.env.LILCAL_PI = '/bin/pi%test"$name';
    expect(unitText()).toContain('Environment="LILCAL_PI=/bin/pi%%test\\"$name"');
  });
});
