import { DEFAULT_HOUR, addDays, dayKey, extractWhen, fmtDay, fmtRelative, fmtWhen, sameDay, startOfDay } from '../dates.js';
import { atMs, isOverdue, sortItems, type Item } from '../model.js';
import type { Key } from './keys.js';

export type Mode =
  | { kind: 'normal' }
  | { kind: 'add'; input: string }
  | { kind: 'confirm'; item: Item }
  | { kind: 'help' };

export type Focus = 'calendar' | 'agenda';

export type State = {
  items: Item[];
  now: Date;
  day: Date;
  month: { y: number; m: number };
  focus: Focus;
  sel: number;
  mode: Mode;
  message: string | null;
  cols: number;
  rows: number;
};

export type Action =
  | { type: 'key'; key: Key }
  | { type: 'items'; items: Item[] }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'tick'; now: Date }
  | { type: 'message'; text: string | null }
  | { type: 'input'; text: string }
  | { type: 'submit'; text: string };

export type Effect =
  | { type: 'quit' }
  | { type: 'add'; text: string; day: Date }
  | { type: 'toggle'; id: string; done: boolean }
  | { type: 'remove'; id: string };

export type AgendaRow =
  | { kind: 'header'; label: string; date: Date; tag?: 'overdue' | 'today' | 'tomorrow' }
  | { kind: 'item'; item: Item; date: Date }
  | { kind: 'empty' };

export function initialState(items: Item[], now: Date, cols: number, rows: number): State {
  const day = startOfDay(now);
  return {
    items: sortItems(items),
    now,
    day,
    month: { y: day.getFullYear(), m: day.getMonth() },
    focus: 'calendar',
    sel: 0,
    mode: { kind: 'normal' },
    message: null,
    cols,
    rows,
  };
}

