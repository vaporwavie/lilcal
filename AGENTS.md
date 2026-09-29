# Repository Guidelines

## Project Structure & Module Organization

lilcal is a Bun/TypeScript reminder calendar with CLI, TUI, MCP, and notification daemon interfaces. `src/cli.ts` is the executable entry point. Shared operations live in `src/commands.ts`, date parsing in `src/dates.ts`, data types in `src/model.ts`, and JSON persistence in `src/store.ts`. `src/tui/` contains the OpenTUI view, reducer, keyboard handling, and application loop. Notification and service code lives in `src/daemon.ts`, `src/notify.ts`, and `src/service.ts`. `src/status.ts` builds the one-line status and agenda buckets, `src/digest.ts` the daily digest notification, and `src/widget.ts` installs the Plasma widget package from `plasma/org.lilcal.status/`. Tests live in `test/`. There is no separate asset directory.

## Build, Test, and Development Commands

Use Bun 1.3+ and pnpm for dependencies. Desktop notifications require Linux with `org.freedesktop.Notifications`.

- `pnpm install`: install dependencies using `pnpm-lock.yaml`.
- `bun src/cli.ts`: open the TUI directly. Append `list --json` to exercise the CLI.
- `pnpm typecheck`: run TypeScript checking without emitting files.
- `bun test`: run the test suite. Use `bun test test/dates.test.ts` for a focused check.
- `bun link`: expose the `lilcal` executable on PATH.

There is no build script. Bun executes the TypeScript source directly.

## Coding Style & Naming Conventions

Match existing code with two-space indentation, single quotes, semicolons, and trailing commas in multiline structures. Use camelCase for functions and variables, PascalCase for types, and lowercase module filenames. Keep `.js` extensions in relative imports and use type-only imports where appropriate. TypeScript enables strict checking and `noUncheckedIndexedAccess`. No formatter or lint command is configured.

## Testing Guidelines

Use `bun:test` with descriptive `describe` and `it` blocks in `test/<module>.test.ts`. Reuse `NOW` and `useTempStore()` from `test/helpers.ts`. The preload fixes the timezone to `Europe/Berlin`. TUI tests use OpenTUI's test renderer. Add tests for new behavior and practical regression cases. No coverage threshold is configured.

## Commit & Pull Request Guidelines

History contains only `init: first blood`, so no broader convention is established. Use concise, descriptive commit subjects. PRs should explain the behavior change, link relevant issues, and report checks run. Include terminal screenshots for visible TUI changes.

## Data & Configuration

Set `LILCAL_DATA` to a temporary JSON path for manual experiments. Otherwise, data uses `$XDG_DATA_HOME/lilcal/items.json`, defaulting to `~/.local/share/lilcal/items.json`. Use `update()` in `src/store.ts` for read-modify-write operations that need the file lock.
