import { DEFAULT_HOUR, extractWhen, parseWhen, toISO, type Parsed } from './dates.js';
import { atMs, findItem, newId, sortItems, validate, type Item } from './model.js';
import { load, update } from './store.js';

export type AddInput = {
  title: string;
  at?: string;
  end?: string;
  notes?: string;
  tags?: string[];
  lead?: number;
  fallbackDay?: Date;
};

export type ListFilter = {
  from?: Date;
  to?: Date;
  includeDone?: boolean;
  tag?: string;
  query?: string;
};

export type Patch = {
  title?: string;
  at?: string;
  end?: string | null;
  notes?: string | null;
  tags?: string[];
  lead?: number | null;
};

export async function addItem(input: AddInput, now: Date = new Date()): Promise<Item> {
  let title = input.title.trim();
  let when: Parsed | null = null;
  if (input.at) {
    when = parseWhen(input.at, now);
    if (!when) throw new Error(`could not understand date: ${input.at}`);
  } else {
    const extracted = extractWhen(title, now);
    if (extracted) {
      title = extracted.title;
      when = extracted.when;
    } else if (input.fallbackDay) {
      const date = new Date(input.fallbackDay);
      date.setHours(DEFAULT_HOUR, 0, 0, 0);
      when = { date, hasTime: false, hasDate: true, index: 0, text: '' };
    } else {
      throw new Error('no date found: pass --at or put a date in the title');
    }
  }
  const item: Item = { id: newId(), title, at: toISO(when.date), createdAt: toISO(now) };
  if (!when.hasTime) item.allDay = true;
  const end = input.end ? parseEnd(input.end, when.date) : when.end ? toISO(when.end) : undefined;
  if (end) item.end = end;
  if (input.notes?.trim()) item.notes = input.notes.trim();
  const tags = normalizeTags(input.tags);
  if (tags.length) item.tags = tags;
  if (input.lead !== undefined) item.lead = input.lead;
  validate(item);
  await update((items) => {
    items.push(item);
  });
  return item;
}

export async function listItems(filter: ListFilter = {}): Promise<Item[]> {
  const items = sortItems(await load());
  const tag = filter.tag?.toLowerCase().replace(/^#/, '');
  const query = filter.query?.toLowerCase();
  return items.filter((item) => {
    if (!filter.includeDone && item.done) return false;
    if (tag && !(item.tags ?? []).includes(tag)) return false;
    const t = atMs(item);
    if (filter.from && t < filter.from.getTime()) return false;
    if (filter.to && t > filter.to.getTime()) return false;
    if (query && !`${item.title} ${item.notes ?? ''}`.toLowerCase().includes(query)) return false;
    return true;
  });
}

export async function getItem(id: string): Promise<Item> {
  return findItem(await load(), id);
}

export async function updateItem(id: string, patch: Patch, now: Date = new Date()): Promise<Item> {
  let result: Item | undefined;
  await update((items) => {
    const item = findItem(items, id);
    if (patch.title !== undefined) item.title = patch.title.trim();
    if (patch.at !== undefined) {
      const when = parseWhen(patch.at, now);
      if (!when) throw new Error(`could not understand date: ${patch.at}`);
      const date = when.date;
      if (!when.hasDate) {
        const current = new Date(item.at);
        date.setFullYear(current.getFullYear(), current.getMonth(), current.getDate());
      }
      item.at = toISO(date);
      if (when.hasTime) delete item.allDay;
      else item.allDay = true;
      delete item.notifiedAt;
      if (when.end) item.end = toISO(when.end);
    }
    if (patch.end === null) delete item.end;
    else if (patch.end !== undefined) item.end = parseEnd(patch.end, new Date(item.at));
    if (patch.notes === null) delete item.notes;
    else if (patch.notes !== undefined) item.notes = patch.notes.trim();
    if (patch.tags !== undefined) {
      const tags = normalizeTags(patch.tags);
      if (tags.length) item.tags = tags;
      else delete item.tags;
    }
    if (patch.lead === null) delete item.lead;
    else if (patch.lead !== undefined) item.lead = patch.lead;
    validate(item);
    result = item;
  });
  return result!;
}

export async function completeItem(id: string, done = true): Promise<Item> {
  let result: Item | undefined;
  await update((items) => {
    const item = findItem(items, id);
    if (done) item.done = true;
    else delete item.done;
    result = item;
  });
  return result!;
}

export async function removeItem(id: string): Promise<Item> {
  let result: Item | undefined;
  await update((items) => {
    const item = findItem(items, id);
    result = item;
    return items.filter((i) => i.id !== item.id);
  });
  return result!;
}

function parseEnd(text: string, start: Date): string {
  const parsed = parseWhen(text, start);
  if (!parsed) throw new Error(`could not understand end date: ${text}`);
  const date = parsed.date;
  if (!parsed.hasDate) date.setFullYear(start.getFullYear(), start.getMonth(), start.getDate());
  return toISO(date);
}

export function normalizeTags(tags: string[] | undefined): string[] {
  const seen = new Set<string>();
  for (const raw of tags ?? []) {
    for (const part of raw.split(',')) {
      const tag = part.trim().toLowerCase().replace(/^#/, '');
      if (tag) seen.add(tag);
    }
  }
  return [...seen];
}
