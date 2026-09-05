import { randomBytes } from 'node:crypto';

export type Item = {
  id: string;
  title: string;
  at: string;
  end?: string;
  allDay?: boolean;
  notes?: string;
  tags?: string[];
  lead?: number;
  done?: boolean;
  notifiedAt?: string;
  createdAt: string;
};

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function newId(length = 6): string {
  const bytes = randomBytes(length);
  let id = '';
  for (let i = 0; i < length; i++) id += ALPHABET[bytes[i]! % ALPHABET.length];
  return id;
}

export function atMs(item: Item): number {
  return new Date(item.at).getTime();
}

export function notifyAtMs(item: Item): number {
  return atMs(item) - (item.lead ?? 0) * 60_000;
}

export function isOverdue(item: Item, now: number): boolean {
  return !item.done && atMs(item) < now;
}

export function sortItems(items: Item[]): Item[] {
  return [...items].sort((a, b) => atMs(a) - atMs(b) || a.createdAt.localeCompare(b.createdAt));
}

export function findItem(items: Item[], idOrPrefix: string): Item {
  const exact = items.find((i) => i.id === idOrPrefix);
  if (exact) return exact;
  const matches = items.filter((i) => i.id.startsWith(idOrPrefix));
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) throw new Error(`no item with id ${idOrPrefix}`);
  throw new Error(`ambiguous id ${idOrPrefix}: ${matches.map((m) => m.id).join(', ')}`);
}

export function validate(item: Item): void {
  if (!item.title.trim()) throw new Error('title is empty');
  if (Number.isNaN(atMs(item))) throw new Error(`invalid date: ${item.at}`);
  if (item.end !== undefined) {
    const end = new Date(item.end).getTime();
    if (Number.isNaN(end)) throw new Error(`invalid end date: ${item.end}`);
    if (end < atMs(item)) throw new Error('end is before start');
  }
  if (item.lead !== undefined && (!Number.isFinite(item.lead) || item.lead < 0)) {
    throw new Error('lead must be a non-negative number of minutes');
  }
}
