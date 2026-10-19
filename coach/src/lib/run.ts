import type { PlanExercise, PlanWorkout, SetType, TestResult, TrainingSession } from '../domain';
import { num, numIn, parseRest, parseTempo, repsN, secOf, sidesOf, sumReps, timeUnit } from './parse';
import { exerciseBlocks, exerciseLabels, mergeGroups, moveInBlocks, removeFromBlocks } from './plan';
import { e1rmRPE, loadFor, recentE1, resolveLoad, testedMax } from './strength';
import { fmtClock, fmtKm, isRunning, parseDur, parseKm } from './running';

/** Seria w trakcie treningu (tryb zawodnika). Pola tekstowe — to wartości z inputów. */
export interface RunSet {
  load: string;
  reps: string;
  rpe: string;
  done: boolean;
  warmup: boolean;
  /** Podpowiedź doboru ciężaru. */
  sug: string;
  /** Zawodnik ręcznie zmienił ciężar — autoregulacja go nie nadpisuje. */
  edited: boolean;
  /** Typ serii z planu i numer bloku (scalonych identycznych wierszy). */
  label?: SetType;
  gi?: number;
  first?: boolean;
  /** Opis bloku do nagłówka, np. „Back-off 3 × 5 @7”. */
  gdesc?: string;
  /** Docelowe RPE i zapis ciężaru z planu. */
  tRpe: string;
  spec: string;
  rest: string;
  /** Nagranie serii (odnośnik jak w SetLog.video). */
  video?: string;
  /** Seria na czas (sekundy / minuty). */
  unit?: 's' | 'min';
  /** Ta sama seria na poprzednim treningu, np. „12 × 14 kg”. */
  prev?: string;
  /** Cardio: dystans (km) i tętno. */
  dist?: string;
  hr?: string;
  /** Bieg / cardio: cel intensywności z planu (strefa albo tempo). */
  pace?: string;
}

export interface RunExercise {
  name: string;
  /** Id ćwiczenia w planie (zapis układu do planu po zmianie nazwy). */
  planExId?: string;
  /** Oznaczenie z planu: „A” albo „B2” w bloku. */
  label?: string;
  /** Połączone z poprzednim w blok (superseria / obwód). */
  linked?: boolean;
  rest: string;
  tempo: [number, number, number, number] | null;
  tempoStr: string;
  notes: string;
  video?: string;
  /** Powtórzenia na każdą stronę (jednostronne). */
  perSide?: boolean;
  /** Serie na czas (sekundy) zamiast powtórzeń. */
  timed?: boolean;
  /** Cardio: wiersz = odcinek (min, km, tętno, RPE). */
  cardio?: boolean;
  sets: RunSet[];
}

/** Nazwy aktywności cardio (domyślnie tryb cardio, da się przełączyć). */
export function cardioByName(name: string): boolean {
  return isRunning(name) || /bieżni|\bbieg\b|bieganie|przebieżk|\brower|ergometr|wioślarz|concept ?2|orbitrek|crosstrainer|marsz|spacer|nordic|pływani|skakank|schody|stepper|air ?bike|assault|ski ?erg|cardio|kardio|\bhiit\b/i.test(name);
}

/** Nazwy ćwiczeń zwykle robionych na czas (domyślnie „na czas”, da się wyłączyć). */
export function timedByName(name: string): boolean {
  return /\bdesk|plank|wall ?sit|krzesełk|\bzwis|dead ?hang|hollow|izometr|\bl-?sit\b|wytrzym|utrzymani|\bhold\b|farmer|spacer farmera|copenhagen|side plank|mostek bokiem/i.test(name);
}

/** Ćwiczenie z planu na czas: ustawione ręcznie, z nazwy albo z zapisu serii („30 s”). */
export function isTimed(e: Pick<PlanExercise, 'name' | 'timed' | 'cardio' | 'groups'>): boolean {
  if (e.cardio ?? cardioByName(e.name)) return false;
  return e.timed ?? (timedByName(e.name) || e.groups.some((g) => g.type !== 'Rozgrzewka' && timeUnit(g.reps) != null));
}

