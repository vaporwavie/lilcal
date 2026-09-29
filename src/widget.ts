import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataPath } from './store.js';

export const WIDGET_ID = 'org.lilcal.status';

export function widgetSource(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'plasma', WIDGET_ID);
}

export function widgetInstallPath(): string {
  const base = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return join(base, 'plasma', 'plasmoids', WIDGET_ID);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The widget runs through plasmashell's environment, so it gets absolute paths and the data file. */
export function widgetCommand(): string {
  const node = realpathSync(process.execPath);
  const cli = join(dirname(fileURLToPath(import.meta.url)), 'cli.ts');
  const configuredPi = process.env.LILCAL_PI || Bun.which('pi') || 'pi';
  const pi = configuredPi.includes('/') ? resolve(configuredPi) : configuredPi;
  return `env ${shellQuote(`LILCAL_DATA=${resolve(dataPath())}`)} ${shellQuote(`LILCAL_PI=${pi}`)} ${shellQuote(node)} ${shellQuote(cli)}`;
}

export function renderWidget(target: string, command = widgetCommand()): string {
  cpSync(widgetSource(), target, { recursive: true });
  const config = join(target, 'contents', 'config', 'main.xml');
  writeFileSync(config, readFileSync(config, 'utf8').replace('__LILCAL_COMMAND__', xmlEscape(command)));
  return target;
}

function kpackagetool(...args: string[]): void {
  execFileSync('kpackagetool6', ['--type', 'Plasma/Applet', ...args], { stdio: 'inherit' });
}

export function installWidget(): string {
  const staging = mkdtempSync(join(tmpdir(), 'lilcal-widget-'));
  try {
    const pkg = renderWidget(join(staging, WIDGET_ID));
    kpackagetool(existsSync(widgetInstallPath()) ? '--upgrade' : '--install', pkg);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return widgetInstallPath();
}

export function uninstallWidget(): void {
  kpackagetool('--remove', WIDGET_ID);
}
