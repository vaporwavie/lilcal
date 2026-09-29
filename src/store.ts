import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Item, Settings } from './model.js';

type FileShape = { version: 1; items: Item[]; settings?: Settings };

export function dataPath(): string {
  if (process.env.LILCAL_DATA) return process.env.LILCAL_DATA;
  const base = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return join(base, 'lilcal', 'items.json');
}

async function loadFile(path: string): Promise<FileShape> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, items: [] };
    throw err;
  }
  if (!raw.trim()) return { version: 1, items: [] };
  const data = JSON.parse(raw) as FileShape | Item[];
  if (Array.isArray(data)) return { version: 1, items: data };
  if (!Array.isArray(data.items)) throw new Error(`unexpected data in ${path}`);
  return { version: 1, items: data.items, ...(data.settings ? { settings: data.settings } : {}) };
}

export async function load(path = dataPath()): Promise<Item[]> {
  return (await loadFile(path)).items;
}

export async function loadSettings(path = dataPath()): Promise<Settings> {
  return (await loadFile(path)).settings ?? {};
}

async function saveFile(file: FileShape, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  const body: FileShape = { version: 1, items: file.items };
  if (file.settings && Object.keys(file.settings).length) body.settings = file.settings;
  await writeFile(tmp, JSON.stringify(body, null, 2) + '\n', 'utf8');
  await rename(tmp, path);
}

export async function save(items: Item[], path = dataPath(), settings?: Settings): Promise<void> {
  await saveFile({ version: 1, items, ...(settings ? { settings } : {}) }, path);
}

export async function update(fn: (items: Item[]) => Item[] | void, path = dataPath()): Promise<Item[]> {
  return withLock(path, async () => {
    const file = await loadFile(path);
    const next = fn(file.items) ?? file.items;
    await saveFile({ ...file, items: next }, path);
    return next;
  });
}

export async function updateSettings(fn: (settings: Settings) => Settings | void, path = dataPath()): Promise<Settings> {
  return withLock(path, async () => {
    const file = await loadFile(path);
    const settings = file.settings ?? {};
    const next = fn(settings) ?? settings;
    await saveFile({ ...file, settings: next }, path);
    return next;
  });
}

const LOCK_TIMEOUT_MS = 3000;
const LOCK_STALE_MS = 10_000;

async function withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${path}.lock`;
  mkdirSync(dirname(path), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const age = Date.now() - (await stat(lock).then((s) => s.mtimeMs, () => Date.now()));
      if (age > LOCK_STALE_MS) {
        await rm(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for lock ${lock}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
