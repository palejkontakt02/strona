import type { Client, ISODate, Payment, Plan, WeeklyReport } from "../domain";
import { isOverdue } from "./billing";
import { reportExpected, reportFor } from "./comms";
import { addDays, daysBetween, weekStart } from "./dates";
import { planStatus } from "./plan";
import { planEnd } from "./planShift";

/* Logika kart Pulpitu: raporty tygodnia, „Do zapłaty”, plany do odnowienia, postęp planu. */

/* ---------- raporty tygodnia ---------- */

/** Tydzień (poniedziałek), za który raport jest WYMAGANY dziś: zawsze poprzedni pełny tydzień (od poniedziałku). */
export const requiredReportWeek = (today: ISODate): ISODate =>
  addDays(weekStart(today), -7);

/**
 * Pulpit — raporty tygodnia, liczone spójnie za jeden tydzień (`week` = poprzedni pełny tydzień):
 * - `expected` — aktywni z włączonym raportem, którzy byli już podopiecznymi w tamtym tygodniu,
 * - `sent` / `missing` — rozłączne (każda osoba w dokładnie jednym miejscu),
 * - `early` — kto już przysłał raport za bieżący (niezakończony) tydzień — nie wlicza się do licznika,
 * - `unread` — nieprzeczytane raporty tylko za `week` (podzbiór `sent` — nikt nie jest naraz „nowy” i w „Nie przysłali”);
 *   starsze nieprzeczytane się nie mieszają, a nieprzeczytane za bieżący tydzień są w `earlyUnread`.
 */
export function weekReports(clients: Client[], today: ISODate) {
  const week = requiredReportWeek(today);
  const current = weekStart(today);
  const weekEnd = addDays(week, 6);
  const joined = (c: Client) => {
    const since = c.startDate || (c.createdAt ? c.createdAt.slice(0, 10) : "");
    return !since || since <= weekEnd;
  };
  const expected = clients.filter(
    (c) => c.status === "aktywny" && reportExpected(c) && joined(c),
  );
  const sent = expected.filter((c) => reportFor(c, week));
  const missing = expected.filter((c) => !reportFor(c, week));
  const early = expected.filter((c) => reportFor(c, current));
  const unreadFor = (w: ISODate): { c: Client; r: WeeklyReport }[] =>
    expected
      .flatMap((c) =>
        (c.weeklyReports ?? [])
          .filter((r) => !r.seenAt && r.week === w)
          .map((r) => ({ c, r })),
      )
      .sort((a, b) => (b.r.at || "").localeCompare(a.r.at || ""));
  return {
    week,
    current,
    expected,
    sent,
    missing,
    early,
    unread: unreadFor(week),
    earlyUnread: unreadFor(current),
  };
}

/* ---------- do zapłaty ---------- */

/**
 * „Do zapłaty” rozdzielone: `overdue` — po terminie (czerwone), `thisWeek` — termin do niedzieli bieżącego
 * tygodnia (albo bez terminu), `later` — późniejsze. Każda grupa od najstarszego terminu.
 */
export function dueBuckets<P extends Payment>(payments: P[], today: ISODate) {
  const we = addDays(weekStart(today), 6);
  const key = (p: Payment) => p.dueDate || p.date;
  const open = payments
    .filter((p) => p.status !== "paid")
    .sort((a, b) => key(a).localeCompare(key(b)));
  const overdue = open.filter((p) => isOverdue(p, today));
  const thisWeek = open.filter(
    (p) => !isOverdue(p, today) && (!p.dueDate || p.dueDate <= we),
  );
  const later = open.filter(
    (p) => !isOverdue(p, today) && !!p.dueDate && p.dueDate > we,
  );
  const sum = (xs: Payment[]) => xs.reduce((a, p) => a + p.amount, 0);
  return {
    overdue,
    thisWeek,
    later,
    overdueSum: sum(overdue),
    thisWeekSum: sum(thisWeek),
    laterSum: sum(later),
  };
}

