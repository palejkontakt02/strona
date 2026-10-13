import type {
  Appointment,
  Billing,
  Checkin,
  Client,
  ExerciseCategory,
  LibraryExercise,
  Payment,
  Plan,
  PlanExercise,
  PlanWorkout,
  SessionExercise,
  SetGroup,
  TrainingSession,
} from '../domain';
import { uid } from '../format';
import { addDays, todayISO, weekStart } from '../lib/dates';
import { computeLsi } from '../lib/tests';
import { loadFor } from '../lib/strength';
import type { Db } from './db';

/* Deterministyczny generator — dane przykładowe zawsze takie same względem dzisiejszej daty. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LIBRARY: [string, ExerciseCategory][] = [
  ['Przysiad ze sztangą', 'Dół ciała'],
  ['Przysiad przedni', 'Dół ciała'],
  ['Przysiad na skrzynię', 'Dół ciała'],
  ['Martwy ciąg', 'Dół ciała'],
  ['Martwy ciąg rumuński', 'Dół ciała'],
  ['Hip thrust', 'Dół ciała'],
  ['Przysiad bułgarski', 'Dół ciała'],
  ['Single leg RDL', 'Dół ciała'],
  ['Step down', 'Dół ciała'],
  ['Nordic hamstring', 'Dół ciała'],
  ['Wyciskanie sztangi leżąc', 'Góra – pchanie'],
  ['Wyciskanie hantli na skosie', 'Góra – pchanie'],
  ['Wyciskanie żołnierskie', 'Góra – pchanie'],
  ['Pompki', 'Góra – pchanie'],
  ['Landmine press', 'Góra – pchanie'],
  ['Podciąganie', 'Góra – przyciąganie'],
  ['Wiosłowanie sztangą', 'Góra – przyciąganie'],
  ['Wiosłowanie hantlem', 'Góra – przyciąganie'],
  ['Face pull', 'Góra – przyciąganie'],
  ['Rotacja zewnętrzna z gumą', 'Góra – przyciąganie'],
  ['Pallof press', 'Core'],
  ['Copenhagen plank', 'Core'],
  ['Dead bug', 'Core'],
  ['Plank boczny', 'Core'],
  ['Zarzut siłowy', 'Dwubój'],
  ['Rwanie z zawieszenia', 'Dwubój'],
  ['CMJ', 'Plyometria'],
  ['Skok na skrzynię', 'Plyometria'],
  ['Hop jednonóż', 'Plyometria'],
  ['Drop jump', 'Plyometria'],
  ['Sprint 10 m', 'Kondycja'],
  ['Rower interwały', 'Kondycja'],
  ['Wioślarz 500 m', 'Kondycja'],
  ['Mobilizacja biodra 90/90', 'Mobilność i rehab'],
  ['Knee-to-wall', 'Mobilność i rehab'],
  ['Izometria czworogłowego', 'Mobilność i rehab'],
  ['Spanish squat', 'Mobilność i rehab'],
];

/* ---------- budowanie serii ---------- */
const row = (type: SetGroup['type'], reps: string, load = '', rpe = ''): SetGroup => ({ type, sets: '1', reps, load, rpe });
const rows = (n: number, type: SetGroup['type'], reps: string, load = '', rpe = '') =>
  Array.from({ length: n }, () => row(type, reps, load, rpe));
const topBack = (reps: string, backoffs: number) => [
  row('Rozgrzewka', '5', '50%'),
  row('Rozgrzewka', '3', '70%'),
  row('Top set', reps, '', '8'),
  ...rows(backoffs, 'Back-off', reps, '-10%', '7'),
];
const ex = (name: string, groups: SetGroup[], rest = '2:00', notes = '', linked = false): PlanExercise => ({ id: uid(), name, rest, notes, groups, linked: linked || undefined });

type WorkoutTpl = { name: string; exercises: () => PlanExercise[] };

