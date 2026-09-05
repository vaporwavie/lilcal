import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const NOW = new Date(2026, 8, 4, 22, 40);

export function useTempStore(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lilcal-'));
  const path = join(dir, 'items.json');
  process.env.LILCAL_DATA = path;
  return path;
}
