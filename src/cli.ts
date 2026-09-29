#!/usr/bin/env bun
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { addItem, completeItem, getItem, listItems, removeItem, updateItem, type Patch } from './commands.js';
import { runDaemon } from './daemon.js';
import { parseWhen } from './dates.js';
import { formatDetail, formatLine } from './format.js';
import { serve } from './mcp.js';
import type { Item } from './model.js';
import { notify } from './notify.js';
import { openPi } from './open.js';
import { installService, serviceStatus, uninstallService, unitPath, unitText } from './service.js';
import { buildStatus, truncate } from './status.js';
import { load, loadSettings, updateSettings, dataPath } from './store.js';
import { digestFor, parseDigestTime } from './digest.js';
import { installWidget, uninstallWidget, widgetInstallPath } from './widget.js';
import { runTui } from './tui/app.js';
import { VERSION } from './version.js';

const USAGE = `lilcal ${VERSION}: reminders and events for you and your agents

Usage
  lilcal                         open the TUI
  lilcal add <title> [--at <when>] [--end <when>] [--repeat <rule>] [--notes <text>] [--tag <t>]... [--lead <min>] [--prompt <task>] [--cwd <dir>]
  lilcal list [--all] [--from <when>] [--to <when>] [--tag <t>] [-q <text>]
  lilcal show <id>
  lilcal status [--width <n>]    one line: overdue count, running tasks, next item (--json for the widget)
  lilcal digest [<HH:MM>|off|send]  daily agenda notification from the daemon
  lilcal edit <id> [--title <t>] [--at <when>] [--end <when>] [--repeat <rule>] [--notes <text>] [--tag <t>]... [--lead <min>] [--prompt <task>] [--cwd <dir>]
  lilcal done <id>...            mark done (undone reverses it)
  lilcal pi <id>                 open interactive pi in a terminal with the task prompt
  lilcal rm <id>...              delete
  lilcal notify <summary> [body] [--urgent]
  lilcal daemon [--interval <sec>] [--once]
  lilcal service install|uninstall|status|unit
  lilcal widget install|uninstall|path   Plasma panel widget
  lilcal mcp                     MCP server on stdio for Claude Code, Codex, and friends
  lilcal path                    print the data file

Every command that prints an item accepts --json.
Dates: "next tuesday 10am", "tomorrow", "in 2 hours", "friday", "2026-09-12T15:00".
Without --at the date comes from the title: lilcal add "call mom sunday 6pm".
Pass --end "", --repeat "", or --notes "" to edit to clear a field.
--repeat accepts daily, weekly, monthly, yearly, or "every N days/weeks/months/years".
The daemon advances recurring events after delivery, never before their start. Lists show the current occurrence.
Done stops the series, undone resumes it. Recurrence is not supported for pi tasks.
--prompt schedules autonomous, noninteractive pi work at --at, with your pi tool permissions.
--cwd selects its working directory (default: home). --lead only advances the notification.
Edit --prompt "" clears the task; --cwd "" resets its directory to home.
Editing --at re-arms execution; prompt/cwd edits do not. Active tasks cannot be rescheduled.
Task results are available in show and list --json.
pi <id> opens an interactive session with the task prompt. LILCAL_TERMINAL or TERMINAL picks the terminal.
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
      const { opts, positionals } = parse(rest, { at: text, end: text, repeat: text, notes: text, prompt: text, cwd: text, tag: tags, lead: text, json });
      const title = positionals.join(' ');
      if (!title.trim()) throw new Error('add needs a title');
      const item = await addItem({
        title,
        at: opts.at as string | undefined,
        end: opts.end as string | undefined,
        repeat: opts.repeat as string | undefined,
        notes: opts.notes as string | undefined,
        prompt: opts.prompt as string | undefined,
        cwd: opts.cwd as string | undefined,
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
    case 'status': {
      const { opts } = parse(rest, { width: text, json });
      const status = buildStatus(await load());
      if (opts.json) return console.log(JSON.stringify(status, null, 2));
      const width = opts.width === undefined ? 0 : Number(opts.width);
      if (!Number.isFinite(width) || width < 0) throw new Error('--width must be a number of characters');
      return console.log(truncate(status.line, width));
    }
    case 'digest': {
      const { opts, positionals } = parse(rest, { json });
      const [action] = positionals;
      if (action === 'off') {
        await updateSettings((settings) => { delete settings.digest; });
        return console.log('digest off');
      }
      if (action === 'send') {
        const id = await notify(digestFor(await load()));
        return console.log(`sent digest ${id}`);
      }
      if (action !== undefined) {
        const time = parseDigestTime(action);
        await updateSettings((settings) => {
          settings.digest = { ...settings.digest, time };
        });
        return console.log(`digest daily at ${time}`);
      }
      const settings = await loadSettings();
      const preview = digestFor(await load());
      if (opts.json) return console.log(JSON.stringify({ ...settings.digest, preview }, null, 2));
      const digest = settings.digest;
      console.log(digest ? `digest daily at ${digest.time}${digest.lastSentOn ? ` (last sent ${digest.lastSentOn})` : ''}` : 'digest off');
      return console.log(`\n${preview.summary}\n${preview.body ?? ''}`);
    }
    case 'edit': {
      const { opts, positionals } = parse(rest, { title: text, at: text, end: text, repeat: text, notes: text, prompt: text, cwd: text, tag: tags, lead: text, json });
      const id = positionals[0];
      if (!id) throw new Error('edit needs an id');
      const patch: Patch = {};
      if (typeof opts.title === 'string') patch.title = opts.title;
      if (typeof opts.at === 'string') patch.at = opts.at;
      if (typeof opts.end === 'string') patch.end = opts.end === '' ? null : opts.end;
      if (typeof opts.repeat === 'string') patch.repeat = opts.repeat === '' ? null : opts.repeat;
      if (typeof opts.notes === 'string') patch.notes = opts.notes === '' ? null : opts.notes;
      if (typeof opts.prompt === 'string') patch.prompt = opts.prompt === '' ? null : opts.prompt;
      if (typeof opts.cwd === 'string') patch.cwd = opts.cwd === '' ? null : opts.cwd;
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
    case 'pi': {
      const { opts, positionals } = parse(rest, { json });
      if (!positionals[0]) throw new Error('pi needs an id');
      const launch = openPi(await getItem(positionals[0]));
      if (opts.json) return console.log(JSON.stringify(launch.argv));
      return console.log(`opened pi for ${positionals[0]} in ${launch.argv[0]}`);
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
    case 'widget': {
      const action = rest[0];
      if (action === 'install') return console.log(`installed ${installWidget()}`);
      if (action === 'uninstall') return uninstallWidget();
      if (action === 'path') return console.log(widgetInstallPath());
      throw new Error('widget needs install, uninstall, or path');
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
