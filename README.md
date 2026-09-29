# lilcal

> **Archived.** No longer maintained; reminders moved to Todoist (`td` CLI). Unmerged work lives on the `archive/pre-todoist` branch.

Reminders and scheduled agent tasks. One JSON file underneath, four ways in: a calendar TUI, a CLI, an MCP server, and a daemon that runs tasks through pi and delivers desktop notifications over D-Bus.

Tell an agent "remind me next week to follow up on this" for a desktop reminder, or "review this project tomorrow morning" for work performed independently. Tasks run at the scheduled time and their results arrive on your desktop.

## Install

```sh
git clone <this repo> lilcal && cd lilcal
pnpm install
bun link                 # puts `lilcal` on PATH (~/.bun/bin)
lilcal service install   # runs scheduled tasks and notifications as a systemd user service
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

## Scheduled tasks with pi

Add `prompt` to an event to have [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) carry out work at its scheduled time. Install pi and configure its provider/model and authentication first, as you would for an ordinary pi session. Task execution also uses GNU coreutils `timeout` to enforce deadlines independently of the daemon.

```sh
lilcal add "Review project" --at "tomorrow 9am" \
  --prompt "Review recent changes and summarize any issues. Do not modify files." \
  --cwd "$PWD" --json
lilcal service install
lilcal show <id>                   # prompt, execution status, result or error
lilcal edit <id> --at "in 1 hour"  # explicitly schedule another attempt
```

The existing MCP `add_reminder` and `update_reminder` tools accept the same `prompt` and `cwd` fields. `list_reminders` returns execution details in `run`. Omit `prompt` for an ordinary reminder. Clear it with `lilcal edit <id> --prompt ""` or an empty/null MCP field. `cwd` defaults to your home directory; explicit relative paths are resolved when the event is created or edited.

Each task starts a fresh, noninteractive `pi --print --mode text --no-session` process with the event title, time, notes, tags, and task prompt. It uses pi's configured model, authentication, extensions, and tools, with your user permissions. These are unattended agent runs, so schedule only work you authorize pi to perform. The agent receives the lilcal CLI location and data path so it can manage follow-up events when instructed.

Tasks run at `at`, including missed events after the daemon starts. `lead` only sends an advance reminder. The daemon polls while tasks run, with up to four tracked tasks executing concurrently and a 15-minute limit per run. Successes and failures produce desktop notifications; failures are critical. Responses are stored up to 64K characters, with a shorter desktop preview. `show` and JSON responses expose the saved result. Successful execution does not mark the calendar item done.

Execution is claimed in the data file before pi starts. Failed or interrupted runs require an explicit `at` edit to try again; editing the prompt or notes alone does not replay work. After a crash, a running claim becomes failed after its deadline and a short grace period. Check any partial effects before rescheduling. Notification delivery is retried independently of execution. A crash around notification delivery can duplicate a notification, but does not replay the task.

While a task is running, its time, prompt, and directory cannot be edited. Marking it done or deleting it does not cancel the active process; deleting also discards its eventual result. Stopping the daemon interrupts its active pi processes. `daemon --once` waits for the batch it starts (up to four tasks).

`LILCAL_PI` selects an alternative pi executable or wrapper (a path or executable name, not a shell command). The service installer captures this setting, your `PATH`, and the resolved data path, and restarts the service. Reinstall after changing these settings. Configure any additional provider environment in the systemd user service environment; the installer does not copy authentication variables.

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

`lilcal daemon` checks every 30 seconds and notifies each open reminder once, at its time or `--lead` minutes before. Reminders that came due while the daemon was off fire as soon as it starts, marked overdue and critical. Task events deliver pi's result instead of an ordinary due-time reminder. Notifications request an unlimited display timeout; the desktop controls presentation.

```sh
lilcal service status              # systemd unit state
journalctl --user -u lilcal -f     # what fired and when
lilcal daemon --once               # single check, cron friendly
```

## Data

Items live in `~/.local/share/lilcal/items.json` (`LILCAL_DATA` overrides the path, `lilcal path` prints it). Each item has `id`, `title`, `at`, `createdAt`, and optionally `end`, `allDay`, `notes`, `tags`, `lead`, `done`, `notifiedAt`, `prompt`, `cwd`, and `run`. A run records its ID, status (`running`, `succeeded`, or `failed`), start/deadline/finish times, output or error, and result notification time. Rescheduling clears the previous run. Times are ISO 8601 with the local offset. Writes go through a lock and an atomic rename, so the TUI, CLI, daemon, and agents can write at the same time.

## Develop

```sh
pnpm typecheck
bun test
```

Pure logic (dates, store, commands, daemon, MCP, TUI reducer) is tested directly. The TUI view is tested through OpenTUI's test renderer, which checks rendered frames without a terminal.
