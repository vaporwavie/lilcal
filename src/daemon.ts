import { randomUUID } from 'node:crypto';
import { runAgent, TASK_KILL_GRACE_MS, TASK_TIMEOUT_MS, type AgentRunner } from './agent.js';
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

export type TickResult = {
  notified: Item[];
  executed: Item[];
  failed: { item: Item; error: Error }[];
  tasks: Promise<void>[];
};
export type TickOptions = {
  background?: boolean;
  signal?: AbortSignal;
  onTask?: (task: Promise<void>) => void;
};
const MAX_RUNNING_TASKS = 4;

export function taskNotificationFor(item: Item): Notification {
  const run = item.run!;
  const text = run.status === 'succeeded' ? run.output ?? 'Task completed.' : run.error ?? 'Task failed.';
  return {
    summary: `${run.status === 'succeeded' ? 'Completed' : 'Failed'}: ${item.title}`,
    body: `${text.slice(0, 2000)}${text.length > 2000 ? '\n[truncated]' : ''}\n\nDetails: lilcal show ${item.id}`,
    urgency: run.status === 'succeeded' ? 1 : 2,
    timeout: 0,
  };
}

async function notifyTask(item: Item, send: Notifier, result: TickResult): Promise<void> {
  if (!item.run || item.run.status === 'running' || item.run.notifiedAt) return;
  const claimId = randomUUID();
  let claimed = false;
  try {
    await update((items) => {
      const run = items.find((i) => i.id === item.id)?.run;
      if (!run || run.id !== item.run!.id || run.notifiedAt || run.status === 'running') return;
      if (run.notificationClaim && new Date(run.notificationClaim.until).getTime() > Date.now()) return;
      run.notificationClaim = { id: claimId, until: new Date(Date.now() + 60_000).toISOString() };
      claimed = true;
    });
    if (!claimed) return;
    await send(taskNotificationFor(item));
    await update((items) => {
      const run = items.find((i) => i.id === item.id)?.run;
      if (run?.notificationClaim?.id !== claimId) return;
      run.notifiedAt = toISO(new Date());
      delete run.notificationClaim;
    });
    result.notified.push(item);
  } catch (err) {
    result.failed.push({ item, error: err as Error });
    if (claimed) {
      await update((items) => {
        const run = items.find((i) => i.id === item.id)?.run;
        if (run?.notificationClaim?.id === claimId) delete run.notificationClaim;
      });
    }
  }
}

/** Claim before launching: a lost process becomes a failed run, never an automatic replay. */
async function claimTasks(now: number): Promise<Item[]> {
  const claimed: Item[] = [];
  await update((items) => {
    for (const item of items) {
      if (item.run?.status === 'running' && new Date(item.run.deadlineAt).getTime() + TASK_KILL_GRACE_MS + 3000 <= now) {
        item.run.status = 'failed';
        item.run.finishedAt = toISO(new Date(now));
        item.run.error = 'Task interrupted or execution deadline exceeded. Check its effects before rescheduling.';
      }
    }
    let available = MAX_RUNNING_TASKS - items.filter((i) => i.run?.status === 'running').length;
    for (const item of items) {
      if (available <= 0) break;
      if (!item.prompt || item.done || item.run || atMs(item) > now) continue;
      item.run = {
        id: randomUUID(),
        status: 'running',
        startedAt: toISO(new Date(now)),
        deadlineAt: toISO(new Date(now + TASK_TIMEOUT_MS)),
      };
      claimed.push(structuredClone(item));
      available--;
    }
  });
  return claimed;
}

async function executeTask(item: Item, runner: AgentRunner, signal?: AbortSignal): Promise<Item | undefined> {
  const run = { ...item.run! };
  try {
    run.output = await runner(item, signal);
    run.status = 'succeeded';
  } catch (err) {
    run.status = 'failed';
    run.error = err instanceof Error ? err.message : String(err);
  }
  run.finishedAt = toISO(new Date());
  let saved: Item | undefined;
  await update((items) => {
    const fresh = items.find((i) => i.id === item.id);
    if (fresh?.run?.id !== run.id || fresh.run.status !== 'running') return;
    fresh.run = run;
    saved = structuredClone(fresh);
  });
  return saved;
}

export async function tick(
  now = Date.now(),
  send: Notifier = sendNotification,
  runner: AgentRunner = runAgent,
  options: TickOptions = {},
): Promise<TickResult> {
  const result: TickResult = { notified: [], executed: [], failed: [], tasks: [] };
  const claimedIds = new Set<string>();
  // Start work independently of D-Bus availability and continue polling while it runs.
  if (!options.signal?.aborted) {
    for (const item of await claimTasks(now)) {
      claimedIds.add(item.run!.id);
      const task = executeTask(item, runner, options.signal).then(async (finished) => {
        if (!finished) return;
        result.executed.push(finished);
        await notifyTask(finished, send, result);
      }).catch((err: Error) => { result.failed.push({ item, error: err }); });
      result.tasks.push(task);
      options.onTask?.(task);
    }
  }
  const items = await load();
  for (const item of due(items, now)) {
    // Tasks use their final result notification at/after 'at'; lead is only an advance reminder.
    if (item.prompt && atMs(item) <= now) continue;
    try {
      await send(notificationFor(item, now));
      await update((fresh) => {
        const current = fresh.find((i) => i.id === item.id);
        if (current && !current.done && current.at === item.at && current.lead === item.lead && current.prompt === item.prompt) {
          current.notifiedAt = toISO(new Date(now));
        }
      });
      result.notified.push(item);
    } catch (err) {
      result.failed.push({ item, error: err as Error });
    }
  }
  // Retry delivery of saved results without rerunning pi. Newly claimed tasks deliver above.
  for (const item of items) {
    if (item.run && !claimedIds.has(item.run.id)) await notifyTask(item, send, result);
  }
  if (!options.background) await Promise.all(result.tasks);
  return result;
}

export type DaemonOptions = { intervalMs: number; once: boolean; log?: (line: string) => void };

export async function runDaemon(opts: DaemonOptions): Promise<void> {
  const log = opts.log ?? ((line: string) => process.stderr.write(`${new Date().toISOString()} ${line}\n`));
  const controller = new AbortController();
  const stop = () => controller.abort();
  const pending = new Set<Promise<void>>();
  const track = (task: Promise<void>) => {
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };
  const signals: NodeJS.EventEmitter = process;
  signals.once('SIGINT', stop);
  signals.once('SIGTERM', stop);
  const logResult = (result: TickResult) => {
    for (const item of result.notified) log(`notified ${item.id} ${item.title}`);
    for (const item of result.executed) log(`pi ${item.run!.status} ${item.id} ${item.title}`);
    for (const { item, error } of result.failed) log(`failed ${item.id} ${item.title}: ${error.message}`);
  };
  try {
    if (!opts.once) log(`lilcal daemon started, checking every ${Math.round(opts.intervalMs / 1000)}s`);
    while (!controller.signal.aborted) {
      try {
        const result = await tick(Date.now(), sendNotification, runAgent, {
          background: true, signal: controller.signal, onTask: track,
        });
        track(Promise.all(result.tasks).then(() => { logResult(result); }));
      } catch (err) {
        log(`tick failed: ${(err as Error).message}`);
      }
      if (opts.once || controller.signal.aborted) break;
      await new Promise<void>((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', wake);
          resolve();
        };
        const timer = setTimeout(wake, opts.intervalMs);
        controller.signal.addEventListener('abort', wake, { once: true });
      });
    }
    await Promise.all(pending);
  } finally {
    signals.removeListener('SIGINT', stop);
    signals.removeListener('SIGTERM', stop);
  }
}
