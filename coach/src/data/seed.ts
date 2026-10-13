import type { Client, ClientStatus, Goal, Plan, SessionType } from '../types';
import { GOALS } from '../types';
import { toISODate, uid } from '../utils';

// Deterministyczny generator, żeby dane przykładowe były zawsze takie same.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type TemplateDay = { name: string; exercises: [string, string, string][] };

const PLAN_TEMPLATES: { name: string; days: TemplateDay[] }[] = [
  {
    name: 'Full Body 3x/tydzień',
    days: [
      {
        name: 'Poniedziałek',
        exercises: [
          ['Przysiad ze sztangą', '4', '8'],
          ['Wyciskanie sztangi leżąc', '4', '8'],
          ['Wiosłowanie hantlem', '3', '10'],
          ['Plank', '3', '45 s'],
        ],
      },
      {
        name: 'Środa',
        exercises: [
          ['Martwy ciąg', '4', '6'],
          ['Wyciskanie hantli nad głowę', '3', '10'],
          ['Podciąganie nachwytem', '3', '6'],
          ['Wykroki chodzone', '3', '12'],
        ],
      },
      {
        name: 'Piątek',
        exercises: [
          ['Przysiad bułgarski', '3', '10'],
          ['Pompki na poręczach', '3', '8'],
          ['Wiosłowanie sztangą', '4', '8'],
          ['Dead bug', '3', '12'],
        ],
      },
    ],
  },
  {
    name: 'Push / Pull / Legs',
    days: [
      {
        name: 'Push',
        exercises: [
          ['Wyciskanie sztangi leżąc', '4', '6'],
          ['Wyciskanie hantli na skosie', '3', '10'],
          ['Wyciskanie żołnierskie', '3', '8'],
          ['Prostowanie ramion na wyciągu', '3', '12'],
        ],
      },
      {
        name: 'Pull',
        exercises: [
          ['Podciąganie', '4', '6'],
          ['Wiosłowanie sztangą', '4', '8'],
          ['Face pull', '3', '15'],
          ['Uginanie ramion z hantlami', '3', '12'],
        ],
      },
      {
        name: 'Legs',
        exercises: [
          ['Przysiad ze sztangą', '4', '6'],
          ['Martwy ciąg rumuński', '3', '8'],
          ['Wypychanie na suwnicy', '3', '12'],
          ['Wspięcia na palce', '4', '15'],
        ],
      },
    ],
  },
  {
    name: 'Redukcja — obwodowy',
    days: [
      {
        name: 'Obwód A',
        exercises: [
          ['Burpee', '4', '10'],
          ['Przysiad z wyskokiem', '4', '12'],
          ['Mountain climber', '4', '30 s'],
          ['Swing kettlebell', '4', '15'],
        ],
      },
      {
        name: 'Obwód B',
        exercises: [
          ['Pompki', '4', '12'],
          ['Wykroki z wyskokiem', '4', '10'],
          ['Wiosłowanie TRX', '4', '12'],
          ['Skakanka', '4', '60 s'],
        ],
      },
    ],
  },
];

const NAMES = [
  'Anna Kowalska', 'Piotr Nowak', 'Katarzyna Wiśniewska', 'Tomasz Wójcik',
  'Magdalena Kamińska', 'Michał Lewandowski', 'Agnieszka Zielińska', 'Krzysztof Szymański',
  'Joanna Woźniak', 'Paweł Dąbrowski', 'Monika Kozłowska', 'Łukasz Jankowski',
  'Aleksandra Mazur', 'Marcin Kwiatkowski', 'Natalia Krawczyk', 'Jakub Piotrowski',
  'Ewa Grabowska', 'Bartosz Nowakowski', 'Karolina Pawłowska', 'Mateusz Michalski',
  'Zuzanna Adamczyk', 'Kamil Dudek', 'Weronika Zając', 'Adrian Wieczorek',
];