const TEMPLATES: Record<string, { name: string; workouts: WorkoutTpl[] }> = {
  sc: {
    name: 'S&C – siła i moc',
    workouts: [
      {
        name: 'A – dół ciała',
        exercises: () => [
          ex('CMJ', rows(3, 'Robocze', '3'), '1:30'),
          ex('Przysiad ze sztangą', topBack('5', 3), '3:00', 'Tempo 3-1-X-0'),
          ex('Martwy ciąg rumuński', rows(3, 'Robocze', '8', '', '7')),
          ex('Nordic hamstring', rows(3, 'Robocze', '5'), '1:30'),
          ex('Copenhagen plank', rows(3, 'Robocze', '20 s'), '60'),
        ],
      },
      {
        name: 'B – góra ciała',
        exercises: () => [
          ex('Zarzut siłowy', rows(4, 'Robocze', '3', '', '7'), '2:00'),
          ex('Wyciskanie sztangi leżąc', topBack('5', 2), '2:30'),
          ex('Podciąganie', rows(4, 'Robocze', '6', '', '8')),
          ex('Wiosłowanie hantlem', rows(3, 'Robocze', '10', '', '8'), ''),
          ex('Pallof press', rows(3, 'Robocze', '10'), '90', '', true),
        ],
      },
      {
        name: 'C – siła jednonóż',
        exercises: () => [
          ex('Skok na skrzynię', rows(4, 'Robocze', '3'), '1:30'),
          ex('Przysiad bułgarski', rows(3, 'Robocze', '8', '', '8'), '2:00', 'Tempo 3-0-1-0'),
          ex('Hip thrust', [row('Rozgrzewka', '8', '60%'), ...rows(3, 'Robocze', '8', '', '8')], ''),
          ex('Wyciskanie żołnierskie', rows(3, 'Robocze', '6', '', '8'), '', '', true),
          ex('Dead bug', rows(3, 'Robocze', '10'), '2:00', '', true),
        ],
      },
    ],
  },
  rts: {
    name: 'Return to Sport – ACL faza 3',
    workouts: [
      {
        name: 'A – siła',
        exercises: () => [
          ex('Izometria czworogłowego', rows(5, 'Robocze', '45 s'), '1:30'),
          ex('Przysiad na skrzynię', rows(4, 'Robocze', '6', '', '7'), '2:30', 'Tempo 3-1-1-0'),
          ex('Single leg RDL', rows(3, 'Robocze', '8', '', '7')),
          ex('Step down', rows(3, 'Robocze', '10'), '90', 'Kontrola koślawienia'),
          ex('Copenhagen plank', rows(3, 'Robocze', '15 s'), '60'),
        ],
      },
      {
        name: 'B – plyometria i stabilność',
        exercises: () => [
          ex('Hop jednonóż', rows(4, 'Robocze', '5'), '1:30', 'Lądowanie miękko, 2 s stabilizacji'),
          ex('Skok na skrzynię', rows(4, 'Robocze', '4'), '1:30'),
          ex('Spanish squat', rows(3, 'Robocze', '30 s'), '60'),
          ex('Hip thrust', rows(3, 'Robocze', '10', '', '7')),
          ex('Pallof press', rows(3, 'Robocze', '10'), '60'),
        ],
      },
    ],
  },
  gen: {
    name: 'Ogólnorozwojowy 2×/tydz.',
    workouts: [
      {
        name: 'Trening 1',
        exercises: () => [
          ex('Przysiad ze sztangą', rows(3, 'Robocze', '8', '', '7')),
          ex('Wyciskanie hantli na skosie', rows(3, 'Robocze', '10', '', '8'), '90'),
          ex('Wiosłowanie sztangą', rows(3, 'Robocze', '10', '', '8'), '90'),
          ex('Plank boczny', rows(3, 'Robocze', '30 s'), '45'),
        ],
      },
      {
        name: 'Trening 2',
        exercises: () => [
          ex('Martwy ciąg', rows(3, 'Robocze', '6', '', '7'), '2:30'),
          ex('Pompki', rows(3, 'Robocze', '12'), '60'),
          ex('Podciąganie', rows(3, 'Robocze', '5', '', '8')),
          ex('Rower interwały', rows(6, 'Robocze', '30 s'), '60'),
        ],
      },
    ],
  },
  shoulder: {
    name: 'Rehab barku + siła ogólna',
    workouts: [
      {
        name: 'Bark + dół',
        exercises: () => [
          ex('Rotacja zewnętrzna z gumą', rows(3, 'Robocze', '15'), '45'),
          ex('Face pull', rows(3, 'Robocze', '15', '', '7'), '60'),
          ex('Landmine press', rows(3, 'Robocze', '10', '', '7'), '90'),
          ex('Przysiad przedni', rows(3, 'Robocze', '8', '', '7')),
          ex('Martwy ciąg rumuński', rows(3, 'Robocze', '10', '', '7')),
        ],
      },
      {
        name: 'Bark + core',
        exercises: () => [
          ex('Rotacja zewnętrzna z gumą', rows(3, 'Robocze', '15'), '45'),
          ex('Wiosłowanie hantlem', rows(3, 'Robocze', '12', '', '7'), '60'),
          ex('Pompki', rows(3, 'Robocze', '8'), '60', 'Na podwyższeniu'),
          ex('Hip thrust', rows(3, 'Robocze', '10', '', '7')),
          ex('Dead bug', rows(3, 'Robocze', '10'), '45'),
        ],
      },
    ],
  },
};

