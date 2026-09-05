import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { createServer, createTools } from '../src/mcp.js';
import { load } from '../src/store.js';
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

  it('sends notifications through the notifier', async () => {
    expect(text(await call('send_notification', { summary: 'Build done', body: 'all green', urgent: true }))).toContain('42');
    expect(notifier).toHaveBeenCalledWith({ summary: 'Build done', body: 'all green', urgency: 2 });
  });
});
