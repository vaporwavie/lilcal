import { beforeEach, describe, expect, it } from 'bun:test';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { addItem, completeItem, getItem, listItems, removeItem, updateItem } from '../src/commands.js';
import type { TaskRun } from '../src/model.js';
import { update } from '../src/store.js';
import { NOW, useTempStore } from './helpers.js';

beforeEach(() => {
  useTempStore();
});

describe('addItem', () => {
  it('takes the date from the title when --at is missing', async () => {
    const item = await addItem({ title: 'call mom sunday 6pm', tags: ['Family,home'] }, NOW);
    expect(item.title).toBe('call mom');
    expect(item.at).toBe('2026-09-06T18:00:00+02:00');
    expect(item.allDay).toBeUndefined();
    expect(item.tags).toEqual(['family', 'home']);
  });

  it('uses --at and resolves a relative end on the same day', async () => {
    const item = await addItem({ title: 'Dentist', at: '2026-09-12T15:00', end: '4pm' }, NOW);
    expect(item.at).toBe('2026-09-12T15:00:00+02:00');
    expect(item.end).toBe('2026-09-12T16:00:00+02:00');
  });

  it('falls back to the given day as an all-day item', async () => {
    const item = await addItem({ title: 'Water plants', fallbackDay: new Date(2026, 8, 20) }, NOW);
    expect(item.allDay).toBe(true);
    expect(item.at).toBe('2026-09-20T09:00:00+02:00');
  });

  it('rejects titles without any date', async () => {
    await expect(addItem({ title: 'buy milk' }, NOW)).rejects.toThrow(/no date/);
  });

  it('rejects an end before the start', async () => {
    await expect(addItem({ title: 'x', at: '2026-09-12T15:00', end: '2026-09-12T14:00' }, NOW)).rejects.toThrow(/before/);
  });
});

describe('listItems', () => {
  it('filters by done, range, tag, and query', async () => {
    const a = await addItem({ title: 'alpha', at: '2026-09-05T10:00', tags: ['work'] }, NOW);
    await addItem({ title: 'beta', at: '2026-09-06T10:00' }, NOW);
    const c = await addItem({ title: 'gamma', at: '2026-09-07T10:00', notes: 'alpha-ish' }, NOW);
    await completeItem(c.id);
    expect((await listItems()).map((i) => i.title)).toEqual(['alpha', 'beta']);
    expect((await listItems({ includeDone: true })).map((i) => i.title)).toEqual(['alpha', 'beta', 'gamma']);
    expect((await listItems({ tag: '#work' })).map((i) => i.id)).toEqual([a.id]);
    expect((await listItems({ from: new Date(2026, 8, 6) })).map((i) => i.title)).toEqual(['beta']);
    expect((await listItems({ to: new Date(2026, 8, 5, 23) })).map((i) => i.title)).toEqual(['alpha']);
    expect((await listItems({ query: 'ALPHA', includeDone: true })).map((i) => i.title)).toEqual(['alpha', 'gamma']);
  });
});

describe('updateItem', () => {
  it('keeps the day for a bare time and re-arms notifications', async () => {
    const item = await addItem({ title: 'Standup', at: '2026-09-10T09:00' }, NOW);
    await updateItem(item.id, { notes: 'x' }, NOW);
    const armed = await updateItem(item.id, { at: '4pm' }, NOW);
    expect(armed.at).toBe('2026-09-10T16:00:00+02:00');
    expect(armed.notifiedAt).toBeUndefined();
  });

  it('clears fields with null and accepts id prefixes', async () => {
    const item = await addItem({ title: 'Trip', at: '2026-09-10T09:00', end: '2026-09-10T12:00', notes: 'pack' }, NOW);
    const updated = await updateItem(item.id.slice(0, 3), { end: null, notes: null, tags: [], lead: 10 }, NOW);
    expect(updated.end).toBeUndefined();
    expect(updated.notes).toBeUndefined();
    expect(updated.lead).toBe(10);
  });

  it('rejects unknown and ambiguous ids', async () => {
    await expect(getItem('nope')).rejects.toThrow(/no item/);
  });
});

describe('completeItem and removeItem', () => {
  it('toggles done and removes', async () => {
    const item = await addItem({ title: 'x', at: '2026-09-10T09:00' }, NOW);
    expect((await completeItem(item.id)).done).toBe(true);
    expect((await completeItem(item.id, false)).done).toBeUndefined();
    await removeItem(item.id);
    expect(await listItems()).toEqual([]);
  });
});