/** Startowe e1RM (kg) dla ćwiczeń z obciążeniem; mnożone przez współczynnik klienta. */
const BASE_E1: Record<string, number> = {
  'Przysiad ze sztangą': 120,
  'Przysiad przedni': 90,
  'Przysiad na skrzynię': 80,
  'Martwy ciąg': 150,
  'Martwy ciąg rumuński': 110,
  'Hip thrust': 140,
  'Przysiad bułgarski': 50,
  'Single leg RDL': 40,
  'Wyciskanie sztangi leżąc': 90,
  'Wyciskanie hantli na skosie': 30,
  'Wyciskanie żołnierskie': 55,
  'Landmine press': 35,
  'Podciąganie': 20,
  'Wiosłowanie sztangą': 80,
  'Wiosłowanie hantlem': 40,
  'Face pull': 25,
  'Zarzut siłowy': 80,
};

interface ClientTpl {
  name: string;
  sex: 'k' | 'm';
  sport: string;
  position?: string;
  goal: string;
  level: string;
  status: Client['status'];
  billing: Billing;
  template: keyof typeof TEMPLATES;
  strength: number;
  /** Dni tygodnia treningów (0 = pon). */
  days: number[];
  time: string;
  /** Ile tygodni historii. */
  weeks: number;
  /** Dni bez treningu na końcu (np. 14 = ostatni trening 2 tygodnie temu). */
  gap?: number;
  special?: 'acwr' | 'pain' | 'acl' | 'shoulder' | 'pkgLow' | 'overdue';
}

