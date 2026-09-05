import * as chrono from 'chrono-node';

export type Parsed = {
  date: Date;
  hasTime: boolean;
  hasDate: boolean;
  end?: Date;
  index: number;
  text: string;
};

export const DEFAULT_HOUR = 9;

const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function parseWhen(input: string, ref: Date = new Date()): Parsed | null {
  const text = input.trim();
  if (!text) return null;
  if (ISO_RE.test(text)) {
    const hasTime = text.includes('T');
    const date = hasTime ? new Date(text) : localDate(text, DEFAULT_HOUR);
    if (Number.isNaN(date.getTime())) return null;
    return { date, hasTime, hasDate: true, index: 0, text };
  }
  const result = chrono.parse(text, ref, { forwardDate: true })[0];
  if (!result) return null;
  const start = result.start;
  const date = start.date();
  const hasDate = (['day', 'weekday', 'month', 'year'] as const).some((c) => start.isCertain(c));
  let hasTime = start.isCertain('hour');
  if (!hasTime) {
    const carriedRef = date.getHours() === ref.getHours() && date.getMinutes() === ref.getMinutes();
    const chronoDefault = date.getHours() === 12 && date.getMinutes() === 0;
    if (carriedRef || chronoDefault) date.setHours(DEFAULT_HOUR, 0, 0, 0);
    else hasTime = true;
  }
  const parsed: Parsed = { date, hasTime, hasDate, index: result.index, text: result.text };
  if (result.end) parsed.end = result.end.date();
  return parsed;
}

export function extractWhen(text: string, ref: Date = new Date()): { title: string; when: Parsed } | null {
  const when = parseWhen(text, ref);
  if (!when || ISO_RE.test(text.trim())) return null;
  const before = text.slice(0, when.index);
  const after = text.slice(when.index + when.text.length);
  const title = `${before} ${after}`
    .replace(/\s+/g, ' ')
    .replace(/\s+(at|on|in|by|for|@)\s*$/i, '')
    .replace(/^\s*(at|on|in|by|for|@)\s+/i, '')
    .trim();
  if (!title) return null;
  return { title, when };
}

function localDate(ymd: string, hour: number): Date {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, hour, 0, 0, 0);
}

export function toISO(d: Date): string {
  const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  );
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtDay(d: Date, withYear = false): string {
  const base = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return withYear ? `${base} ${d.getFullYear()}` : base;
}

export function fmtMonth(y: number, m: number): string {
  return `${MONTHS_LONG[m]} ${y}`;
}

export function fmtWhen(d: Date, allDay: boolean, now: Date = new Date()): string {
  const day = fmtDay(d, d.getFullYear() !== now.getFullYear());
  return allDay ? day : `${day} ${fmtTime(d)}`;
}

export function fmtRelative(d: Date, now: Date = new Date()): string {
  const diff = d.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60_000);
  const hour = Math.round(abs / 3_600_000);
  const dayDiff = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86_400_000);
  let text: string;
  if (min < 1) text = 'now';
  else if (min < 60) text = `${min} min`;
  else if (hour < 24 && dayDiff === 0) text = `${hour} h`;
  else if (dayDiff === 0) text = 'today';
  else if (Math.abs(dayDiff) === 1) return diff < 0 ? 'yesterday' : 'tomorrow';
  else if (Math.abs(dayDiff) < 14) text = `${Math.abs(dayDiff)} days`;
  else if (Math.abs(dayDiff) < 60) text = `${Math.round(Math.abs(dayDiff) / 7)} weeks`;
  else text = `${Math.round(Math.abs(dayDiff) / 30)} months`;
  if (text === 'now' || text === 'today') return text;
  return diff < 0 ? `${text} ago` : `in ${text}`;
}