describe('scheduled pi tasks', () => {
  const finishedRun: TaskRun = {
    id: 'run-1',
    status: 'succeeded',
    startedAt: NOW.toISOString(),
    deadlineAt: new Date(NOW.getTime() + 60_000).toISOString(),
    finishedAt: NOW.toISOString(),
    output: 'Report ready',
  };

  it('trims prompts, defaults cwd to home, resolves relative directories, and searches prompts', async () => {
    const item = await addItem({ title: 'Report', at: 'tomorrow', prompt: '  Summarize deployment logs  ' }, NOW);
    expect(item.prompt).toBe('Summarize deployment logs');
    expect(item.cwd).toBe(homedir());
    expect((await listItems({ query: 'DEPLOYMENT' })).map((i) => i.id)).toEqual([item.id]);
    const changed = await updateItem(item.id, { cwd: '.' }, NOW);
    expect(changed.cwd).toBe(resolve('.'));
    expect((await updateItem(item.id, { cwd: null }, NOW)).cwd).toBe(homedir());
    const relative = await addItem({ title: 'Test', at: 'tomorrow', prompt: 'Run tests', cwd: 'test/..' }, NOW);
    expect(relative.cwd).toBe(resolve('.'));
  });

  it('rejects empty prompts, cwd without prompt, missing directories, and files as cwd', async () => {
    for (const input of [
      { prompt: '' },
      { prompt: '   ' },
      { cwd: '.' },
      { prompt: 'Run tests', cwd: '' },
      { prompt: 'Run tests', cwd: 'no-such-task-directory' },
      { prompt: 'Run tests', cwd: 'package.json' },
    ]) {
      await expect(addItem({ title: 'Test', at: 'tomorrow', ...input }, NOW)).rejects.toThrow();
    }
    expect(await listItems()).toEqual([]);
    const item = await addItem({ title: 'Test', at: 'tomorrow' }, NOW);
    await expect(updateItem(item.id, { cwd: '.' }, NOW)).rejects.toThrow(/requires a prompt/);
    await expect(updateItem(item.id, { prompt: ' ' }, NOW)).rejects.toThrow(/prompt is empty/);
    await updateItem(item.id, { prompt: 'Run tests' }, NOW);
    await expect(updateItem(item.id, { cwd: 'package.json' }, NOW)).rejects.toThrow(/existing directory/);
    expect((await getItem(item.id)).cwd).toBe(homedir());
  });

  it('retains execution history through metadata edits and clearing a task, but re-arms on explicit at', async () => {
    const item = await addItem({ title: 'Report', at: 'tomorrow', prompt: 'Write report', cwd: '.' }, NOW);
    await update((items) => {
      items[0]!.run = finishedRun;
      items[0]!.notifiedAt = NOW.toISOString();
    });
    const edited = await updateItem(item.id, { title: 'New title', notes: 'Context', prompt: 'Revise report', cwd: 'test', lead: 5 }, NOW);
    expect(edited.run).toEqual(finishedRun);
    expect(edited.notifiedAt).toBe(NOW.toISOString());
    const cleared = await updateItem(item.id, { prompt: null }, NOW);
    expect(cleared.prompt).toBeUndefined();
    expect(cleared.cwd).toBeUndefined();
    expect(cleared.run).toEqual(finishedRun);
    const restored = await updateItem(item.id, { prompt: 'Write report again' }, NOW);
    expect(restored.run).toEqual(finishedRun);
    expect(restored.cwd).toBe(homedir());
    const rearmed = await updateItem(item.id, { at: item.at }, NOW);
    expect(rearmed.run).toBeUndefined();
    expect(rearmed.notifiedAt).toBeUndefined();
    expect(rearmed.prompt).toBe('Write report again');
  });

  it('blocks schedule and execution edits during a run but permits metadata, done, and removal', async () => {
    const item = await addItem({ title: 'Report', at: 'tomorrow', prompt: 'Write report' }, NOW);
    const running: TaskRun = { ...finishedRun, status: 'running', finishedAt: undefined, output: undefined };
    await update((items) => { items[0]!.run = running; });
    for (const patch of [{ at: 'next week' }, { prompt: 'Different' }, { prompt: null }, { cwd: '.' }, { cwd: null }]) {
      await expect(updateItem(item.id, patch, NOW)).rejects.toThrow(/task is running/);
    }
    const edited = await updateItem(item.id, { title: 'New title', notes: 'New context', lead: 5, tags: ['work'] }, NOW);
    expect(edited.run?.status).toBe('running');
    expect(edited.title).toBe('New title');
    expect((await completeItem(item.id)).run?.status).toBe('running');
    expect((await completeItem(item.id, false)).run?.status).toBe('running');
    expect((await removeItem(item.id)).run?.status).toBe('running');
    expect(await listItems({ includeDone: true })).toEqual([]);
  });
});
