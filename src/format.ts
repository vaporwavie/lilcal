import { fmtRelative, fmtWhen } from './dates.js';
import { isOverdue, type Item } from './model.js';

export function describeItem(item: Item, now: Date = new Date()): string {
  const at = new Date(item.at);
  const parts = [item.title, `${fmtWhen(at, item.allDay ?? false, now)} (${fmtRelative(at, now)})`, `id ${item.id}`];
  if (item.tags?.length) parts.push(item.tags.map((t) => `#${t}`).join(' '));
  if (item.done) parts.unshift('[done]');
  return parts.join(' | ');
}

export function formatLine(item: Item, now: Date = new Date()): string {
  const at = new Date(item.at);
  const mark = item.done ? '✓' : isOverdue(item, now.getTime()) ? '!' : ' ';
  const when = fmtWhen(at, item.allDay ?? false, now).padEnd(20);
  const rel = fmtRelative(at, now).padEnd(12);
  const tags = item.tags?.length ? `  ${item.tags.map((t) => `#${t}`).join(' ')}` : '';
  return `${mark} ${item.id}  ${when} ${rel} ${item.title}${tags}`;
}

export function formatDetail(item: Item, now: Date = new Date()): string {
  const at = new Date(item.at);
  const rows: [string, string][] = [
    ['id', item.id],
    ['title', item.title],
    ['at', `${fmtWhen(at, item.allDay ?? false, now)} (${fmtRelative(at, now)})`],
  ];
  if (item.end) rows.push(['end', fmtWhen(new Date(item.end), false, now)]);
  if (item.allDay) rows.push(['all day', 'yes']);
  if (item.lead) rows.push(['notify', `${item.lead} min before`]);
  if (item.tags?.length) rows.push(['tags', item.tags.join(', ')]);
  if (item.notes) rows.push(['notes', item.notes]);
  rows.push(['status', item.done ? 'done' : isOverdue(item, now.getTime()) ? 'overdue' : 'pending']);
  if (item.notifiedAt) rows.push(['notified', fmtWhen(new Date(item.notifiedAt), false, now)]);
  rows.push(['created', fmtWhen(new Date(item.createdAt), false, now)]);
  const width = Math.max(...rows.map(([k]) => k.length));
  return rows.map(([k, v]) => `${k.padEnd(width)}  ${v.replace(/\n/g, `\n${' '.repeat(width + 2)}`)}`).join('\n');
}
