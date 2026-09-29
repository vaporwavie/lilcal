import { describe, expect, it } from 'bun:test';
import type { Item } from '../src/model.js';
import { buildStatus, fmtSoon, truncate } from '../src/status.js';
import { NOW } from './helpers.js';

const item = (over: Partial<Item>): Item => ({ id: over.id ?? 'x', title: 'x', at: '2026-09-04T23:00:00+02:00', createdAt: '2026-09-01T00:00:00+02:00', ...over });

describe('buildStatus', () => {
  it('splits open items into overdue, today, and later, and builds the line', () => {
    const status = buildStatus([
      item({ id: 'late', title: 'Late', at: '2026-08-31T09:00:00+02:00', tags: ['ops'] }),
      item({ id: 'soon', title: 'Soon', at: '2026-09-04T23:00:00+02:00' }),
      item({ id: 'tmrw', title: 'Tomorrow', at: '2026-09-05T09:00:00+02:00', allDay: true }),
      item({ id: 'done', title: 'Done', at: '2026-08-30T09:00:00+02:00', done: true }),
      item({ id: 'task', title: 'Task', at: '2026-09-04T22:00:00+02:00', prompt: 'work', run: { id: 'r', status: 'running', startedAt: '', deadlineAt: '' } }),
    ], NOW);
    expect(status.overdue.map((e) => e.id)).toEqual(['late', 'task']);
    expect(status.today.map((e) => e.id)).toEqual(['soon']);
    expect(status.later.map((e) => e.id)).toEqual(['tmrw']);
    expect(status.next?.id).toBe('soon');
    expect(status.running).toBe(1);
    expect(status.overdue[0]).toMatchObject({ overdue: true, tags: ['ops'], label: '4 days ago' });
    expect(status.today[0]?.label).toBe('23:00');
    expect(status.later[0]?.label).toBe('tomorrow');
    expect(status.overdue[1]?.task).toBe(true);
    expect(status.overdue[1]?.prompt).toBe(true);
    expect(status.overdue[0]?.prompt).toBe(false);
    expect(status.line).toBe('2 overdue · 1 running · Soon in 20 min');
  });

  it('reports nothing scheduled and caps later items', () => {
    expect(buildStatus([], NOW).line).toBe('nothing scheduled');
    expect(buildStatus([item({ title: 'Late', at: '2026-08-31T09:00:00+02:00' })], NOW).line).toBe('1 overdue · Late 4 days ago');
    const many = Array.from({ length: 8 }, (_, i) => item({ id: `i${i}`, at: `2026-09-1${i}T10:00:00+02:00` }));
    const status = buildStatus(many, NOW);
    expect(status.later).toHaveLength(5);
    expect(status.line).toBe('x Thu 10 Sep 10:00');
  });
});

describe('fmtSoon', () => {
  it('keeps the time for tomorrow and near days', () => {
    expect(fmtSoon(new Date('2026-09-05T09:00:00+02:00'), false, NOW)).toBe('tomorrow 09:00');
    expect(fmtSoon(new Date('2026-09-05T09:00:00+02:00'), true, NOW)).toBe('tomorrow');
    expect(fmtSoon(new Date('2026-09-04T23:00:00+02:00'), false, NOW)).toBe('in 20 min');
    expect(fmtSoon(new Date('2026-09-08T14:30:00+02:00'), false, NOW)).toBe('Tue 8 Sep 14:30');
  });
});

describe('truncate', () => {
  it('cuts with an ellipsis only when needed', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('a long status line', 8)).toBe('a long…');
    expect(truncate('a long status line', 0)).toBe('a long status line');
  });
});
