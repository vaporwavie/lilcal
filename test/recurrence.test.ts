import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { addItem, completeItem, getItem, listItems, removeItem, updateItem } from '../src/commands.js';
import { tick } from '../src/daemon.js';
import { toISO } from '../src/dates.js';
import { nextOccurrence, parseRepeat } from '../src/recurrence.js';
import { load } from '../src/store.js';
import { NOW, useTempStore } from './helpers.js';

beforeEach(() => { useTempStore(); });

const next = (repeat: string, anchor: string, after = anchor) =>
  toISO(nextOccurrence(parseRepeat(repeat, anchor), new Date(after)));

describe('recurrence dates', () => {
  it('supports daily, weekly, monthly, yearly, and explicit intervals', () => {
    const anchor = '2026-09-04T09:00:00+02:00';
    expect(next('daily', anchor)).toBe('2026-09-05T09:00:00+02:00');
    expect(next('weekly', anchor)).toBe('2026-09-11T09:00:00+02:00');
    expect(next('monthly', anchor)).toBe('2026-10-04T09:00:00+02:00');
    expect(next('yearly', anchor)).toBe('2027-09-04T09:00:00+02:00');
    expect(next('every 2 weeks', anchor)).toBe('2026-09-18T09:00:00+02:00');
    expect(next('every 3 months', anchor)).toBe('2026-12-04T09:00:00+01:00');
    expect(next('every 2 years', anchor)).toBe('2028-09-04T09:00:00+02:00');
    expect(parseRepeat(' DAILY ', anchor).frequency).toBe('daily');
  });

  it('clamps month ends without changing the original day', () => {
    const anchor = '2026-01-31T10:00:00+01:00';
    expect(next('monthly', anchor)).toBe('2026-02-28T10:00:00+01:00');
    expect(next('monthly', anchor, '2026-02-28T10:00:00+01:00')).toBe('2026-03-31T10:00:00+02:00');
    expect(next('monthly', anchor, '2026-12-31T10:00:00+01:00')).toBe('2027-01-31T10:00:00+01:00');
  });

  it('restores leap day in leap years', () => {
    const anchor = '2024-02-29T09:00:00+01:00';
    expect(next('yearly', anchor)).toBe('2025-02-28T09:00:00+01:00');
    expect(next('yearly', anchor, '2027-02-28T09:00:00+01:00')).toBe('2028-02-29T09:00:00+01:00');
  });

  it('keeps local wall time across both DST transitions', () => {
    expect(next('daily', '2026-03-28T09:00:00+01:00')).toBe('2026-03-29T09:00:00+02:00');
    expect(next('daily', '2026-10-24T09:00:00+02:00')).toBe('2026-10-25T09:00:00+01:00');
    const anchor = '2026-03-28T02:30:00+01:00';
    expect(next('daily', anchor)).toBe('2026-03-29T03:30:00+02:00');
    expect(next('daily', anchor, '2026-03-29T03:30:00+02:00')).toBe('2026-03-30T02:30:00+02:00');
  });

  it('skips missed periods and treats the cutoff as exclusive', () => {
    const anchor = '2000-01-01T09:00:00+01:00';
    expect(next('daily', anchor, '2026-09-04T08:59:59+02:00')).toBe('2026-09-04T09:00:00+02:00');
    expect(next('daily', anchor, '2026-09-04T09:00:00+02:00')).toBe('2026-09-05T09:00:00+02:00');
  });

  it('rejects invalid rules and unrepresentable intervals', () => {
    for (const repeat of ['', 'sometimes', 'every 0 days', 'every -1 weeks', 'every 1.5 months', 'every 999999999999999999 years']) {
      expect(() => parseRepeat(repeat, NOW.toISOString())).toThrow(/repeat/);
    }
    expect(() => parseRepeat('daily', 'invalid')).toThrow(/anchor/);
  });
});

describe('recurring item API', () => {
  it('persists recurrence through the existing store and filters', async () => {
    const item = await addItem({ title: 'Standup', at: 'tomorrow', repeat: 'every 2 weeks', tags: ['work'] }, NOW);
    expect(item.repeat).toEqual({ frequency: 'weekly', interval: 2, anchor: item.at });
    expect(item.allDay).toBe(true);
    expect(await getItem(item.id)).toEqual(item);
    expect(await listItems({ tag: 'work', query: 'standup' })).toEqual([item]);
  });

  it('edits, re-anchors, and clears recurrence without affecting other metadata', async () => {
    const item = await addItem({ title: 'Standup', at: 'tomorrow', repeat: 'daily' }, NOW);
    const changed = await updateItem(item.id, { repeat: 'weekly', notes: 'Context' }, NOW);
    expect(changed.repeat?.frequency).toBe('weekly');
    const moved = await updateItem(item.id, { at: '2026-09-12T11:00' }, NOW);
    expect(moved.repeat?.anchor).toBe(moved.at);
    expect(moved.notes).toBe('Context');
    expect((await updateItem(item.id, { repeat: null }, NOW)).repeat).toBeUndefined();
  });

  it('rejects invalid changes atomically and does not opt pi tasks into repeated execution', async () => {
    await expect(addItem({ title: 'Invalid', at: 'tomorrow', repeat: 'never' }, NOW)).rejects.toThrow(/repeat/);
    await expect(addItem({ title: 'Task', at: 'tomorrow', repeat: 'daily', prompt: 'Work' }, NOW)).rejects.toThrow(/pi tasks/);
    expect(await load()).toEqual([]);
    const item = await addItem({ title: 'Standup', at: 'tomorrow', repeat: 'daily' }, NOW);
    await expect(updateItem(item.id, { title: 'Wrong', repeat: 'every 0 days' }, NOW)).rejects.toThrow(/repeat/);
    await expect(updateItem(item.id, { prompt: 'Work' }, NOW)).rejects.toThrow(/pi tasks/);
    expect(await getItem(item.id)).toEqual(item);
    const task = await updateItem(item.id, { repeat: null, prompt: 'Work' }, NOW);
    expect(task.prompt).toBe('Work');
    await expect(updateItem(item.id, { repeat: 'daily' }, NOW)).rejects.toThrow(/pi tasks/);
  });
});

