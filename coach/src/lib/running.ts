import type { PlanExercise, RunProfile, SetGroup, TrainingSession } from '../domain';
import { uid } from '../format';

/**
 * Bieganie: zapis jak u trenerów biegowych — rozgrzewka, część główna (odcinki × dystans / czas
 * @ tempo lub strefa, przerwa w truchcie), schłodzenie. Strefy tętna z tętna maks., tempo z czasu na 5 km.
 */

/** Nazwy treningów biegowych (pokazujemy tempo, strefy, kilometraż). */
export function isRunning(name: string): boolean {
  return /bieg|bieżni|trucht|interwał|przebieżk|fartlek|\bbnp\b|\bowb\s*\d|\bbc\s*[123]\b|\bwb\s*[123]\b|jogging|\brun\b/i.test(name);
}

/** Czas z pola: „45” = 45 min, „3:05” = 3 min 5 s, „1:20:00”, „90 s”, „45''”. Zwraca minuty. */
export function parseDur(v: unknown): number | null {
  const t = String(v ?? '').trim().replace(',', '.');
  if (!t) return null;
  let m = t.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (m) return +m[1] * 60 + +m[2] + +m[3] / 60;
  m = t.match(/^(\d+):(\d{1,2})$/);
  if (m) return +m[1] + +m[2] / 60;
  m = t.match(/^(\d+(?:\.\d+)?)\s*(s|sek\w*|"|'')$/i);
  if (m) return +m[1] / 60;
  m = t.match(/^(\d+(?:\.\d+)?)\s*(min\w*|')?$/i);
  if (m) return +m[1];
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Minuty jako zegar: 3.0833 → „3:05”, 80 → „1:20:00”. */
export function fmtClock(min: number): string {
  const s = Math.round(min * 60);
  const h = Math.floor(s / 3600);
  return h ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** Czas do pokazania: pełne minuty „45 min”, z sekundami „3:05”. */
export function fmtDur(min: number): string {
  return Math.abs(min * 60 - Math.round(min) * 60) < 0.5 && min < 60 ? `${Math.round(min)} min` : fmtClock(min);
}

/** Tempo min/km z czasu (min) i dystansu (km): „5:24/km”. */
export function paceText(min: number | null | undefined, km: number | null | undefined): string {
  if (!min || !km || km < 0.05) return '';
  const p = min / km;
  return p > 1.5 && p < 30 ? `${fmtClock(p)}/km` : '';
}

/** Dystans z pola planu: „0,8”, „800 m”, „5 km” → km. */
export function parseKm(v: unknown): number | null {
  const m = String(v ?? '').trim().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(km|m)?$/i);
  if (!m) return null;
  return m[2]?.toLowerCase() === 'm' ? +m[1] / 1000 : +m[1];
}

/** Dystans do pokazania: < 1 km w metrach. */
export function fmtKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${String(Math.round(km * 100) / 100).replace('.', ',')} km`;
}

export interface Zone {
  z: string;
  name: string;
  /** % tętna maks. */
  hr: [number, number];
  /** Tempo jako wielokrotność tempa na 5 km (wolniej = więcej). */
  pace: [number, number];
}

/** 5 stref (% HRmax) z polskimi nazwami zakresów; tempo orientacyjne względem tempa 5 km. */
export const ZONES: Zone[] = [
  { z: 'Z1', name: 'trucht / regeneracja', hr: [0.5, 0.6], pace: [1.35, 1.5] },
  { z: 'Z2', name: 'rozbieganie (OWB1)', hr: [0.6, 0.7], pace: [1.2, 1.35] },
  { z: 'Z3', name: 'tempo (OWB2 / BC2)', hr: [0.7, 0.8], pace: [1.1, 1.2] },
  { z: 'Z4', name: 'próg (BC3)', hr: [0.8, 0.9], pace: [1.03, 1.1] },
  { z: 'Z5', name: 'interwały (VO₂max)', hr: [0.9, 1], pace: [0.95, 1.03] },
];

const ALIAS: Record<string, string> = { OWB1: 'Z2', OWB2: 'Z3', BC1: 'Z2', BC2: 'Z3', BC3: 'Z4', WB1: 'Z2', WB2: 'Z3', WB3: 'Z4', TRUCHT: 'Z1' };

/** Strefa z zapisu celu: „Z2”, „strefa 3”, „OWB1”, „BC3”. */
export function zoneOf(target: string | undefined): Zone | null {
  const t = String(target ?? '').toUpperCase().replace(/\s+/g, '');
  const a = Object.keys(ALIAS).find((k) => t.includes(k));
  const m = (a ? ALIAS[a] : t).match(/(?:Z|STREFA)([1-5])/);
  return m ? ZONES[+m[1] - 1] : null;
}

/** Tempo na 5 km (min/km) z czasu biegu, np. „25:00” → 5. */
export function pace5k(p?: RunProfile): number | null {
  const d = parseDur(p?.t5k);
  return d && d > 10 && d < 90 ? d / 5 : null;
}

/** Wiek z daty urodzenia → szacowane tętno maks. (Tanaka: 208 − 0,7 × wiek), gdy nie wpisano zmierzonego. */
export function hrMaxOf(p?: RunProfile, birthDate?: string): { v: number; est: boolean } | null {
  if (p?.hrMax && p.hrMax > 120 && p.hrMax < 230) return { v: p.hrMax, est: false };
  if (!birthDate) return null;
  const age = (Date.now() - new Date(`${birthDate}T12:00:00`).getTime()) / (365.25 * 864e5);
  return age > 8 && age < 100 ? { v: Math.round(208 - 0.7 * age), est: true } : null;
}

/** Opis celu odcinka: strefa z zakresem tętna i tempa (jeśli są dane) albo tempo wpisane wprost. */
export function targetText(target: string | undefined, p?: RunProfile, birthDate?: string): string {
  const t = String(target ?? '').trim();
  if (!t) return '';
  const z = zoneOf(t);
  if (!z) return /^\d{1,2}:\d{2}(\s*[-–]\s*\d{1,2}:\d{2})?$/.test(t) ? `${t}/km` : t;
  const hm = hrMaxOf(p, birthDate);
  const p5 = pace5k(p);
  return [
    `${z.z} ${z.name}`,
    hm && `${Math.round(hm.v * z.hr[0])}–${Math.round(hm.v * z.hr[1])} ud./min`,
    p5 && `~${fmtClock(p5 * z.pace[0])}–${fmtClock(p5 * z.pace[1])}/km`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Suma biegu w treningu: km, minuty i średnie tempo (z odcinków z czasem i dystansem). */
export function runTotals(s: TrainingSession): { km: number; min: number; pace: string } | null {
  const logs = s.exercises.filter((e) => e.cardio).flatMap((e) => e.setsLog ?? []);
  if (!logs.length) return null;
  const km = logs.reduce((a, x) => a + (x.dist ?? 0), 0);
  const min = logs.reduce((a, x) => a + (x.reps ?? 0), 0);
  const both = logs.filter((x) => x.dist && x.reps);
  return { km, min, pace: paceText(both.reduce((a, x) => a + x.reps!, 0), both.reduce((a, x) => a + x.dist!, 0)) };
}

const g = (type: SetGroup['type'], sets: string, reps: string, load: string, pace: string, rpe = ''): SetGroup => ({ type, sets, reps, load, rpe, pace });

export interface RunTemplate {
  id: string;
  name: string;
  hint: string;
  make: () => PlanExercise;
}

/** Gotowe jednostki biegowe do wstawienia i dopasowania (czas = min lub m:ss, dystans = km lub „800 m”). */
export const RUN_TEMPLATES: RunTemplate[] = [
  { id: 'easy', name: 'Rozbieganie', hint: '40 min w Z2 (OWB1)', make: () => ({ id: uid(), name: 'Rozbieganie', cardio: true, rest: '', notes: 'Spokojnie, swobodna rozmowa.', groups: [g('Robocze', '1', '40', '', 'Z2', '3')] }) },
  { id: 'long', name: 'Długi bieg', hint: '75 min w Z2', make: () => ({ id: uid(), name: 'Długi bieg', cardio: true, rest: '', notes: 'Równe tempo, picie co 20–30 min.', groups: [g('Robocze', '1', '75', '', 'Z2', '4')] }) },
  {
    id: 'int',
    name: 'Interwały 6 × 800 m',
    hint: 'rozgrzewka, 6 × 800 m w Z5, 2:00 trucht, schłodzenie',
    make: () => ({ id: uid(), name: 'Interwały 6 × 800 m', cardio: true, rest: '2:00 trucht', notes: '', groups: [g('Rozgrzewka', '1', '15', '', 'Z2'), g('Robocze', '6', '', '800 m', 'Z5', '8'), g('Schłodzenie', '1', '10', '', 'Z1')] }),
  },
  {
    id: 'tempo',
    name: 'Bieg w tempie progowym',
    hint: 'rozgrzewka, 20 min w Z4 (BC3), schłodzenie',
    make: () => ({ id: uid(), name: 'Bieg progowy', cardio: true, rest: '', notes: '', groups: [g('Rozgrzewka', '1', '15', '', 'Z2'), g('Robocze', '1', '20', '', 'Z4', '7'), g('Schłodzenie', '1', '10', '', 'Z1')] }),
  },
  {
    id: 'strides',
    name: 'Rozbieganie + przebieżki',
    hint: '30 min Z2, potem 6 × 100 m szybko i luźno',
    make: () => ({ id: uid(), name: 'Rozbieganie + przebieżki (RT)', cardio: true, rest: '1:00 trucht', notes: 'Przebieżki: szybko, ale luźno — bez sprintu.', groups: [g('Rozgrzewka', '1', '30', '', 'Z2'), g('Robocze', '6', '', '100 m', 'szybko, luźno')] }),
  },
  {
    id: 'hills',
    name: 'Podbiegi',
    hint: 'rozgrzewka, 8 × 0:30 pod górę, zbieg truchtem',
    make: () => ({ id: uid(), name: 'Podbiegi (SB)', cardio: true, rest: 'zbieg truchtem', notes: 'Nachylenie 5–8%, wysokie kolano, praca rąk.', groups: [g('Rozgrzewka', '1', '15', '', 'Z2'), g('Robocze', '8', '0:30', '', 'Z5', '8'), g('Schłodzenie', '1', '10', '', 'Z1')] }),
  },
  {
    id: 'fartlek',
    name: 'Fartlek',
    hint: '8 × 1 min mocniej / 1 min trucht',
    make: () => ({ id: uid(), name: 'Fartlek', cardio: true, rest: '1:00 trucht', notes: '', groups: [g('Rozgrzewka', '1', '10', '', 'Z2'), g('Robocze', '8', '1:00', '', 'Z4', '7'), g('Schłodzenie', '1', '10', '', 'Z1')] }),
  },
  { id: 'bnp', name: 'Bieg z narastającą prędkością (BNP)', hint: '3 × 10 min: Z2 → Z3 → Z4', make: () => ({ id: uid(), name: 'BNP', cardio: true, rest: '', notes: 'Bez przerw — każdy odcinek szybciej.', groups: [g('Robocze', '1', '10', '', 'Z2', '4'), g('Robocze', '1', '10', '', 'Z3', '6'), g('Robocze', '1', '10', '', 'Z4', '7')] }) },
];