/** Nazwy ćwiczeń zwykle robionych na każdą stronę osobno (domyślnie „na stronę”, da się wyłączyć). */
export function perSideByName(name: string): boolean {
  return /jednorącz|jednonóż|jednonoż|boczn|na (jedną )?(nogę|rękę|stronę)|bułgarsk|wykrok|single[- ]?(arm|leg)|one[- ]?(arm|leg)|unilateral|split squat|lunge|step[- ]?up|pistol|copenhagen|suitcase|side plank|deska bokiem|pallof/i.test(name);
}

export interface Run {
  planId: string;
  workoutId: string;
  name: string;
  planName: string;
  weekName: string;
  date: string;
  startedAt: number;
  idx: number;
  ex: RunExercise[];
  /** Edycja zapisanego treningu (zamiast nowego). */
  editSessionId?: string;
  /** Wizyta, z której trener uruchomił trening (zachowana po wyjściu do panelu). */
  appointmentId?: string;
  /** Trening w parze / grupie: pozostałe osoby prowadzone razem (id podopiecznych). */
  pairWith?: string[];
}

const TEMPO_RE = /[0-9xX]\s*-\s*[0-9xX]\s*-\s*[0-9xX]\s*-\s*[0-9xX]/;

/** Ostatnie e1RM ćwiczenia z historii (jak w prototypie: ostatni punkt przebiegu). */
function lastE1(history: TrainingSession[], name: string): number | null {
  return recentE1(history, name);
}

/**
 * Serie do wykonania dla ćwiczenia z planu: bloki scalonych wierszy, ciężar rozwiązywany
 * wg zapisu (kg / % e1RM / ±% od poprzedniego bloku / z RPE). Back-off/Robocze liczone
 * od ostatniej serii poprzedniego bloku; Drop set kaskadowo seria po serii.
 */
/** Dystans z planu cardio: „3”, „3 km”, „800 m” → km jako tekst. */
function distOf(v: string | undefined): string {
  const km = parseKm(v);
  return km != null ? String(km).replace('.', ',') : '';
}

/** Opis bloku odcinków: „6 × 800 m · Z5”, „Rozgrzewka 15 min · Z2”. */
function cardioDesc(g: { type: string; sets?: string; reps: string; load: string; pace?: string } | undefined): string {
  if (!g) return '';
  const n = repsN(g.sets) || 1;
  const km = parseKm(g.load);
  const d = parseDur(g.reps);
  const what = [km != null && fmtKm(km), d != null && (Number.isInteger(d) ? `${d} min` : fmtClock(d))].filter(Boolean).join(' / ');
  const head = (g.type === 'Rozgrzewka' || g.type === 'Schłodzenie' ? `${g.type} ` : g.type === 'Przerwa' ? 'Trucht / marsz ' : '') + (n > 1 ? `${n} × ` : '');
  return `${head}${what || 'odcinek'}${g.pace ? ` · ${g.pace}` : ''}`;
}

