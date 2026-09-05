import { fmtRelative, fmtWhen, toISO } from './dates.js';
import { atMs, notifyAtMs, type Item } from './model.js';
import { notify as sendNotification, type Notification, type Notifier } from './notify.js';
import { load, update } from './store.js';

export function due(items: Item[], now: number): Item[] {
  return items.filter((item) => !item.done && !item.notifiedAt && notifyAtMs(item) <= now);
}

export function notificationFor(item: Item, now: number): Notification {
  const at = new Date(item.at);
  const overdue = atMs(item) < now - 5 * 60_000;
  const lines = [`${fmtWhen(at, item.allDay ?? false, new Date(now))} (${fmtRelative(at, new Date(now))})`];
  if (item.notes) lines.push(item.notes);
  if (item.tags?.length) lines.push(item.tags.map((t) => `#${t}`).join(' '));
  return {
    summary: overdue ? `Overdue: ${item.title}` : item.title,
    body: lines.join('\n'),
    urgency: overdue ? 2 : 1,
    timeout: 0,
  };
}

export type TickResult = { notified: Item[]; failed: { item: Item; error: Error }[] };

export async function tick(now = Date.now(), send: Notifier = sendNotification): Promise<TickResult> {
  const items = await load();
  const result: TickResult = { notified: [], failed: [] };
  for (const item of due(items, now)) {
    try {
      await send(notificationFor(item, now));
      result.notified.push(item);
    } catch (err) {
      result.failed.push({ item, error: err as Error });
    }
  }
  if (result.notified.length) {
    const ids = new Set(result.notified.map((i) => i.id));
    const stamp = toISO(new Date(now));
    await update((fresh) => {
      for (const item of fresh) if (ids.has(item.id)) item.notifiedAt = stamp;
    });
  }
  return result;
}

export type DaemonOptions = { intervalMs: number; once: boolean; log?: (line: string) => void };

export async function runDaemon(opts: DaemonOptions): Promise<void> {
  const log = opts.log ?? ((line: string) => process.stderr.write(`${new Date().toISOString()} ${line}\n`));
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  if (!opts.once) log(`lilcal daemon started, checking every ${Math.round(opts.intervalMs / 1000)}s`);
  while (!stopped) {
    try {
      const result = await tick();
      for (const item of result.notified) log(`notified ${item.id} ${item.title}`);
      for (const { item, error } of result.failed) log(`failed ${item.id} ${item.title}: ${error.message}`);
    } catch (err) {
      log(`tick failed: ${(err as Error).message}`);
    }
    if (opts.once) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, opts.intervalMs);
      const onStop = () => {
        clearTimeout(timer);
        resolve();
      };
      process.once('SIGINT', onStop);
      process.once('SIGTERM', onStop);
    });
  }
}
