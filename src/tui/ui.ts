import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  RGBA,
  ScrollBoxRenderable,
  TextRenderable,
  bg,
  bold,
  fg,
  t,
  underline,
  type CliRenderer,
  type StylableInput,
  type StyledText,
} from '@opentui/core';
import { dayKey, fmtDay, fmtMonth, fmtTime, sameDay } from '../dates.js';
import { isOverdue, type Item } from '../model.js';
import { addPreview, agendaRows, selectableItems, type State } from './state.js';

export const LEFT_W = 24;

const P = {
  accent: '#7dcfff',
  red: '#f7768e',
  yellow: '#e0af68',
  green: '#9ece6a',
  muted: '#6b7089',
  select: '#2f3b5c',
  divider: '#3b4261',
  ink: '#1a1b26',
};

const FG = RGBA.defaultForeground();

type Chunk = StylableInput | string;

function styled(parts: Chunk[]): StyledText {
  const strings = Object.assign(Array<string>(parts.length + 1).fill(''), { raw: Array<string>(parts.length + 1).fill('') });
  return t(strings as unknown as TemplateStringsArray, ...parts);
}

const muted = (s: string) => fg(P.muted)(s);

export type UiHandlers = { onInput(text: string): void; onSubmit(text: string): void };

export type Ui = { update(state: State): void; input: InputRenderable };

