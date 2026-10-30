import { describe, expect, it } from 'vitest';
import type { SetGroup } from '../domain';
import { planLoads } from './planLoads';

const g = (type: SetGroup['type'], load: string, reps = '5', rpe = ''): SetGroup => ({ type, sets: '1', reps, load, rpe });

describe('planLoads', () => {
  it('back-off −10% liczony od top setu, bez kumulacji', () => {
    const r = planLoads([g('Top set', '100'), g('Back-off', '-10%'), g('Back-off', '-10%'), g('Back-off', '-10%')], null);
    expect(r.map((x) => x.load)).toEqual([100, 90, 90, 90]);
  });
  it('drop set od poprzedniej serii', () => {
    const r = planLoads([g('Robocze', '100'), g('Drop set', '-20%'), g('Drop set', '-20%')], null);
    expect(r.map((x) => x.load)).toEqual([100, 80, 65]);
  });
  it('% z maksa i puste pole z RPE', () => {
    const r = planLoads([g('Robocze', '75%'), g('Top set', '', '5', '8')], 140);
    expect(r[0].load).toBe(105);
    expect(r[1].load).toBeGreaterThan(100);
  });
  it('bez maksa: % i puste pole nieznane, kg bez zmian', () => {
    const r = planLoads([g('Robocze', '75%'), g('Robocze', ''), g('Robocze', '60')], null);
    expect(r.map((x) => x.load)).toEqual([null, null, 60]);
  });
});
