#!/usr/bin/env bun
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { addItem, completeItem, getItem, listItems, removeItem, updateItem, type Patch } from './commands.js';
import { runDaemon } from './daemon.js';
import { parseWhen } from './dates.js';
import { formatDetail, formatLine } from './format.js';
import { serve } from './mcp.js';
import type { Item } from './model.js';
import { notify } from './notify.js';
import { installService, serviceStatus, uninstallService, unitPath, unitText } from './service.js';
import { dataPath } from './store.js';
import { runTui } from './tui/app.js';
import { VERSION } from './version.js';

const USAGE = `lilcal ${VERSION}: reminders and events for you and your agents

Usage
  lilcal                         open the TUI
  lilcal add <title> [--at <when>] [--end <when>] [--notes <text>] [--tag <t>]... [--lead <min>]
  lilcal list [--all] [--from <when>] [--to <when>] [--tag <t>] [-q <text>]
  lilcal show <id>
  lilcal edit <id> [--title <t>] [--at <when>] [--end <when>] [--notes <text>] [--tag <t>]... [--lead <min>]
  lilcal done <id>...            mark done (undone reverses it)
  lilcal rm <id>...              delete
  lilcal notify <summary> [body] [--urgent]
  lilcal daemon [--interval <sec>] [--once]
  lilcal service install|uninstall|status|unit
  lilcal mcp                     MCP server on stdio for Claude Code, Codex, and friends
  lilcal path                    print the data file

Every command that prints an item accepts --json.
Dates: "next tuesday 10am", "tomorrow", "in 2 hours", "friday", "2026-09-12T15:00".
Without --at the date comes from the title: lilcal add "call mom sunday 6pm".
Pass --end "" or --notes "" to edit to clear a field.
`;

type Opts = Record<string, string | boolean | string[] | undefined>;

function parse(args: string[], options: ParseArgsConfig['options']): { opts: Opts; positionals: string[] } {
  const { values, positionals } = parseArgs({ args, options, allowPositionals: true, strict: true });
  return { opts: values as Opts, positionals };
}

const json = { type: 'boolean' } as const;
const text = { type: 'string' } as const;
const tags = { type: 'string', multiple: true } as const;

function lead(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--lead must be minutes, got ${String(v)}`);
  return n;
}

function bound(v: unknown, name: string): Date | undefined {
  if (typeof v !== 'string') return undefined;
  const parsed = parseWhen(v);
  if (!parsed) throw new Error(`could not understand --${name}: ${v}`);
  return parsed.date;
}

function printItem(item: Item, asJson: boolean, verb?: string): void {
  if (asJson) console.log(JSON.stringify(item, null, 2));
  else console.log(verb ? `${verb} ${formatLine(item)}` : formatLine(item));
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (command === undefined) return runTui();
  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(USAGE);
      return;
    case '--version':
    case '-v':
      console.log(VERSION);
      return;
    case 'add': {
      const { opts, positionals } = parse(rest, { at: text, end: text, notes: text, tag: tags, lead: text, json });
      const title = positionals.join(' ');
      if (!title.trim()) throw new Error('add needs a title');
      const item = await addItem({
        title,
        at: opts.at as string | undefined,
        end: opts.end as string | undefined,
        notes: opts.notes as string | undefined,
        tags: opts.tag as string[] | undefined,
        lead: lead(opts.lead),
      });
      printItem(item, Boolean(opts.json), 'Added');
      return;
    }
    case 'list':
    case 'ls': {
      const { opts, positionals } = parse(rest, { all: { type: 'boolean' }, from: text, to: text, tag: text, query: { type: 'string', short: 'q' }, json });
      const items = await listItems({
        includeDone: Boolean(opts.all),
        from: bound(opts.from, 'from'),
        to: bound(opts.to, 'to'),
        tag: opts.tag as string | undefined,
        query: (opts.query as string | undefined) ?? (positionals.length ? positionals.join(' ') : undefined),
      });
      if (opts.json) return console.log(JSON.stringify(items, null, 2));
      if (!items.length) return console.log('Nothing scheduled.');
      for (const item of items) console.log(formatLine(item));
      return;
    }
    case 'show': {
      const { opts, positionals } = parse(rest, { json });
      if (!positionals[0]) throw new Error('show needs an id');
      const item = await getItem(positionals[0]);
      if (opts.json) return console.log(JSON.stringify(item, null, 2));
      return console.log(formatDetail(item));
    }
    case 'edit': {
      const { opts, positionals } = parse(rest, { title: text, at: text, end: text, notes: text, tag: tags, lead: text, json });
      const id = positionals[0];
      if (!id) throw new Error('edit needs an id');
      const patch: Patch = {};
      if (typeof opts.title === 'string') patch.title = opts.title;
      if (typeof opts.at === 'string') patch.at = opts.at;
      if (typeof opts.end === 'string') patch.end = opts.end === '' ? null : opts.end;
      if (typeof opts.notes === 'string') patch.notes = opts.notes === '' ? null : opts.notes;
      if (Array.isArray(opts.tag)) patch.tags = opts.tag;
      const l = lead(opts.lead);
      if (l !== undefined) patch.lead = l;
      if (!Object.keys(patch).length) throw new Error('edit needs at least one field to change');
      printItem(await updateItem(id, patch), Boolean(opts.json), 'Updated');
      return;
    }
    case 'done':
    case 'undone': {
      const { opts, positionals } = parse(rest, { json });
      if (!positionals.length) throw new Error(`${command} needs an id`);
      for (const id of positionals) printItem(await completeItem(id, command === 'done'), Boolean(opts.json), command === 'done' ? 'Done' : 'Reopened');
      return;
    }
    case 'rm':
    case 'remove': {
      const { opts, positionals } = parse(rest, { json });
      if (!positionals.length) throw new Error('rm needs an id');
      for (const id of positionals) printItem(await removeItem(id), Boolean(opts.json), 'Removed');
      return;
    }
    case 'notify': {
      const { opts, positionals } = parse(rest, { urgent: { type: 'boolean' } });
      const [summary, ...body] = positionals;
      if (!summary) throw new Error('notify needs a summary');
      const id = await notify({ summary, body: body.join(' ') || undefined, urgency: opts.urgent ? 2 : 1 });
      console.log(`sent notification ${id}`);
      return;
    }
    case 'daemon': {
      const { opts } = parse(rest, { interval: text, once: { type: 'boolean' } });
      const seconds = opts.interval === undefined ? 30 : Number(opts.interval);
      if (!Number.isFinite(seconds) || seconds < 1) throw new Error('--interval must be seconds');
      await runDaemon({ intervalMs: seconds * 1000, once: Boolean(opts.once) });
      return;
    }
    case 'service': {
      const action = rest[0];
      if (action === 'install') return console.log(`installed ${installService()}`);
      if (action === 'uninstall') return uninstallService();
      if (action === 'status') return serviceStatus();
      if (action === 'unit') {
        process.stdout.write(`# ${unitPath()}\n${unitText()}`);
        return;
      }
      throw new Error('service needs install, uninstall, status, or unit');
    }
    case 'mcp':
      return serve();
    case 'path':
      return console.log(dataPath());
    default:
      throw new Error(`unknown command: ${command}\n\n${USAGE}`);
  }
}

main(process.argv.slice(2)).catch((err: Error) => {
  console.error(`lilcal: ${err.message}`);
  process.exit(1);
});
