import { createTestRenderer } from '@opentui/core/testing';
import { describe, expect, it } from 'bun:test';
import type { Item } from '../src/model.js';
import { fromKeyEvent } from '../src/tui/keys.js';
import { addPreview, agendaRows, initialState, reduce, selectedItem, type Action, type State } from '../src/tui/state.js';
import { createUi, type UiHandlers } from '../src/tui/ui.js';
import { NOW } from './helpers.js';

const items: Item[] = [
  { id: 'old111', title: 'Old thing', at: '2026-09-01T09:00:00+02:00', createdAt: '' },
  { id: 'tod111', title: 'Tonight', at: '2026-09-04T23:30:00+02:00', createdAt: '', notes: 'bring the thing' },
  { id: 'sun111', title: 'call mom', at: '2026-09-06T18:00:00+02:00', createdAt: '', tags: ['family'] },
  { id: 'don111', title: 'Finished', at: '2026-09-06T19:00:00+02:00', createdAt: '', done: true },
  { id: 'oct111', title: 'October', at: '2026-10-02T09:00:00+02:00', createdAt: '', allDay: true },
];

const press = (state: State, ...keys: string[]) => {
  let s = state;
  const effects = [];
  for (const k of keys) {
    const key = k.length === 1 ? { name: 'char', ch: k } : { name: k };
    const r = reduce(s, { type: 'key', key } satisfies Action);
    s = r.state;
    effects.push(...r.effects);
  }
  return { state: s, effects };
};

const send = (state: State, action: Action) => reduce(state, action);
const fresh = () => initialState(items, NOW, 100, 24);

describe('fromKeyEvent', () => {
  it('maps OpenTUI key events onto reducer keys', () => {
    const ev = (name: string, extra: Partial<{ sequence: string; ctrl: boolean; shift: boolean }> = {}) => ({ name, sequence: name, ctrl: false, shift: false, ...extra });
    expect(fromKeyEvent(ev('return', { sequence: '\r' }))).toEqual({ name: 'enter' });
    expect(fromKeyEvent(ev('c', { ctrl: true }))).toEqual({ name: 'ctrl-c' });
    expect(fromKeyEvent(ev('g', { sequence: 'G', shift: true }))).toEqual({ name: 'char', ch: 'G' });
    expect(fromKeyEvent(ev('up', { sequence: '\x1b[A' }))).toEqual({ name: 'up' });
    expect(fromKeyEvent(ev('space', { sequence: ' ' }))).toEqual({ name: 'char', ch: ' ' });
    expect(fromKeyEvent(ev('?', { sequence: '?' }))).toEqual({ name: 'char', ch: '?' });
  });
});