const CLIENTS: ClientTpl[] = [
  { name: 'Kacper Nowak', sex: 'm', sport: 'Piłka nożna', position: 'Pomocnik', goal: 'Siła i szybkość przed rundą', level: 'Zaawansowany', status: 'aktywny', billing: 'pakiet', template: 'sc', strength: 1.1, days: [0, 3], time: '17:00', weeks: 9, special: 'pkgLow' },
  { name: 'Julia Wiśniewska', sex: 'k', sport: 'Piłka ręczna', position: 'Rozgrywająca', goal: 'Powrót do gry po rekonstrukcji ACL', level: 'Średniozaawansowany', status: 'aktywny', billing: 'pakiet', template: 'rts', strength: 0.6, days: [1, 4], time: '15:30', weeks: 10, special: 'acl' },
  { name: 'Michał Zieliński', sex: 'm', sport: 'CrossFit', goal: 'Przygotowanie do zawodów', level: 'Zaawansowany', status: 'aktywny', billing: 'abonament', template: 'sc', strength: 1.25, days: [0, 2, 4], time: '07:00', weeks: 8, special: 'acwr' },
  { name: 'Aleksandra Kamińska', sex: 'k', sport: 'Bieganie', goal: 'Półmaraton poniżej 1:45', level: 'Średniozaawansowany', status: 'aktywny', billing: 'abonament', template: 'gen', strength: 0.55, days: [1, 3], time: '18:30', weeks: 8, special: 'overdue' },
  { name: 'Tomasz Lewandowski', sex: 'm', sport: 'Rekreacja', goal: 'Zdrowe plecy i forma', level: 'Początkujący', status: 'aktywny', billing: 'pojedyncza', template: 'gen', strength: 0.75, days: [2], time: '12:00', weeks: 7, gap: 14 },
  { name: 'Zofia Dąbrowska', sex: 'k', sport: 'Siatkówka', position: 'Atakująca', goal: 'Wyskok i stabilność kolan', level: 'Średniozaawansowany', status: 'aktywny', billing: 'pakiet', template: 'sc', strength: 0.65, days: [1, 4], time: '16:30', weeks: 8, special: 'pain' },
  { name: 'Paweł Wójcik', sex: 'm', sport: 'Trójbój siłowy', goal: 'Przysiad 200 kg', level: 'Zaawansowany', status: 'aktywny', billing: 'abonament', template: 'sc', strength: 1.45, days: [0, 2, 4], time: '19:00', weeks: 9 },
  { name: 'Marta Krawczyk', sex: 'k', sport: 'Tenis', goal: 'Powrót do gry bez bólu barku', level: 'Średniozaawansowany', status: 'aktywny', billing: 'pojedyncza', template: 'shoulder', strength: 0.5, days: [0, 3], time: '10:00', weeks: 6, special: 'shoulder' },
  { name: 'Natalia Kowalczyk', sex: 'k', sport: 'Rekreacja', goal: 'Redukcja i siła', level: 'Początkujący', status: 'aktywny', billing: 'pakiet', template: 'gen', strength: 0.5, days: [2, 5], time: '09:00', weeks: 2 },
  { name: 'Bartosz Mazur', sex: 'm', sport: 'Koszykówka', position: 'Rozgrywający', goal: 'Utrzymanie formy w sezonie', level: 'Średniozaawansowany', status: 'pauza', billing: 'pakiet', template: 'sc', strength: 0.95, days: [1], time: '20:00', weeks: 6, gap: 30 },
];

function slug(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/\s+/g, '.');
}

function buildPlan(clientId: string, key: keyof typeof TEMPLATES, start: string): Plan {
  const t = TEMPLATES[key];
  const weeks = [1, 2, 3, 4].map((n) => ({
    id: uid(),
    name: `Tydzień ${n}${n === 4 ? ' (deload)' : ''}`,
    workouts: t.workouts.map<PlanWorkout>((w) => ({ id: uid(), name: w.name, exercises: w.exercises() })),
  }));
  return { id: uid(), clientId, name: t.name, startDate: start, active: true, weeks, updatedAt: start + 'T08:00:00Z' };
}

