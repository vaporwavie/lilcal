# lilcal

Reminders and events for you and your agents. One JSON file underneath, four ways in: a calendar TUI, a CLI, an MCP server for Claude Code and Codex, and a daemon that fires desktop notifications over D-Bus.

The point is continuity. Tell an agent "remind me next week to follow up on this" and the reminder lands in the same calendar you open in the terminal, then pops up on your desktop when it is due, with the notes the agent left for you.

## Install

```sh
git clone <this repo> lilcal && cd lilcal
pnpm install
bun link                 # puts `lilcal` on PATH (~/.bun/bin)
lilcal service install   # runs the notifier as a systemd user service
```

Needs Bun 1.3+ (the TUI is built on [OpenTUI](https://github.com/anomalyco/opentui)), pnpm for dependencies, and a Linux desktop that provides `org.freedesktop.Notifications`.

## Agents

Register the MCP server once. After that, asking for a reminder in plain language is enough.

```sh
claude mcp add --scope user lilcal -- bun /path/to/lilcal/src/cli.ts mcp
codex mcp add lilcal -- bun /path/to/lilcal/src/cli.ts mcp
```

The server exposes `add_reminder`, `list_reminders`, `update_reminder`, `complete_reminder`, `remove_reminder`, and `send_notification`. Its instructions tell the agent to add reminders without asking first, to pass `at` in natural language, to put pickup context (paths, links, ticket ids) in `notes`, and to repeat the resolved time back to you. Every response includes the current local time so relative dates resolve the same way on both sides.

Agents without MCP can shell out. Every command that prints an item takes `--json`:

```sh
lilcal add "Review PR #42" --at "next tuesday 10am" --notes "branch feat/x" --tag lilcal --json
lilcal list --json
lilcal notify "Build finished" "3 tests failed in store.test.ts"
```

## Terminal

`lilcal` opens the calendar. The left pane is the month, the right pane is the agenda from the selected day onward, with overdue items on top.

| Key | Action |
| --- | --- |
| `h j k l`, arrows | move by day or week, `n` / `p` change month, `t` jumps to today |
| `Enter`, `Tab` | focus the agenda, then `j` / `k` select items |
| `a` | add an item. Type `call mom sunday 6pm`, check the preview, press Enter |
| `x`, `d` | toggle done, delete (asks first) |
| `?`, `q` | help, quit |

The TUI reloads when the file changes, so an agent adding a reminder shows up while you watch.

The CLI covers the same actions.

```sh
lilcal add "call mom sunday 6pm"          # date parsed out of the title
lilcal add "Dentist" --at 2026-09-12T15:00 --end 4pm
lilcal list                               # open items, overdue marked with !
lilcal edit <id> --at 4pm                 # bare time keeps the day, re-arms the notification
lilcal done <id>   lilcal rm <id>   lilcal show <id>
```

Dates accept `next tuesday 10am`, `tomorrow`, `in 2 hours`, `friday`, `monday morning`, or ISO 8601. A date without a time becomes an all-day item that notifies at 09:00.

## Notifications

`lilcal daemon` checks every 30 seconds and notifies each open item once, at its time or `--lead` minutes before. Items that came due while the daemon was off fire as soon as it starts, marked overdue and critical, so nothing slips past. Notifications stay on screen until dismissed.

```sh
lilcal service status              # systemd unit state
journalctl --user -u lilcal -f     # what fired and when
lilcal daemon --once               # single check, cron friendly
```

## Data

Items live in `~/.local/share/lilcal/items.json` (`LILCAL_DATA` overrides the path, `lilcal path` prints it). Each item has `id`, `title`, `at`, `createdAt`, and optionally `end`, `allDay`, `notes`, `tags`, `lead`, `done`, and `notifiedAt`. Times are ISO 8601 with the local offset. Writes go through a lock and an atomic rename, so the TUI, CLI, daemon, and agents can write at the same time.

## Develop

```sh
pnpm typecheck
bun test
```

Pure logic (dates, store, commands, daemon, MCP, TUI reducer) is tested directly. The TUI view is tested through OpenTUI's test renderer, which checks rendered frames without a terminal.
