/**
 * Postępy podopiecznego: serie robocze na partię mięśniową w tygodniu.
 * Biblioteka ćwiczeń (data/atlas.ts, seed) ma tylko kategorie, nie mięśnie — stąd słownik
 * słów kluczowych dla polskich (i angielskich) nazw ćwiczeń. Czyste funkcje, testy w progressMuscles.test.ts.
 */
import type { ISODate, SessionExercise, TrainingSession } from '../domain';
import { addDays, weekStart } from './dates';
import { repsN } from './parse';

export const MUSCLES = ['klatka', 'plecy', 'barki', 'biceps', 'triceps', 'czworoglowe', 'dwuglowe', 'posladki', 'lydki', 'brzuch'] as const;
export type Muscle = (typeof MUSCLES)[number];

export const MUSCLE_LABEL: Record<Muscle, string> = {
  klatka: 'Klatka',
  plecy: 'Plecy',
  barki: 'Barki',
  biceps: 'Biceps',
  triceps: 'Triceps',
  czworoglowe: 'Czworogłowe',
  dwuglowe: 'Dwugłowe uda',
  posladki: 'Pośladki',
  lydki: 'Łydki',
  brzuch: 'Brzuch',
};

export interface MuscleMap {
  /** Główne mięśnie — seria liczy się w całości. */
  primary: Muscle[];
  /** Pomocnicze — seria liczy się jako ½. */
  secondary: Muscle[];
}

