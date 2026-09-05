import type { KeyEvent } from '@opentui/core';

export type Key = { name: string; ch?: string };

const NAMED = new Set(['escape', 'tab', 'up', 'down', 'left', 'right', 'pageup', 'pagedown', 'home', 'end', 'delete', 'backspace']);

export function fromKeyEvent(e: Pick<KeyEvent, 'name' | 'sequence' | 'ctrl' | 'shift'>): Key {
  if (e.ctrl && e.name.length === 1) return { name: `ctrl-${e.name}` };
  if (e.name === 'return' || e.name === 'enter' || e.name === 'linefeed') return { name: 'enter' };
  if (NAMED.has(e.name)) return { name: e.name };
  if (e.name === 'space') return { name: 'char', ch: ' ' };
  const seq = e.sequence ?? '';
  if ([...seq].length === 1 && (seq.codePointAt(0) ?? 0) >= 0x20) return { name: 'char', ch: seq };
  if (e.name.length === 1) return { name: 'char', ch: e.shift ? e.name.toUpperCase() : e.name };
  return { name: e.name };
}
