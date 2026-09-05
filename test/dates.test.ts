import { describe, expect, it } from 'bun:test';
import { extractWhen, fmtRelative, parseWhen, toISO } from '../src/dates.js';
import { NOW } from './helpers.js';

describe('parseWhen', () => {
  it('parses ISO datetimes with time', () => {
    const p = parseWhen('2026-09-12T15:00', NOW)!;
    expect(p.hasTime).toBe(true);
    expect(p.hasDate).toBe(true);
    expect(toISO(p.date)).toBe('2026-09-12T15:00:00+02:00');
  });

  it('treats a bare ISO date as all day at 09:00', () => {
    const p = parseWhen('2026-09-12', NOW)!;
    expect(p.hasTime).toBe(false);
    expect(toISO(p.date)).toBe('2026-09-12T09:00:00+02:00');
  });

  it('resolves weekdays forward and defaults the time', () => {
    const p = parseWhen('friday', NOW)!;
    expect(p.hasTime).toBe(false);
    expect(p.hasDate).toBe(true);
    expect(toISO(p.date)).toBe('2026-09-11T09:00:00+02:00');
  });

  it('keeps explicit times', () => {
    expect(toISO(parseWhen('next tuesday 10am', NOW)!.date)).toBe('2026-09-08T10:00:00+02:00');
    expect(toISO(parseWhen('in 2 hours', NOW)!.date)).toBe('2026-09-05T00:40:00+02:00');
  });

  it('keeps fuzzy times of day', () => {
    const p = parseWhen('monday morning', NOW)!;
    expect(p.hasTime).toBe(true);
    expect(toISO(p.date)).toBe('2026-09-07T06:00:00+02:00');
  });

  it('marks a bare time as having no date', () => {
    const p = parseWhen('4pm', NOW)!;
    expect(p.hasDate).toBe(false);
    expect(p.hasTime).toBe(true);
  });

  it('returns null for nonsense', () => {
    expect(parseWhen('gibberish', NOW)).toBeNull();
    expect(parseWhen('', NOW)).toBeNull();
  });

  it('captures ranges', () => {
    const p = parseWhen('2-3pm tomorrow', NOW)!;
    expect(toISO(p.date)).toBe('2026-09-05T14:00:00+02:00');
    expect(toISO(p.end!)).toBe('2026-09-05T15:00:00+02:00');
  });
});

describe('extractWhen', () => {
  it('splits the date out of a sentence', () => {
    const r = extractWhen('call mom sunday 6pm', NOW)!;
    expect(r.title).toBe('call mom');
    expect(toISO(r.when.date)).toBe('2026-09-06T18:00:00+02:00');
  });

  it('strips dangling prepositions', () => {
    expect(extractWhen('pay rent on friday', NOW)!.title).toBe('pay rent');
    expect(extractWhen('review PR next monday at 9', NOW)!.title).toBe('review PR');
  });

  it('returns null when the text is only a date or has none', () => {
    expect(extractWhen('tomorrow', NOW)).toBeNull();
    expect(extractWhen('buy milk', NOW)).toBeNull();
  });
});

describe('fmtRelative', () => {
  it('describes distances', () => {
    expect(fmtRelative(new Date(2026, 8, 4, 22, 50), NOW)).toBe('in 10 min');
    expect(fmtRelative(new Date(2026, 8, 5, 10, 0), NOW)).toBe('tomorrow');
    expect(fmtRelative(new Date(2026, 8, 1, 9, 0), NOW)).toBe('3 days ago');
    expect(fmtRelative(new Date(2026, 9, 20, 9, 0), NOW)).toBe('in 7 weeks');
  });
});
