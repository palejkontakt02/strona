import { apptReplyState } from "../lib/appts";
import { useEffect, useState, type DragEvent } from "react";
import { Icon, Modal, Seg, Tag } from "../components/ui";
import type {
  Appointment,
  AppointmentStatus,
  ISODate,
  Plan,
  PlanWorkout,
  TrainingSession,
} from "../domain";
import {
  clientById,
  extraState,
  groupOf,
  isSolo,
  type ExtraState,
} from "../data/ops";
import { useStore } from "../data/store";
import { fmtMonth, fmtShort, fmtWeekday } from "../format";
import { clashes, clientHue } from "../lib/calendar";
import { addDays, todayISO, weekStart } from "../lib/dates";
import { useNav } from "../nav";
import { doneInPass, nextDate, nextWorkout, planSequence, workoutDate } from "../lib/plan";
import { LocationTag, locStyle } from "../components/location";
import { put } from "../data/db";
import { canMove, moveVisit } from "../lib/calendarMove";
import {
  axisRange,
  freeSlots,
  hhmm,
  hourLabel,
  hoursOn,
  lanes,
} from "../lib/freeSlots";
import { useTrainerProfile } from "../data/trainerProfile";
import { useMedia } from "./Dashboard";

/** Przeciąganie wizyt (komputer, mysz): typ danych przeciągania i czy urządzenie ma precyzyjny wskaźnik. */
const DRAG_TYPE = "application/x-fitowa-appt";
const finePointer = () =>
  typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches;

export const APPT_STATUS: Record<
  AppointmentStatus,
  { label: string; tone: "neutral" | "ok" | "muted" | "warn" }
> = {
  planned: { label: "Zaplanowana", tone: "neutral" },
  done: { label: "Odbyta", tone: "ok" },
  cancel: { label: "Odwołana", tone: "muted" },
  noshow: { label: "Nieobecność", tone: "warn" },
};

export function ApptStatusTag({ status }: { status: AppointmentStatus }) {
  const s = APPT_STATUS[status];
  return <Tag tone={s.tone}>{s.label}</Tag>;
}

export const hueStyle = (clientId: string) =>
  ({ "--hue": clientHue(clientId) }) as React.CSSProperties;

type Mode = "Dzień" | "Tydzień" | "Miesiąc";
const WHO = ["Wszyscy", "Ze mną", "Samodzielnie"] as const;
type Who = (typeof WHO)[number];

