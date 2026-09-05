import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { addItem } from '../src/commands.js';
import { due, notificationFor, tick } from '../src/daemon.js';
import type { Item } from '../src/model.js';
import { load } from '../src/store.js';
import { NOW, useTempStore } from './helpers.js';

beforeEach(() => {
  useTempStore();
});

const base = (over: Partial<Item>): Item => ({ id: 'a', title: 'a', at: '2026-09-04T23:00:00+02:00', createdAt: '', ...over });

describe('due', () => {
  it('honours lead time, done, and notified flags', () => {
    const now = NOW.getTime();
    expect(due([base({})], now)).toHaveLength(0);
    expect(due([base({ lead: 30 })], now)).toHaveLength(1);
    expect(due([base({ lead: 30, done: true })], now)).toHaveLength(0);
    expect(due([base({ lead: 30, notifiedAt: 'x' })], now)).toHaveLength(0);
    expect(due([base({ at: '2026-09-01T09:00:00+02:00' })], now)).toHaveLength(1);
  });
});

describe('notificationFor', () => {
  it('marks overdue items as critical', () => {
    const n = notificationFor(base({ at: '2026-09-01T09:00:00+02:00', notes: 'ctx', tags: ['p'] }), NOW.getTime());
    expect(n.summary).toBe('Overdue: a');
    expect(n.urgency).toBe(2);
    expect(n.body).toContain('ctx');
    expect(n.body).toContain('#p');
  });

  it('keeps on-time items normal', () => {
    const n = notificationFor(base({ lead: 30 }), NOW.getTime());
    expect(n.summary).toBe('a');
    expect(n.urgency).toBe(1);
  });
});

describe('tick', () => {
  it('notifies due items once and records the time', async () => {
    const item = await addItem({ title: 'Ping', at: '2026-09-04T22:30' }, NOW);
    await addItem({ title: 'Later', at: '2026-09-10T22:30' }, NOW);
    const send = mock(async () => 1);
    const first = await tick(NOW.getTime(), send);
    expect(first.notified.map((i) => i.id)).toEqual([item.id]);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await load()).find((i) => i.id === item.id)?.notifiedAt).toBe('2026-09-04T22:40:00+02:00');
    const second = await tick(NOW.getTime(), send);
    expect(second.notified).toHaveLength(0);
  });

  it('keeps items pending when sending fails', async () => {
    const item = await addItem({ title: 'Ping', at: '2026-09-04T22:30' }, NOW);
    const send = mock(async () => {
      throw new Error('no bus');
    });
    const result = await tick(NOW.getTime(), send);
    expect(result.failed[0]?.item.id).toBe(item.id);
    expect((await load())[0]?.notifiedAt).toBeUndefined();
  });
});
