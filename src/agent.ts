import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Item } from './model.js';
import { dataPath } from './store.js';

export const TASK_TIMEOUT_MS = 15 * 60_000;
export const TASK_OUTPUT_LIMIT = 64 * 1024;
export const TASK_KILL_GRACE_MS = 2000;
export type AgentRunner = (item: Item, signal?: AbortSignal) => Promise<string>;
export type PiOptions = { executable?: string; timeoutMs?: number; signal?: AbortSignal };

export function taskPrompt(item: Item): string {
  return [
    `Scheduled event: ${item.title}`,
    `Event id: ${item.id}`,
    `Scheduled time: ${item.at}`,
    `Current time: ${new Date().toISOString()}`,
    item.notes ? `Context: ${item.notes}` : '',
    item.tags?.length ? `Tags: ${item.tags.join(', ')}` : '',
    '',
    'Task:',
    item.prompt,
  ].filter((line) => line !== undefined).join('\n');
}

/** Run a fresh pi session, passing the task as stdin rather than shell/CLI syntax. */
export async function runPi(item: Item, options: PiOptions = {}): Promise<string> {
  if (!item.prompt?.trim()) throw new Error('task prompt is empty');
  if (options.signal?.aborted) throw new Error('pi task interrupted');
  const configured = options.executable ?? process.env.LILCAL_PI ?? 'pi';
  const executable = configured.includes('/') ? resolve(configured) : configured;
  const timeoutMs = options.timeoutMs ?? (item.run ? new Date(item.run.deadlineAt).getTime() - Date.now() : TASK_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('pi task deadline exceeded');
  const supervisor = Bun.which('timeout');
  if (!supervisor) throw new Error('scheduled pi tasks require the coreutils timeout command');
  const cli = fileURLToPath(new URL('./cli.ts', import.meta.url));
  const instructions = [
    'You are performing a scheduled lilcal task unattended. Carry out the task using your available tools.',
    'Return a concise result suitable for a desktop notification. Report failures or anything requiring user input.',
    'lilcal delivers your final response automatically; do not send a duplicate completion notification.',
    `To inspect or manage calendar events, use ${JSON.stringify(process.execPath)} ${JSON.stringify(cli)} with --help for its CLI API.`,
  ].join('\n');
  return new Promise((resolveOutput, reject) => {
    // The external deadline also applies if the lilcal daemon crashes.
    const child = spawn(supervisor, [
      '--signal=TERM', `--kill-after=${TASK_KILL_GRACE_MS / 1000}s`, `${timeoutMs / 1000}s`,
      executable, '--print', '--mode', 'text', '--no-session', '--append-system-prompt', instructions,
    ], {
      cwd: item.cwd ?? homedir(),
      env: { ...process.env, LILCAL_DATA: resolve(dataPath()) },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    let output = '';
    let stderr = '';
    let truncated = false;
    let failure: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ESRCH') child.kill(signal);
      }
    };
    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), TASK_KILL_GRACE_MS);
    };
    const abort = () => stop(new Error('pi task interrupted'));
    const timer = setTimeout(() => stop(new Error('pi task timed out')), timeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      const room = TASK_OUTPUT_LIMIT - output.length;
      output += chunk.slice(0, room);
      if (chunk.length > room) truncated = true;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4096);
    });
    child.on('error', (error) => { failure = error; });
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') stop(error);
    });
    // Descendants can keep inherited pipes open after pi exits. Stop them before waiting for close.
    child.on('exit', () => kill('SIGKILL'));
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      // A completed pi process must not leave background members of its group running.
      kill('SIGKILL');
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', abort);
      if (failure) return reject(failure);
      if (code === 124) return reject(new Error('pi task timed out'));
      if (code !== 0) return reject(new Error(`pi ${signal ? `terminated by ${signal}` : `exited with code ${code}`}${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
      if (!output.trim()) return reject(new Error('pi returned no response'));
      resolveOutput(output.trim() + (truncated ? '\n[output truncated]' : ''));
    });
    child.stdin.end(taskPrompt(item));
  });
}

export const runAgent: AgentRunner = (item, signal) => runPi(item, { signal });
