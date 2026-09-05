import { mkdirSync, readFileSync, utimesSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import type { Item } from '../src/model.js';
import { load, save, update } from '../src/store.js';
import { useTempStore } from './helpers.js';

const item = (id: string): Item => ({ id, title: id, at: '2026-09-10T09:00:00+02:00', createdAt: '2026-09-04T22:40:00+02:00' });

describe('store', () => {
  it('loads an empty list when the file is missing', async () => {
    const path = useTempStore();
    expect(await load(path)).toEqual([]);
  });

  it('round-trips items through a versioned file', async () => {
    const path = useTempStore();
    await save([item('a')], path);
    expect(JSON.parse(readFileSync(path, 'utf8')).version).toBe(1);
    expect(await load(path)).toEqual([item('a')]);
  });

  it('serialises concurrent updates', async () => {
    const path = useTempStore();
    await Promise.all(['a', 'b', 'c', 'd'].map((id) => update((items) => void items.push(item(id)), path)));
    expect((await load(path)).map((i) => i.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('breaks stale locks', async () => {
    const path = useTempStore();
    mkdirSync(`${path}.lock`);
    const old = new Date(Date.now() - 60_000);
    utimesSync(`${path}.lock`, old, old);
    await update((items) => void items.push(item('a')), path);
    expect(await load(path)).toHaveLength(1);
  });
});