export function createUi(renderer: CliRenderer, handlers: UiHandlers): Ui {
  const text = (extra: Partial<ConstructorParameters<typeof TextRenderable>[1]> = {}) =>
    new TextRenderable(renderer, { content: '', fg: FG, wrapMode: 'none', selectable: false, ...extra });

  const main = new BoxRenderable(renderer, { flexDirection: 'row', flexGrow: 1, flexShrink: 1, width: '100%' });
  const calendar = new BoxRenderable(renderer, {
    width: LEFT_W,
    flexShrink: 0,
    flexDirection: 'column',
    paddingLeft: 1,
    border: ['right'],
    borderColor: P.divider,
  });
  const monthTitle = text();
  const weekdays = text();
  const weeks = Array.from({ length: 6 }, () => text());
  const clock = text();
  const counts = text();
  const legend = text();
  for (const node of [monthTitle, weekdays, ...weeks, text(), clock, counts, text(), legend]) calendar.add(node);

  const agenda = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    flexShrink: 1,
    paddingLeft: 1,
    viewportCulling: true,
    scrollbarOptions: { trackOptions: { foregroundColor: P.divider, backgroundColor: 'transparent' } },
  });

  const status = new BoxRenderable(renderer, { height: 1, width: '100%', flexShrink: 0, flexDirection: 'row', paddingLeft: 1 });
  const statusText = text({ flexGrow: 1 });
  const addLabel = text({ content: styled([bg(P.accent)(fg(P.ink)(bold(' add '))), ' ']), visible: false });
  const input = new InputRenderable(renderer, {
    flexGrow: 1,
    visible: false,
    textColor: FG,
    cursorColor: P.accent,
    placeholder: 'call mom sunday 6pm',
  });
  const preview = text({ visible: false, flexShrink: 0 });
  input.on(InputRenderableEvents.INPUT, (value: string) => handlers.onInput(value));
  input.on(InputRenderableEvents.ENTER, (value: string) => handlers.onSubmit(value));
  for (const node of [statusText, addLabel, input, preview]) status.add(node);

  main.add(calendar);
  main.add(agenda);
  renderer.root.add(main);
  renderer.root.add(status);

  let rows: BoxRenderable[] = [];

  function renderCalendar(state: State): void {
    const { y, m } = state.month;
    monthTitle.content = styled([bold(fmtMonth(y, m))]);
    weekdays.content = styled([muted('Mo Tu We Th Fr Sa Su')]);
    const perDay = dayCounts(state.items, state.now.getTime());
    const first = new Date(y, m, 1);
    const offset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    let day = 1 - offset;
    for (const week of weeks) {
      const chunks: Chunk[] = [];
      for (let wd = 0; wd < 7; wd++, day++) {
        if (day < 1 || day > daysInMonth) {
          chunks.push('   ');
          continue;
        }
        const date = new Date(y, m, day);
        const entry = perDay.get(dayKey(date));
        let cell: StylableInput | string = String(day).padStart(2, ' ');
        const color = entry?.overdue ? P.red : entry?.open ? P.accent : entry?.done ? P.muted : undefined;
        if (color) cell = fg(color)(cell);
        if (sameDay(date, state.now)) cell = bold(underline(cell));
        if (sameDay(date, state.day)) cell = bg(P.select)(cell);
        chunks.push(cell, ' ');
      }
      week.content = styled(chunks);
    }
    const overdue = state.items.filter((i) => isOverdue(i, state.now.getTime())).length;
    const todayOpen = state.items.filter((i) => !i.done && sameDay(new Date(i.at), state.now)).length;
    clock.content = styled([muted(`${fmtDay(state.now)} ${fmtTime(state.now)}`)]);
    counts.content = styled([
      todayOpen ? fg(P.accent)(`${todayOpen} today`) : muted('0 today'),
      overdue ? fg(P.red)(`, ${overdue} overdue`) : '',
    ]);
    legend.content = styled([fg(P.accent)('■'), muted(' open  '), fg(P.red)('■'), muted(' overdue')]);
  }

  function row(chunks: Chunk[], highlight = false): BoxRenderable {
    const box = new BoxRenderable(renderer, {
      width: '100%',
      height: 1,
      flexShrink: 0,
      backgroundColor: highlight ? P.select : 'transparent',
    });
    box.add(text({ content: styled(chunks) }));
    return box;
  }

  function renderAgenda(state: State): void {
    for (const old of rows) {
      agenda.remove(old);
      old.destroyRecursively();
    }
    rows = [];
    const next: BoxRenderable[] = [];
    let selectedLine = 0;
    if (state.mode.kind === 'help') {
      for (const [k, v] of HELP) next.push(row(k ? [fg(P.accent)(k.padEnd(18)), v] : [bold(v)]));
    } else {
      const selected = selectableItems(state)[state.sel]?.item;
      let first = true;
      for (const r of agendaRows(state)) {
        if (r.kind === 'header') {
          if (!first) next.push(row([]));
          first = false;
          if (r.tag === 'overdue') {
            next.push(row([bold(fg(P.red)('Overdue'))]));
            continue;
          }
          const chunks: Chunk[] = [bold(fmtDay(r.date, r.date.getFullYear() !== state.now.getFullYear()))];
          if (r.tag) chunks.push(fg(P.yellow)(`  ${r.tag}`));
          next.push(row(chunks));
          continue;
        }
        if (r.kind === 'empty') {
          next.push(row([muted('  nothing scheduled')]));
          continue;
        }
        const item = r.item;
        const isSelected = selected?.id === item.id;
        const focused = isSelected && state.focus === 'agenda';
        const overdue = isOverdue(item, state.now.getTime());
        const time = item.allDay ? 'all day' : fmtTime(r.date);
        const chunks: Chunk[] = [
          isSelected && !focused ? bold('›') : ' ',
          item.done ? fg(P.green)('✓ ') : '  ',
          fg(item.done ? P.muted : overdue ? P.red : P.accent)(time.padEnd(8)),
          item.done ? muted(item.title) : bold(item.title),
        ];
        if (item.end && !item.allDay) chunks.push(muted(` until ${fmtTime(new Date(item.end))}`));
        if (item.tags?.length) chunks.push(muted(`  ${item.tags.map((tag) => `#${tag}`).join(' ')}`));
        if (isSelected) selectedLine = next.length;
        next.push(row(chunks, focused));
        if (isSelected && item.notes) {
          for (const line of wrap(item.notes, Math.max(10, agendaWidth() - 12)).slice(0, 4)) next.push(row([muted(`           ${line}`)]));
        }
      }
    }
    for (const box of next) agenda.add(box);
    rows = next;
    const viewport = Math.max(1, renderer.height - 1);
    agenda.verticalScrollBar.visible = next.length > viewport;
    const top = agenda.scrollTop;
    if (selectedLine < top) agenda.scrollTo(selectedLine);
    else if (selectedLine >= top + viewport) agenda.scrollTo(selectedLine - viewport + 1);
    else if (next.length <= viewport) agenda.scrollTo(0);
  }

  function agendaWidth(): number {
    return Math.max(20, renderer.width - LEFT_W - 2);
  }

  let adding = false;

  function renderStatus(state: State): void {
    const mode = state.mode;
    const wantAdd = mode.kind === 'add';
    if (wantAdd !== adding) {
      adding = wantAdd;
      statusText.visible = !wantAdd;
      addLabel.visible = wantAdd;
      input.visible = wantAdd;
      preview.visible = wantAdd;
      if (wantAdd) {
        input.value = '';
        input.focus();
      } else {
        input.blur();
      }
    }
    if (mode.kind === 'add') {
      const hint = addPreview(mode.input, state);
      preview.content = styled([muted(hint ? `  ${hint}` : '  Esc cancels')]);
      return;
    }
    if (mode.kind === 'confirm') {
      statusText.content = styled([bold(fg(P.yellow)(`Delete "${mode.item.title}"? y/n`))]);
      return;
    }
    if (mode.kind === 'help') {
      statusText.content = styled([muted('any key closes help')]);
      return;
    }
    if (state.message) {
      const isError = state.message.startsWith('Error');
      statusText.content = styled([fg(isError ? P.red : P.green)(state.message)]);
      return;
    }
    const focusHint = state.focus === 'agenda' ? 'j/k item  Esc calendar' : 'hjkl move  Enter agenda';
    statusText.content = styled([muted(`${focusHint}  n/p month  t today  a add  x done  d delete  ? help  q quit`)]);
  }

  return {
    input,
    update(state) {
      renderCalendar(state);
      renderAgenda(state);
      renderStatus(state);
    },
  };
}

const HELP: [string, string][] = [
  ['', 'Keys'],
  ['h j k l / arrows', 'move by day or week on the calendar'],
  ['n / p', 'next or previous month'],
  ['t', 'jump to today'],
  ['Enter / Tab', 'focus the agenda list'],
  ['j / k', 'select the next or previous item'],
  ['g / G', 'first or last item'],
  ['a', 'add: type "call mom sunday 6pm" and press Enter'],
  ['x', 'toggle done on the selected item'],
  ['d', 'delete the selected item'],
  ['Esc', 'back to the calendar'],
  ['q', 'quit'],
  ['', ''],
  ['CLI', 'lilcal add "title" --at "next tuesday 10am"'],
  ['Agents', 'lilcal mcp (MCP server) or lilcal list --json'],
];

function dayCounts(items: Item[], now: number): Map<string, { open: number; done: number; overdue: boolean }> {
  const map = new Map<string, { open: number; done: number; overdue: boolean }>();
  for (const item of items) {
    const key = dayKey(new Date(item.at));
    const entry = map.get(key) ?? { open: 0, done: 0, overdue: false };
    if (item.done) entry.done++;
    else entry.open++;
    if (isOverdue(item, now)) entry.overdue = true;
    map.set(key, entry);
  }
  return map;
}

export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      if (line && [...line].length + 1 + [...word].length > width) {
        out.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}