export function agendaRows(state: State): AgendaRow[] {
  const rows: AgendaRow[] = [];
  const today = startOfDay(state.now);
  const dayStart = startOfDay(state.day);
  if (dayStart.getTime() <= today.getTime()) {
    const overdue = state.items.filter((i) => isOverdue(i, state.now.getTime()) && atMs(i) < today.getTime());
    if (overdue.length) {
      rows.push({ kind: 'header', label: 'Overdue', date: today, tag: 'overdue' });
      for (const item of overdue) rows.push({ kind: 'item', item, date: new Date(item.at) });
    }
  }
  const upcoming = state.items.filter((i) => atMs(i) >= dayStart.getTime());
  const groups = new Map<string, { date: Date; items: Item[] }>();
  const selectedKey = dayKey(dayStart);
  groups.set(selectedKey, { date: dayStart, items: [] });
  for (const item of upcoming) {
    const date = new Date(item.at);
    const key = dayKey(date);
    const group = groups.get(key) ?? { date: startOfDay(date), items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  for (const { date, items } of groups.values()) {
    const tag = sameDay(date, today) ? 'today' : sameDay(date, addDays(today, 1)) ? 'tomorrow' : undefined;
    rows.push({ kind: 'header', label: '', date, tag });
    if (!items.length) rows.push({ kind: 'empty' });
    for (const item of items) rows.push({ kind: 'item', item, date: new Date(item.at) });
  }
  return rows;
}

export function selectableItems(state: State): { item: Item; date: Date }[] {
  return agendaRows(state).flatMap((r) => (r.kind === 'item' ? [{ item: r.item, date: r.date }] : []));
}

export function selectedItem(state: State): Item | undefined {
  return selectableItems(state)[state.sel]?.item;
}

function moveDay(state: State, day: Date): State {
  const next = startOfDay(day);
  return { ...state, day: next, month: { y: next.getFullYear(), m: next.getMonth() }, sel: 0 };
}

function moveMonth(state: State, delta: number): State {
  const y = state.month.y;
  const m = state.month.m + delta;
  const target = new Date(y, m, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  const day = new Date(target.getFullYear(), target.getMonth(), Math.min(state.day.getDate(), lastDay));
  return moveDay(state, day);
}

function clampSel(state: State): State {
  const count = selectableItems(state).length;
  const sel = Math.max(0, Math.min(state.sel, count - 1));
  return sel === state.sel ? state : { ...state, sel };
}

function moveSel(state: State, delta: number): State {
  const list = selectableItems(state);
  if (!list.length) return state;
  const sel = Math.max(0, Math.min(list.length - 1, state.sel + delta));
  const target = list[sel]!;
  const day = startOfDay(target.date);
  const shouldFollow = day.getTime() >= startOfDay(state.day).getTime();
  const next = { ...state, sel };
  if (!shouldFollow || sameDay(day, state.day)) return next;
  return { ...next, month: { y: day.getFullYear(), m: day.getMonth() } };
}

export function reduce(state: State, action: Action): { state: State; effects: Effect[] } {
  const none: Effect[] = [];
  switch (action.type) {
    case 'items':
      return { state: clampSel({ ...state, items: sortItems(action.items) }), effects: none };
    case 'resize':
      return { state: { ...state, cols: action.cols, rows: action.rows }, effects: none };
    case 'tick':
      return { state: { ...state, now: action.now }, effects: none };
    case 'message':
      return { state: { ...state, message: action.text }, effects: none };
    case 'input':
      if (state.mode.kind !== 'add') return { state, effects: none };
      return { state: { ...state, mode: { kind: 'add', input: action.text } }, effects: none };
    case 'submit': {
      if (state.mode.kind !== 'add') return { state, effects: none };
      const text = action.text.trim();
      const next = { ...state, mode: { kind: 'normal' } as Mode };
      return { state: next, effects: text ? [{ type: 'add', text, day: state.day }] : none };
    }
    case 'key':
      return reduceKey(state, action.key);
  }
}

function reduceKey(state: State, key: Key): { state: State; effects: Effect[] } {
  const none: Effect[] = [];
  const mode = state.mode;
  if (key.name === 'ctrl-c') return { state, effects: [{ type: 'quit' }] };

  if (mode.kind === 'help') return { state: { ...state, mode: { kind: 'normal' } }, effects: none };

  if (mode.kind === 'confirm') {
    const yes = key.name === 'char' && (key.ch === 'y' || key.ch === 'Y');
    const next = { ...state, mode: { kind: 'normal' } as Mode };
    return { state: next, effects: yes ? [{ type: 'remove', id: mode.item.id }] : none };
  }

  if (mode.kind === 'add') {
    if (key.name === 'escape') return { state: { ...state, mode: { kind: 'normal' } }, effects: none };
    return { state, effects: none };
  }

  const s: State = state.message ? { ...state, message: null } : state;
  const ch = key.name === 'char' ? key.ch : undefined;
  const agenda = s.focus === 'agenda';

  if (ch === 'q') return { state: s, effects: [{ type: 'quit' }] };
  if (ch === '?') return { state: { ...s, mode: { kind: 'help' } }, effects: none };
  if (ch === 'a') return { state: { ...s, mode: { kind: 'add', input: '' } }, effects: none };
  if (ch === 't') return { state: moveDay(s, s.now), effects: none };
  if (ch === 'n' || key.name === 'pagedown') return { state: moveMonth(s, 1), effects: none };
  if (ch === 'p' || key.name === 'pageup') return { state: moveMonth(s, -1), effects: none };
  if (key.name === 'tab') return { state: { ...s, focus: agenda ? 'calendar' : 'agenda' }, effects: none };
  if (key.name === 'enter' && !agenda) return { state: { ...s, focus: 'agenda' }, effects: none };
  if (key.name === 'escape' && agenda) return { state: { ...s, focus: 'calendar' }, effects: none };

  if (ch === 'x' || key.name === 'delete' || ch === 'd') {
    const item = selectedItem(s);
    if (!item) return { state: { ...s, message: 'Nothing selected' }, effects: none };
    if (ch === 'x') return { state: s, effects: [{ type: 'toggle', id: item.id, done: !item.done }] };
    return { state: { ...s, mode: { kind: 'confirm', item } }, effects: none };
  }

  if (agenda) {
    if (ch === 'j' || key.name === 'down') return { state: moveSel(s, 1), effects: none };
    if (ch === 'k' || key.name === 'up') return { state: moveSel(s, -1), effects: none };
    if (ch === 'g' || key.name === 'home') return { state: moveSel(s, -Infinity), effects: none };
    if (ch === 'G' || key.name === 'end') return { state: moveSel(s, Infinity), effects: none };
    if (ch === 'h' || key.name === 'left') return { state: moveDay(s, addDays(s.day, -1)), effects: none };
    if (ch === 'l' || key.name === 'right') return { state: moveDay(s, addDays(s.day, 1)), effects: none };
    return { state: s, effects: none };
  }

  if (ch === 'h' || key.name === 'left') return { state: moveDay(s, addDays(s.day, -1)), effects: none };
  if (ch === 'l' || key.name === 'right') return { state: moveDay(s, addDays(s.day, 1)), effects: none };
  if (ch === 'j' || key.name === 'down') return { state: moveDay(s, addDays(s.day, 7)), effects: none };
  if (ch === 'k' || key.name === 'up') return { state: moveDay(s, addDays(s.day, -7)), effects: none };
  return { state: s, effects: none };
}

export function addPreview(input: string, state: State): string | null {
  const text = input.trim();
  if (!text) return null;
  const extracted = extractWhen(text, state.now);
  if (extracted) {
    const when = fmtWhen(extracted.when.date, !extracted.when.hasTime, state.now);
    return `${extracted.title} at ${when} (${fmtRelative(extracted.when.date, state.now)})`;
  }
  const date = startOfDay(state.day);
  date.setHours(DEFAULT_HOUR, 0, 0, 0);
  return `${text} on ${fmtDay(date)} all day`;
}
