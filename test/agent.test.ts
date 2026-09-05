import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { chmodSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { runPi, TASK_OUTPUT_LIMIT } from '../src/agent.js';
import type { Item } from '../src/model.js';
import { NOW, useTempStore } from './helpers.js';

let dir: string;
let previousData: string | undefined;
beforeEach(() => {
  previousData = process.env.LILCAL_DATA;
  dir = dirname(useTempStore());
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (previousData === undefined) delete process.env.LILCAL_DATA;
  else process.env.LILCAL_DATA = previousData;
});

function fakePi(source: string): string {
  const path = join(dir, 'fake-pi');
  writeFileSync(path, `#!${process.execPath}\n${source}\n`);
  chmodSync(path, 0o755);
  return path;
}
const item = (): Item => ({
  id: 'task', title: 'Review', at: NOW.toISOString(), createdAt: NOW.toISOString(),
  prompt: '@file --help $(touch unwanted)\nReview the changes.', notes: 'branch: work', cwd: dir,
});

describe('pi runner', () => {
  it('uses noninteractive text mode, a fresh session, stdin, and the requested directory', async () => {
    const executable = fakePi(`const input = await Bun.stdin.text();
      console.log(JSON.stringify({ input, args: process.argv.slice(2), cwd: process.cwd(), data: process.env.LILCAL_DATA }));`);
    const output = JSON.parse(await runPi(item(), { executable }));
    expect(output.args.slice(0, 5)).toEqual(['--print', '--mode', 'text', '--no-session', '--append-system-prompt']);
    expect(output.args).toHaveLength(6);
    expect(output.input).toContain(item().prompt);
    expect(output.input).toContain('branch: work');
    expect(output.input).toContain('Event id: task');
    expect(output.cwd).toBe(dir);
    expect(output.data).toBe(resolve(process.env.LILCAL_DATA!));
  });

  it('reports startup and nonzero exit errors', async () => {
    await expect(runPi(item(), { executable: join(dir, 'missing') })).rejects.toThrow();
    const executable = fakePi('console.error("provider unavailable"); process.exit(7);');
    await expect(runPi(item(), { executable })).rejects.toThrow('pi exited with code 7: provider unavailable');
  });

  it('rejects a missing response', async () => {
    await expect(runPi(item(), { executable: fakePi('process.exit(0);') })).rejects.toThrow('no response');
  });

  it('bounds large output while draining the subprocess', async () => {
    const executable = fakePi(`process.stdout.write('x'.repeat(${TASK_OUTPUT_LIMIT * 4}));`);
    const output = await runPi(item(), { executable });
    expect(output).toBe('x'.repeat(TASK_OUTPUT_LIMIT) + '\n[output truncated]');
  });

  it('times out an unresponsive subprocess', async () => {
    const executable = fakePi('setInterval(() => {}, 1000);');
    await expect(runPi(item(), { executable, timeoutMs: 100 })).rejects.toThrow('timed out');
  });

  it('honours the persisted execution deadline rather than starting a fresh timeout', async () => {
    const task = item();
    task.run = {
      id: 'claim', status: 'running', startedAt: new Date().toISOString(),
      deadlineAt: new Date(Date.now() + 100).toISOString(),
    };
    const executable = fakePi('setInterval(() => {}, 1000);');
    await expect(runPi(task, { executable })).rejects.toThrow('timed out');
    task.run.deadlineAt = new Date(0).toISOString();
    await expect(runPi(task, { executable })).rejects.toThrow('deadline exceeded');
  });

  it('force-kills processes that ignore graceful cancellation', async () => {
    const executable = fakePi("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);");
    await expect(runPi(item(), { executable, timeoutMs: 100 })).rejects.toThrow('timed out');
  });

  it('cleans up background group members after pi exits successfully', async () => {
    const marker = join(dir, 'survived');
    const source = `setTimeout(() => { require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'alive'); }, 250);`;
    const executable = fakePi(`import { spawn } from 'node:child_process';
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(source)}], { stdio: 'ignore' });
      child.unref(); console.log('Done');`);
    expect(await runPi(item(), { executable })).toBe('Done');
    await Bun.sleep(400);
    expect(existsSync(marker)).toBe(false);
  });

  it('cleans up descendants holding inherited output pipes without waiting for the deadline', async () => {
    const executable = fakePi(`import { spawn } from 'node:child_process';
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'inherit' });
      child.unref(); console.log('Done');`);
    expect(await runPi(item(), { executable, timeoutMs: 1000 })).toBe('Done');
  });

  it('enforces the deadline even if the process hosting runPi is killed', async () => {
    const ready = join(dir, 'ready');
    const marker = join(dir, 'survived-crash');
    const executable = fakePi(`import { writeFileSync } from 'node:fs';
      writeFileSync(${JSON.stringify(ready)}, 'ready');
      setTimeout(() => writeFileSync(${JSON.stringify(marker)}, 'alive'), 1000);`);
    const module = new URL('../src/agent.ts', import.meta.url).pathname;
    const host = Bun.spawn([process.execPath, '-e', `import { runPi } from ${JSON.stringify(module)};
      await runPi(${JSON.stringify(item())}, { executable: ${JSON.stringify(executable)}, timeoutMs: 400 });`], {
      stdout: 'ignore', stderr: 'ignore',
    });
    try {
      for (let i = 0; i < 50 && !existsSync(ready); i++) await Bun.sleep(10);
      expect(existsSync(ready)).toBe(true);
    } finally {
      host.kill('SIGKILL');
      await host.exited;
    }
    await Bun.sleep(1200);
    expect(existsSync(marker)).toBe(false);
  });

  it('interrupts an active subprocess on shutdown', async () => {
    const controller = new AbortController();
    const executable = fakePi('setInterval(() => {}, 1000);');
    const pending = runPi(item(), { executable, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('interrupted');
    await expect(runPi(item(), { executable, signal: controller.signal })).rejects.toThrow('interrupted');
  });
});