export function buildRunExercise(e: PlanExercise, history: TrainingSession[], video?: string, tests: TestResult[] = []): RunExercise {
  const cardio = e.cardio ?? cardioByName(e.name);
  const timed = isTimed(e);
  // %1RM: test z maksem, jeśli nowszy niż ostatni trening z tym ćwiczeniem (albo brak historii); inaczej e1RM z treningów
  const tm = testedMax(tests, e.name);
  const lastDate = history.filter((s) => s.exercises.some((x) => x.name === e.name)).reduce((a, s) => (s.date > a ? s.date : a), '');
  const hist = lastE1(history, e.name);
  const fromTest = !!tm && (tm.date >= lastDate || hist == null);
  const e1 = fromTest ? tm!.value : hist;
  const sets: RunSet[] = [];
  let prev: number | null = null;
  // ostatni zapis tego ćwiczenia — podpowiedź „poprzednio” przy każdej serii roboczej
  const lastLog = [...history].sort((a, b) => b.date.localeCompare(a.date)).flatMap((s) => s.exercises.filter((x) => x.name === e.name && x.setsLog?.length))[0]?.setsLog?.filter((x) => !x.warmup) ?? [];
  const prevText = (x: (typeof lastLog)[number] | undefined) =>
    x && x.reps != null ? `${x.reps}${x.repsR != null ? `/${x.repsR}` : ''}${x.unit ? ` ${x.unit}` : ''}${x.load != null ? ` × ${String(x.load).replace('.', ',')} kg` : ''}${x.rpe != null ? ` @${String(x.rpe).replace('.', ',')}` : ''}` : undefined;
  let workIdx = 0;
  mergeGroups(e.groups).forEach((g, gi) => {
    const cnt = repsN(g.sets) || 1;
    const range = /\d\s*[-–]\s*\d/.test(String(g.sets || ''));
    const ref = prev;
    for (let i = 0; i < cnt; i++) {
      const rl0 = resolveLoad(g.load, e1, g.reps, g.rpe, g.type === 'Drop set' ? prev : ref);
      const rl = fromTest && rl0.why ? { ...rl0, why: rl0.why.replace('szac. 1RM', `1RM z testu (${String(e1).replace('.', ',')} kg)`) } : rl0;
      if (rl.load != null) prev = rl.load;
      sets.push({
        load: rl.load != null ? String(rl.load) : '',
        // kompleks „2+1” zostaje tekstem (zapis liczy sumę powtórzeń)
        reps: /^\s*\d+(\s*\+\s*\d+)+\s*$/.test(g.reps) ? g.reps.replace(/\s/g, '') : String(repsN(g.reps) || ''),
        unit: timeUnit(g.reps) ?? undefined,
        rpe: '',
        done: false,
        warmup: g.type === 'Rozgrzewka',
        sug: i === 0 ? rl.why : '',
        edited: false,
        label: g.type,
        gi,
        first: i === 0,
        gdesc: `${g.type} ${g.sets || ''} × ${g.reps || ''}${g.rpe ? ' @' + g.rpe : ''}${range ? ` · dokładaj serie, dopóki RPE ≤ ${g.rpe || 'cel'}` : ''}`,
        tRpe: g.rpe || '',
        spec: g.load || '',
        rest: g.rest || '',
        prev: g.type === 'Rozgrzewka' ? undefined : prevText(lastLog[workIdx++]),
      });
    }
  });
  const notes = String(e.notes || '');
  return {
    name: e.name,
    planExId: e.id,
    linked: e.linked || undefined,
    rest: e.rest || '',
    tempo: parseTempo(notes),
    tempoStr: (notes.match(TEMPO_RE)?.[0] ?? '').replace(/\s/g, ''),
    // słowo „tempo” usuwamy tylko razem z zapisem tempa (np. „tempo 3-1-X-0”), nie z innych uwag
    notes: TEMPO_RE.test(notes) ? notes.replace(/tempo\s*:?\s*/i, '').replace(TEMPO_RE, '').replace(/^[\s,;·-]+|[\s,;·-]+$/g, '') : notes.trim(),
    video,
    perSide: cardio ? undefined : e.perSide ?? (perSideByName(e.name) || undefined),
    cardio: cardio || undefined,
    timed: timed || undefined,
    sets: timed
      ? sets.map((x) => {
          // seria na czas: sekundy z planu („30”, „1:30”, „2 min”); L/P „30/20” zostaje
          const raw = mergeGroups(e.groups)[x.gi ?? 0]?.reps ?? '';
          const sec = secOf(raw);
          // ciężar tylko wpisany w planie (np. deska z obciążeniem) — bez doboru z e1RM, które przy czasie nie ma sensu
          const fixed = !!x.spec && /\d/.test(x.spec) && !/%/.test(x.spec);
          return { ...x, unit: 's' as const, reps: sec != null ? String(sec) : raw.trim().replace(/\s*s$/i, ''), load: fixed ? x.load : '', sug: '' };
        })
      : cardio
      ? sets.map((x) => {
          // odcinek: czas tak jak w planie („15”, „0:30”), dystans w km, cel tempa / strefy
          const gr = mergeGroups(e.groups)[x.gi ?? 0];
          const d = parseDur(gr?.reps);
          return { ...x, unit: 'min' as const, reps: d != null ? (Number.isInteger(d) ? String(d) : fmtClock(d)) : (gr?.reps.trim() ?? ''), load: '', dist: distOf(gr?.load), pace: gr?.pace || undefined, prev: undefined, gdesc: cardioDesc(gr), warmup: x.warmup };
        })
      : sets,
  };
}