const SESSION_TYPES_POOL: SessionType[] = ['Trening siłowy', 'Trening funkcjonalny', 'Cardio', 'Trening siłowy'];

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/\s+/g, '.');
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function buildPlan(index: number): Plan {
  const t = PLAN_TEMPLATES[index % PLAN_TEMPLATES.length];
  return {
    name: t.name,
    days: t.days.map((day) => ({
      id: uid(),
      name: day.name,
      exercises: day.exercises.map(([name, sets, reps]) => ({ id: uid(), name, sets, reps, done: false })),
    })),
  };
}

export function createSeed(today = new Date()): Client[] {
  const rand = mulberry32(2026);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
  const times = ['07:00', '08:30', '10:00', '12:00', '16:00', '17:30', '19:00'];

  return NAMES.map((name, i) => {
    const female = /a$/.test(name.split(' ')[0]);
    const height = female ? 158 + Math.round(rand() * 16) : 172 + Math.round(rand() * 16);
    const goal: Goal = pick(GOALS);
    const status: ClientStatus = i % 9 === 4 ? 'Nowy' : i % 7 === 5 ? 'Pauza' : 'Aktywny';

    // Waga startowa i trend zależny od celu.
    const startWeight = Math.round((female ? 58 + rand() * 22 : 74 + rand() * 26) * 10) / 10;
    const trend = goal === 'Redukcja tkanki tłuszczowej' ? -0.9 : goal === 'Budowa masy mięśniowej' ? 0.5 : -0.2;

    const measurements = Array.from({ length: 6 }, (_, k) => {
      const weight = Math.round((startWeight + trend * k + (rand() - 0.5) * 0.6) * 10) / 10;
      return {
        id: uid(),
        date: toISODate(addDays(today, -14 * (5 - k) - 2)),
        weight,
        chest: Math.round(weight * 1.18 + rand() * 4),
        waist: Math.round(weight * (female ? 0.98 : 1.0) + rand() * 3),
        hips: Math.round(weight * 1.25 + rand() * 4),
        note: k === 0 ? 'Pomiar startowy' : undefined,
      };
    });
    const currentWeight = measurements[measurements.length - 1].weight;
    const targetWeight = Math.round(startWeight + trend * 14);

    const sessions = [
      ...[-12, -8, -4].map((d) => ({
        id: uid(),
        date: toISODate(addDays(today, d - (i % 3))),
        time: pick(times),
        type: pick(SESSION_TYPES_POOL),
        status: (rand() < 0.15 ? 'Odwołana' : 'Odbyta') as 'Odwołana' | 'Odbyta',
      })),
      ...[1 + (i % 4), 5 + (i % 3)].map((d, k) => ({
        id: uid(),
        date: toISODate(addDays(today, d)),
        time: pick(times),
        type: (k === 1 && i % 5 === 0 ? 'Pomiar sylwetki' : pick(SESSION_TYPES_POOL)) as SessionType,
        status: 'Zaplanowana' as const,
      })),
    ];

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const monthName = (d: Date) => d.toLocaleDateString('pl-PL', { month: 'long' });
    const payments = [
      {
        id: uid(),
        date: toISODate(prevMonthStart),
        amount: 400,
        description: `Karnet miesięczny — ${monthName(prevMonthStart)}`,
        status: 'Opłacone' as const,
      },
      {
        id: uid(),
        date: toISODate(monthStart),
        amount: 400,
        description: `Karnet miesięczny — ${monthName(monthStart)}`,
        status: (rand() < 0.35 ? 'Zaległe' : 'Opłacone') as 'Zaległe' | 'Opłacone',
      },
    ];
    if (i % 4 === 1) {
      payments.push({
        id: uid(),
        date: toISODate(addDays(today, -10)),
        amount: 150,
        description: 'Konsultacja dietetyczna',
        status: rand() < 0.5 ? 'Zaległe' : 'Opłacone',
      });
    }

    return {
      id: uid(),
      name,
      email: `${slug(name)}@example.com`,
      phone: `+48 ${500 + Math.floor(rand() * 300)} ${String(Math.floor(rand() * 1000)).padStart(3, '0')} ${String(
        Math.floor(rand() * 1000),
      ).padStart(3, '0')}`,
      age: 22 + Math.floor(rand() * 30),
      height,
      goal,
      status,
      currentWeight,
      targetWeight,
      measurements,
      sessions,
      payments,
      plan: buildPlan(i),
    };
  });
}
