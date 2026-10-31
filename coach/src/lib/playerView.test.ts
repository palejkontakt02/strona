import { describe, expect, it } from 'vitest';
import { commaNum, showRunHelp, soloByDefault } from './playerView';

const at = (d: string, t: string) => new Date(`${d}T${t}:00`).getTime();
const appt = (date: string, time: string, status: 'planned' | 'done' | 'cancel' | 'noshow' = 'planned') => ({ clientId: 'c1', date, time, status });

describe('soloByDefault', () => {
  it('bez wizyty — samodzielnie', () => {
    expect(soloByDefault([], 'c1', '2026-10-31', at('2026-10-31', '18:00'))).toBe(true);
  });
  it('wizyta rano, trening wieczorem — samodzielnie', () => {
    expect(soloByDefault([appt('2026-10-31', '08:00')], 'c1', '2026-10-31', at('2026-10-31', '18:00'))).toBe(true);
  });
  it('wizyta w oknie ±2 h — z trenerem', () => {
    expect(soloByDefault([appt('2026-10-31', '17:00')], 'c1', '2026-10-31', at('2026-10-31', '18:30'))).toBe(false);
    expect(soloByDefault([appt('2026-10-31', '20:00')], 'c1', '2026-10-31', at('2026-10-31', '18:00'))).toBe(false);
  });
  it('wizyta odwołana albo innej osoby się nie liczy', () => {
    expect(soloByDefault([appt('2026-10-31', '18:00', 'cancel')], 'c1', '2026-10-31', at('2026-10-31', '18:00'))).toBe(true);
    expect(soloByDefault([{ ...appt('2026-10-31', '18:00'), clientId: 'x' }], 'c1', '2026-10-31', at('2026-10-31', '18:00'))).toBe(true);
  });
  it('trening wpisany po fakcie (inny dzień startu) — wizyta tego dnia wystarcza', () => {
    expect(soloByDefault([appt('2026-10-30', '08:00')], 'c1', '2026-10-30', at('2026-10-31', '18:00'))).toBe(false);
  });
});

describe('commaNum / showRunHelp', () => {
  it('przecinek dziesiętny', () => {
    expect(commaNum('62.5')).toBe('62,5');
    expect(commaNum('62,5')).toBe('62,5');
    expect(commaNum('+2.5% (60.5 kg)')).toBe('+2,5% (60,5 kg)');
    expect(commaNum('')).toBe('');
  });
  it('instrukcja przy pierwszych 2 treningach', () => {
    expect(showRunHelp(0)).toBe(true);
    expect(showRunHelp(1)).toBe(true);
    expect(showRunHelp(2)).toBe(false);
  });
});
