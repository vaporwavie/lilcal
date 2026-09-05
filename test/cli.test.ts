import { beforeEach, describe, expect, it } from 'bun:test';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { Item } from '../src/model.js';
import { update } from '../src/store.js';
import { NOW, useTempStore } from './helpers.js';

beforeEach(() => { useTempStore(); });

async function cli(...args: string[]): Promise<string> {
  const child = Bun.spawn([process.execPath, resolve('src/cli.ts'), ...args], {
    env: { ...process.env },
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
