import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createServer, createTools } from '../src/mcp.js';
import { load, update } from '../src/store.js';
import { NOW, useTempStore } from './helpers.js';

const notifier = mock(async () => 42);
let server: ReturnType<typeof createServer>;

beforeEach(() => {
  useTempStore();
  notifier.mockClear();
  server = createServer(createTools(notifier, () => NOW));
});

const call = (name: string, args: Record<string, unknown>, id = 1) =>
  server.handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

const text = (res: Awaited<ReturnType<typeof call>>) => (res?.result as { content: { text: string }[] }).content[0]!.text;

describe('mcp server', () => {
  it('answers initialize with the requested protocol version and instructions', async () => {
    const res = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
    const result = res?.result as { protocolVersion: string; instructions: string; capabilities: object };
    expect(result.protocolVersion).toBe('2024-11-05');
    expect(result.capabilities).toEqual({ tools: {} });
    expect(result.instructions).toContain('add_reminder');
  });

  it('ignores notifications and rejects unknown methods', async () => {
    expect(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    const res = await server.handle({ jsonrpc: '2.0', id: 9, method: 'nope' });
    expect(res?.error?.code).toBe(-32601);
  });

  it('lists tools with schemas', async () => {
    const res = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (res?.result as { tools: { name: string; inputSchema: { required?: string[] } }[] }).tools;
    expect(tools.map((t) => t.name)).toEqual([
      'add_reminder',
      'list_reminders',
      'update_reminder',
      'complete_reminder',
      'remove_reminder',
      'send_notification',
    ]);
    expect(tools[0]!.inputSchema.required).toEqual(['title', 'at']);
  });

  it('adds, lists, updates, completes, and removes', async () => {
    const added = text(await call('add_reminder', { title: 'Ship', at: 'next monday 9am', notes: 'cwd x', tags: ['p'], lead_minutes: 5 }));
    expect(added).toContain('Added: Ship | Mon 7 Sep 09:00 (in 3 days)');
    expect(added).toContain('Current local time: Fri 4 Sep 22:40');
    const id = (await load())[0]!.id;

    expect(text(await call('list_reminders', { tag: 'p' }))).toContain('1 item(s)');
    expect(text(await call('list_reminders', { from: 'next year' }))).toContain('No reminders');

    expect(text(await call('update_reminder', { id, at: '10am', notes: '' }))).toContain('Mon 7 Sep 10:00');
    expect((await load())[0]!.notes).toBeUndefined();

    expect(text(await call('complete_reminder', { id }))).toContain('Completed');
    expect(text(await call('remove_reminder', { id }))).toContain('Removed');
    expect(await load()).toEqual([]);
  });

  it('reports tool errors inside the result', async () => {
    const res = await call('add_reminder', { title: 'x', at: 'gibberish' });
    expect((res?.result as { isError: boolean }).isError).toBe(true);
    expect(text(res)).toMatch(/could not understand date/);
    const missing = await call('add_reminder', { at: 'tomorrow' });
    expect(text(missing)).toMatch(/title is required/);
  });

  it('creates and edits tasks, searches prompts, and exposes persisted run results', async () => {
    const added = await call('add_reminder', { title: 'Report', at: 'tomorrow', prompt: '  Summarize logs  ', cwd: '.', lead_minutes: 10 });
    expect((added?.result as { isError?: boolean }).isError).toBeUndefined();
    const item = (await load())[0]!;
    expect(item.prompt).toBe('Summarize logs');
    expect(item.cwd).toBe(resolve('.'));
    const run = { id: 'pi-1', status: 'failed' as const, startedAt: NOW.toISOString(), deadlineAt: NOW.toISOString(), output: 'Partial report', error: 'pi failed' };
    await update((items) => { items[0]!.run = run; });
    const listed = text(await call('list_reminders', { query: 'LOGS' }));
    expect(listed).toContain('Partial report');
    expect(listed).toContain('pi failed');
    await call('update_reminder', { id: item.id, prompt: 'Summarize more logs', cwd: '' });
    expect((await load())[0]!.cwd).toBe(homedir());
    expect((await load())[0]!.run).toEqual(run);
    await call('update_reminder', { id: item.id, prompt: '' });
    expect((await load())[0]!.prompt).toBeUndefined();
    expect((await load())[0]!.cwd).toBeUndefined();
    expect((await load())[0]!.run).toEqual(run);
    await call('update_reminder', { id: item.id, prompt: 'Retry', at: 'next monday' });
    expect((await load())[0]!.run).toBeUndefined();
    await call('update_reminder', { id: item.id, prompt: null });
    expect((await load())[0]!.prompt).toBeUndefined();
  });

  it('reports invalid task fields without creating items', async () => {
    for (const fields of [{ prompt: '' }, { prompt: 42 }, { cwd: '.' }, { prompt: 'Work', cwd: 'package.json' }]) {
      const result = await call('add_reminder', { title: 'Task', at: 'tomorrow', ...fields });
      expect((result?.result as { isError: boolean }).isError).toBe(true);
    }
    expect(await load()).toEqual([]);
  });

  it('adds, lists, edits, and clears recurrence through the existing tools', async () => {
    const added = text(await call('add_reminder', { title: 'Standup', at: 'tomorrow', repeat: 'weekly' }));
    expect(added).toContain('[repeat: weekly]');
    const item = (await load())[0]!;
    expect(item.repeat).toEqual({ frequency: 'weekly', interval: 1, anchor: item.at });
    expect(text(await call('list_reminders', {}))).toContain('[repeat: weekly]');
    await call('update_reminder', { id: item.id, repeat: 'every 2 months' });
    expect((await load())[0]!.repeat?.interval).toBe(2);
    await call('update_reminder', { id: item.id, repeat: '' });
    expect((await load())[0]!.repeat).toBeUndefined();
    await call('update_reminder', { id: item.id, repeat: 'yearly' });
    await call('update_reminder', { id: item.id, repeat: null });
    expect((await load())[0]!.repeat).toBeUndefined();
    for (const repeat of [42, {}, '', 'never', null]) {
      const result = await call('add_reminder', { title: 'Invalid', at: 'tomorrow', repeat });
      expect((result?.result as { isError: boolean }).isError).toBe(true);
    }
    expect(await load()).toHaveLength(1);
  });

  it('sends notifications through the notifier', async () => {
    expect(text(await call('send_notification', { summary: 'Build done', body: 'all green', urgent: true }))).toContain('42');
    expect(notifier).toHaveBeenCalledWith({ summary: 'Build done', body: 'all green', urgency: 2 });
  });
});
