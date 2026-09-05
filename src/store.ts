import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Item } from './model.js';

type FileShape = { version: 1; items: Item[] };

export function dataPath(): string {
  if (process.env.LILCAL_DATA) return process.env.LILCAL_DATA;
  const base = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return join(base, 'lilcal', 'items.json');
}

export async function load(path = dataPath()): Promise<Item[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  if (!raw.trim()) return [];
  const data = JSON.parse(raw) as FileShape | Item[];
  const items = Array.isArray(data) ? data : data.items;
  if (!Array.isArray(items)) throw new Error(`unexpected data in ${path}`);
  return items;
}

export async function save(items: Item[], path = dataPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  const body: FileShape = { version: 1, items };
  await writeFile(tmp, JSON.stringify(body, null, 2) + '\n', 'utf8');
  await rename(tmp, path);
}

export async function update(fn: (items: Item[]) => Item[] | void, path = dataPath()): Promise<Item[]> {
  return withLock(path, async () => {
    const items = await load(path);
    const next = fn(items) ?? items;
    await save(next, path);
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
