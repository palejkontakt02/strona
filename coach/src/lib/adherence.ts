import type { Client, ISODate, Plan, TrainingSession } from '../domain';
import { reportExpected, reportFor } from './comms';
import { addDays, daysBetween, todayISO } from './dates';
import { workoutDate } from './plan';

/**
 * Realizacja planu z ostatnich `days` dni: jednostki z datą w tym oknie (bez dzisiejszej) i ile z nich zrobiono.
 * Jednostka zrobiona = zapisany trening tej jednostki (dowolnego dnia od 7 dni przed terminem — przeniesiona też się liczy).
 */
export function planAdherence(plans: Plan[], sessions: TrainingSession[], today: ISODate = todayISO(), days = 14): { planned: number; done: number; missed: number } {
  const from = addDays(today, -days);
  let planned = 0;
  let done = 0;
  for (const p of plans.filter((x) => x.active && !x.template)) {
    p.weeks.forEach((w, wi) =>
      w.workouts.forEach((k) => {
        if (!k.exercises.some((e) => e.name.trim())) return;
        const d = workoutDate(p, wi, k);
        if (!d || d < from || d >= today || (p.startDate && d < p.startDate)) return;
        planned++;
        if (sessions.some((s) => s.planId === p.id && s.workoutId === k.id && s.date >= addDays(d, -7))) done++;
      }),
    );
  }
  return { planned, done, missed: planned - done };
}

export interface DropReason {
  level: 'red' | 'yellow';
  text: string;
}

/**
 * „Odpada”: sygnał odejścia, zanim klient zniknie (milknie: opuszcza treningi i raporty).
 * - z planem: 2+ opuszczone zaplanowane treningi albo zrobione < 50% w 2 tygodnie;
 * - bez planu z datami: 10+ dni bez treningu;
 * - raport tygodniowy: brak 2 tygodnie z rzędu (czerwony).
 */
export function dropReasons(client: Client, plans: Plan[], sessions: TrainingSession[], today: ISODate = todayISO(), lastSession?: ISODate): DropReason[] {
  const out: DropReason[] = [];
  const a = planAdherence(plans, sessions, today);
  if (a.planned >= 2 && (a.missed >= 2 || a.done / a.planned < 0.5))
    out.push({ level: a.done === 0 ? 'red' : 'yellow', text: `Zrobione ${a.done} z ${a.planned} zaplanowanych w 2 tygodnie` });
  else if (a.planned < 2 && lastSession && daysBetween(lastSession, today) >= 10) out.push({ level: 'yellow', text: `${daysBetween(lastSession, today)} dni bez treningu` });
  if (reportExpected(client)) {
    const w1 = addDays(addDays(today, -((new Date(`${today}T12:00:00`).getDay() + 6) % 7)), -7);
    const w2 = addDays(w1, -7);
    const since = client.startDate || (client.createdAt ? client.createdAt.slice(0, 10) : '');
    const m1 = (!since || since <= addDays(w1, 6)) && !reportFor(client, w1);
    const m2 = (!since || since <= addDays(w2, 6)) && !reportFor(client, w2);
    // pojedynczy brak jest już w karcie „Raporty tygodnia” — tu tylko 2 z rzędu
    if (m1 && m2) out.push({ level: 'red', text: 'Brak raportu tygodniowego 2 tygodnie z rzędu' });
  }
  return out;
}

/**
 * Tydzień (pn–nd) w liczbach do raportu tygodniowego: zaplanowane jednostki z datą w tym tygodniu, ile zrobiono
 * (zapisany trening tej jednostki) oraz treningi ponad plan (zapisane w tym tygodniu, bez zaplanowanej jednostki z tego tygodnia).
 */
export function weekCount(plans: Plan[], sessions: TrainingSession[], week: ISODate): { planned: number; done: number; extra: number; total: number } {
  const end = addDays(week, 6);
  const ids = new Set<string>();
  let planned = 0;
  let done = 0;
  for (const p of plans.filter((x) => x.active && !x.template)) {
    p.weeks.forEach((w, wi) =>
      w.workouts.forEach((k) => {
        if (!k.exercises.some((e) => e.name.trim())) return;
        const d = workoutDate(p, wi, k);
        if (!d || d < week || d > end) return;
        planned++;
        ids.add(k.id);
        if (sessions.some((s) => s.planId === p.id && s.workoutId === k.id && s.date >= addDays(d, -7) && s.date <= addDays(end, 7))) done++;
      }),
    );
  }
  const inWeek = sessions.filter((s) => s.date >= week && s.date <= end);
  const extra = inWeek.filter((s) => !s.workoutId || !ids.has(s.workoutId)).length;
  return { planned, done, extra, total: inWeek.length };
}

/** Tekst licznika: „zrobione 3 z 4 zaplanowanych · +1 dodatkowy”, bez planu „4 treningi”. */
export function weekCountText(c: { planned: number; done: number; extra: number; total: number }): string {
  if (!c.planned) return c.total ? `${c.total} ${c.total === 1 ? 'trening' : c.total < 5 ? 'treningi' : 'treningów'}` : 'brak treningów';
  return `zrobione ${c.done} z ${c.planned} zaplanowanych${c.extra ? ` · +${c.extra} dodatkowy` : ''}`;
}