export function createSeed(today = todayISO()): Db {
  const rand = rng(2026);
  const r = (a: number, b: number) => a + rand() * (b - a);
  const ri = (a: number, b: number) => Math.round(r(a, b));

  const library: LibraryExercise[] = LIBRARY.map(([name, cat]) => ({ id: uid(), name, cat }));
  const clients: Client[] = [];
  const plans: Plan[] = [];
  const sessions: TrainingSession[] = [];
  const appointments: Appointment[] = [];

  CLIENTS.forEach((t, ci) => {
    const id = uid();
    const startDate = addDays(weekStart(today), -7 * t.weeks);
    const plan = buildPlan(id, t.template, startDate);
    // Starszy, zakończony plan dla części klientów.
    if (t.weeks >= 8) {
      const old = buildPlan(id, t.template === 'rts' ? 'gen' : t.template, addDays(startDate, -42));
      old.name = t.template === 'rts' ? 'ACL – faza 2 (wzmacnianie)' : `${old.name} – blok wprowadzający`;
      old.active = false;
      old.updatedAt = startDate + 'T08:00:00Z';
      plans.push(old);
    }
    plans.push(plan);
    const seq = plan.weeks.flatMap((w) => w.workouts);

    /* --- treningi i wizyty z przeszłości --- */
    const clientSessions: TrainingSession[] = [];
    const lastDay = addDays(today, -(t.gap ?? 1));
    let k = 0;
    for (let w = t.weeks; w >= 0; w--) {
      for (const d of t.days) {
        const date = addDays(addDays(weekStart(today), -7 * w), d);
        if (date < startDate || date > lastDay) continue;
        const apptId = uid();
        // Co jakiś czas odwołana wizyta lub nieobecność.
        const roll = rand();
        if (roll < 0.05 || (roll < 0.08 && ci % 3 === 0)) {
          appointments.push({ id: apptId, clientId: id, date, time: t.time, duration: 60, location: 'Siłownia', status: roll < 0.05 ? 'cancel' : 'noshow' });
          continue;
        }
        const workout = seq[k % seq.length];
        k++;
        const progress = 1 + 0.012 * k;
        const spike = t.special === 'acwr' && date >= addDays(today, -7);
        const sessionExercises: SessionExercise[] = workout.exercises.map((e) => {
          const base = BASE_E1[e.name];
          const work = e.groups.filter((g) => g.type !== 'Rozgrzewka');
          const top = work[0];
          const reps = top.reps;
          const rpe = top.rpe || '';
          if (!base) return { name: e.name, sets: String(work.length), reps, load: '', rpe, rest: e.rest };
          const e1 = base * t.strength * progress * r(0.97, 1.03);
          const load = loadFor(e1, reps, rpe || 8);
          return { name: e.name, sets: String(work.length), reps, load: String(load), rpe: rpe || '8', rest: e.rest };
        });
        const wellness = {
          sleep: ri(3, 5),
          energy: ri(2, 5),
          muscle: ri(2, 5),
          stress: ri(2, 4),
          mood: ri(3, 5),
        };
        const isLast = date === lastDay || addDays(date, 7) > lastDay;
        const session: TrainingSession = {
          id: uid(),
          clientId: id,
          date,
          workoutName: workout.name,
          charge: t.billing,
          duration: spike ? ri(85, 100) : ri(55, 75),
          srpe: spike ? ri(8, 9) : ri(5, 7),
          pain: t.special === 'pain' && isLast ? 6 : t.special === 'acl' ? ri(1, 3) : ri(0, 1),
          wellness: t.special === 'pain' && isLast ? { sleep: 2, energy: 2, muscle: 2, stress: 2, mood: 3 } : wellness,
          planId: plan.id,
          workoutId: workout.id,
          exercises: sessionExercises,
          notes: t.special === 'pain' && isLast ? 'Ból przedniej części kolana przy skokach, odpuszczona plyometria.' : '',
        };
        clientSessions.push(session);
        appointments.push({ id: apptId, clientId: id, date, time: t.time, duration: 60, location: 'Siłownia', status: 'done', sessionId: session.id });
      }
    }
    // Dodatkowe ciężkie jednostki w ostatnim tygodniu dla skoku ACWR.
    if (t.special === 'acwr') {
      for (const d of [-6, -4, -2]) {
        const date = addDays(today, d);
        if (clientSessions.some((s) => s.date === date)) continue;
        clientSessions.push({ id: uid(), clientId: id, date, workoutName: 'Metcon (samodzielnie)', charge: 'brak', duration: 75, srpe: 9, pain: 1, exercises: [{ name: 'Wioślarz 500 m', sets: '6', reps: '1' }] });
      }
    }
    sessions.push(...clientSessions);

    /* --- wizyty planowane (seria co tydzień) --- */
    if (t.status === 'aktywny' && !t.gap) {
      const seriesId = uid();
      for (let w = 0; w <= 2; w++) {
        for (const d of t.days) {
          const date = addDays(addDays(weekStart(today), 7 * w), d);
          if (date < today) continue;
          appointments.push({ id: uid(), clientId: id, date, time: t.time, duration: 60, location: 'Siłownia', status: 'planned', seriesId });
        }
      }
    }

    /* --- płatności --- */
    const payments: Payment[] = [];
    const used = clientSessions.filter((s) => s.charge === 'pakiet').length;
    if (t.billing === 'pakiet') {
      // Pakiety po 10 sesji; dla „pkgLow” zostają 2.
      const total = t.special === 'pkgLow' ? used + 2 : Math.ceil((used + 3) / 10) * 10;
      let bought = 0;
      let date = startDate;
      while (bought < total) {
        const size = Math.min(10, total - bought) >= 10 ? 10 : total - bought;
        payments.push({ id: uid(), type: 'pakiet', amount: size * 160, sessions: size, date, dueDate: date, status: 'paid', paidDate: date });
        bought += size;
        date = addDays(date, 35);
        if (date > today) date = addDays(today, -3);
      }
    }
    if (t.billing === 'abonament') {
      for (let m = 2; m >= 0; m--) {
        const d = new Date(today + 'T12:00:00');
        d.setDate(1);
        d.setMonth(d.getMonth() - m);
        const first = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
        const overdue = t.special === 'overdue' && m === 0;
        payments.push({ id: uid(), type: 'abonament', amount: 600, month: first.slice(0, 7), date: first, dueDate: addDays(first, 7), status: overdue ? 'due' : 'paid', paidDate: overdue ? undefined : addDays(first, 2) });
      }
    }
    if (t.billing === 'pojedyncza') {
      clientSessions.forEach((s, i) => {
        const due = t.special === 'shoulder' && i === clientSessions.length - 1;
        payments.push({ id: uid(), type: 'pojedyncza', amount: 180, date: s.date, dueDate: addDays(s.date, 7), status: due ? 'due' : 'paid', paidDate: due ? undefined : s.date, desc: `Sesja ${new Date(s.date + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}` });
      });
    }

    /* --- pomiary --- */
    const w0 = t.sex === 'k' ? r(56, 68) : r(74, 92);
    const measurements = Array.from({ length: 5 }, (_, i) => {
      const weight = Math.round((w0 + (i - 2) * r(-0.5, 0.4)) * 10) / 10;
      return {
        id: uid(),
        date: addDays(startDate, i * 14),
        weight,
        waist: Math.round(weight * (t.sex === 'k' ? 1.08 : 1.0)),
        hips: Math.round(weight * (t.sex === 'k' ? 1.5 : 1.2)),
        chest: Math.round(weight * (t.sex === 'k' ? 1.45 : 1.22)),
        arm: Math.round(weight * 0.38),
        thigh: Math.round(weight * (t.sex === 'k' ? 0.88 : 0.72)),
        bf: Math.round(r(t.sex === 'k' ? 20 : 11, t.sex === 'k' ? 27 : 19) * 10) / 10,
        note: i === 0 ? 'Pomiar startowy' : undefined,
      };
    }).filter((m) => m.date <= today);

    /* --- testy --- */
    const tests: Client['tests'] = [];
    const tdate = addDays(today, -10);
    const cmj = Math.round(r(t.sex === 'k' ? 28 : 38, t.sex === 'k' ? 36 : 50) * 10) / 10;
    tests.push({ id: uid(), date: addDays(startDate, 3), name: 'CMJ (cm)', value: Math.round(cmj * 0.94 * 10) / 10, unit: 'cm' });
    tests.push({ id: uid(), date: tdate, name: 'CMJ (cm)', value: cmj, unit: 'cm' });
    if (BASE_E1['Przysiad ze sztangą'] && t.template === 'sc') {
      tests.push({ id: uid(), date: tdate, name: '1RM przysiad', value: Math.round((120 * t.strength * 1.1) / 2.5) * 2.5, unit: 'kg' });
    }
    if (t.special === 'acl') {
      for (const [name, L, P, date] of [
        ['Single hop (cm)', 118, 152, addDays(today, -40)],
        ['Single hop (cm)', 131, 158, tdate],
        ['Triple hop (cm)', 402, 455, tdate],
        ['Izometria czworogłowego (Nm)', 168, 221, tdate],
      ] as const) {
        tests.push({ id: uid(), date, name, left: L, right: P, involved: 'L', lsi: computeLsi(L, P, { involved: 'L' }) ?? undefined, unit: name.includes('Nm') ? 'Nm' : 'cm' });
      }
    }
    if (t.special === 'pain') {
      tests.push({ id: uid(), date: tdate, name: 'Y-balance (%)', left: 94, right: 89, lsi: computeLsi(94, 89) ?? undefined, unit: '%' });
    }

    /* --- urazy --- */
    const injuryLog: Client['injuryLog'] = [];
    if (t.special === 'acl') injuryLog.push({ id: uid(), name: 'Rekonstrukcja ACL', date: addDays(today, -230), side: 'lewa', status: 'w rehabilitacji', returnDate: addDays(today, 60), note: 'Przeszczep z mięśni kulszowo-goleniowych.' });
    if (t.special === 'shoulder') injuryLog.push({ id: uid(), name: 'Konflikt podbarkowy', date: addDays(today, -70), side: 'prawa', status: 'aktywny', note: 'Ból przy serwisie.' });
    if (t.special === 'pain') injuryLog.push({ id: uid(), name: 'Skręcenie stawu skokowego', date: addDays(today, -400), side: 'prawa', status: 'wyleczony' });

    /* --- check-iny (tryb zawodnika) --- */
    const checkins: Checkin[] = [];
    if (ci < 4) {
      for (let d = 20; d >= 1; d -= ri(1, 3)) {
        checkins.push({ date: addDays(today, -d), sleep: ri(3, 5), energy: ri(3, 5), muscle: ri(2, 4), stress: ri(2, 4), mood: ri(3, 5) });
      }
    }

    const age = t.sex === 'k' ? 19 + (ci % 9) : 22 + (ci % 12);
    clients.push({
      id,
      name: t.name,
      email: `${slug(t.name)}@example.com`,
      phone: `+48 ${500 + ci * 37} ${String(100 + ci * 71).slice(-3)} ${String(200 + ci * 53).slice(-3)}`,
      goal: t.goal,
      level: t.level,
      status: t.status,
      dob: `${new Date().getFullYear() - age}-0${1 + (ci % 9)}-1${ci % 9}`,
      height: t.sex === 'k' ? 160 + ci * 2 : 175 + ci,
      sport: t.sport,
      position: t.position,
      dominant: ci % 4 === 1 ? 'lewa' : 'prawa',
      experience: `${2 + (ci % 6)} lata`,
      daysPerWeek: t.days.length,
      targetDate: t.special === 'acl' ? addDays(today, 60) : t.special === 'acwr' ? addDays(today, 24) : undefined,
      billing: t.billing,
      singleRate: t.billing === 'pojedyncza' ? 180 : undefined,
      subRate: t.billing === 'abonament' ? 600 : undefined,
      pkgSize: t.billing === 'pakiet' ? 10 : undefined,
      pkgPrice: t.billing === 'pakiet' ? 1600 : undefined,
      startDate,
      injuries: t.special === 'acl' ? 'ACL lewe (rekonstrukcja)' : '',
      notes: '',
      createdAt: startDate + 'T08:00:00Z',
      payments,
      measurements,
      tests,
      injuryLog,
      checkins,
    });
  });

  return { clients, plans, sessions, appointments, library };
}

/** Pusta baza (start bez danych przykładowych) — zostawia bibliotekę ćwiczeń. */
export function createEmpty(): Db {
  return { clients: [], plans: [], sessions: [], appointments: [], library: LIBRARY.map(([name, cat]) => ({ id: uid(), name, cat })) };
}
