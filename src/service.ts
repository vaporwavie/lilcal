import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataPath } from './store.js';

export const SERVICE_NAME = 'lilcal';

export function unitPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'systemd', 'user', `${SERVICE_NAME}.service`);
}

// systemd expands specifiers in all values and dollar variables in ExecStart.
function unitQuote(value: string, command = false): string {
  return JSON.stringify(value.replace(/%/g, '%%').replace(/\$/g, () => command ? '$$' : '$'));
}
export function unitText(): string {
  const node = realpathSync(process.execPath);
  const cli = join(dirname(fileURLToPath(import.meta.url)), 'cli.ts');
  const configuredPi = process.env.LILCAL_PI || Bun.which('pi') || 'pi';
  const pi = configuredPi.includes('/') ? resolve(configuredPi) : configuredPi;
  return [
    '[Unit]',
    'Description=lilcal scheduled tasks and notifications',
    'After=graphical-session.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${unitQuote(node, true)} ${unitQuote(cli, true)} daemon`,
    'WorkingDirectory=~',
    `Environment=${unitQuote(`PATH=${process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin'}`)}`,
    `Environment=${unitQuote(`LILCAL_PI=${pi}`)}`,
    `Environment=${unitQuote(`LILCAL_DATA=${resolve(dataPath())}`)}`,
    'KillMode=control-group',
    'Restart=on-failure',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

function systemctl(...args: string[]): void {
  execFileSync('systemctl', ['--user', ...args], { stdio: 'inherit' });
}

export function installService(): string {
  const path = unitPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, unitText());
  systemctl('daemon-reload');
  systemctl('enable', SERVICE_NAME);
  systemctl('restart', SERVICE_NAME);
  return path;
}

export function uninstallService(): void {
  try {
    systemctl('disable', '--now', SERVICE_NAME);
  } finally {
    rmSync(unitPath(), { force: true });
    systemctl('daemon-reload');
  }
}

export function serviceStatus(): void {
  try {
    systemctl('status', SERVICE_NAME, '--no-pager');
  } catch {
    process.exitCode = 1;
  }
}
