import { createCliRenderer } from '@opentui/core';
import { mkdirSync, watch } from 'node:fs';
import { basename, dirname } from 'node:path';
import { addItem, completeItem, removeItem } from '../commands.js';
import { fmtWhen } from '../dates.js';
import { dataPath, load } from '../store.js';
import { fromKeyEvent } from './keys.js';
import { initialState, reduce, type Action, type Effect, type State } from './state.js';
import { createUi } from './ui.js';

export async function runTui(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('the TUI needs a terminal; try `lilcal list`');

  const path = dataPath();
  mkdirSync(dirname(path), { recursive: true });
  const items = await load(path);

  const renderer = await createCliRenderer({ exitOnCtrlC: false, autoFocus: false, useMouse: false });
  let state: State = initialState(items, new Date(), renderer.width, renderer.height);
  let queue: Promise<void> = Promise.resolve();
  let closing = false;

  const ui = createUi(renderer, {
    onInput: (text) => dispatch({ type: 'input', text }),
    onSubmit: (text) => dispatch({ type: 'submit', text }),
  });

  const quit = () => {
    if (closing) return;
    closing = true;
    watcher.close();
    clearInterval(clock);
    renderer.destroy();
    process.exit(0);
  };

  const dispatch = (action: Action) => {
    if (closing) return;
    const result = reduce(state, action);
    state = result.state;
    for (const effect of result.effects) run(effect);
    if (!closing) ui.update(state);
  };

  const reload = async () => {
    try {
      dispatch({ type: 'items', items: await load(path) });
    } catch (err) {
      dispatch({ type: 'message', text: `Error: ${(err as Error).message}` });
    }
  };

  const run = (effect: Effect) => {
    if (effect.type === 'quit') return quit();
    queue = queue.then(async () => {
      try {
        if (effect.type === 'add') {
          const item = await addItem({ title: effect.text, fallbackDay: effect.day }, new Date());
          dispatch({ type: 'message', text: `Added "${item.title}" at ${fmtWhen(new Date(item.at), item.allDay ?? false)}` });
        } else if (effect.type === 'toggle') {
          const item = await completeItem(effect.id, effect.done);
          dispatch({ type: 'message', text: `${item.done ? 'Done' : 'Reopened'}: ${item.title}` });
        } else if (effect.type === 'remove') {
          const item = await removeItem(effect.id);
          dispatch({ type: 'message', text: `Deleted: ${item.title}` });
        }
      } catch (err) {
        dispatch({ type: 'message', text: `Error: ${(err as Error).message}` });
      }
      await reload();
    });
  };

  let pending: ReturnType<typeof setTimeout> | null = null;
  const watcher = watch(dirname(path), { persistent: false }, (_event, name) => {
    if (name && name !== basename(path)) return;
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => void reload(), 60);
  });
  const clock = setInterval(() => dispatch({ type: 'tick', now: new Date() }), 30_000);

  const adding = () => state.mode.kind === 'add';
  renderer.keyInput.on('keypress', (event) => {
    if (adding()) {
      if (event.name === 'escape') dispatch({ type: 'key', key: { name: 'escape' } });
      else if (event.ctrl && event.name === 'c') dispatch({ type: 'key', key: { name: 'ctrl-c' } });
      return;
    }
    dispatch({ type: 'key', key: fromKeyEvent(event) });
    if (adding()) event.stopPropagation();
  });
  renderer.on('resize', (width: number, height: number) => dispatch({ type: 'resize', cols: width, rows: height }));
  renderer.once('destroy', () => setImmediate(quit));

  ui.update(state);
  await new Promise<void>(() => {});
}