/* ---------- plany ---------- */

/** Postęp planu: tydzień n z total i koniec; `ended` — po ostatnim dniu planu. */
export function planProgress(
  plan: Plan,
  today: ISODate,
): {
  week: number | null;
  total: number;
  end?: ISODate;
  ended: boolean;
  notStarted: boolean;
  daysLeft: number | null;
} {
  const total = plan.weeks.length;
  const end = planEnd(plan) ?? planStatus(plan, today).endDate;
  const ended = !!end && today > end;
  const notStarted = !!plan.startDate && today < weekStart(plan.startDate);
  let week: number | null = null;
  if (plan.startDate && total)
    week = Math.min(
      total,
      Math.max(
        1,
        Math.floor(daysBetween(weekStart(plan.startDate), today) / 7) + 1,
      ),
    );
  return {
    week,
    total,
    end,
    ended,
    notStarted,
    daysLeft: end ? daysBetween(today, end) : null,
  };
}

/** „15.11” */
export const dm = (iso: ISODate) =>
  `${Number(iso.slice(8))}.${iso.slice(5, 7)}`;

/** Etykieta do tabeli: „tydz. 3/4 · do 15.11” / „zakończony” / „od 3.11” / „—”. */
export function planLabel(
  plan: Plan | null | undefined,
  today: ISODate,
): { text: string; ended: boolean; soon: boolean } {
  if (!plan) return { text: "—", ended: false, soon: false };
  const p = planProgress(plan, today);
  if (p.ended) return { text: "zakończony", ended: true, soon: false };
  if (p.notStarted && plan.startDate)
    return {
      text: `od ${dm(weekStart(plan.startDate))}`,
      ended: false,
      soon: false,
    };
  const parts = [
    p.week != null ? `tydz. ${p.week}/${p.total}` : `${p.total} tyg.`,
    p.end ? `do ${dm(p.end)}` : "",
  ].filter(Boolean);
  return {
    text: parts.join(" · "),
    ended: false,
    soon: p.daysLeft != null && p.daysLeft <= 7,
  };
}

/** Aktywny plan podopiecznego (bez treningów poza planem i szablonów). */
export const activePlanOf = (plans: Plan[], clientId: string) =>
  plans.find(
    (p) => p.clientId === clientId && p.active && !p.extra && !p.template,
  ) ?? null;

export interface RenewRow {
  client: Client;
  plan: Plan;
  end: ISODate;
  /** Dni do końca (ujemne — już po końcu). */
  daysLeft: number;
  ended: boolean;
}

/**
 * Plany do odnowienia: aktywni podopieczni, których aktywny plan kończy się w ≤ `within` dni albo już się
 * skończył. Pomija tych, którzy mają już przygotowany kolejny plan (zaczynający się po starcie bieżącego).
 * Zakończone najpierw, potem wg daty końca.
 */
export function plansToRenew(
  clients: Client[],
  plans: Plan[],
  today: ISODate,
  within = 7,
): RenewRow[] {
  const out: RenewRow[] = [];
  for (const client of clients) {
    if (client.status !== "aktywny") continue;
    const plan = activePlanOf(plans, client.id);
    if (!plan || !plan.weeks.length) continue;
    const end = planEnd(plan);
    if (!end) continue;
    const daysLeft = daysBetween(today, end);
    if (daysLeft > within) continue;
    const prepared = plans.some(
      (p) =>
        p.id !== plan.id &&
        p.clientId === client.id &&
        !p.extra &&
        !p.template &&
        !!p.startDate &&
        !!plan.startDate &&
        p.startDate > plan.startDate,
    );
    if (prepared) continue;
    out.push({ client, plan, end, daysLeft, ended: daysLeft < 0 });
  }
  return out.sort(
    (a, b) =>
      a.daysLeft - b.daysLeft ||
      a.client.name.localeCompare(b.client.name, "pl"),
  );
}