describe('reducer', () => {
  it('moves the day cursor and follows months', () => {
    const { state } = press(fresh(), 'l', 'j');
    expect(state.day.getDate()).toBe(12);
    const next = press(state, 'n').state;
    expect(next.month).toEqual({ y: 2026, m: 9 });
    expect(next.day.getDate()).toBe(12);
    const back = press(next, 't').state;
    expect(back.day.getDate()).toBe(4);
    expect(back.month.m).toBe(8);
  });

  it('shows overdue first and lets the agenda selection follow items', () => {
    const state = fresh();
    expect(agendaRows(state)[0]).toMatchObject({ kind: 'header', tag: 'overdue' });
    expect(selectedItem(state)?.id).toBe('old111');
    const { state: focused } = press(state, 'enter', 'j', 'j');
    expect(focused.focus).toBe('agenda');
    expect(selectedItem(focused)?.id).toBe('sun111');
    expect(focused.day.getDate()).toBe(4);
  });

  it('runs the add flow through input and submit actions', () => {
    const typed = send(press(fresh(), 'a').state, { type: 'input', text: 'gym monday 7pm' }).state;
    expect(typed.mode).toEqual({ kind: 'add', input: 'gym monday 7pm' });
    expect(addPreview('gym monday 7pm', typed)).toBe('gym at Mon 7 Sep 19:00 (in 3 days)');
    expect(addPreview('water plants', typed)).toBe('water plants on Fri 4 Sep all day');
    const { state, effects } = send(typed, { type: 'submit', text: 'gym monday 7pm' });
    expect(state.mode.kind).toBe('normal');
    expect(effects).toEqual([{ type: 'add', text: 'gym monday 7pm', day: state.day }]);
    expect(press(typed, 'escape').state.mode.kind).toBe('normal');
    expect(press(typed, 'q').effects).toEqual([]);
  });

  it('toggles done and confirms deletes', () => {
    expect(press(fresh(), 'x').effects).toEqual([{ type: 'toggle', id: 'old111', done: true }]);
    const { state } = press(fresh(), 'd');
    expect(state.mode.kind).toBe('confirm');
    expect(press(state, 'n').effects).toEqual([]);
    expect(press(state, 'y').effects).toEqual([{ type: 'remove', id: 'old111' }]);
  });

  it('quits on q and ctrl-c', () => {
    expect(press(fresh(), 'q').effects).toEqual([{ type: 'quit' }]);
    expect(press(fresh(), 'ctrl-c').effects).toEqual([{ type: 'quit' }]);
  });
});

describe('ui', () => {
  async function frameFor(state: State, handlers: UiHandlers = { onInput: () => {}, onSubmit: () => {} }) {
    const setup = await createTestRenderer({ width: 100, height: 24 });
    const ui = createUi(setup.renderer, handlers);
    ui.update(state);
    await setup.renderOnce();
    return { setup, ui, frame: setup.captureCharFrame() };
  }

  it('draws the calendar, agenda, and status line', async () => {
    const { setup, frame } = await frameFor(fresh());
    try {
      expect(frame).toContain('September 2026');
      expect(frame).toContain('Mo Tu We Th Fr Sa Su');
      expect(frame).toContain(' 1  2  3  4  5  6');
      expect(frame).toContain('Overdue');
      expect(frame).toContain('Old thing');
      expect(frame).toContain('Fri 4 Sep  today');
      expect(frame).toContain('23:30   Tonight');
      expect(frame).toContain('#family');
      expect(frame).toContain('all day October');
      expect(frame).toContain('q quit');
      expect(frame).toContain('1 today, 1 overdue');
    } finally {
      setup.renderer.destroy();
    }
  });

  it('shows notes for the selected item and empty days', async () => {
    const selected = await frameFor(press(fresh(), 'enter', 'j').state);
    try {
      expect(selected.frame).toContain('bring the thing');
    } finally {
      selected.setup.renderer.destroy();
    }
    const empty = await frameFor(press(fresh(), 'l').state);
    try {
      expect(empty.frame).toContain('Sat 5 Sep  tomorrow');
      expect(empty.frame).toContain('nothing scheduled');
    } finally {
      empty.setup.renderer.destroy();
    }
  });

  it('shows help and wires the add input to the handlers', async () => {
    const help = await frameFor(press(fresh(), '?').state);
    try {
      expect(help.frame).toContain('toggle done');
    } finally {
      help.setup.renderer.destroy();
    }
    const typed: string[] = [];
    const submitted: string[] = [];
    const adding = await frameFor(press(fresh(), 'a').state, { onInput: (v) => void typed.push(v), onSubmit: (v) => void submitted.push(v) });
    try {
      expect(adding.frame).toContain(' add ');
      expect(adding.frame).toContain('Esc cancels');
      await adding.setup.mockInput.typeText('hi');
      adding.setup.mockInput.pressEnter();
      await adding.setup.renderOnce();
      expect(typed).toEqual(['h', 'hi']);
      expect(submitted).toEqual(['hi']);
      expect(adding.setup.captureCharFrame()).toContain('hi');
    } finally {
      adding.setup.renderer.destroy();
    }
  });
});
