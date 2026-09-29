import { createInterface } from 'node:readline';
import { addItem, completeItem, listItems, removeItem, updateItem, type Patch } from './commands.js';
import { fmtWhen, parseWhen } from './dates.js';
import { describeItem } from './format.js';
import { notify as sendNotification, type Notifier } from './notify.js';
import { VERSION } from './version.js';

export const INSTRUCTIONS = [
  "lilcal is the user's personal reminder calendar. It shows desktop notifications through D-Bus when reminders come due.",
  'When the user asks to be reminded of something, or mentions a future deadline, appointment, or follow-up, call add_reminder right away instead of asking for confirmation.',
  'Pass "at" in natural language ("next tuesday 10am", "tomorrow", "in 2 hours", "friday") or ISO 8601. Put the context the user will need when the reminder fires (paths, links, what to pick back up) in "notes".',
  'Only set "prompt" when the user wants work performed, not for reminder-only requests. It opts into autonomous noninteractive pi execution at "at", with pi tool access under the user\'s permissions. "lead_minutes" advances only the desktop reminder, not execution.',
  'Set "cwd" to an existing directory for the task; it defaults to the user\'s home. Task results and errors are stored in "run", returned by list_reminders and CLI show/list --json. Editing "at" re-arms execution; editing prompt or cwd preserves run history. Active tasks cannot have at, prompt, or cwd edited. Completing or removing a task does not stop an active pi process.',
  'Set "repeat" for recurring reminders/events: daily, weekly, monthly, yearly, or "every N days/weeks/months/years". Recurrence is not supported for pi tasks. The daemon advances the same item after successful notification, once its start has passed. Lists show the current occurrence only. Completing stops the series, removing deletes it, and empty/null repeat on update makes it one-off.',
  'Every response includes the resolved local time. Repeat it to the user so they can correct it.',
  'send_notification shows a desktop notification immediately. Use it to get the user\'s attention when a long task finishes or needs input.',
].join('\n');

type JsonRpcId = number | string | null;
export type Request = { jsonrpc?: string; id?: JsonRpcId; method: string; params?: Record<string, unknown> };
export type Response = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<string>;
};

const str = (description: string) => ({ type: 'string', description });
const strList = (description: string) => ({ type: 'array', items: { type: 'string' }, description });

function s(v: unknown, name: string, required = false): string | undefined {
  if (v === undefined || v === null) {
    if (required) throw new Error(`${name} is required`);
    return undefined;
  }
  if (typeof v !== 'string') throw new Error(`${name} must be a string`);
  return v;
}

