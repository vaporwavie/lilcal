import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { taskPrompt } from './agent.js';
import type { Item } from './model.js';
import { dataPath } from './store.js';

export type Launch = { argv: string[]; cwd: string; env: Record<string, string> };

// Each terminal's argument form for running a command inside it.
const TERMINALS: Array<[name: string, prefix: string[]]> = [
  ['xdg-terminal-exec', []],
  ['konsole', ['-e']],
  ['kitty', []],
  ['alacritty', ['-e']],
  ['foot', []],
  ['wezterm', ['start', '--']],
  ['ghostty', ['-e']],
  ['gnome-terminal', ['--']],
  ['xfce4-terminal', ['-x']],
  ['xterm', ['-e']],
];

export function terminalPrefix(env: NodeJS.ProcessEnv = process.env, which: (name: string) => string | null = Bun.which): string[] {
  const preferred = env.LILCAL_TERMINAL || env.TERMINAL;
  if (preferred) {
    const name = preferred.split('/').pop() ?? preferred;
    const known = TERMINALS.find(([candidate]) => candidate === name);
    return [preferred, ...(known ? known[1] : ['-e'])];
  }
  for (const [name, prefix] of TERMINALS) {
    const path = which(name);
    if (path) return [path, ...prefix];
  }
  throw new Error('no terminal found, set LILCAL_TERMINAL or TERMINAL');
}

/** Interactive pi in a new terminal window, seeded with the event's task prompt. */
export function piLaunch(item: Item, env: NodeJS.ProcessEnv = process.env, which?: (name: string) => string | null): Launch {
  if (!item.prompt?.trim()) throw new Error(`${item.id} has no prompt`);
  const configured = env.LILCAL_PI ?? 'pi';
  const pi = configured.includes('/') ? resolve(configured) : configured;
  return {
    argv: [...terminalPrefix(env, which), pi, '--', taskPrompt(item)],
    cwd: item.cwd ?? homedir(),
    env: { ...(env as Record<string, string>), LILCAL_DATA: resolve(dataPath()) },
  };
}

export function openPi(item: Item): Launch {
  const launch = piLaunch(item);
  const [command, ...args] = launch.argv;
  const child = spawn(command!, args, { cwd: launch.cwd, env: launch.env, stdio: 'ignore', detached: true });
  child.unref();
  return launch;
}
