import { fmtRelative, fmtWhen } from './dates.js';
import { formatRepeat } from './recurrence.js';
import { isOverdue, type Item } from './model.js';

export function describeItem(item: Item, now: Date = new Date()): string {
  const at = new Date(item.at);
  const parts = [item.title, `${fmtWhen(at, item.allDay ?? false, now)} (${fmtRelative(at, now)})`, `id ${item.id}`];
  if (item.repeat) parts.push(`[repeat: ${formatRepeat(item.repeat)}]`);
  if (item.tags?.length) parts.push(item.tags.map((t) => `#${t}`).join(' '));
  if (item.prompt || item.run) parts.push(taskLabel(item));
  if (item.done) parts.unshift('[done]');
  return parts.join(' | ');
}

export function formatLine(item: Item, now: Date = new Date()): string {
  const at = new Date(item.at);
  const mark = item.done ? '✓' : isOverdue(item, now.getTime()) ? '!' : ' ';
  const when = fmtWhen(at, item.allDay ?? false, now).padEnd(20);
  const rel = fmtRelative(at, now).padEnd(12);
  const tags = item.tags?.length ? `  ${item.tags.map((t) => `#${t}`).join(' ')}` : '';
  const task = item.prompt || item.run ? `  ${taskLabel(item)}` : '';
  const repeat = item.repeat ? `  [repeat: ${formatRepeat(item.repeat)}]` : '';
  return `${mark} ${item.id}  ${when} ${rel} ${item.title}${tags}${task}${repeat}`;
}

export function formatDetail(item: Item, now: Date = new Date()): string {
  const at = new Date(item.at);
  const rows: [string, string][] = [
    ['id', item.id],
    ['title', item.title],
    ['at', `${fmtWhen(at, item.allDay ?? false, now)} (${fmtRelative(at, now)})`],
  ];
  if (item.end) rows.push(['end', fmtWhen(new Date(item.end), false, now)]);
  if (item.repeat) rows.push(['repeat', formatRepeat(item.repeat)], ['repeat anchor', item.repeat.anchor]);
  if (item.allDay) rows.push(['all day', 'yes']);
  if (item.lead) rows.push(['notify', `${item.lead} min before`]);
  if (item.tags?.length) rows.push(['tags', item.tags.join(', ')]);
  if (item.notes) rows.push(['notes', item.notes]);
  if (item.prompt) rows.push(['prompt', item.prompt]);
  if (item.cwd) rows.push(['cwd', item.cwd]);
  if (item.prompt || item.run) rows.push(['task', taskLabel(item)]);
  if (item.run) {
    rows.push(['run id', item.run.id], ['started', item.run.startedAt], ['deadline', item.run.deadlineAt]);
    if (item.run.finishedAt) rows.push(['finished', item.run.finishedAt]);
    if (item.run.output) rows.push(['output', item.run.output]);
    if (item.run.error) rows.push(['error', item.run.error]);
    if (item.run.notifiedAt) rows.push(['result notified', item.run.notifiedAt]);
  }
  rows.push(['status', item.done ? 'done' : isOverdue(item, now.getTime()) ? 'overdue' : 'pending']);
  if (item.notifiedAt) rows.push(['notified', fmtWhen(new Date(item.notifiedAt), false, now)]);
  rows.push(['created', fmtWhen(new Date(item.createdAt), false, now)]);
  const width = Math.max(...rows.map(([k]) => k.length));
  return rows.map(([k, v]) => `${k.padEnd(width)}  ${v.replace(/\n/g, `\n${' '.repeat(width + 2)}`)}`).join('\n');
}

function taskLabel(item: Item): string {
  return `[pi: ${item.run?.status ?? (item.done ? 'done' : 'scheduled')}]`;
}
