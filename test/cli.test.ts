import { beforeEach, describe, expect, it } from 'bun:test';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { Item } from '../src/model.js';
import { update } from '../src/store.js';
import { NOW, useTempStore } from './helpers.js';

beforeEach(() => { useTempStore(); });

async function cli(...args: string[]): Promise<string> {
  return cliWith({}, ...args);
}

async function cliWith(env: Record<string, string>, ...args: string[]): Promise<string> {
  const child = Bun.spawn([process.execPath, resolve('src/cli.ts'), ...args], {
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exit !== 0) throw new Error(stderr || `CLI exited ${exit}`);
  return stdout;
}

describe('CLI recurring events', () => {
  it('adds, displays, edits, and clears repeat using existing commands', async () => {
    const item = JSON.parse(await cli('add', 'Standup', '--at', '2026-09-12T10:00', '--repeat', 'weekly', '--json')) as Item;
    expect(item.repeat).toEqual({ frequency: 'weekly', interval: 1, anchor: item.at });
    expect(await cli('list')).toContain('[repeat: weekly]');
    expect(await cli('show', item.id)).toContain('weekly');
    const changed = JSON.parse(await cli('edit', item.id, '--repeat', 'every 2 months', '--json')) as Item;
    expect(changed.repeat?.interval).toBe(2);
    expect(changed.repeat?.frequency).toBe('monthly');
    expect(await cli('list')).toContain('[repeat: every 2 months]');
    const cleared = JSON.parse(await cli('edit', item.id, '--repeat', '', '--json')) as Item;
    expect(cleared.repeat).toBeUndefined();
    await expect(cli('add', 'Invalid', '--at', 'tomorrow', '--repeat', 'never')).rejects.toThrow(/repeat/);
    expect(await cli('--help')).toContain('--repeat');
  });
});

describe('CLI pi tasks', () => {
  it('plumbs prompt/cwd through add, edit, list, and show with execution results', async () => {
    const item = JSON.parse(await cli('add', 'Report', '--at', '2026-09-12T10:00', '--prompt', '  Summarize logs  ', '--cwd', '.', '--json')) as Item;
    expect(item.prompt).toBe('Summarize logs');
    expect(item.cwd).toBe(resolve('.'));
    expect(await cli('list')).toContain('[pi: scheduled]');
    expect((JSON.parse(await cli('list', '-q', 'LOGS', '--json')) as Item[])[0]!.id).toBe(item.id);
    const run = {
      id: 'pi-run',
      status: 'failed' as const,
      startedAt: NOW.toISOString(),
      deadlineAt: NOW.toISOString(),
      finishedAt: NOW.toISOString(),
      output: 'Partial report\nMore detail',
      error: 'pi failed',
    };
    await update((items) => { items[0]!.run = run; });
    const detail = await cli('show', item.id);
    expect(detail).toContain('[pi: failed]');
    expect(detail).toContain('Partial report');
    expect(detail).toContain('More detail');
    expect(detail).toContain('pi failed');
    expect(detail).toContain('pi-run');
    expect((JSON.parse(await cli('show', item.id, '--json')) as Item).run).toEqual(run);
    const changed = JSON.parse(await cli('edit', item.id, '--prompt', 'Revise report', '--cwd', '', '--json')) as Item;
    expect(changed.prompt).toBe('Revise report');
    expect(changed.cwd).toBe(homedir());
    expect(changed.run).toEqual(run);
    const cleared = JSON.parse(await cli('edit', item.id, '--prompt', '', '--json')) as Item;
    expect(cleared.prompt).toBeUndefined();
    expect(cleared.cwd).toBeUndefined();
    expect(cleared.run).toEqual(run);
    expect(await cli('show', item.id)).toContain('Partial report');
  });

  it('rejects empty add prompts and directories without a task', async () => {
    await expect(cli('add', 'Task', '--at', 'tomorrow', '--prompt', '')).rejects.toThrow(/prompt is empty/);
    await expect(cli('add', 'Task', '--at', 'tomorrow', '--cwd', '.')).rejects.toThrow(/cwd requires a prompt/);
  });
});

describe('CLI status and digest', () => {
  it('prints the one-line status and the JSON the widget reads', async () => {
    await cli('add', 'Late', '--at', '2026-09-01T09:00');
    const line = await cli('status');
    expect(line).toMatch(/^1 overdue · Late /);
    expect((await cli('status', '--width', '12')).trim()).toBe('1 overdue ·…');
    const status = JSON.parse(await cli('status', '--json')) as { overdue: { id: string }[]; line: string };
    expect(status.overdue).toHaveLength(1);
    expect(status.line).toBe(line.trim());
  });

  it('configures, previews, and clears the digest', async () => {
    expect((await cli('digest')).startsWith('digest off')).toBe(true);
    expect(await cli('digest', '8:30')).toContain('digest daily at 08:30');
    expect(await cli('digest')).toContain('digest daily at 08:30');
    expect(await cli('digest')).toContain('Nothing scheduled today.');
    const json = JSON.parse(await cli('digest', '--json')) as { time: string; preview: { summary: string } };
    expect(json.time).toBe('08:30');
    expect(json.preview.summary).toMatch(/0 today/);
    await expect(cli('digest', 'noon')).rejects.toThrow(/HH:MM/);
    expect(await cli('digest', 'off')).toContain('digest off');
    expect(await cli('--help')).toContain('lilcal status');
  });
});

describe('CLI pi', () => {
  it('opens a terminal running pi with the task prompt and rejects plain reminders', async () => {
    const fake = resolve(process.env.LILCAL_DATA!, '..', 'term.sh');
    await Bun.write(fake, '#!/bin/sh\nprintf "%s\\n" "$@" > "$(dirname "$0")/term.log"\n');
    await Bun.$`chmod +x ${fake}`;
    const env = { LILCAL_TERMINAL: fake, LILCAL_PI: '/opt/pi' };
    const task = JSON.parse(await cli('add', 'Deploy', '--at', '2026-09-12T10:00', '--prompt', 'ship it', '--json')) as Item;
    const plain = JSON.parse(await cli('add', 'Call', '--at', '2026-09-12T11:00', '--json')) as Item;
    const argv = JSON.parse(await cliWith(env, 'pi', task.id, '--json')) as string[];
    expect(argv.slice(0, 4)).toEqual([fake, '-e', '/opt/pi', '--']);
    expect(argv[4]).toContain('Task:\nship it');
    await Bun.sleep(200);
    expect(await Bun.file(resolve(fake, '..', 'term.log')).text()).toContain('/opt/pi');
    await expect(cliWith(env, 'pi', plain.id)).rejects.toThrow(/no prompt/);
    await expect(cliWith(env, 'pi')).rejects.toThrow(/needs an id/);
  });
});