export function buildRun(
  plan: { id: string; name: string },
  weekName: string,
  workout: PlanWorkout,
  history: TrainingSession[],
  videos: Record<string, string | undefined>,
  today: string,
  now = Date.now(),
  tests: TestResult[] = [],
): Run {
  return {
    planId: plan.id,
    workoutId: workout.id,
    name: workout.name || 'Trening',
    planName: plan.name,
    weekName,
    date: today,
    startedAt: now,
    idx: 0,
    ex: withLabels(workout.exercises.filter((e) => e.name).map((e) => buildRunExercise(e, history, videos[e.name], tests))),
  };
}

/** Nowe ćwiczenie dodane w trakcie treningu (poza planem). */
/** Cardio dodane w trakcie: N odcinków po X min (i opcjonalnie dystans). */
export function adHocCardio(name: string, bouts: number, minutes: string, km: string, rest = ''): RunExercise {
  return {
    name,
    cardio: true,
    rest,
    tempo: null,
    tempoStr: '',
    notes: '',
    sets: Array.from({ length: Math.min(20, Math.max(1, bouts)) }, () => ({ load: '', reps: minutes, unit: 'min' as const, dist: km, hr: '', rpe: '', done: false, warmup: false, sug: '', edited: true, tRpe: '', spec: '', rest })),
  };
}

export function adHocExercise(name: string, sets: number, reps: string, load: string, rest = '2:00', timed = false): RunExercise {
  return {
    name,
    perSide: perSideByName(name) || undefined,
    timed: timed || undefined,
    rest,
    tempo: null,
    tempoStr: '',
    notes: '',
    sets: Array.from({ length: Math.min(20, Math.max(1, sets)) }, () => ({
      load,
      reps,
      rpe: '',
      done: false,
      warmup: false,
      sug: '',
      edited: !!load,
      tRpe: '',
      spec: load,
      rest: '',
      ...(timed ? { unit: 's' as const, reps: String(secOf(reps) ?? reps) } : {}),
    })),
  };
}

/** Pusty trening (bez planu) — ćwiczenia dodaje się w trakcie. */
export function emptyRun(name: string, today: string, now = Date.now()): Run {
  return { planId: '', workoutId: '', name, planName: '', weekName: '', date: today, startedAt: now, idx: 0, ex: [] };
}

/** Dodaje ćwiczenie na końcu treningu i przelicza oznaczenia (A, B, C1…). */
export function appendExercise(run: Run, e: RunExercise): Run {
  // Dołączone do bloku: przerwa po rundzie należy do ostatniego ćwiczenia, poprzednie przechodzi bez odpoczynku.
  const prev = e.linked && run.ex.length ? run.ex.map((x, i) => (i === run.ex.length - 1 ? { ...x, rest: '' } : x)) : run.ex;
  const last = run.ex[run.ex.length - 1];
  const added = e.linked && last?.rest && !e.rest ? { ...e, rest: last.rest } : e;
  return { ...run, ex: withLabels([...prev, added]), idx: run.ex.length };
}

