import { toISO } from './dates.js';
import type { Item } from './model.js';

export type Recurrence = {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  anchor: string;
};

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
const UNITS = { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' } as const;

export function parseRepeat(text: string, anchor: string): Recurrence {
  const value = text.trim().toLowerCase();
  let frequency = FREQUENCIES.find((f) => f === value);
  let interval = 1;
  if (!frequency) {
    const match = /^every ([1-9]\d*) (day|week|month|year)s?$/.exec(value);
    if (match) {
      frequency = UNITS[match[2] as keyof typeof UNITS];
      interval = Number(match[1]);
    }
  }
  if (!frequency) throw new Error('repeat must be daily, weekly, monthly, yearly, or "every N days/weeks/months/years"');
  const rule = { frequency, interval, anchor };
  validateRepeat(rule);
  return rule;
}

export function validateRepeat(rule: Recurrence): void {
  if (!rule || !FREQUENCIES.includes(rule.frequency)) throw new Error('invalid repeat frequency');
  if (!Number.isSafeInteger(rule.interval) || rule.interval < 1) throw new Error('repeat interval must be a positive integer');
  if (!Number.isFinite(new Date(rule.anchor).getTime())) throw new Error('invalid repeat anchor');
  // Reject intervals that cannot produce another representable calendar date.
  if (!Number.isFinite(occurrenceAt(rule, 1).getTime())) throw new Error('repeat interval is too large');
}

export function formatRepeat(rule: Recurrence): string {
  if (rule.interval === 1) return rule.frequency;
  const unit = Object.entries(UNITS).find(([, frequency]) => frequency === rule.frequency)![0];
  return `every ${rule.interval} ${unit}s`;
}

/** Calculate from the original local date, so short months and DST do not cause drift. */
function occurrenceAt(rule: Recurrence, index: number): Date {
  const anchor = new Date(rule.anchor);
  const date = new Date(anchor);
  const step = index * rule.interval;
  if (rule.frequency === 'daily' || rule.frequency === 'weekly') {
    date.setDate(anchor.getDate() + step * (rule.frequency === 'weekly' ? 7 : 1));
  } else {
    date.setDate(1);
    date.setMonth(anchor.getMonth() + step * (rule.frequency === 'yearly' ? 12 : 1));
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(anchor.getDate(), lastDay));
  }
  return date;
}

/** Find the first occurrence strictly after the cutoff without replaying missed periods. */
export function nextOccurrence(rule: Recurrence, after: Date): Date {
  validateRepeat(rule);
  if (!Number.isFinite(after.getTime())) throw new Error('invalid repeat cutoff');
  const anchor = new Date(rule.anchor);
  let periods: number;
  if (rule.frequency === 'daily' || rule.frequency === 'weekly') {
    const localDay = (d: Date) => {
      const utc = new Date(0);
      utc.setUTCFullYear(d.getFullYear(), d.getMonth(), d.getDate());
      return utc.getTime() / 86_400_000;
    };
    periods = (localDay(after) - localDay(anchor)) / (rule.frequency === 'weekly' ? 7 : 1);
  } else {
    periods = ((after.getFullYear() - anchor.getFullYear()) * 12 + after.getMonth() - anchor.getMonth()) /
      (rule.frequency === 'yearly' ? 12 : 1);
  }
  let index = Math.max(1, Math.floor(periods / rule.interval));
  let next = occurrenceAt(rule, index);
  while (next.getTime() <= after.getTime()) next = occurrenceAt(rule, ++index);
  if (!Number.isFinite(next.getTime())) throw new Error('next repeat date is out of range');
  return next;
}

/** Call only inside store.update(). A lead notification must not move an event before its start. */
export function advanceRepeat(item: Item, now: number): void {
  if (!item.repeat || item.done || !item.notifiedAt || new Date(item.at).getTime() > now) return;
  const next = nextOccurrence(item.repeat, new Date(now));
  if (item.end) {
    const duration = new Date(item.end).getTime() - new Date(item.at).getTime();
    item.end = toISO(new Date(next.getTime() + duration));
  }
  item.at = toISO(next);
  delete item.notifiedAt;
}
