import { dayKey, fmtDay } from './dates.js';
import type { Item, Settings } from './model.js';
import type { Notification } from './notify.js';
import { buildStatus, fmtSoon, type StatusEntry } from './status.js';

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

export function parseDigestTime(text: string): string {
  const match = TIME_RE.exec(text.trim());
  const hour = match ? Number(match[1]) : NaN;
  const minute = match ? Number(match[2]) : NaN;
  if (!match || hour > 23 || minute > 59) throw new Error(`digest time must be HH:MM, got ${text}`);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function digestDue(settings: Settings, now: Date): boolean {
  const digest = settings.digest;
  if (!digest) return false;
  if (digest.lastSentOn === dayKey(now)) return false;
  const [hour, minute] = digest.time.split(':').map(Number) as [number, number];
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
  return now.getTime() >= at.getTime();
}

function line(entry: StatusEntry, now: Date): string {
  const tags = entry.tags.length ? ` ${entry.tags.map((t) => `#${t}`).join(' ')}` : '';
  const task = entry.task ? ' [pi]' : '';
  if (entry.overdue) return `! ${entry.title} (${entry.relative})${tags}${task}`;
  return `${entry.label}  ${entry.title}${tags}${task}`;
}

export function digestFor(items: Item[], now: Date = new Date()): Notification {
  const status = buildStatus(items, now);
  const lines: string[] = [];
  if (status.overdue.length) {
    lines.push('Overdue');
    for (const entry of status.overdue) lines.push(line(entry, now));
  }
  if (status.today.length) {
    if (lines.length) lines.push('');
    lines.push('Today');
    for (const entry of status.today) lines.push(line(entry, now));
  } else {
    if (lines.length) lines.push('');
    lines.push('Nothing scheduled today.');
    const next = status.later[0];
    if (next) lines.push(`Next: ${next.title} ${fmtSoon(new Date(next.at), next.allDay, now)}`);
  }
  const counts = [`${status.today.length} today`];
  if (status.overdue.length) counts.push(`${status.overdue.length} overdue`);
  return {
    summary: `${fmtDay(now)}: ${counts.join(', ')}`,
    body: lines.join('\n'),
    urgency: 1,
    timeout: 0,
  };
}