function withLabels(ex: RunExercise[]): RunExercise[] {
  const labels = exerciseLabels(ex);
  return ex.map((e, i) => ({ ...e, label: labels[i] }));
}

/** Bloki biegu (indeksy ćwiczeń); pojedyncze ćwiczenie to blok jednoelementowy. */
export function runBlocks(run: Run): number[][] {
  return exerciseBlocks(run.ex);
}

/** Numer serii roboczej (bez rozgrzewek) w ćwiczeniu. */
function workIndex(e: RunExercise, setIdx: number): number {
  return e.sets.slice(0, setIdx).filter((s) => !s.warmup).length;
}

/**
 * Po zaliczeniu serii w bloku (superseria / obwód): jeśli w tej rundzie zostało jeszcze inne
 * ćwiczenie bloku — przejście bez pełnej przerwy (czas przejścia = przerwa tego ćwiczenia, puste = od razu)
 * i wskazanie następnego; gdy runda zamknięta — przerwa z ostatniego ćwiczenia bloku (domyślnie 120 s).
 */
export function blockRest(run: Run, exIdx: number, setIdx: number): { rest: number | null; next?: number } {
  const block = runBlocks(run).find((b) => b.includes(exIdx)) ?? [exIdx];
  const e = run.ex[exIdx];
  if (e.sets[setIdx]?.warmup) return { rest: null };
  if (block.length === 1) return { rest: parseRest(e.sets[setIdx]?.rest || e.rest) || 120 };
  const w = workIndex(e, setIdx);
  const pos = block.indexOf(exIdx);
  const order = [...block.slice(pos + 1), ...block.slice(0, pos)];
  const next = order.find((k) => {
    const sets = run.ex[k].sets.filter((s) => !s.warmup);
    return sets[w] && !sets[w].done;
  });
  if (next != null) {
    const t = parseRest(e.rest);
    return { rest: t > 0 && pos < block.length - 1 ? t : null, next };
  }
  return { rest: parseRest(run.ex[block[block.length - 1]].rest) || 120 };
}

/**
 * Zaliczenie serii `i` (lub cofnięcie). Zwraca nowe serie i czas przerwy (s) do odliczenia.
 * Autoregulacja następnej niezaliczonej serii roboczej (jeśli nie edytowana ręcznie):
 * - względna (±%) w tym samym bloku (nie Drop set) → ten sam ciężar, co faktycznie wykonany,
 * - względna z innego bloku / Drop set → przelicz od faktycznego ciężaru,
 * - stała (kg / %) → bez zmian,
 * - pusta → dobór z e1RM tej serii do docelowego RPE, z podpowiedzią „±X% vs poprzednia seria”.
 */
