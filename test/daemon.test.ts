import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { addItem, completeItem, removeItem, updateItem } from '../src/commands.js';
import { TASK_TIMEOUT_MS, TASK_KILL_GRACE_MS } from '../src/agent.js';
import { due, notificationFor, tick } from '../src/daemon.js';
import type { Item } from '../src/model.js';
import type { Notification } from '../src/notify.js';
import { dataPath, load, save, update } from '../src/store.js';
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


describe('scheduled pi tasks', () => {
  const addTask = (extra: Partial<Parameters<typeof addItem>[0]> = {}) => addItem({
    title: 'Review', at: '2026-09-04T22:30', prompt: 'Review the latest changes', ...extra,
  }, NOW);

  it('claims, executes, persists the result, and notifies once', async () => {
    const item = await addTask();
    const send = mock(async (_notification: Notification) => 1);
    const runner = mock(async (claimed: Item) => {
      expect((await load())[0]?.run?.id).toBe(claimed.run!.id);
      expect(claimed.run?.status).toBe('running');
      return 'Review complete: two issues found.';
    });
    const result = await tick(NOW.getTime(), send, runner);
    expect(result.executed).toHaveLength(1);
    const saved = (await load())[0]!;
    expect(saved.run?.status).toBe('succeeded');
    expect(saved.run?.output).toBe('Review complete: two issues found.');
    expect(saved.run?.notifiedAt).toBeDefined();
    expect(saved.done).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ summary: 'Completed: Review', urgency: 1 });
    await tick(NOW.getTime(), send, runner);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(saved.id).toBe(item.id);
  });

  it('uses lead for advance notification but runs only at the event time', async () => {
    await addTask({ at: '2026-09-04T23:00', lead: 30 });
    const send = mock(async () => 1);
    const runner = mock(async () => 'Done');
    await tick(NOW.getTime(), send, runner);
    expect(send).toHaveBeenCalledTimes(1);
    expect(runner).not.toHaveBeenCalled();
    await tick(new Date('2026-09-04T23:00:00+02:00').getTime(), send, runner);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('retries failed result delivery without repeating agent work', async () => {
    await addTask();
    const runner = mock(async () => 'Done');
    const failingSend = mock(async () => { throw new Error('no bus'); });
    const first = await tick(NOW.getTime(), failingSend, runner);
    expect(first.failed).toHaveLength(1);
    expect((await load())[0]?.run?.status).toBe('succeeded');
    expect((await load())[0]?.run?.notifiedAt).toBeUndefined();
    const send = mock(async () => 1);
    await tick(NOW.getTime(), send, runner);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await load())[0]?.run?.notifiedAt).toBeDefined();
  });

  it('records failures, shows critical notifications, and requires rescheduling to retry', async () => {
    const item = await addTask();
    const runner = mock(async () => { throw new Error('pi unavailable'); });
    const send = mock(async (_notification: Notification) => 1);
    await tick(NOW.getTime(), send, runner);
    expect((await load())[0]?.run).toMatchObject({ status: 'failed', error: 'pi unavailable' });
    expect(send.mock.calls[0]![0]).toMatchObject({ summary: 'Failed: Review', urgency: 2 });
    await updateItem(item.id, { notes: 'new context', prompt: 'Try differently' }, NOW);
    await tick(NOW.getTime(), send, runner);
    expect(runner).toHaveBeenCalledTimes(1);
    await updateItem(item.id, { at: '2026-09-04T22:35' }, NOW);
    await tick(NOW.getTime(), send, runner);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('prevents duplicate execution across overlapping ticks', async () => {
    await addTask();
    let release!: (text: string) => void;
    const runner = mock(() => new Promise<string>((resolve) => { release = resolve; }));
    const send = mock(async () => 1);
    const first = await tick(NOW.getTime(), send, runner, { background: true });
    try {
      await tick(NOW.getTime(), send, runner);
      expect(runner).toHaveBeenCalledTimes(1);
      expect((await load())[0]?.run?.status).toBe('running');
    } finally {
      release('Done');
      await Promise.all(first.tasks);
    }
  });

  it('exposes launched work for shutdown tracking even if a later store read fails', async () => {
    await addTask();
    let claimed!: Item;
    let release!: (output: string) => void;
    const tracked: Promise<void>[] = [];
    const runner = (item: Item) => {
      claimed = item;
      writeFileSync(dataPath(), 'invalid JSON');
      return new Promise<string>((resolve) => { release = resolve; });
    };
    try {
      await expect(tick(NOW.getTime(), async () => 1, runner, {
        background: true, onTask: (task) => { tracked.push(task); },
      })).rejects.toThrow();
      expect(tracked).toHaveLength(1);
    } finally {
      await save([claimed]);
      release('Done');
      await Promise.all(tracked);
    }
    expect((await load())[0]?.run?.status).toBe('succeeded');
  });

  it('serializes simultaneous execution claims and result delivery', async () => {
    await addTask();
    const runner = mock(async () => 'Done');
    const send = mock(async () => 1);
    await Promise.all([tick(NOW.getTime(), send, runner), tick(NOW.getTime(), send, runner)]);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('reserves result delivery while another tick is sending and recovers expired reservations', async () => {
    await addTask();
    const runner = mock(async () => 'Done');
    await tick(NOW.getTime(), async () => { throw new Error('no bus'); }, runner);
    await update((items) => {
      items[0]!.run!.notificationClaim = { id: 'lost', until: new Date(0).toISOString() };
    });
    let entered!: () => void;
    let release!: (id: number) => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const send = mock(() => {
      entered();
      return new Promise<number>((resolve) => { release = resolve; });
    });
    const first = tick(NOW.getTime(), send, runner);
    await started;
    try {
      await tick(NOW.getTime(), send, runner);
      expect(send).toHaveBeenCalledTimes(1);
      expect(runner).toHaveBeenCalledTimes(1);
    } finally {
      release(1);
      await first;
    }
    expect((await load())[0]?.run?.notificationClaim).toBeUndefined();
    expect((await load())[0]?.run?.notifiedAt).toBeDefined();
  });

  it('continues polling new reminders and caps concurrent tasks at four', async () => {
    for (let i = 0; i < 5; i++) await addTask({ title: `Task ${i}` });
    const releases: ((text: string) => void)[] = [];
    const runner = mock(() => new Promise<string>((resolve) => { releases.push(resolve); }));
    const send = mock(async () => 1);
    const first = await tick(NOW.getTime(), send, runner, { background: true });
    try {
      expect(runner).toHaveBeenCalledTimes(4);
      const reminder = await addItem({ title: 'New reminder', at: '2026-09-04T22:30' }, NOW);
      const second = await tick(NOW.getTime(), send, runner, { background: true });
      expect(second.notified.map((i) => i.id)).toContain(reminder.id);
      expect(runner).toHaveBeenCalledTimes(4);
    } finally {
      for (const release of releases) release('Done');
      await Promise.all(first.tasks);
    }
    const nextRunner = mock(async () => 'Last task');
    await tick(NOW.getTime(), send, nextRunner);
    expect(nextRunner).toHaveBeenCalledTimes(1);
  });

  it('reports expired claims after a crash without automatically rerunning them', async () => {
    await addTask();
    await update((items) => {
      items[0]!.run = {
        id: 'lost', status: 'running', startedAt: NOW.toISOString(),
        deadlineAt: new Date(NOW.getTime() + TASK_TIMEOUT_MS).toISOString(),
      };
    });
    const runner = mock(async () => 'Must not run');
    const send = mock(async () => 1);
    await tick(NOW.getTime() + TASK_TIMEOUT_MS + TASK_KILL_GRACE_MS + 3000, send, runner);
    expect((await load())[0]?.run?.status).toBe('failed');
    expect(runner).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not start completed tasks or resurrect removed running tasks', async () => {
    const done = await addTask();
    await completeItem(done.id);
    const running = await addTask();
    let release!: (text: string) => void;
    const runner = mock(() => new Promise<string>((resolve) => { release = resolve; }));
    const send = mock(async () => 1);
    const result = await tick(NOW.getTime(), send, runner, { background: true });
    try {
      expect(runner).toHaveBeenCalledTimes(1);
      await removeItem(running.id);
    } finally {
      release('Done');
      await Promise.all(result.tasks);
    }
    expect((await load()).map((i) => i.id)).toEqual([done.id]);
    expect(send).not.toHaveBeenCalled();
  });
});