export function CalendarView() {
  const { db, apply, ask, toast } = useStore();
  const [dropDay, setDropDay] = useState<ISODate | null>(null);
  const { openModal } = useNav();
  const today = todayISO();
  // telefon: domyślnie jeden dzień (tydzień przy wielu podopiecznych to bardzo długa strona)
  const [mode, setMode] = useState<Mode>(() =>
    typeof matchMedia === "function" && matchMedia("(max-width: 720px)").matches
      ? "Dzień"
      : "Tydzień",
  );
  const [anchor, setAnchor] = useState<ISODate>(today);
  const [locSel, setLoc] = useState("");
  // telefon: „kto trenuje” i miejsca w arkuszu „Filtr (N)” zamiast dwóch dodatkowych rzędów przełączników
  const phone = useMedia("(max-width: 720px)");
  const [filterOpen, setFilterOpen] = useState(false);
  // kto: wszyscy / treningi ze mną (wizyty) / samodzielne — wybór zapamiętany na tym urządzeniu
  const [who, setWhoState] = useState<Who>(() => {
    try {
      const v = localStorage.getItem("fitowa-cal-who");
      return v === "Ze mną" || v === "Samodzielnie" ? v : "Wszyscy";
    } catch {
      return "Wszyscy";
    }
  });
  const setWho = (v: Who) => {
    setWhoState(v);
    try {
      localStorage.setItem("fitowa-cal-who", v);
    } catch {
      // bez zapamiętania
    }
  };
  // telefon: tydzień przewija się do wybranego dnia (domyślnie dziś), a nie od poniedziałku
  useEffect(() => {
    if (mode !== "Tydzień" || !matchMedia("(max-width: 720px)").matches) return;
    const el =
      document.querySelector<HTMLElement>(`.week-day[data-date="${anchor}"]`) ??
      document.querySelector<HTMLElement>(".week-day.is-today");
    if (el && el.previousElementSibling) el.scrollIntoView({ block: "start" });
  }, [mode, anchor]);
  // Filtr usuniętego miejsca nie może dalej ukrywać wizyt.
  const loc = db.locations.some((l) => l.id === locSel) ? locSel : "";

  const shift = (dir: number) => {
    if (mode === "Dzień") setAnchor(addDays(anchor, dir));
    else if (mode === "Tydzień") setAnchor(addDays(anchor, 7 * dir));
    else {
      const d = new Date(anchor + "T12:00:00");
      d.setDate(1);
      d.setMonth(d.getMonth() + dir);
      setAnchor(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`,
      );
    }
  };

  const inLoc = (id?: string) => !loc || id === loc;
  // para / grupa = jeden kafelek (pierwsza wizyta z grupy, pozostałe osoby w nim)
  const apptsOn = (date: ISODate) => {
    if (who === "Samodzielnie") return [];
    const list = db.appointments.filter(
      (a) => a.date === date && inLoc(a.locationId),
    );
    const rep = (a: Appointment) => {
      if (!a.groupId) return true;
      const g = list.filter((x) => x.groupId === a.groupId);
      return (g.find((x) => x.status !== "cancel") ?? g[0]).id === a.id;
    };
    return list.filter(rep).sort((a, b) => a.time.localeCompare(b.time));
  };
  const linked = new Set(
    db.appointments.map((a) => a.sessionId).filter(Boolean),
  );
  const looseOn = (date: ISODate) =>
    db.sessions.filter(
      (s) =>
        s.date === date &&
        !linked.has(s.id) &&
        inLoc(s.locationId) &&
        (who === "Wszyscy" || (who === "Samodzielnie") === isSolo(db, s)),
    );
  // treningi zadane na dzień (poza planem), jeszcze niewykonane — przerywana ramka
  const assigned: Assigned[] = db.plans
    .filter(
      (p) =>
        p.extra &&
        db.clients.some(
          (c) =>
            c.id === p.clientId &&
            c.status === "aktywny" &&
            inLoc(c.locationId),
        ),
    )
    .flatMap((p) =>
      p.weeks
        .flatMap((w) => w.workouts)
        .filter((k) => k.date)
        .map((k) => ({
          plan: p,
          workout: k,
          state: extraState(
            k,
            p.id,
            db.sessions.filter((s) => s.clientId === p.clientId),
            today,
          ).state,
        })),
    )
    .filter((x) => x.state !== "done");
  // treningi z aktywnego planu na dni ustawione przez trenera — do zrobienia (bez wizyty tego dnia)
  for (const p of db.plans.filter(
    (x) =>
      x.active &&
      !x.extra &&
      db.clients.some(
        (c) =>
          c.id === x.clientId && c.status === "aktywny" && inLoc(c.locationId),
      ),
  )) {
    // jak w zakładce Plan: liczy się bieżące przejście planu; następny trening na jego najbliższej dacie
    // (zaległy termin przechodzi na najbliższy dzień tygodnia), jednostki przed następnym i inne minione daty — pomijane
    const ss = db.sessions.filter((x) => x.clientId === p.clientId);
    const done = doneInPass(p, ss);
    const nx = nextWorkout(p, ss);
    const seqIds = planSequence(p).map((x) => x.workout.id);
    const ni = nx ? seqIds.indexOf(nx.workout.id) : 0;
    p.weeks.forEach((w, wi) =>
      w.workouts.forEach((k) => {
        const planned = workoutDate(p, wi, k);
        const isNext = nx?.workout.id === k.id;
        const d = isNext ? nextDate(p, nx, today) ?? planned : planned;
        if (!d || (!isNext && done.has(k.id)) || !k.exercises.some((e) => e.name.trim()))
          return;
        if (!isNext && (seqIds.indexOf(k.id) < ni || d < today)) return;
        if (
          db.appointments.some(
            (a) =>
              a.clientId === p.clientId &&
              a.date === d &&
              a.status !== "cancel",
          )
        )
          return;
        assigned.push({
          plan: p,
          workout: { ...k, date: d },
          state: isNext && planned && planned < today ? "overdue" : "due",
          fromPlan: true,
        });
      }),
    );
  }
  // zadane poza planem robi się samodzielnie — nie w widoku „Ze mną”
  const assignedOn = (date: ISODate) =>
    who === "Ze mną" ? [] : assigned.filter((x) => x.workout.date === date);

  /** Upuszczenie wizyty na inny dzień: ta sama godzina; para razem; seria — pytanie „Ta i następne?”. */
  const moveTo = async (id: string, date: ISODate) => {
    const a = db.appointments.find((x) => x.id === id);
    if (!a || !canMove(a) || a.date === date) return;
    const later =
      !!a.seriesId &&
      db.appointments.some(
        (x) =>
          x.seriesId === a.seriesId &&
          x.date > a.date &&
          x.status === "planned",
      );
    const all =
      later &&
      (await ask(
        "To wizyta cykliczna. Przesunąć też kolejne zaplanowane wizyty z tej serii o tyle samo dni?",
        { confirm: "Ta i następne", cancel: "Tylko ta", danger: false },
      ));
    const changes = moveVisit(db, a, date, a.time, all);
    const ids = changes.map((c) => (c as { item: Appointment }).item.id);
    const before = db.appointments.filter((x) => ids.includes(x.id));
    const clash = clashes(
      { ...a, date },
      db.appointments.filter((x) => !ids.includes(x.id)),
    );
    if (!(await apply(changes))) return;
    const who = clientById(db, a.clientId)?.name.split(" ")[0] ?? "Wizyta";
    toast(
      `${who}: przeniesiono na ${fmtWeekday(date)} ${fmtShort(date)}, ${a.time}${all ? ` (i ${ids.length - 1} kolejne)` : ""}.${clash.length ? ` Uwaga: kolizja z ${clash.map((c) => `${clientById(db, c.clientId)?.name.split(" ")[0] ?? "—"} ${c.time}`).join(", ")}.` : ""}`,
      {
        label: "Cofnij",
        run: () =>
          void apply(
            before.map((x) => put("appointments", x)),
            "Cofnięto przeniesienie.",
          ),
      },
    );
  };
  const dropProps = (date: ISODate) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dropDay !== date) setDropDay(date);
    },
    onDragLeave: (e: DragEvent) => {
      if (
        !(e.currentTarget as HTMLElement).contains(
          e.relatedTarget as Node | null,
        )
      )
        setDropDay((d) => (d === date ? null : d));
    },
    onDrop: (e: DragEvent) => {
      const id = e.dataTransfer.getData(DRAG_TYPE);
      setDropDay(null);
      if (!id) return;
      e.preventDefault();
      void moveTo(id, date);
    },
  });

  const nFilters = (who !== "Wszyscy" ? 1 : 0) + (loc ? 1 : 0);
  const locFilter = (
    <div className="loc-filter" role="radiogroup" aria-label="Miejsce">
      <button
        type="button"
        role="radio"
        aria-checked={!loc}
        className={!loc ? "active" : ""}
        onClick={() => setLoc("")}
      >
        Wszystkie
      </button>
      {db.locations.map((l) => (
        <button
          key={l.id}
          type="button"
          role="radio"
          aria-checked={loc === l.id}
          className={loc === l.id ? "active" : ""}
          style={locStyle(l)}
          onClick={() => setLoc(loc === l.id ? "" : l.id)}
        >
          <i /> {l.name.replace(/\s*\(.*?\)/, "")}
        </button>
      ))}
    </div>
  );

  const ws = weekStart(anchor);
  const title =
    mode === "Dzień"
      ? `${fmtWeekday(anchor)} ${fmtShort(anchor)}`
      : mode === "Tydzień"
        ? `${fmtShort(ws)} – ${fmtShort(addDays(ws, 6))}`
        : fmtMonth(anchor.slice(0, 7));

  return (
    <div className="page page-wide fade">
      <div className="page-head">
        <h2>Kalendarz</h2>
        <div className="cal-controls">
          <Seg
            options={["Dzień", "Tydzień", "Miesiąc"] as const}
            value={mode}
            onChange={setMode}
            label="Widok"
          />
          {!phone && (
            <Seg
              options={WHO}
              value={who}
              onChange={setWho}
              label="Kto trenuje"
            />
          )}
          <div className="cal-nav">
            <button
              className="icon-btn"
              aria-label="Poprzedni"
              onClick={() => shift(-1)}
            >
              <Icon name="chevL" />
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setAnchor(today)}
            >
              Dziś
            </button>
            <button
              className="icon-btn"
              aria-label="Następny"
              onClick={() => shift(1)}
            >
              <Icon name="chevR" />
            </button>
            <strong className="cal-title first-cap">{title}</strong>
          </div>
          {phone ? (
            <button
              type="button"
              className={`btn btn-secondary btn-sm cal-filter-btn ${nFilters ? "is-on" : ""}`}
              onClick={() => setFilterOpen(true)}
              aria-haspopup="dialog"
            >
              <Icon name="settings" size={14} /> Filtr
              {nFilters ? ` (${nFilters})` : ""}
            </button>
          ) : (
            db.locations.length > 1 && locFilter
          )}
        </div>
      </div>

      {phone && filterOpen && (
        <Modal
          title="Filtr kalendarza"
          onClose={() => setFilterOpen(false)}
          onSubmit={() => setFilterOpen(false)}
          submitLabel="Gotowe"
        >
          <div className="cal-filter-sheet">
            <p className="eyebrow">Kto trenuje</p>
            <Seg
              options={WHO}
              value={who}
              onChange={setWho}
              label="Kto trenuje"
            />
            {db.locations.length > 1 && (
              <>
                <p className="eyebrow">Miejsce</p>
                {locFilter}
              </>
            )}
            {nFilters > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => (setWho("Wszyscy"), setLoc(""))}
              >
                Wyczyść filtr
              </button>
            )}
          </div>
        </Modal>
      )}
      {mode === "Dzień" && (
        // pasek tygodnia: szybki wybór dnia, kropka = coś zaplanowane
        <div className="day-strip" role="tablist" aria-label="Dzień tygodnia">
          {Array.from({ length: 7 }, (_, i) => addDays(ws, i)).map((date) => {
            const n =
              apptsOn(date).length +
              looseOn(date).length +
              assignedOn(date).length;
            return (
              <button
                key={date}
                type="button"
                role="tab"
                aria-selected={date === anchor}
                className={`day-strip-btn ${date === anchor ? "active" : ""} ${date === today ? "is-today" : ""}`}
                onClick={() => setAnchor(date)}
                aria-label={`${fmtWeekday(date)} ${fmtShort(date)}${n ? `, ${n}` : ""}`}
              >
                <span>{fmtWeekday(date).slice(0, 2)}</span>
                <b>{Number(date.slice(8))}</b>
                <i>{n || ""}</i>
              </button>
            );
          })}
        </div>
      )}
      {mode === "Dzień" ? (
        <div className="week week-one week-axis">
          <section
            data-date={anchor}
            className={`week-day ${anchor === today ? "is-today" : ""} ${dropDay === anchor ? "drop-over" : ""}`}
            {...dropProps(anchor)}
          >
            <header>
              <span className="first-cap">{fmtWeekday(anchor)}</span>{" "}
              <strong>{fmtShort(anchor)}</strong>
              <button
                className="icon-btn icon-btn-sm"
                aria-label={`Dodaj wizytę ${fmtShort(anchor)}`}
                onClick={() => openModal({ kind: "appt", date: anchor })}
              >
                <Icon name="plus" size={14} />
              </button>
            </header>
            {looseOn(anchor).length + assignedOn(anchor).length > 0 && (
              <div
                className="week-items day-allday"
                aria-label="Bez godziny / samodzielne"
              >
                {looseOn(anchor).map((s) => (
                  <SessionTile key={s.id} s={s} />
                ))}
                {assignedOn(anchor).map((x) => (
                  <AssignedTile key={x.workout.id} x={x} />
                ))}
              </div>
            )}
            <DayAxis
              date={anchor}
              today={today}
              appts={apptsOn(anchor)}
              onDragEnd={() => setDropDay(null)}
            />
          </section>
        </div>
      ) : mode !== "Miesiąc" ? (
        <div className="week">
          {Array.from({ length: 7 }, (_, i) => addDays(ws, i)).map((date) => (
            <section
              key={date}
              data-date={date}
              className={`week-day ${date === today ? "is-today" : ""} ${dropDay === date ? "drop-over" : ""}`}
              {...dropProps(date)}
            >
              <header>
                <span className="first-cap">{fmtWeekday(date)}</span>{" "}
                <strong>{fmtShort(date)}</strong>
                <button
                  className="icon-btn icon-btn-sm"
                  aria-label={`Dodaj wizytę ${fmtShort(date)}`}
                  onClick={() => openModal({ kind: "appt", date })}
                >
                  <Icon name="plus" size={14} />
                </button>
              </header>
              <div className="week-items">
                {apptsOn(date).map((a) => (
                  <ApptTile
                    key={a.id}
                    a={a}
                    onDragEnd={() => setDropDay(null)}
                  />
                ))}
                {looseOn(date).map((s) => (
                  <SessionTile key={s.id} s={s} />
                ))}
                {assignedOn(date).map((x) => (
                  <AssignedTile key={x.workout.id} x={x} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <MonthGrid
          anchor={anchor}
          today={today}
          apptsOn={apptsOn}
          looseOn={looseOn}
          assignedOn={assignedOn}
          onPickDay={(d) => {
            setAnchor(d);
            setMode(
              matchMedia("(max-width: 720px)").matches ? "Dzień" : "Tydzień",
            );
          }}
        />
      )}
      <p className="muted small legend-note">
        kropka = miejsce · „sam” = trening samodzielny (kropkowany pasek) ·
        przerywana ramka = zadany do zrobienia
      </p>
    </div>
  );
}

function ApptTile({
  a,
  onDragEnd,
  style,
  className = "",
}: {
  a: Appointment;
  onDragEnd?: () => void;
  style?: React.CSSProperties;
  className?: string;
}) {
  const { db } = useStore();
  const { openModal } = useNav();
  const c = clientById(db, a.clientId);
  const partners = groupOf(db.appointments, a).filter(
    (x) => x.id !== a.id && x.status !== "cancel",
  );
  // para: status każdej osoby osobno (nieobecność jednej nie wyszarza całej wizyty)
  const all = [a, ...partners];
  const mixed = partners.length > 0 && all.some((x) => x.status !== a.status);
  const status =
    mixed && all.some((x) => x.status === "planned") ? "planned" : a.status;
  const first = (id: string) => clientById(db, id)?.name.split(" ")[0] ?? "—";
  const clash =
    a.status === "planned" && clashes(a, db.appointments).length > 0;
  // komputer: wizytę zaplanowaną można przeciągnąć na inny dzień (godzina zostaje)
  const drag = !!onDragEnd && canMove(a) && finePointer();
  const [dragging, setDragging] = useState(false);
  return (
    <button
      className={`tile tile-${status} ${className} ${clash ? "tile-clash" : ""} ${a.status === "planned" && a.date < todayISO() ? "tile-overdue" : ""} ${drag ? "tile-draggable" : ""} ${dragging ? "is-dragging" : ""}`}
      style={{ ...hueStyle(a.clientId), ...style }}
      title={
        clash
          ? "Kolizja z inną wizytą o tej porze"
          : drag
            ? "Przeciągnij na inny dzień, by przesunąć wizytę"
            : undefined
      }
      draggable={drag || undefined}
      onDragStart={
        drag
          ? (e) => {
              e.dataTransfer.setData(DRAG_TYPE, a.id);
              e.dataTransfer.setData(
                "text/plain",
                `${c?.name ?? ""} ${a.time}`,
              );
              e.dataTransfer.effectAllowed = "move";
              setDragging(true);
            }
          : undefined
      }
      onDragEnd={
        drag
          ? () => {
              setDragging(false);
              onDragEnd?.();
            }
          : undefined
      }
      onClick={() => openModal({ kind: "appt", appt: a })}
    >
      <span className="tile-time">
        {clash && (
          <span className="clash-mark" aria-label="Kolizja">
            <Icon name="alert" size={13} />{" "}
          </span>
        )}
        {a.time}
      </span>
      <span className="tile-name">
        {partners.length ? (
          <>
            <Icon name="users" size={13} />{" "}
            {[c, ...partners.map((x) => clientById(db, x.clientId))]
              .map((x) => x?.name.split(" ")[0] ?? "—")
              .join(" + ")}
          </>
        ) : (
          (c?.name ?? "—")
        )}
      </span>
      <span className="tile-meta">
        <LocationTag id={a.locationId} short />
        {mixed ? (
          <span className="tile-status">
            {all
              .filter((x) => x.status !== "planned")
              .map(
                (x) =>
                  `${first(x.clientId)}: ${APPT_STATUS[x.status].label.toLowerCase()}`,
              )
              .join(", ")}
          </span>
        ) : (
          <>
            {a.status !== "planned" && (
              <span className="tile-status">{APPT_STATUS[a.status].label}</span>
            )}
            {apptReplyState(a) === "confirmed" && a.status === "planned" && (
              <span className="tile-status reply-ok">potwierdzona</span>
            )}
            {apptReplyState(a)?.startsWith("cancelled") && (
              <span className="tile-status reply-warn" title={a.reply?.reason}>
                {apptReplyState(a) === "cancelled-late"
                  ? "późne odwołanie"
                  : "odwołał(a)"}
              </span>
            )}
          </>
        )}
      </span>
    </button>
  );
}

function SessionTile({ s }: { s: TrainingSession }) {
  const { db } = useStore();
  const { openModal } = useNav();
  const c = clientById(db, s.clientId);
  // ten sam wygląd co odbyta wizyta: godzina zapisu, podopieczny, miejsce, nazwa treningu
  const time = s.createdAt
    ? new Date(s.createdAt).toLocaleTimeString("pl-PL", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  const solo = isSolo(db, s);
  return (
    <button
      className={`tile tile-done ${solo ? "tile-solo" : ""}`}
      style={hueStyle(s.clientId)}
      onClick={() => openModal({ kind: "session", session: s })}
    >
      <span className="tile-time">
        {time || "Trening"}{" "}
        <span className={`who-badge ${solo ? "solo" : "with"}`}>
          {solo ? "sam" : "ze mną"}
        </span>
      </span>
      <span className="tile-name">{c?.name ?? "—"}</span>
      <span className="tile-meta">
        <LocationTag id={s.locationId} short />
        <span className="tile-status">{s.workoutName || "Trening"}</span>
      </span>
    </button>
  );
}

/** Minuty → piksele na osi godzin widoku Dzień (godzina ≈ 64 px). */
const PX = 64 / 60;

/**
 * Widok Dzień: oś godzin (godziny pracy z profilu trenera, poszerzone o wizyty spoza nich), kafelki wizyt
 * proporcjonalne do długości (kolizje obok siebie), wolne okienka ≥ 60 min — stuknięcie dodaje wizytę.
 */
function DayAxis({
  date,
  today,
  appts,
  onDragEnd,
}: {
  date: ISODate;
  today: ISODate;
  appts: Appointment[];
  onDragEnd: () => void;
}) {
  const { db } = useStore();
  const { openModal } = useNav();
  const { profile } = useTrainerProfile();
  const [nowMin, setNowMin] = useState(
    () => new Date().getHours() * 60 + new Date().getMinutes(),
  );
  useEffect(() => {
    if (date !== today) return;
    const t = setInterval(
      () => setNowMin(new Date().getHours() * 60 + new Date().getMinutes()),
      60_000,
    );
    return () => clearInterval(t);
  }, [date, today]);
  const timed = appts.filter((a) => a.time);
  // dzień poza godzinami pracy i bez wizyt — bez pustej osi
  if (!timed.length && !hoursOn(date, profile.workHours))
    return (
      <p className="muted small day-off">
        Dzień wolny — poza godzinami pracy. Wizytę dodasz przyciskiem „+”.
      </p>
    );
  const range = axisRange(timed, date, profile.workHours);
  // wolne okienka wg wszystkich wizyt (niezależnie od filtra), tylko od dziś
  const free =
    date < today
      ? []
      : freeSlots(db.appointments, date, profile.workHours, {
          notBefore: date === today ? nowMin : undefined,
          off: profile.vacation,
        });
  const hours: number[] = [];
  for (let m = range.from; m <= range.to; m += 60) hours.push(m);
  const y = (m: number) => (m - range.from) * PX;
  return (
    <div className="day-axis" style={{ height: `${y(range.to)}px` }}>
      {hours.map((m) => (
        <div key={m} className="day-hour" style={{ top: `${y(m)}px` }}>
          <span>{hourLabel(m)}</span>
        </div>
      ))}
      {free.map((f) => (
        <button
          key={f.from}
          type="button"
          className="free-slot"
          style={{
            top: `${y(f.from) + 1}px`,
            height: `${(f.to - f.from) * PX - 2}px`,
          }}
          onClick={() => openModal({ kind: "appt", date, time: hhmm(f.from) })}
          aria-label={`Wolne ${hhmm(f.from)}–${hhmm(f.to)}: dodaj wizytę o ${hhmm(f.from)}`}
        >
          <span className="free-slot-range">
            wolne {hourLabel(f.from)}–{hourLabel(f.to)}
          </span>
          <span className="free-slot-add">+ wizyta o {hhmm(f.from)}</span>
        </button>
      ))}
      {date === today && nowMin >= range.from && nowMin <= range.to && (
        <div
          className="day-now"
          style={{ top: `${y(nowMin)}px` }}
          aria-hidden
        />
      )}
      {lanes(timed).map(({ item, from, to, lane, of }) => {
        const h = Math.max((to - from) * PX - 2, 30);
        return (
          <ApptTile
            key={item.id}
            a={item}
            onDragEnd={onDragEnd}
            className={`tile-axis ${h < 56 ? "tile-short" : ""}`}
            style={
              {
                top: `${y(from) + 1}px`,
                height: `${h}px`,
                "--lane": lane,
                "--of": of,
              } as React.CSSProperties
            }
          />
        );
      })}
      {!timed.length && !free.length && (
        <p className="muted small day-axis-empty">Brak wizyt.</p>
      )}
    </div>
  );
}

interface Assigned {
  plan: Plan;
  workout: PlanWorkout;
  state: ExtraState["state"];
  /** Jednostka z planu (dzień ustawiony w planie), nie trening poza planem. */
  fromPlan?: boolean;
}

/** Trening zadany na ten dzień (jeszcze niewykonany) — otwiera jego edycję. */
function AssignedTile({ x }: { x: Assigned }) {
  const { db } = useStore();
  const { openModal } = useNav();
  const c = clientById(db, x.plan.clientId);
  return (
    <button
      className={`tile tile-loose ${x.state === "overdue" ? "tile-loose-overdue" : ""}`}
      style={hueStyle(x.plan.clientId)}
      onClick={() =>
        openModal({ kind: "plan", plan: x.plan, focusWorkoutId: x.workout.id })
      }
      title={
        x.fromPlan
          ? "Trening z planu na ten dzień — kliknij, by zmienić plan"
          : "Trening zadany poza planem — kliknij, by zmienić"
      }
    >
      <span className="tile-time">
        {x.fromPlan ? "z planu · " : ""}
        {x.state === "overdue" ? "zaległy" : "do zrobienia"}
      </span>
      <span className="tile-name">{c?.name ?? "—"}</span>
      <span className="tile-meta">
        <span className="tile-status">{x.workout.name}</span>
      </span>
    </button>
  );
}

function MonthGrid({
  anchor,
  today,
  apptsOn,
  looseOn,
  assignedOn,
  onPickDay,
}: {
  anchor: ISODate;
  today: ISODate;
  apptsOn: (d: ISODate) => Appointment[];
  looseOn: (d: ISODate) => TrainingSession[];
  assignedOn: (d: ISODate) => Assigned[];
  onPickDay: (d: ISODate) => void;
}) {
  const { db } = useStore();
  const phone = useMedia("(max-width: 720px)");
  const first = anchor.slice(0, 7) + "-01";
  const start = weekStart(first);
  const days: ISODate[] = [];
  for (let d = start; days.length < 42; d = addDays(d, 1)) days.push(d);
  while (
    days.length > 35 &&
    days[days.length - 7].slice(0, 7) !== first.slice(0, 7)
  )
    days.splice(-7);
  return (
    <div className="month">
      {["pon", "wt", "śr", "czw", "pt", "sob", "nd"].map((d) => (
        <div key={d} className="month-dow">
          {d}
        </div>
      ))}
      {days.map((d) => {
        const items = apptsOn(d).filter((a) => a.status !== "cancel");
        const loose = [...looseOn(d), ...assignedOn(d)];
        const cls = `month-cell ${d.slice(0, 7) !== first.slice(0, 7) ? "other" : ""} ${d === today ? "is-today" : ""} ${d < today ? "is-past" : ""}`;
        if (phone) {
          // telefon: cyfra dnia i liczba wizyt (zamiast pasków bez treści)
          const n = items.length;
          return (
            <button
              key={d}
              className={`${cls} month-cell-count`}
              onClick={() => onPickDay(d)}
              aria-label={`${fmtShort(d)}: ${n ? `${n} ${n === 1 ? "wizyta" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "wizyty" : "wizyt"}` : "brak wizyt"}${loose.length ? `, ${loose.length} samodzielnie / zadane` : ""}`}
            >
              <span className="month-num">{Number(d.slice(8))}</span>
              {n > 0 && <span className="month-count">{n}</span>}
              {loose.length > 0 && <span className="month-loose" aria-hidden />}
            </button>
          );
        }
        return (
          <button key={d} className={cls} onClick={() => onPickDay(d)}>
            <span className="month-num">{Number(d.slice(8))}</span>
            {items.slice(0, 3).map((a) => (
              <span
                key={a.id}
                className={`month-item tile-${a.status}`}
                style={hueStyle(a.clientId)}
              >
                <span className="hide-mobile">{a.time} </span>
                {clientById(db, a.clientId)?.name.split(" ")[0]}
              </span>
            ))}
            {loose.slice(0, 1).map((s) =>
              "workout" in s ? (
                <span
                  key={s.workout.id}
                  className="month-item tile-loose"
                  style={hueStyle(s.plan.clientId)}
                >
                  {clientById(db, s.plan.clientId)?.name.split(" ")[0]}
                </span>
              ) : (
                <span
                  key={s.id}
                  className={`month-item tile-done ${isSolo(db, s) ? "tile-solo" : ""}`}
                  style={hueStyle(s.clientId)}
                >
                  {clientById(db, s.clientId)?.name.split(" ")[0]}
                </span>
              ),
            )}
            {items.length + loose.length >
              Math.min(items.length, 3) + Math.min(loose.length, 1) && (
              <span className="month-more">
                +
                {items.length +
                  loose.length -
                  Math.min(items.length, 3) -
                  Math.min(loose.length, 1)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