export function completeSet(ex: RunExercise, i: number): { sets: RunSet[]; rest: number | null } {
  const sets = ex.sets.map((x) => ({ ...x }));
  const s = sets[i];
  if (s.done) {
    s.done = false;
    return { sets, rest: null };
  }
  const myR = s.tRpe;
  s.done = true;
  // pusta seria przejmuje powtórzenia i ciężar z poprzedniej zaliczonej serii roboczej
  const before = [...sets.slice(0, i)].reverse().find((x) => x.done && !x.warmup);
  if (!s.warmup && before) {
    if (!s.reps.trim()) s.reps = before.reps;
    if (!s.load.trim()) s.load = before.load;
  }
  // puste RPE zostaje puste — cel z planu to nie wynik (inaczej zawyża e1RM i „zgodność”)
  if (s.warmup) return { sets, rest: null };

  const j = sets.findIndex((x, k) => k > i && !x.done && !x.warmup);
  // bez RPE (ani wpisanego, ani celu z planu) nie zgadujemy — następna seria bierze ten sam ciężar
  // seria na czas: bez autoregulacji ciężaru (e1RM z sekund nie ma sensu) — następna z tym samym ciężarem
  if ((!s.rpe && !myR) || s.unit) {
    if (j > -1 && !sets[j].edited && !sets[j].load && !sets[j].spec) sets[j].load = s.load;
    return { sets, rest: parseRest(s.rest || ex.rest) || 120 };
  }
  const e1 = e1rmRPE(s.load, sumReps(s.reps), s.rpe || myR);
  if (j > -1 && !sets[j].edited) {
    const nxt = sets[j];
    const spec = nxt.spec;
    const prev = num(s.load);
    if (/^[+-]\s*\d/.test(spec) && prev && nxt.gi === s.gi && nxt.label !== 'Drop set') {
      nxt.load = s.load;
      nxt.sug = '';
    } else if (/^[+-]\s*\d/.test(spec) && prev) {
      const rl = resolveLoad(spec, e1, nxt.reps, nxt.tRpe, prev);
      nxt.load = String(rl.load);
      nxt.sug = `${rl.why} (${String(prev).replace('.', ',')} kg)`;
    } else if (spec && (num(spec) != null || /%/.test(spec))) {
      // stały ciężar z planu — bez zmian
    } else if (e1) {
      const tr = nxt.tRpe || s.rpe || '8';
      const nl = loadFor(e1, nxt.reps || s.reps, tr);
      const base = prev || nl;
      const diff = base ? Math.round(((nl - base) / base) * 100) : 0;
      nxt.load = String(nl);
      // bez wpisanego RPE porównujemy tylko do celu (nie zgadujemy „niżej / wyżej”)
      const got = num(s.rpe);
      const cmp = got == null ? null : got < num(tr)! ? 'niżej' : got > num(tr)! ? 'wyżej' : 'zgodne';
      nxt.sug = diff === 0 ? (cmp ? 'Utrzymaj ciężar – RPE zgodne z celem' : `Utrzymaj ciężar (cel RPE ${tr})`) : `${diff > 0 ? '+' : ''}${diff}% vs poprzednia seria (${cmp ? `RPE ${cmp} / ` : 'wg '}cel ${tr})`;
    }
  }
  return { sets, rest: parseRest(s.rest || ex.rest) || 120 };
}

