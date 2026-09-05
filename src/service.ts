import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVICE_NAME = 'lilcal';

export function unitPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'systemd', 'user', `${SERVICE_NAME}.service`);
}

export function unitText(): string {
  const node = realpathSync(process.execPath);
  const cli = join(dirname(fileURLToPath(import.meta.url)), 'cli.ts');
  return [
    '[Unit]',
    'Description=lilcal reminder notifications',
    'After=graphical-session.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${node} ${cli} daemon`,
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
  systemctl('enable', '--now', SERVICE_NAME);
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
