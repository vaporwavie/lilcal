import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { addItem } from '../src/commands.js';
import { tick } from '../src/daemon.js';
import { digestDue, digestFor, parseDigestTime } from '../src/digest.js';
import { load, loadSettings, save, update, updateSettings } from '../src/store.js';
import { NOW, useTempStore } from './helpers.js';

beforeEach(() => { useTempStore(); });

describe('parseDigestTime', () => {
  it('normalizes HH:MM and rejects the rest', () => {
    expect(parseDigestTime('8:30')).toBe('08:30');
    expect(parseDigestTime(' 23:59 ')).toBe('23:59');
    expect(() => parseDigestTime('24:00')).toThrow(/HH:MM/);
    expect(() => parseDigestTime('morning')).toThrow(/HH:MM/);
  });
});

describe('digestDue', () => {
  it('fires once per day after the configured time', () => {
    expect(digestDue({}, NOW)).toBe(false);
    expect(digestDue({ digest: { time: '23:00' } }, NOW)).toBe(false);
    expect(digestDue({ digest: { time: '08:30' } }, NOW)).toBe(true);
    expect(digestDue({ digest: { time: '08:30', lastSentOn: '2026-09-04' } }, NOW)).toBe(false);
    expect(digestDue({ digest: { time: '08:30', lastSentOn: '2026-09-03' } }, NOW)).toBe(true);
  });
});

describe('digestFor', () => {
  it('lists overdue and today items with counts in the summary', async () => {
    await addItem({ title: 'Late', at: '2026-08-31T09:00', tags: ['ops'] }, NOW);
    await addItem({ title: 'Soon', at: '2026-09-04T23:00' }, NOW);
    await addItem({ title: 'Task', at: '2026-09-04T23:30', prompt: 'work' }, NOW);
    const digest = digestFor(await load(), NOW);
    expect(digest.summary).toBe('Fri 4 Sep: 2 today, 1 overdue');
    expect(digest.body).toBe('Overdue\n! Late (4 days ago) #ops\n\nToday\n23:00  Soon\n23:30  Task [pi]');
    expect(digest.urgency).toBe(1);
  });

  it('points at the next item when today is empty', async () => {
    await addItem({ title: 'Standup', at: '2026-09-07T09:00' }, NOW);
    const digest = digestFor(await load(), NOW);
    expect(digest.summary).toBe('Fri 4 Sep: 0 today');
    expect(digest.body).toBe('Nothing scheduled today.\nNext: Standup Mon 7 Sep 09:00');
  });
});

describe('settings storage', () => {
  it('survives item updates and plain saves', async () => {
    await updateSettings((settings) => { settings.digest = { time: '08:30' }; });
    await update((items) => { items.push({ id: 'a', title: 'a', at: NOW.toISOString(), createdAt: '' }); });
    expect(await loadSettings()).toEqual({ digest: { time: '08:30' } });
    expect(await load()).toHaveLength(1);
    await save([]);
    expect(await loadSettings()).toEqual({});
  });
});

describe('daemon digest', () => {
  it('sends the digest once per day and records the day', async () => {
    await addItem({ title: 'Soon', at: '2026-09-04T23:00' }, NOW);
    await updateSettings((settings) => { settings.digest = { time: '08:30' }; });
    const send = mock(async () => 1);
    const first = await tick(NOW.getTime(), send);
    expect(first.digest?.summary).toBe('Fri 4 Sep: 1 today');
    expect(send).toHaveBeenCalledTimes(1);
    expect((await loadSettings()).digest?.lastSentOn).toBe('2026-09-04');
    const second = await tick(NOW.getTime(), send);
    expect(second.digest).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    const tomorrow = new Date(2026, 8, 5, 8, 31).getTime();
    const third = await tick(tomorrow, send);
    expect(third.digest).toBeDefined();
    expect((await loadSettings()).digest?.lastSentOn).toBe('2026-09-05');
  });

  it('keeps the digest pending when delivery fails', async () => {
    await updateSettings((settings) => { settings.digest = { time: '08:30' }; });
    const result = await tick(NOW.getTime(), async () => { throw new Error('no bus'); });
    expect(result.digestError?.message).toBe('no bus');
    expect((await loadSettings()).digest?.lastSentOn).toBeUndefined();
  });
});