function num(v: unknown, name: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${name} must be a number`);
  return v;
}

function list(v: unknown, name: string): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return [v];
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new Error(`${name} must be a list of strings`);
  return v;
}

function withJson(summary: string, data: unknown): string {
  return `${summary}\n${JSON.stringify(data, null, 2)}`;
}

function nowLine(now: Date): string {
  return `Current local time: ${fmtWhen(now, false, now)}`;
}

function parseBound(v: unknown, name: string, now: Date): Date | undefined {
  const text = s(v, name);
  if (!text) return undefined;
  const parsed = parseWhen(text, now);
  if (!parsed) throw new Error(`could not understand ${name}: ${text}`);
  return parsed.date;
}

export function createTools(notifier: Notifier = sendNotification, clock: () => Date = () => new Date()): Tool[] {
  return [
    {
      name: 'add_reminder',
      description:
        'Add a reminder, event, or scheduled pi task to the user\'s calendar. "at" accepts natural language or ISO 8601. Optional "prompt" opts into autonomous work at that time. Returns the item with its resolved local time and id.',
      inputSchema: {
        type: 'object',
        properties: {
          title: str('Short title shown in the notification'),
          at: str('When it is due: "next tuesday 10am", "tomorrow", "in 2 hours", "friday", or ISO 8601. Without a time it becomes an all-day item notified at 09:00.'),
          end: str('Optional end time for events, e.g. "11am" or ISO 8601'),
          repeat: str('Repeat daily, weekly, monthly, yearly, or "every N days/weeks/months/years". Reminders/events only, not pi tasks. The same item advances after notification, done stops the series.'),
          notes: str('Context to show when the reminder fires: what to pick back up, paths, links, ticket ids'),
          prompt: str('Task for autonomous noninteractive pi execution at "at". Only provide when the user wants work performed, with pi tool access under their permissions.'),
          cwd: str('Existing task working directory, resolved relative to this server. Requires prompt. Defaults to the user\'s home.'),
          tags: strList('Optional tags, e.g. the project name'),
          lead_minutes: { type: 'number', description: 'Notify this many minutes before "at". Default 0.' },
        },
        required: ['title', 'at'],
      },
      run: async (a) => {
        const now = clock();
        const item = await addItem(
          {
            title: s(a.title, 'title', true)!,
            at: s(a.at, 'at', true),
            end: s(a.end, 'end'),
            repeat: s(a.repeat, 'repeat', a.repeat !== undefined),
            notes: s(a.notes, 'notes'),
            prompt: s(a.prompt, 'prompt', a.prompt !== undefined),
            cwd: s(a.cwd, 'cwd', a.cwd !== undefined),
            tags: list(a.tags, 'tags'),
            lead: num(a.lead_minutes, 'lead_minutes'),
          },
          now,
        );
        return withJson(`Added: ${describeItem(item, now)}\n${nowLine(now)}`, item);
      },
    },
    {
      name: 'list_reminders',
      description:
        'List reminders, events, and tasks, soonest first, including run status, output, and errors in JSON. Without filters returns everything not yet done, including overdue items.',
      inputSchema: {
        type: 'object',
        properties: {
          from: str('Only items at or after this time (natural language or ISO 8601)'),
          to: str('Only items at or before this time (natural language or ISO 8601)'),
          include_done: { type: 'boolean', description: 'Include completed items. Default false.' },
          tag: str('Only items with this tag'),
          query: str('Case-insensitive text match on title, notes, and prompt'),
        },
      },
      run: async (a) => {
        const now = clock();
        const items = await listItems({
          from: parseBound(a.from, 'from', now),
          to: parseBound(a.to, 'to', now),
          includeDone: a.include_done === true,
          tag: s(a.tag, 'tag'),
          query: s(a.query, 'query'),
        });
        if (!items.length) return `No reminders found.\n${nowLine(now)}`;
        const lines = items.map((item) => `- ${describeItem(item, now)}`);
        return withJson(`${items.length} item(s). ${nowLine(now)}\n${lines.join('\n')}`, items);
      },
    },
    {
      name: 'update_reminder',
      description: 'Change only the given fields. Editing "at" re-arms notification and pi execution; prompt/cwd edits preserve run history. Active tasks reject at/prompt/cwd edits. Pass an empty string to clear end, notes, or prompt; empty cwd resets to home.',
      inputSchema: {
        type: 'object',
        properties: {
          id: str('Item id (a unique prefix is enough)'),
          title: str('New title'),
          at: str('New time. A bare time like "4pm" keeps the current day.'),
          end: str('New end time, or "" to clear'),
          repeat: { type: ['string', 'null'], description: 'daily, weekly, monthly, yearly, or "every N days/weeks/months/years". Resets the recurrence anchor to the current start. ""/null clears recurrence.' },
          notes: str('New notes, or "" to clear'),
          prompt: { type: ['string', 'null'], description: 'Autonomous pi task, or ""/null to clear it and cwd. Only set when the user wants work performed.' },
          cwd: { type: ['string', 'null'], description: 'Existing working directory for pi, or ""/null to reset to home. Requires prompt.' },
          tags: strList('Replacement tag list'),
          lead_minutes: { type: 'number', description: 'Minutes before "at" to notify' },
        },
        required: ['id'],
      },
      run: async (a) => {
        const now = clock();
        const patch: Patch = {};
        const title = s(a.title, 'title');
        if (title !== undefined) patch.title = title;
        const at = s(a.at, 'at');
        if (at !== undefined) patch.at = at;
        const end = s(a.end, 'end');
        if (end !== undefined) patch.end = end === '' ? null : end;
        const repeat = s(a.repeat, 'repeat');
        if (a.repeat === null || repeat === '') patch.repeat = null;
        else if (repeat !== undefined) patch.repeat = repeat;
        const notes = s(a.notes, 'notes');
        if (notes !== undefined) patch.notes = notes === '' ? null : notes;
          const prompt = s(a.prompt, 'prompt');
          if (a.prompt === null || prompt === '') patch.prompt = null;
          else if (prompt !== undefined) patch.prompt = prompt;
          const cwd = s(a.cwd, 'cwd');
          if (a.cwd === null || cwd === '') patch.cwd = null;
          else if (cwd !== undefined) patch.cwd = cwd;
        const tags = list(a.tags, 'tags');
        if (tags !== undefined) patch.tags = tags;
        const lead = num(a.lead_minutes, 'lead_minutes');
        if (lead !== undefined) patch.lead = lead;
        const item = await updateItem(s(a.id, 'id', true)!, patch, now);
        return withJson(`Updated: ${describeItem(item, now)}`, item);
      },
    },
    {
      name: 'complete_reminder',
      description: 'Mark a reminder as done (or not done with done=false). Done items stop future reminders and tasks and leave the default list. Does not stop an active pi process.',
      inputSchema: {
        type: 'object',
        properties: {
          id: str('Item id (a unique prefix is enough)'),
          done: { type: 'boolean', description: 'Default true' },
        },
        required: ['id'],
      },
      run: async (a) => {
        const item = await completeItem(s(a.id, 'id', true)!, a.done !== false);
        return withJson(`${item.done ? 'Completed' : 'Reopened'}: ${describeItem(item, clock())}`, item);
      },
    },
    {
      name: 'remove_reminder',
      description: 'Delete a reminder permanently. Does not stop an active pi process. Prefer complete_reminder unless the user asks to delete.',
      inputSchema: {
        type: 'object',
        properties: { id: str('Item id (a unique prefix is enough)') },
        required: ['id'],
      },
      run: async (a) => {
        const item = await removeItem(s(a.id, 'id', true)!);
        return withJson(`Removed: ${describeItem(item, clock())}`, item);
      },
    },
    {
      name: 'send_notification',
      description: 'Show a desktop notification right now, without creating a reminder. Use it to get the user\'s attention.',
      inputSchema: {
        type: 'object',
        properties: {
          summary: str('One-line headline'),
          body: str('Optional details'),
          urgent: { type: 'boolean', description: 'Critical urgency, stays on screen until dismissed. Default false.' },
        },
        required: ['summary'],
      },
      run: async (a) => {
        const id = await notifier({
          summary: s(a.summary, 'summary', true)!,
          body: s(a.body, 'body'),
          urgency: a.urgent === true ? 2 : 1,
        });
        return `Notification shown (id ${id}).`;
      },
    },
  ];
}

export type Server = { handle: (req: Request) => Promise<Response | null> };

export function createServer(tools: Tool[] = createTools()): Server {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const ok = (id: JsonRpcId, result: unknown): Response => ({ jsonrpc: '2.0', id, result });
  const fail = (id: JsonRpcId, code: number, message: string): Response => ({ jsonrpc: '2.0', id, error: { code, message } });

  async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = byName.get(name);
    if (!tool) throw new Error(`unknown tool: ${name}`);
    try {
      return { content: [{ type: 'text', text: await tool.run(args) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }

  return {
    async handle(req) {
      const id = req.id ?? null;
      const isNotification = req.id === undefined;
      if (typeof req.method !== 'string') return isNotification ? null : fail(id, -32600, 'invalid request');
      const params = req.params ?? {};
      switch (req.method) {
        case 'initialize': {
          const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18';
          return ok(id, {
            protocolVersion: requested,
            capabilities: { tools: {} },
            serverInfo: { name: 'lilcal', version: VERSION },
            instructions: INSTRUCTIONS,
          });
        }
        case 'ping':
          return ok(id, {});
        case 'tools/list':
          return ok(id, { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
        case 'tools/call': {
          const name = params.name;
          if (typeof name !== 'string') return fail(id, -32602, 'tools/call needs a name');
          if (!byName.has(name)) return fail(id, -32602, `unknown tool: ${name}`);
          const args = (params.arguments ?? {}) as Record<string, unknown>;
          return ok(id, await call(name, args));
        }
        default:
          if (isNotification) return null;
          return fail(id, -32601, `method not found: ${req.method}`);
      }
    },
  };
}

export async function serve(server: Server = createServer()): Promise<void> {
  const write = (msg: unknown) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
      continue;
    }
    const batch = Array.isArray(parsed) ? parsed : [parsed];
    const responses: Response[] = [];
    for (const req of batch) {
      const res = await server.handle(req as Request);
      if (res) responses.push(res);
    }
    if (Array.isArray(parsed)) {
      if (responses.length) write(responses);
    } else if (responses[0]) {
      write(responses[0]);
    }
  }
}

