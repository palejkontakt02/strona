import { describe, expect, it } from 'vitest';
import type { Plan, TrainingSession } from '../domain';
import { exercisesFor, isTemplate, matchName, nextMonday, painHistory, painSpotsOf, pctOf, planFromTemplate, TEMPLATE_CLIENT, templateFromPlan, templatesOf } from './analytics';

const sess = (date: string, painMap?: TrainingSession['painMap']): TrainingSession => ({ id: date + Math.random(), clientId: 'c1', date, charge: 'brak', exercises: [], painMap });

describe('painHistory', () => {
  const today = '2026-10-24';
  const list = [
    sess('2026-10-20', [{ area: 'kolano', side: 'P', level: 6 }, { area: 'bark', side: 'L', level: 2 }]),
    sess('2026-10-13', [{ area: 'kolano', side: 'P', level: 3 }, { area: 'kolano', side: 'P', level: 4 }]),
    sess('2026-10-06', [{ area: 'kolano', side: 'L', level: 5 }, { area: 'odcinek lędźwiowy', level: 0 }]),
    sess('2026-09-29', [{ area: 'kolano', side: 'P', level: 2 }]),
    sess('2026-08-01', [{ area: 'kolano', side: 'P', level: 9 }]), // starsze niż 8 tygodni
    sess('2026-10-25', [{ area: 'kolano', side: 'P', level: 9 }]), // przyszłość
    sess('2026-10-22'),
  ];
  const rows = painHistory(list, today);
  it('grupuje po miejscu i stronie, liczy razy, max i ostatnie', () => {
    expect(rows[0]).toEqual({ area: 'kolano', side: 'P', count: 3, max: 6, last: '2026-10-20', lastLevel: 6 });
    expect(rows.map((r) => `${r.area}|${r.side ?? ''}`)).toEqual(['kolano|P', 'kolano|L', 'bark|L']);
  });
  it('pomija poziom 0, stare i przyszłe wpisy; ta sama strona raz na trening', () => {
    expect(rows.find((r) => r.area === 'odcinek lędźwiowy')).toBeUndefined();
    expect(rows.find((r) => r.side === 'P')!.max).toBe(6);
  });
  it('punkty mapy = najwyższy poziom', () => {
    expect(painSpotsOf(rows)).toContainEqual({ area: 'kolano', side: 'L', level: 5 });
  });
  it('pusto bez mapy', () => {
    expect(painHistory([sess('2026-10-20')], today)).toEqual([]);
  });
});

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: 'p1',
  clientId: 'c1',
  name: 'Siła 4 tyg.',
  startDate: '2026-10-05',
  active: true,
  weeks: [
    {
      id: 'w1',
      name: 'Tydzień 1',
      workouts: [
        { id: 'k1', name: 'A', day: 1, exercises: [{ id: 'e1', name: 'Przysiad', groups: [{ type: 'Robocze', reps: '5', load: '100', rpe: '8' }] }] },
        { id: 'k2', name: 'B', date: '2026-10-08', assignedAt: '2026-10-01', exercises: [] },
      ],
    },
  ],
  ...over,
});

describe('szablony planów', () => {
  it('nextMonday: zawsze następny poniedziałek', () => {
    expect(nextMonday('2026-10-24')).toBe('2026-10-26'); // sobota
    expect(nextMonday('2026-10-25')).toBe('2026-10-26'); // niedziela
    expect(nextMonday('2026-10-26')).toBe('2026-11-02'); // poniedziałek → za tydzień
  });
  it('szablon z planu: osobne id, nieaktywny, nie należy do podopiecznego', () => {
    const t = templateFromPlan(plan());
    expect(t.clientId).toBe(TEMPLATE_CLIENT);
    expect(t.template).toBe(true);
    expect(t.active).toBe(false);
    expect(isTemplate(t)).toBe(true);
    expect(t.id).not.toBe('p1');
    expect(t.weeks[0].workouts[0].id).not.toBe('k1');
    expect(t.weeks[0].workouts[0].exercises[0].id).not.toBe('e1');
    expect(t.weeks[0].workouts[0].exercises[0].groups[0].load).toBe('100');
    expect(isTemplate(plan())).toBe(false);
  });
  it('plan z szablonu: start w najbliższy poniedziałek, daty przesunięte, bez znacznika', () => {
    const t = templateFromPlan(plan());
    const p = planFromTemplate(t, 'c2', '2026-10-24', true);
    expect(p.clientId).toBe('c2');
    expect(p.template).toBeUndefined();
    expect(p.startDate).toBe('2026-10-26');
    expect(p.active).toBe(true);
    expect(p.weeks[0].workouts[1].date).toBe('2026-10-29'); // +21 dni jak start
    expect(p.weeks[0].workouts[1].assignedAt).toBeUndefined();
    expect(p.weeks[0].workouts[0].day).toBe(1);
  });
  it('lista szablonów pomija plany podopiecznych', () => {
    const t = templateFromPlan(plan({ name: 'B' }));
    const u = { ...templateFromPlan(plan({ name: 'A' })), clientId: TEMPLATE_CLIENT };
    expect(templatesOf([plan(), t, u]).map((x) => x.name)).toEqual(['A', 'B']);
  });
});

describe('zadanie wielu osobom', () => {
  it('kg czyszczone, % i bieg zostają, nowe id', () => {
    const ex = [
      { id: 'a', name: 'Przysiad', groups: [{ type: 'Robocze' as const, reps: '5', load: '100', rpe: '' }, { type: 'Robocze' as const, reps: '5', load: '75%', rpe: '' }] },
      { id: 'b', name: 'Bieg', cardio: true, groups: [{ type: 'Robocze' as const, reps: '30', load: '5', rpe: '' }] },
    ];
    const out = exercisesFor(ex, false);
    expect(out[0].groups.map((g) => g.load)).toEqual(['', '75%']);
    expect(out[1].groups[0].load).toBe('5');
    expect(out[0].id).not.toBe('a');
    expect(ex[0].groups[0].load).toBe('100');
    expect(exercisesFor(ex, true)[0].groups[0].load).toBe('100');
  });
  it('wyszukiwanie po imieniu bez polskich znaków', () => {
    expect(matchName('Zofia Dąbrowska', 'dabr')).toBe(true);
    expect(matchName('Łukasz Nowak', 'luk')).toBe(true);
    expect(matchName('Anna', 'zo')).toBe(false);
    expect(matchName('Anna', '  ')).toBe(true);
  });
});

describe('pctOf', () => {
  it('tylko zapis „N%”', () => {
    expect(pctOf('75%')).toBe(75);
    expect(pctOf(' 72,5 % ')).toBe(72.5);
    expect(pctOf('-10%')).toBeNull();
    expect(pctOf('+4%')).toBeNull();
    expect(pctOf('100')).toBeNull();
    expect(pctOf('')).toBeNull();
  });
});
