import { beforeEach, describe, expect, it } from 'bun:test';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { Item } from '../src/model.js';
import { piLaunch, terminalPrefix } from '../src/open.js';
import { useTempStore } from './helpers.js';

beforeEach(() => { useTempStore(); });

const item: Item = { id: 'abc', title: 'Ship it', at: '2026-09-04T23:00:00+02:00', createdAt: '2026-09-01T00:00:00+02:00', prompt: 'run the release', notes: 'branch main' };

describe('terminalPrefix', () => {
  it('prefers LILCAL_TERMINAL, then TERMINAL, then known terminals on PATH', () => {
    expect(terminalPrefix({ LILCAL_TERMINAL: '/opt/bin/konsole', TERMINAL: 'kitty' })).toEqual(['/opt/bin/konsole', '-e']);
    expect(terminalPrefix({ TERMINAL: 'kitty' })).toEqual(['kitty']);
    expect(terminalPrefix({ TERMINAL: 'st' })).toEqual(['st', '-e']);
    expect(terminalPrefix({}, (name) => name === 'alacritty' ? '/usr/bin/alacritty' : null)).toEqual(['/usr/bin/alacritty', '-e']);
    expect(() => terminalPrefix({}, () => null)).toThrow(/no terminal/);
  });
});

describe('piLaunch', () => {
  it('runs pi in the terminal with the task prompt, cwd, and data path', () => {
    const launch = piLaunch(item, { TERMINAL: 'kitty', LILCAL_PI: './bin/pi' });
    expect(launch.argv.slice(0, 3)).toEqual(['kitty', resolve('./bin/pi'), '--']);
    expect(launch.argv[3]).toContain('Scheduled event: Ship it');
    expect(launch.argv[3]).toContain('Context: branch main');
    expect(launch.argv[3]).toEndWith('Task:\nrun the release');
    expect(launch.cwd).toBe(homedir());
    expect(launch.env.LILCAL_DATA).toBe(resolve(process.env.LILCAL_DATA!));
    expect(piLaunch({ ...item, cwd: '/tmp' }, { TERMINAL: 'kitty' }).cwd).toBe('/tmp');
    expect(piLaunch({ ...item, cwd: '/tmp' }, { TERMINAL: 'kitty' }).argv[1]).toBe('pi');
  });

  it('refuses items without a prompt', () => {
    expect(() => piLaunch({ ...item, prompt: undefined }, { TERMINAL: 'kitty' })).toThrow(/no prompt/);
    expect(() => piLaunch({ ...item, prompt: '  ' }, { TERMINAL: 'kitty' })).toThrow(/no prompt/);
  });
});
