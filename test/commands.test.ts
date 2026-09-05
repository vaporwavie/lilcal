import { beforeEach, describe, expect, it } from 'bun:test';
import { addItem, completeItem, getItem, listItems, removeItem, updateItem } from '../src/commands.js';
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