/** Małe litery, bez polskich znaków (ł → l), bez myślników. */
export function normName(name: string): string {
  return String(name ?? '')
    .toLocaleLowerCase('pl')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[-–_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type Rule = [RegExp, Muscle[], Muscle[]?];

/** Kolejność ma znaczenie: pierwsza pasująca reguła wygrywa (szczegółowe przed ogólnymi). */
const RULES: Rule[] = [
  // kondycja, plyometria, mobilność — bez serii na mięśnie
  [/wioslarz|ergometr|rower|bieg|trucht|orbitrek|skakank|plyw|\bski ?erg|marsz|spacer|\bbike\b|\brun\b|jogging/, []],
  [/\bskok|wyskok|podskok|\bhop\b|jump|\bcmj\b|plyo|bound|pajacyk|burpee/, []],
  [/hip thrust|glute bridge|most biodrow|unoszenie bioder|wypychanie bioder|odwodzenie|abduct|glute kickback|wykop/, ['posladki'], ['dwuglowe']],
  [/nordic|leg curl|uginanie nog|ugin\w* nog|hamstring curl|glute ham/, ['dwuglowe']],
  [/rumun|\brdl\b|romanian|stiff|prostych nog|good morning|dzien dobry|single leg deadlift/, ['dwuglowe', 'posladki'], ['plecy']],
  [/martwy ciag|deadlift|\bmc\b/, ['posladki', 'dwuglowe', 'plecy'], ['czworoglowe']],
  [/swing|wymach/, ['posladki', 'dwuglowe']],
  [/zarzut|rwanie|podrzut|\bclean\b|snatch|\bjerk\b/, ['posladki', 'czworoglowe'], ['plecy', 'barki']],
  [/prostowanie nog|leg extension|izometri\w* czworo|wall sit|krzeselko|sissy|spanish squat/, ['czworoglowe']],
  [/wykrok|zakrok|lunge|bulgar|split squat|step ?up|step ?down|wejsci\w* na|wchodzeni|pistol|skater|cossack/, ['czworoglowe', 'posladki'], ['dwuglowe']],
  [/przysiad|squat|leg press|suwnic|wypychanie nog|hack/, ['czworoglowe', 'posladki'], ['dwuglowe']],
  [/lydk|wspiec|wspinani\w* na palce|calf|na palce/, ['lydki']],
  [/face pull|odwrotn\w* rozpiet|reverse fly|rear delt|tyln\w* aktonu|rotacj\w* zewn|external rotation|\by raise|\bytw\b|\bi y t\b/, ['barki'], ['plecy']],
  [/zolniersk|\bohp\b|overhead press|military|nad glow|arnold|landmine press|push press|wyciskanie \w+ (stojac|siedzac)|shoulder press|wyciskanie na barki/, ['barki'], ['triceps']],
  [/unoszenie (ramion |hantli |rak )?(bokiem|przodem|w bok)|wznos\w* (bokiem|przodem|hantli|ramion)|lateral raise|front raise|upright|podciaganie sztangi wzdluz/, ['barki']],
  [/francusk|prostowanie (ramion|przedramion|rak)|triceps|pushdown|push down|skull|kickback|dipy na lawce|bench dip|wyciskanie waskie|close grip/, ['triceps']],
  [/uginanie (ramion|przedramion|rak)|biceps|\bcurl|mlotkow|hammer|modlitewn|preacher/, ['biceps']],
  [/wyciskanie|bench|pompk|push ?up|rozpiet|\bfly\b|flye|dipy|dips|porecz|chest press|butterfly|krzyzowani|crossover/, ['klatka'], ['triceps', 'barki']],
  [/podciag|pull ?up|chin ?up|sciaganie|pulldown|drazek|pullover/, ['plecy'], ['biceps']],
  [/wioslowanie|\brow\b|rowing|przyciaganie|inverted row|australijsk/, ['plecy'], ['biceps']],
  [/szrug|shrug|kaptur/, ['plecy']],
  [/prostowanie tulowia|hyperext|wyprost\w* tulow|back extension|superman|lawka rzymska|roman chair/, ['plecy'], ['posladki', 'dwuglowe']],
  [/plank|deska|dead ?bug|pallof|brzuch|spieci|crunch|unoszenie nog|hollow|ab wheel|kolko|rollout|russian twist|bird ?dog|scyzoryk|wznos\w* nog|nozyc|farmer|spacer farmera|carry|copenhagen|suitcase|antyrotac|anti rotation|core|l sit|woodchop|drwal/, ['brzuch']],
];

const NONE: MuscleMap = { primary: [], secondary: [] };

/** Mięśnie pracujące w ćwiczeniu (po nazwie). Nieznane ćwiczenie — puste listy. */
export function musclesOf(name: string): MuscleMap {
  const n = normName(name);
  if (!n) return NONE;
  for (const [re, primary, secondary = []] of RULES) if (re.test(n)) return { primary, secondary };
  return NONE;
}

/** Ukończone serie robocze ćwiczenia (bez rozgrzewek i niezaliczonych); bez zapisu serii — z podsumowania „serie”. Cardio — 0. */
export function workingSets(e: SessionExercise): number {
  if (e.cardio) return 0;
  if (e.setsLog?.length) return e.setsLog.filter((s) => !s.warmup && s.done !== false && !/rozgrzew|warm/i.test(s.label ?? '')).length;
  return repsN(e.sets) ?? 0;
}

/** Serie na partię w zbiorze treningów: główne × 1, pomocnicze × ½. */
export function setsByMuscle(sessions: TrainingSession[]): Record<Muscle, number> {
  const out = Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>;
  for (const s of sessions)
    for (const e of s.exercises) {
      const n = workingSets(e);
      if (!n) continue;
      const { primary, secondary } = musclesOf(e.name);
      for (const m of primary) out[m] += n;
      for (const m of secondary) out[m] += n / 2;
    }
  return out;
}

export interface MuscleWeekRow {
  muscle: Muscle;
  label: string;
  /** Bieżący tydzień (pn–dziś). */
  now: number;
  /** Poprzedni tydzień (pn–nd). */
  prev: number;
}

/** Serie na partię w bieżącym i poprzednim tygodniu; kolejność jak w MUSCLES. */
export function weeklyMuscleSets(sessions: TrainingSession[], today: ISODate): MuscleWeekRow[] {
  const w0 = weekStart(today);
  const wPrev = addDays(w0, -7);
  const now = setsByMuscle(sessions.filter((s) => s.date >= w0 && s.date <= today));
  const prev = setsByMuscle(sessions.filter((s) => s.date >= wPrev && s.date < w0));
  return MUSCLES.map((m) => ({ muscle: m, label: MUSCLE_LABEL[m], now: now[m], prev: prev[m] }));
}

/** Odcień na sylwetce: 0 — brak serii, 1 — 1–9 serii, 2 — 10 i więcej (typowa dawka tygodniowa na wzrost). */
export function muscleTier(sets: number): 0 | 1 | 2 {
  return sets >= 10 ? 2 : sets > 0 ? 1 : 0;
}