/** Zamienia serie z biegu na zapis treningu (`setsLog`) + podsumowanie. */
export function runToExercises(run: Run) {
  return run.ex.map((e) => {
    const log = e.sets
      .filter((s) => s.done)
      .map((s) => {
        const cx = /^\d+(\+\d+)+$/.test(s.reps.replace(/\s/g, '')) ? s.reps.replace(/\s/g, '') : undefined;
        if (e.cardio) {
          const d = parseDur(s.reps);
          return {
            reps: d != null ? Math.round(d * 100) / 100 : undefined,
            unit: 'min' as const,
            dist: parseKm(s.dist) ?? undefined,
            hr: numIn(s.hr, 30, 240) ?? undefined,
            rpe: numIn(s.rpe, 0, 10) ?? undefined,
            warmup: s.warmup || undefined,
            label: s.label === 'Schłodzenie' || s.label === 'Przerwa' || s.warmup ? s.label : undefined,
            video: s.video,
          };
        }
        const unit = s.unit ?? timeUnit(s.reps) ?? undefined;
        const lr = e.perSide ? sidesOf(s.reps) : null;
        // różny wynik na stronę (30/20): reps = lewa, repsR = prawa; ten sam — jedna liczba
        const reps = lr ? lr[0] : unit === 's' ? secOf(s.reps) ?? repsN(s.reps) ?? undefined : unit ? repsN(s.reps) ?? undefined : sumReps(s.reps) ?? undefined;
        const repsR = lr && lr[1] !== lr[0] ? lr[1] : undefined;
        return { load: num(s.load) ?? undefined, reps, repsR, unit, rpe: numIn(s.rpe, 0, 10) ?? undefined, warmup: s.warmup || undefined, label: s.label, complex: cx, video: s.video };
      });
    // cardio: schłodzenie i trucht między seriami to nie odcinki robocze
    const work = log.filter((s) => !s.warmup && !(e.cardio && 'label' in s && (s.label === 'Schłodzenie' || s.label === 'Przerwa')));
    const top = work[0];
    // Tekst powtórzeń z jednostką (np. „45 s”) zostaje w podsumowaniu.
    const topSet = e.sets.find((x) => x.done && !x.warmup);
    const topRaw = topSet && (topSet.unit && !timeUnit(topSet.reps) ? `${topSet.reps.trim()} ${topSet.unit}` : topSet.reps.trim());
    return {
      name: e.name,
      label: e.label,
      sets: String(work.length),
      reps: topRaw || (top?.reps != null ? String(top.reps) : ''),
      load: top?.load != null ? String(top.load) : '',
      rpe: top?.rpe != null ? String(top.rpe) : '',
      rest: e.rest || undefined,
      notes: [e.tempoStr && !e.notes.includes(e.tempoStr) ? `Tempo ${e.tempoStr}` : '', e.notes.trim(), log.some((x) => x.complex) && !/kompleks/i.test(e.notes) ? `Kompleks ${log.find((x) => x.complex)!.complex}` : '']
        .filter(Boolean)
        .join(' · ') || undefined,
      setsLog: log,
      perSide: e.perSide || undefined,
      cardio: e.cardio || undefined,
      timed: e.timed || undefined,
    };
  }).filter((e) => e.setsLog.length > 0);
}

/* ---------- edycja układu treningu w trakcie (trener) ---------- */

function relabel(run: Run, ex: RunExercise[], idx: number): Run {
  const fixed = ex.map((e, i) => (i === 0 && e.linked ? { ...e, linked: undefined } : e));
  return { ...run, ex: withLabels(fixed), idx: Math.max(0, Math.min(idx, fixed.length - 1)) };
}

/** Łączy ćwiczenie z poprzednim w blok (superseria / obwód) albo rozłącza. */
export function toggleLink(run: Run, k: number): Run {
  if (k <= 0) return run;
  const ex = run.ex.map((e, i) => (i === k ? { ...e, linked: e.linked ? undefined : true } : e));
  return relabel(run, ex, k);
}

/** Przesuwa ćwiczenie w górę (-1) lub w dół (+1) z zachowaniem bloków. */
export function moveExercise(run: Run, k: number, dir: -1 | 1): Run {
  const j = k + dir;
  if (j < 0 || j >= run.ex.length) return run;
  return relabel(run, moveInBlocks(run.ex, k, dir), j);
}

/** Usuwa ćwiczenie; jeśli było początkiem bloku, następne przejmuje rolę początku. */
export function removeExercise(run: Run, k: number): Run {
  return relabel(run, removeFromBlocks(run.ex, k), Math.min(run.idx, run.ex.length - 2));
}

export function renameExercise(run: Run, k: number, patch: Partial<Pick<RunExercise, 'name' | 'rest'>>): Run {
  return { ...run, ex: run.ex.map((e, i) => (i === k ? { ...e, ...patch } : e)) };
}

/**
 * Przenosi układ z treningu do jednostki planu: kolejność, nazwy, przerwy i bloki.
 * Ćwiczenia z planu zachowują swoje serie; dodane w trakcie dostają serie z treningu.
 */
