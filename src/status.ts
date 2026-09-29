import { fmtRelative, fmtTime, fmtWhen, sameDay, startOfDay, toISO } from './dates.js';
import { atMs, sortItems, type Item } from './model.js';

export type StatusEntry = {
  id: string;
  title: string;
  at: string;
  allDay: boolean;
  tags: string[];
  task: boolean;
  prompt: boolean;
  overdue: boolean;
  when: string;
  relative: string;
  label: string;
};

export type Status = {
  now: string;
  overdue: StatusEntry[];
  today: StatusEntry[];
  later: StatusEntry[];
  next: StatusEntry | null;
  running: number;
  line: string;
};

export const LATER_LIMIT = 5;

export function fmtSoon(d: Date, allDay: boolean, now: Date = new Date()): string {
  if (sameDay(d, now)) return allDay ? 'today' : fmtRelative(d, now);
  const dayDiff = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (dayDiff === 1) return allDay ? 'tomorrow' : `tomorrow ${fmtTime(d)}`;
  return fmtWhen(d, allDay, now);
}

function entry(item: Item, now: Date): StatusEntry {
  const at = new Date(item.at);
  const allDay = item.allDay ?? false;
  const overdue = atMs(item) < now.getTime();
  const label = overdue ? fmtRelative(at, now) : sameDay(at, now) ? (allDay ? 'all day' : fmtTime(at)) : fmtSoon(at, allDay, now);
  return {
    id: item.id,
    title: item.title,
    at: item.at,
    allDay,
    tags: item.tags ?? [],
    task: Boolean(item.prompt || item.run),
    prompt: Boolean(item.prompt?.trim()),
    overdue,
    when: fmtWhen(at, allDay, now),
    relative: fmtRelative(at, now),
    label,
  };
}

export function buildStatus(items: Item[], now: Date = new Date()): Status {
  const open = sortItems(items).filter((item) => !item.done);
  const overdue = open.filter((item) => atMs(item) < now.getTime()).map((item) => entry(item, now));
  const future = open.filter((item) => atMs(item) >= now.getTime());
  const today = future.filter((item) => sameDay(new Date(item.at), now)).map((item) => entry(item, now));
  const later = future.filter((item) => !sameDay(new Date(item.at), now)).slice(0, LATER_LIMIT).map((item) => entry(item, now));
  const nextItem = future[0];
  const next = nextItem ? entry(nextItem, now) : null;
  const running = items.filter((item) => item.run?.status === 'running').length;
  const parts: string[] = [];
  if (overdue.length) parts.push(`${overdue.length} overdue`);
  if (running) parts.push(`${running} running`);
  const first = overdue[0];
  if (next) parts.push(`${next.title} ${fmtSoon(new Date(next.at), next.allDay, now)}`);
  else if (first) parts.push(`${first.title} ${first.relative}`);
  else parts.push('nothing scheduled');
  return { now: toISO(now), overdue, today, later, next, running, line: parts.join(' · ') };
}

export function truncate(text: string, width: number): string {
  if (width <= 0 || text.length <= width) return text;
  return `${text.slice(0, Math.max(1, width - 1)).trimEnd()}…`;
}
