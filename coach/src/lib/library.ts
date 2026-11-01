import type { ExerciseCategory, Plan, TrainingSession } from '../domain';
import { ATLAS } from '../data/atlas';
import { normalize } from '../format';

/* Biblioteka ćwiczeń: atlas bez duplikatów (słownik PL ↔ EN) i zmiana nazwy w planach / historii. */

/** Podstawowe ćwiczenia: nazwa z atlasu (EN) → polskie nazwy, pod którymi trenerzy je zapisują. */
export const PL_EN: [string, string[]][] = [
  ['Back Squat', ['Przysiad ze sztangą', 'Przysiad ze sztangą na plecach', 'Przysiad tylny']],
  ['Front Squat', ['Przysiad przedni', 'Przysiad ze sztangą z przodu']],
  ['Box Squat', ['Przysiad na skrzynię']],
  ['Goblet Squat', ['Przysiad goblet', 'Przysiad z kettlem']],
  ['Bulgarian Split Squat', ['Przysiad bułgarski', 'Bułgarski przysiad']],
  ['Split Squat', ['Wykrok w miejscu', 'Przysiad wykroczny']],
  ['Walking Lunge', ['Wykroki chodzone', 'Wykroki w marszu']],
  ['Reverse Lunge', ['Wykrok w tył', 'Wykroki w tył']],
  ['Step-Up', ['Wejście na skrzynię', 'Wejścia na skrzynię']],
  ['Step-Down', ['Step down', 'Zejście ze stepu']],
  ['Leg Press', ['Suwnica', 'Wypychanie na suwnicy']],
  ['Leg Extension', ['Prostowanie nóg na maszynie', 'Wyprost nóg']],
  ['Deadlift', ['Martwy ciąg', 'Martwy ciąg klasyczny']],
  ['Sumo Deadlift', ['Martwy ciąg sumo']],
  ['Trap Bar Deadlift', ['Martwy ciąg na trap bar', 'Martwy ciąg z trap bar']],
  ['Romanian Deadlift', ['Martwy ciąg rumuński', 'RDL']],
  ['Single-Leg Romanian Deadlift', ['Single leg RDL', 'Martwy ciąg rumuński jednonóż', 'RDL jednonóż']],
  ['Good Morning', ['Skłony ze sztangą', 'Dzień dobry']],
  ['Barbell Hip Thrust', ['Hip thrust', 'Hip thrust ze sztangą', 'Wypychanie bioder']],
  ['Glute Bridge', ['Mostek biodrowy', 'Unoszenie bioder']],
  ['Nordic Hamstring Curl', ['Nordic hamstring', 'Nordic curl', 'Nordyckie uginanie']],
  ['Lying Leg Curl', ['Uginanie nóg leżąc']],
  ['Kettlebell Swing', ['Swing kettlem', 'Swing']],
  ['Standing Calf Raise', ['Wspięcia na palce', 'Wspięcia na palce stojąc']],
  ['Bench Press', ['Wyciskanie sztangi leżąc', 'Wyciskanie na ławce płaskiej', 'Wyciskanie leżąc']],
  ['Incline Bench Press', ['Wyciskanie sztangi na skosie']],
  ['Incline Dumbbell Press', ['Wyciskanie hantli na skosie']],
  ['Dumbbell Bench Press', ['Wyciskanie hantli leżąc']],
  ['Overhead Press', ['Wyciskanie żołnierskie', 'Wyciskanie nad głowę', 'OHP']],
  ['Half-Kneeling Landmine Press', ['Landmine press']],
  ['Push-Up', ['Pompki', 'Pompka']],
  ['Dip', ['Dipy', 'Pompki na poręczach']],
  ['Pull-Up', ['Podciąganie', 'Podciąganie nachwytem', 'Podciąganie na drążku']],
  ['Chin-Up', ['Podciąganie podchwytem']],
  ['Lat Pulldown', ['Ściąganie drążka', 'Ściąganie drążka wyciągu górnego']],
  ['Barbell Row', ['Wiosłowanie sztangą']],
  ['Single-Arm Dumbbell Row', ['Wiosłowanie hantlem', 'Wiosłowanie hantlem jednorącz']],
  ['Seated Cable Row', ['Wiosłowanie linką', 'Wiosłowanie siedząc na wyciągu']],
  ['Inverted Row', ['Wiosłowanie australijskie', 'Podciąganie australijskie']],
  ['Face Pull', ['Face pull', 'Przyciąganie liny do twarzy']],
  ['Cable External Rotation', ['Rotacja zewnętrzna z gumą', 'Rotacja zewnętrzna na wyciągu']],
  ['Barbell Curl', ['Uginanie ramion ze sztangą']],
  ['Plank', ['Deska', 'Plank']],
  ['Side Plank', ['Plank boczny', 'Deska boczna']],
  ['Copenhagen Plank', ['Copenhagen plank', 'Deska kopenhaska']],
  ['Dead Bug', ['Dead bug', 'Martwy robak']],
  ['Bird Dog', ['Bird dog']],
  ['Pallof Press', ['Pallof press']],
  ['Farmer’s Carry', ['Spacer farmera', 'Farmer walk']],
  ['Power Clean', ['Zarzut siłowy', 'Power clean']],
  ['Hang Snatch', ['Rwanie z zawieszenia']],
  ['Countermovement Jump', ['CMJ', 'Skok z zamachem']],
  ['Box Jump', ['Skok na skrzynię', 'Skoki na skrzynię']],
  ['Single-Leg Hop', ['Hop jednonóż', 'Skok jednonóż']],
  ['Drop Jump', ['Drop jump', 'Zeskok']],
  ['Broad Jump', ['Skok w dal z miejsca']],
  ['Sprint 10 m', ['Sprint 10 m']],
  ['Bike Intervals', ['Rower interwały', 'Interwały na rowerze']],
  ['Rowing Erg 500 m', ['Wioślarz 500 m', 'Ergometr 500 m']],
  ['90/90 Hip Switch', ['Mobilizacja biodra 90/90', '90/90']],
  ['Knee-to-Wall Ankle Mobilization', ['Knee-to-wall', 'Kolano do ściany']],
  ['Isometric Quad Set', ['Izometria czworogłowego', 'Napinanie czworogłowego']],
  ['Spanish Squat', ['Spanish squat', 'Przysiad hiszpański']],
  ['Wall Sit', ['Krzesełko', 'Krzesełko przy ścianie']],
];