export function applyRunLayout(workout: PlanWorkout, run: Run, newId: () => string): PlanWorkout {
  const pool = [...workout.exercises];
  const exercises = run.ex.map((e) => {
    const byId = e.planExId ? pool.findIndex((p) => p.id === e.planExId) : -1;
    const i = byId >= 0 ? byId : pool.findIndex((p) => p.name === e.name);
    const base = i >= 0 ? pool.splice(i, 1)[0] : null;
    const groups = base
      ? base.groups
      : e.sets.map((s) => ({ type: (s.label ?? (s.warmup ? 'Rozgrzewka' : 'Robocze')) as SetType, sets: '1', reps: s.reps, load: s.spec || s.load, rpe: s.tRpe || s.rpe }));
    const notes = base ? base.notes : [e.tempoStr && `Tempo ${e.tempoStr}`, e.notes].filter(Boolean).join(' · ');
    return { ...(base ?? { id: newId() }), notes, name: e.name, rest: e.rest, linked: e.linked || undefined, groups };
  });
  return { ...workout, exercises };
}

/**
 * Otwiera zapisany trening do poprawek seria po serii: serie z zapisu (setsLog) albo
 * z podsumowania (serie × powt. @kg), wszystkie zaliczone; bloki odtwarzane z oznaczeń (B1, B2…).
 */
export function sessionToRun(s: TrainingSession, now = Date.now()): Run {
  const ex: RunExercise[] = s.exercises.map((e) => {
    const base = { done: true, sug: '', edited: true, tRpe: '', spec: '', rest: '' };
    const sets: RunSet[] = e.setsLog?.length
      ? e.setsLog.map((x) => ({
          ...base,
          load: x.load != null ? String(x.load) : '',
          reps: x.reps != null ? (x.repsR != null ? `${x.reps}/${x.repsR}` : e.cardio && !Number.isInteger(x.reps) ? fmtClock(x.reps) : String(x.reps)) : '',
          rpe: x.rpe != null ? String(x.rpe) : '',
          warmup: !!x.warmup,
          label: x.label as SetType | undefined,
          video: x.video,
          unit: x.unit,
          dist: x.dist != null ? String(x.dist).replace('.', ',') : undefined,
          hr: x.hr != null ? String(x.hr) : undefined,
        }))
      : Array.from({ length: repsN(e.sets) || 1 }, () => ({ ...base, load: e.load ?? '', reps: e.reps ?? '', rpe: e.rpe ?? '', warmup: false }));
    const m = e.label?.match(/^[A-Z]+(\d+)$/);
    return {
      name: e.name,
      linked: m && m[1] !== '1' ? true : undefined,
      rest: e.rest ?? '',
      tempo: parseTempo(e.notes),
      tempoStr: (String(e.notes || '').match(TEMPO_RE)?.[0] ?? '').replace(/\s/g, ''),
      notes: e.notes ?? '',
      perSide: e.perSide || undefined,
      cardio: e.cardio || undefined,
      timed: e.timed || e.setsLog?.some((x) => x.unit === 's') || undefined,
      sets,
    };
  });
  return {
    planId: s.planId ?? '',
    workoutId: s.workoutId ?? '',
    name: s.workoutName || 'Trening',
    planName: '',
    weekName: '',
    date: s.date,
    startedAt: now - (s.duration ?? 0) * 60000,
    idx: 0,
    ex: withLabels(ex),
    editSessionId: s.id,
  };
}

/** Ten sam trening jeszcze raz: ćwiczenia, bloki i ciężary z zapisu, wszystkie serie do zrobienia. */
export function repeatRun(s: TrainingSession, date: string, now = Date.now()): Run {
  const r = sessionToRun(s, now);
  return {
    ...r,
    // powtórka nie przesuwa postępu planu („następny trening” zostaje bez zmian)
    planId: '',
    workoutId: '',
    date,
    startedAt: now,
    editSessionId: undefined,
    // cardio: tętno i RPE z poprzedniego razu to nie wynik tego treningu
    ex: r.ex.map((e) => ({ ...e, sets: e.sets.map((x, i) => ({ ...x, done: false, edited: false, first: i === 0, video: undefined, ...(e.cardio ? { hr: '', rpe: '' } : {}) })) })),
  };
}
