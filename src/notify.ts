import dbus from 'dbus-next';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type Notification = {
  summary: string;
  body?: string;
  urgency?: 0 | 1 | 2;
  timeout?: number;
  icon?: string;
};

export type Notifier = (n: Notification) => Promise<number>;

function busAddress(): string | undefined {
  if (process.env.DBUS_SESSION_BUS_ADDRESS) return undefined;
  const runtime = process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1000}`;
  const path = join(runtime, 'bus');
  if (existsSync(path)) return `unix:path=${path}`;
  return undefined;
}

export function escapeBody(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const notify: Notifier = async (n) => {
  const address = busAddress();
  const bus = address ? dbus.sessionBus({ busAddress: address }) : dbus.sessionBus();
  try {
    const proxy = await bus.getProxyObject('org.freedesktop.Notifications', '/org/freedesktop/Notifications');
    const iface = proxy.getInterface('org.freedesktop.Notifications') as unknown as {
      Notify: (...args: unknown[]) => Promise<number>;
    };
    const hints = {
      urgency: new dbus.Variant('y', n.urgency ?? 1),
      'desktop-entry': new dbus.Variant('s', 'lilcal'),
    };
    return await iface.Notify(
      'lilcal',
      0,
      n.icon ?? 'x-office-calendar',
      n.summary,
      escapeBody(n.body ?? ''),
      [],
      hints,
      n.timeout ?? 0,
    );
  } finally {
    bus.disconnect();
  }
};