describe('recurring notifications', () => {
  const add = (extra: Partial<Parameters<typeof addItem>[0]> = {}) => addItem({
    title: 'Standup', at: '2026-09-04T22:30', repeat: 'daily', ...extra,
  }, NOW);

  it('advances the same item after delivery, preserving duration and metadata', async () => {
    const item = await add({ end: '23:30', notes: 'Context', tags: ['work'] });
    const send = mock(async () => 1);
    const first = await tick(NOW.getTime(), send);
    expect(first.notified[0]?.at).toBe(item.at);
    const saved = await getItem(item.id);
    expect(saved).toEqual({ ...item, at: '2026-09-05T22:30:00+02:00', end: '2026-09-05T23:30:00+02:00' });
    expect(await load()).toHaveLength(1);
    await tick(NOW.getTime(), send);
    expect(send).toHaveBeenCalledTimes(1);
    await tick(new Date(saved.at).getTime(), send);
    expect(send).toHaveBeenCalledTimes(2);
    expect((await getItem(item.id)).at).toBe('2026-09-06T22:30:00+02:00');
  });

  it('keeps an advance-notified occurrence visible until its start', async () => {
    const item = await add({ at: '2026-09-04T23:00', lead: 30 });
    const send = mock(async () => 1);
    await tick(NOW.getTime(), send);
    expect((await getItem(item.id)).at).toBe(item.at);
    expect((await getItem(item.id)).notifiedAt).toBeDefined();
    await tick(NOW.getTime(), send);
    await tick(new Date(item.at).getTime(), send);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await getItem(item.id)).at).toBe('2026-09-05T23:00:00+02:00');
    await tick(new Date('2026-09-05T22:30:00+02:00').getTime(), send);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('retries failures and catches up once rather than flooding missed occurrences', async () => {
    const item = await add({ at: '2020-01-01' });
    const failed = await tick(NOW.getTime(), async () => { throw new Error('no bus'); });
    expect(failed.failed).toHaveLength(1);
    expect(await getItem(item.id)).toEqual(item);
    const send = mock(async () => 1);
    await tick(NOW.getTime(), send);
    expect(send).toHaveBeenCalledTimes(1);
    const saved = await getItem(item.id);
    expect(saved.at).toBe('2026-09-05T09:00:00+02:00');
    expect(saved.allDay).toBe(true);
    expect(saved.repeat?.anchor).toBe(item.at);
  });

  it('stops on done or removal and resumes when reopened', async () => {
    const item = await add();
    const send = mock(async () => 1);
    await completeItem(item.id);
    await tick(NOW.getTime(), send);
    expect(send).not.toHaveBeenCalled();
    expect((await getItem(item.id)).at).toBe(item.at);
    await completeItem(item.id, false);
    await tick(NOW.getTime(), send);
    expect(send).toHaveBeenCalledTimes(1);
    await removeItem(item.id);
    await tick(new Date('2026-09-06T23:00:00+02:00').getTime(), send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await load()).toEqual([]);
  });

  it('does not advance a schedule edited while notification delivery is in progress', async () => {
    const item = await add();
    await tick(NOW.getTime(), async () => {
      await updateItem(item.id, { at: '2026-09-20T10:00' }, NOW);
      return 1;
    });
    const saved = await getItem(item.id);
    expect(saved.at).toBe('2026-09-20T10:00:00+02:00');
    expect(saved.repeat?.anchor).toBe(saved.at);
    expect(saved.notifiedAt).toBeUndefined();
  });

  it('does not advance twice when ticks overlap', async () => {
    const item = await add();
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const first = tick(NOW.getTime(), async () => { started(); await waiting; return 1; });
    await ready;
    try {
      await tick(NOW.getTime(), async () => 2);
    } finally {
      release();
      await first;
    }
    expect((await getItem(item.id)).at).toBe('2026-09-05T22:30:00+02:00');
  });
});
