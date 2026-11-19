import { describe, expect, it } from 'vitest';
import { rpeLevel, sessionKind } from './dataColors';

describe('rpeLevel', () => {
  it('maps RPE to five steps', () => {
    expect(rpeLevel(5)).toBe(1);
    expect(rpeLevel('6')).toBe(1);
    expect(rpeLevel('7')).toBe(2);
    expect(rpeLevel('8')).toBe(3);
    expect(rpeLevel('9')).toBe(4);
    expect(rpeLevel(10)).toBe(5);
  });
  it('reads Polish decimals, prefixes and ranges (upper bound)', () => {
    expect(rpeLevel('7,5')).toBe(3);
    expect(rpeLevel('8.5')).toBe(4);
    expect(rpeLevel('@9')).toBe(4);
    expect(rpeLevel('RPE 8')).toBe(3);
    expect(rpeLevel('7-8')).toBe(3);
    expect(rpeLevel('8–9')).toBe(4);
    expect(rpeLevel(' 6 ')).toBe(1);
  });
  it('returns null for empty, RIR, text and out of range', () => {
    expect(rpeLevel('')).toBeNull();
    expect(rpeLevel(undefined)).toBeNull();
    expect(rpeLevel(null)).toBeNull();
    expect(rpeLevel('RIR 2')).toBeNull();
    expect(rpeLevel('lekko')).toBeNull();
    expect(rpeLevel('11')).toBeNull();
    expect(rpeLevel(0)).toBeNull();
    expect(rpeLevel(Number.NaN)).toBeNull();
  });
});

describe('sessionKind', () => {
  it('uses workout name first', () => {
    expect(sessionKind({ name: 'Mobilność bioder', exercises: [{ name: 'Przysiad' }] })).toBe('rehab');
    expect(sessionKind({ name: 'Bieg Z2', exercises: [] })).toBe('bieg');
    expect(sessionKind({ name: 'Dwubój: technika', exercises: [] })).toBe('dwuboj');
  });
  it('strength by majority of exercises', () => {
    expect(sessionKind({ name: 'A', exercises: [{ name: 'Przysiad ze sztangą' }, { name: 'Martwy ciąg' }, { name: 'Rozciąganie' }] })).toBe('sila');
  });
  it('olympic lifts make it dwubój', () => {
    expect(sessionKind(['Rwanie', 'Podrzut', 'Przysiad przedni'])).toBe('dwuboj');
    expect(sessionKind(['Power clean', 'Przysiad', 'Wyciskanie', 'Wiosłowanie sztangą'])).toBe('sila');
  });
  it('running by cardio flag or name', () => {
    expect(sessionKind([{ name: 'Interwały', cardio: true }, { name: 'Bieg ciągły' }])).toBe('bieg');
    expect(sessionKind(['Bieg 5 km'])).toBe('bieg');
  });
  it('rehab and mobility', () => {
    expect(sessionKind(['Rolowanie łydek', 'Mobilizacja kręgosłupa piersiowego'])).toBe('rehab');
  });
  it('empty is inne', () => {
    expect(sessionKind(null)).toBe('inne');
    expect(sessionKind([])).toBe('inne');
    expect(sessionKind({ name: '', exercises: [{ name: '  ' }] })).toBe('inne');
  });
});