const key = (s: string) => normalize(s).replace(/[’'`]/g, '').replace(/[\s-]+/g, ' ').trim();
const ALIAS = new Map<string, string>();
for (const [en, pls] of PL_EN) for (const n of [en, ...pls]) ALIAS.set(key(n), key(en));

/** Klucz ćwiczenia: polska nazwa ze słownika → nazwa z atlasu; inne bez wielkości liter / ogonków. */
export const exerciseKey = (name: string) => ALIAS.get(key(name)) ?? key(name);

/** Ćwiczenia z atlasu, których nie ma w bibliotece — także pod polską nazwą (Przysiad ze sztangą = Back Squat). */
export function atlasToAdd(libraryNames: string[], atlas: [string, ExerciseCategory][] = ATLAS): [string, ExerciseCategory][] {
  const have = new Set(libraryNames.map(exerciseKey));
  return atlas.filter(([n]) => !have.has(exerciseKey(n)));
}

/* ---------- zmiana nazwy ---------- */

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Ile planów i ile zapisanych treningów ma ćwiczenie o tej nazwie (bez wielkości liter). */
export function renameCounts(plans: Plan[], sessions: TrainingSession[], name: string): { plans: number; sessions: number } {
  const inPlan = (p: Plan) => p.weeks.some((w) => w.workouts.some((k) => k.exercises.some((e) => same(e.name, name))));
  return { plans: plans.filter(inPlan).length, sessions: sessions.filter((s) => s.exercises.some((e) => same(e.name, name))).length };
}

/** Plany i treningi z nową nazwą ćwiczenia (tylko zmienione rekordy). */
export function renameIn(plans: Plan[], sessions: TrainingSession[], from: string, to: string): { plans: Plan[]; sessions: TrainingSession[] } {
  const nm = <T extends { name: string }>(e: T): T => (same(e.name, from) ? { ...e, name: to } : e);
  const ps = plans
    .filter((p) => p.weeks.some((w) => w.workouts.some((k) => k.exercises.some((e) => same(e.name, from)))))
    .map((p) => ({ ...p, weeks: p.weeks.map((w) => ({ ...w, workouts: w.workouts.map((k) => ({ ...k, exercises: k.exercises.map(nm) })) })) }));
  const ss = sessions.filter((s) => s.exercises.some((e) => same(e.name, from))).map((s) => ({ ...s, exercises: s.exercises.map(nm) }));
  return { plans: ps, sessions: ss };
}
