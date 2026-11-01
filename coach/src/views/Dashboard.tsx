import { useEffect, useState, type ReactNode } from "react";
import {
  Avatar,
  Card,
  Dot,
  Empty,
  Icon,
  IconBtn,
  Kpi,
  Tag,
} from "../components/ui";
import {
  allPayments,
  clientById,
  groupOf,
  lastSessionDate,
  paymentLabel,
  sessionsOf,
  type PaymentRow,
} from "../data/ops";
import { put } from "../data/db";
import { needsReview, sessionVideos } from "../data/videos";
import { markPaid } from "../data/payActions";
import { useStore } from "../data/store";
import { ago, fmtDate, fmtDay, fmtLong, plural, pln } from "../format";
import { clientAlerts } from "../lib/alerts";
import { healthFlags, trainerNotesOf } from "./client/Health";
import { isOverdue, packageStatus, PACKAGE_WARN_AT } from "../lib/billing";
import { addDays, daysBetween, todayISO } from "../lib/dates";
import { useNav } from "../nav";
import { ApptStatusTag } from "./CalendarView";
import { LocationTag, locStyle } from "../components/location";
import { clubAmount, clubOutstanding, clubSessions } from "../lib/club";
import { weekLabel } from "../lib/comms";
import { useSendMessage } from "../components/Chat";
import type { Appointment, Client } from "../domain";
import { openInbox } from "./Inbox";
import { REVIEW_LABEL, reviewQueue } from "../lib/reviewQueue";
import { dm, dueBuckets, plansToRenew, weekReports } from "../lib/dashboard";
import { weekSummary } from "../lib/freeSlots";
import { useTrainerProfile } from "../data/trainerProfile";

/** Zgodność z zapytaniem CSS (np. telefon) — aktualizowana przy zmianie rozmiaru okna. */
export function useMedia(query: string): boolean {
  const get = () =>
    typeof matchMedia === "function" && matchMedia(query).matches;
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const m = matchMedia(query);
    const fn = () => setOn(m.matches);
    m.addEventListener?.("change", fn);
    return () => m.removeEventListener?.("change", fn);
  }, [query]);
  return on;
}

const FOLD_KEY = "fitowa-dash-folds";
/** Rozwinięte sekcje Pulpitu (telefon: „Więcej”, „Jutro”) — zapamiętane na tym urządzeniu. */
function useFolds(): [Record<string, boolean>, (id: string) => void] {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(FOLD_KEY) || "{}") as Record<
        string,
        boolean
      >;
    } catch {
      return {};
    }
  });
  const toggle = (id: string) =>
    setOpen((o) => {
      const n = { ...o, [id]: !o[id] };
      try {
        localStorage.setItem(FOLD_KEY, JSON.stringify(n));
      } catch {
        // bez zapamiętania
      }
      return n;
    });
  return [open, toggle];
}

/** Zwijana sekcja (telefon): nagłówek z liczbą, treść po rozwinięciu. */
function Fold({
  id,
  title,
  badge,
  tone,
  open,
  onToggle,
  className = "",
  children,
}: {
  id: string;
  title: string;
  badge?: ReactNode;
  tone?: "danger" | "warn";
  open: boolean;
  onToggle: (id: string) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`card dash-fold ${open ? "is-open" : ""} ${className}`}>
      <button
        type="button"
        className="dash-fold-head"
        aria-expanded={open}
        onClick={() => onToggle(id)}
      >
        <span className="dash-fold-title">{title}</span>
        {badge != null && badge !== "" && (
          <span className={`dash-fold-badge${tone ? ` tone-${tone}` : ""}`}>
            {badge}
          </span>
        )}
        <span className="dash-fold-chev" aria-hidden>
          <Icon name="chevD" size={16} />
        </span>
      </button>
      {open && <div className="dash-fold-body">{children}</div>}
    </section>
  );
}

interface Sec {
  id: string;
  title: string;
  className: string;
  body: ReactNode;
  action?: ReactNode;
  /** Krótka informacja w zwiniętym nagłówku (telefon). */
  badge?: ReactNode;
  tone?: "danger" | "warn";
}

export function Dashboard() {
  const { db, apply, toast } = useStore();
  const { openClient, openModal, startLive, go } = useNav();
  const { profile } = useTrainerProfile();
  const phone = useMedia("(max-width: 1000px)");
  const [folds, toggleFold] = useFolds();
  const clubs = db.locations.filter((l) => l.kind === "klub");
  const today = todayISO();
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [showAllToday, setShowAllToday] = useState(false);
  const [showAllRenew, setShowAllRenew] = useState(false);
  const active = db.clients.filter((c) => c.status === "aktywny");

  const todayAppts = db.appointments
    .filter((a) => a.date === today && a.status !== "cancel")
    .sort((a, b) => a.time.localeCompare(b.time));
  const tomorrow = addDays(today, 1);
  const tomorrowAppts = db.appointments
    .filter((a) => a.date === tomorrow && a.status !== "cancel")
    .sort((a, b) => a.time.localeCompare(b.time));
  const now = new Date();
  const wk = weekSummary(
    db.appointments,
    today,
    now.getHours() * 60 + now.getMinutes(),
    profile.workHours,
    profile.vacation,
  );
  const week = db.sessions.filter(
    (s) => s.date > addDays(today, -7) && s.date <= today,
  ).length;
  const payments = allPayments(db);
  const month = today.slice(0, 7);
  const paidThisMonth = payments
    .filter(
      (p) => p.status === "paid" && (p.paidDate || p.date).startsWith(month),
    )
    .reduce((a, p) => a + p.amount, 0);
  const overdue = payments.filter((p) => isOverdue(p, today));
  const dues = dueBuckets(payments, today);

  const alerts = active.flatMap((c) =>
    clientAlerts(
      c,
      sessionsOf(db, c.id),
      today,
      healthFlags(trainerNotesOf(db.trainer_notes, c.id).health, c.intake),
    ).map((a) => ({ ...a, client: c })),
  );
  alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === "red" ? -1 : 1));

  const packages = active
    .map((c) => ({ c, pk: packageStatus(c, sessionsOf(db, c.id)) }))
    .filter(
      (x) =>
        x.pk &&
        x.pk.left <= PACKAGE_WARN_AT &&
        (x.c.billing === "pakiet" || !x.c.billing),
    )
    .sort((a, b) => a.pk!.left - b.pk!.left);

  const idle = active
    .map((c) => ({ c, last: lastSessionDate(db, c.id) }))
    // nowy podopieczny bez treningów, ale z zaplanowaną wizytą, nie jest „nieaktywny”
    .filter((x) =>
      !x.last
        ? !db.appointments.some(
            (a) =>
              a.clientId === x.c.id &&
              a.status === "planned" &&
              a.date >= today,
          )
        : daysBetween(x.last, today) >= 10,
    )
    .sort((a, b) => (a.last || "").localeCompare(b.last || ""));

  const recent = [...db.sessions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);
  const renew = plansToRenew(db.clients, db.plans, today);

  const kpis = (
    <div className="kpi-grid kpi-strip">
      <Kpi
        label="Aktywni klienci"
        value={active.length}
        sub={`${db.clients.length} łącznie`}
      />
      <Kpi
        label="Treningi – 7 dni"
        value={week}
        sub={plural(week, "trening", "treningi", "treningów")}
      />
      <Kpi label="Wpłaty w tym miesiącu" value={pln(paidThisMonth)} />
      <Kpi
        onClick={() => {
          try {
            sessionStorage.setItem("payments-filter", "Zaległe");
          } catch {
            /* bez sessionStorage — zwykłe przejście */
          }
          go("Płatności");
        }}
        label="Zaległości"
        value={pln(overdue.reduce((a, p) => a + p.amount, 0))}
        sub={
          overdue.length
            ? `${overdue.length} ${plural(overdue.length, "płatność", "płatności", "płatności")} po terminie`
            : "brak"
        }
        tone={overdue.length ? "danger" : undefined}
      />
    </div>
  );

  const shortName = (id: string) => clientById(db, id)?.name ?? "—";

  const todayCard = (
    <Card
      title={`Dziś w kalendarzu${todayAppts.length > 6 ? ` (${todayAppts.length})` : ""}`}
      className="span-2 dash-today"
    >
      {todayAppts.length === 0 ? (
        <Empty>Brak wizyt na dziś.</Empty>
      ) : (
        <ul className="rows">
          {/* dużo wizyt: najpierw te, które jeszcze przed Tobą (reszta po rozwinięciu) */}
          {(showAllToday || todayAppts.length <= 8
            ? todayAppts
            : (todayAppts.filter((a) => a.status === "planned").length
                ? todayAppts.filter((a) => a.status === "planned")
                : todayAppts
              ).slice(0, 6)
          ).map((a) => {
            const c = clientById(db, a.clientId);
            return (
              <li key={a.id} className="row dash-visit" data-status={a.status}>
                <span className="row-time">{a.time}</span>
                <div className="grow row-main">
                  <button
                    className="link ellipsis"
                    onClick={() => c && openClient(c.id)}
                  >
                    {c?.name ?? "—"}
                  </button>
                  {(() => {
                    const pr = groupOf(db.appointments, a).filter(
                      (x) => x.id !== a.id && x.status !== "cancel",
                    );
                    return pr.length ? (
                      <span
                        className="muted small nowrap"
                        title="Trening w parze — „Prowadź” otwiera obie osoby"
                      >
                        <Icon name="users" size={13} /> +{" "}
                        {pr
                          .map(
                            (x) =>
                              clientById(db, x.clientId)?.name.split(" ")[0] ??
                              "—",
                          )
                          .join(", ")}
                      </span>
                    ) : null;
                  })()}
                  <LocationTag id={a.locationId} short />
                </div>
                <span className={a.status === "planned" ? "hide-mobile" : ""}>
                  <ApptStatusTag status={a.status} />
                </span>
                {a.status === "planned" ||
                (a.status === "done" && !a.sessionId) ? (
                  <>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => startLive(a.clientId, a.id)}
                      title="Prowadź trening na żywo, seria po serii"
                      aria-label="Prowadź trening"
                    >
                      <Icon name="play" size={14} />{" "}
                      <span className="hide-xs">Prowadź</span>
                    </button>
                    <IconBtn
                      icon="edit"
                      label="Zapisz trening po fakcie"
                      onClick={() =>
                        openModal({
                          kind: "session",
                          appt: a,
                          clientId: a.clientId,
                          date: a.date,
                        })
                      }
                    />
                  </>
                ) : a.sessionId &&
                  db.sessions.some((x) => x.id === a.sessionId) ? (
                  <IconBtn
                    icon="eye"
                    label="Pokaż zapisany trening"
                    onClick={() =>
                      openModal({
                        kind: "session",
                        session: db.sessions.find((x) => x.id === a.sessionId)!,
                      })
                    }
                  />
                ) : (
                  <span className="btn-sm-placeholder" />
                )}
                <IconBtn
                  icon="cal"
                  label="Szczegóły wizyty (odwołaj, nieobecność, zmiana)"
                  onClick={() => openModal({ kind: "appt", appt: a })}
                />
              </li>
            );
          })}
        </ul>
      )}
      {todayAppts.length > 8 && (
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setShowAllToday(!showAllToday)}
        >
          {showAllToday
            ? "Pokaż mniej"
            : `Pokaż wszystkie wizyty (${todayAppts.length})`}
        </button>
      )}
      <div className="dash-ahead">
        <button
          type="button"
          className="dash-ahead-head"
          aria-expanded={!!folds.tomorrow}
          onClick={() => toggleFold("tomorrow")}
        >
          <span className="dash-ahead-title">Jutro</span>
          <span className="muted small">
            {tomorrowAppts.length
              ? `${tomorrowAppts.length} ${plural(tomorrowAppts.length, "wizyta", "wizyty", "wizyt")}${tomorrowAppts.length ? ` · od ${tomorrowAppts[0].time}` : ""}`
              : "brak wizyt"}
          </span>
          <span className="dash-fold-chev" aria-hidden>
            <Icon name="chevD" size={16} />
          </span>
        </button>
        {folds.tomorrow && tomorrowAppts.length > 0 && (
          <ul className="rows dash-tomorrow">
            {tomorrowAppts.map((a: Appointment) => (
              <li key={a.id} className="row">
                <span className="row-time">{a.time}</span>
                <button
                  className="link grow ellipsis"
                  onClick={() => openClient(a.clientId)}
                >
                  {shortName(a.clientId)}
                </button>
                <LocationTag id={a.locationId} short />
                <IconBtn
                  icon="cal"
                  label="Szczegóły wizyty"
                  onClick={() => openModal({ kind: "appt", appt: a })}
                />
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="dash-week-line"
          onClick={() => go("Kalendarz")}
          title="Otwórz kalendarz"
        >
          <Icon name="cal" size={14} /> <span>{wk.label}</span>
        </button>
      </div>
    </Card>
  );

  const msgsCard = (() => {
    const notes = db.clients
      .flatMap((c) =>
        (c.inbox ?? [])
          .filter((n) => !n.read && !n.hidden)
          .map((n) => ({ c, n })),
      )
      .sort((a, b) => (b.n.at || "").localeCompare(a.n.at || ""));
    if (!notes.length) return null;
    // jedna pozycja na podopiecznego (najnowsza wiadomość na górze), szybka odpowiedź w wierszu
    const groups = [...new Map(notes.map((x) => [x.c.id, x.c])).values()].map(
      (c) => ({ c, ns: notes.filter((x) => x.c.id === c.id).map((x) => x.n) }),
    );
    return (
      <Card
        title={`Wiadomości od podopiecznych (${notes.length})`}
        className="span-2 dash-msgs"
        action={
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => openInbox(go)}
          >
            Wszystkie ›
          </button>
        }
      >
        <ul className="rows dash-msg-groups">
          {groups.slice(0, 5).map(({ c, ns }) => (
            <li key={c.id} className="row row-top dash-msg-group">
              <div className="grow">
                <div className="dash-msg-who">
                  <button
                    className="link"
                    onClick={() => openInbox(go, { clientId: c.id })}
                  >
                    {c.name}
                  </button>
                  {ns.length > 1 && (
                    <span className="nav-badge">{ns.length}</span>
                  )}
                  <span className="muted small">
                    {" "}
                    ·{" "}
                    {new Date(ns[0].at).toLocaleString("pl-PL", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                {ns.slice(0, 2).map((n) => (
                  <div key={n.id} className="dash-msg-line">
                    {(n.ref?.sessionId || n.sessionId) && (
                      <Icon name="dumbbell" size={13} />
                    )}
                    {n.media?.length ? (
                      <Icon
                        name={
                          n.media[0].kind === "video"
                            ? "cam"
                            : n.media[0].kind === "audio"
                              ? "mic"
                              : "image"
                        }
                        size={13}
                      />
                    ) : null}
                    <span className="small ellipsis-2">{n.text}</span>
                  </div>
                ))}
                {ns.length > 2 && (
                  <div className="muted small">
                    + {ns.length - 2} wcześniejsze
                  </div>
                )}
                <QuickReply client={c} />
                <div className="row-links">
                  <button
                    className="link small"
                    onClick={() => openInbox(go, { clientId: c.id })}
                  >
                    Rozmowa ›
                  </button>
                  {(() => {
                    const hit = ns.find((n) => {
                      const id = n.ref?.sessionId ?? n.sessionId;
                      return id && db.sessions.some((x) => x.id === id);
                    });
                    const sid = hit
                      ? (hit.ref?.sessionId ?? hit.sessionId)
                      : undefined;
                    return sid ? (
                      <button
                        className="link small"
                        onClick={() =>
                          openModal({
                            kind: "review",
                            sessionId: sid,
                            exIndex: hit?.ref?.exIndex,
                          })
                        }
                      >
                        Zobacz trening ›
                      </button>
                    ) : null;
                  })()}
                  <button
                    className="link small muted"
                    onClick={() =>
                      apply([
                        put("clients", {
                          ...c,
                          inbox: (c.inbox ?? []).map((x) => ({
                            ...x,
                            read: true,
                          })),
                        }),
                      ])
                    }
                  >
                    ✓ Przeczytane
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {groups.length > 5 && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => openInbox(go)}
          >
            I jeszcze {groups.length - 5} — wszystkie rozmowy ›
          </button>
        )}
      </Card>
    );
  })();

  const videosCard = (() => {
    // nagrania serii, których trener jeszcze nie obejrzał (ostatnie 30 dni)
    const from = addDays(today, -30);
    const todo = db.sessions
      .filter((x) => x.date >= from && needsReview(x))
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
      );
    if (!todo.length) return null;
    return (
      <Card
        title={`Nagrania do obejrzenia (${todo.length})`}
        className="span-2 dash-videos"
      >
        <ul className="rows">
          {todo.slice(0, 8).map((x) => {
            const c = clientById(db, x.clientId);
            const n = sessionVideos(x).length;
            return (
              <li key={x.id} className="row">
                <span className="row-time">{fmtDay(x.date)}</span>
                <div className="grow row-main">
                  <b className="ellipsis">{c?.name ?? "—"}</b>
                  <span className="muted small ellipsis">
                    {x.workoutName || "Trening"} · <Icon name="cam" size={13} />{" "}
                    {n}
                    {x.notes ? " · ma notatkę" : ""}
                  </span>
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => openModal({ kind: "review", sessionId: x.id })}
                >
                  <Icon name="play" size={14} />{" "}
                  <span className="hide-xs">Obejrzyj</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
    );
  })();

  const overdueApptsCard = (() => {
    // zaplanowane wizyty z ostatnich 2 tygodni, które nie zostały rozliczone
    const from = addDays(today, -14);
    const overdueAppts = db.appointments
      .filter((a) => a.status === "planned" && a.date < today && a.date >= from)
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    if (!overdueAppts.length) return null;
    return (
      <Card
        title={`Do uzupełnienia (${overdueAppts.length})`}
        className="span-2 dash-overdue"
      >
        <p className="muted small">
          Minione wizyty bez zapisanego treningu — zapisz trening (zejdzie z
          pakietu / doliczy się klubowi) albo oznacz odwołanie.
        </p>
        <ul className="rows">
          {overdueAppts.slice(0, 8).map((a) => {
            const c = clientById(db, a.clientId);
            return (
              <li key={a.id} className="row">
                <span className="row-time">
                  {fmtDay(a.date)} {a.time}
                </span>
                <button
                  className="link grow"
                  onClick={() => c && openClient(c.id)}
                >
                  {c?.name ?? "—"}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() =>
                    openModal({
                      kind: "session",
                      appt: a,
                      clientId: a.clientId,
                      date: a.date,
                    })
                  }
                >
                  Zapisz trening
                </button>
                <IconBtn
                  icon="cal"
                  label="Szczegóły wizyty"
                  onClick={() => openModal({ kind: "appt", appt: a })}
                />
              </li>
            );
          })}
        </ul>
      </Card>
    );
  })();

  const reviewCard = (() => {
    const q = reviewQueue(db.clients, db.sessions, today);
    if (!q.length) return null;
    const kinds = [...new Set(q.map((x) => x.kind))];
    return (
      <Card
        title={`Do przejrzenia (${q.length})`}
        className="dash-review"
        action={
          <button
            className="btn btn-primary btn-sm"
            onClick={() => openInbox(go, { tab: "Do przejrzenia" })}
          >
            Przejrzyj ›
          </button>
        }
      >
        <p className="small muted">
          Z ostatnich 7 dni:{" "}
          {kinds.map((k) => REVIEW_LABEL[k].toLowerCase()).join(", ")}.
        </p>
      </Card>
    );
  })();

  const alertsCard = (() => {
    // jedna pozycja na osobę (kilka sygnałów w jednej linii), czerwone najpierw
    const groups = [
      ...new Map(alerts.map((a) => [a.client.id, a.client])).values(),
    ]
      .map((client) => ({
        client,
        items: alerts.filter((a) => a.client.id === client.id),
      }))
      .sort(
        (a, b) =>
          Number(b.items.some((x) => x.level === "red")) -
          Number(a.items.some((x) => x.level === "red")),
      );
    return (
      <Card
        title={`Sygnały ostrzegawcze${groups.length ? ` (${groups.length})` : ""}`}
        className="dash-alerts"
      >
        {groups.length === 0 ? (
          <Empty>Wszystko w normie.</Empty>
        ) : (
          <ul className="rows">
            {(showAllAlerts ? groups : groups.slice(0, 5)).map(
              ({ client, items }) => (
                <li key={client.id} className="row row-top">
                  <Dot
                    tone={
                      items.some((a) => a.level === "red") ? "danger" : "warn"
                    }
                  />
                  <div className="grow">
                    <button
                      className="link"
                      onClick={() => openClient(client.id, "Monitoring")}
                    >
                      {client.name}
                    </button>
                    <div className="small muted ellipsis-2">
                      {items.map((a) => a.text).join(" · ")}
                    </div>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
        {groups.length > 5 && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowAllAlerts(!showAllAlerts)}
          >
            {showAllAlerts
              ? "Pokaż mniej"
              : `Pokaż wszystkie (${groups.length})`}
          </button>
        )}
      </Card>
    );
  })();

  /* ---- sekcje „Więcej” (telefon: zwijane) ---- */
  const secs: Sec[] = [];

  if (renew.length)
    secs.push({
      id: "renew",
      title: `Plany do odnowienia (${renew.length})`,
      className: "dash-renew",
      badge: renew.some((r) => r.ended)
        ? `${renew.filter((r) => r.ended).length} zakończ.`
        : `${renew.length}`,
      tone: renew.some((r) => r.ended) ? "warn" : undefined,
      body: (
        <>
          <ul className="rows">
            {(showAllRenew ? renew : renew.slice(0, 6)).map((r) => (
              <li key={r.client.id} className="row">
                <div className="grow row-main">
                  <button
                    className="link ellipsis"
                    onClick={() => openClient(r.client.id, "Plan")}
                  >
                    {r.client.name}
                  </button>
                  <span
                    className={`small ellipsis ${r.ended ? "dash-renew-ended" : "muted"}`}
                  >
                    {r.plan.name} ·{" "}
                    {r.ended
                      ? `zakończony ${dm(r.end)}`
                      : r.daysLeft === 0
                        ? "kończy się dziś"
                        : `do ${dm(r.end)} (za ${r.daysLeft} ${plural(r.daysLeft, "dzień", "dni", "dni")})`}
                  </span>
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => openClient(r.client.id, "Plan")}
                  title="Karta podopiecznego → Plan: przycisk „Następny blok”"
                >
                  Następny blok ›
                </button>
              </li>
            ))}
          </ul>
          {renew.length > 6 && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowAllRenew(!showAllRenew)}
            >
              {showAllRenew
                ? "Pokaż mniej"
                : `Pokaż wszystkie (${renew.length})`}
            </button>
          )}
        </>
      ),
    });

  {
    // raporty: liczone za poprzedni pełny tydzień (wymagany od poniedziałku); bieżący — osobno, jako „wcześniej”
    const rs = weekReports(db.clients, today);
    if (rs.expected.length || rs.unread.length || rs.earlyUnread.length)
      secs.push({
        id: "reports",
        title: `Raporty tygodnia: ${rs.sent.length} z ${rs.expected.length} przysłało`,
        className: "span-2 dash-reports",
        badge:
          rs.unread.length + rs.earlyUnread.length
            ? `${rs.unread.length + rs.earlyUnread.length} nowe`
            : rs.missing.length
              ? `brak: ${rs.missing.length}`
              : "",
        tone: rs.missing.length ? "warn" : undefined,
        body: (
          <>
            <p className="muted small">Tydzień {weekLabel(rs.week)}</p>
            {rs.unread.length > 0 && (
              <ul className="rows">
                {rs.unread.slice(0, 5).map(({ c, r }) => (
                  <li key={r.id} className="row">
                    <Tag tone="warn">nowy</Tag>
                    <button
                      className="link grow ellipsis"
                      onClick={() => openClient(c.id, "Przegląd")}
                    >
                      {c.name}
                    </button>
                    <span className="small muted nowrap">
                      {weekLabel(r.week)}
                      {r.weight != null
                        ? ` · ${String(r.weight).replace(".", ",")} kg`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {rs.missing.length > 0 && (
              <p className="small dash-missing">
                <span className="muted">Nie przysłali: </span>
                {rs.missing.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && ", "}
                    <button
                      className="link"
                      onClick={() => openClient(c.id, "Przegląd")}
                    >
                      {c.name}
                    </button>
                  </span>
                ))}
              </p>
            )}
            {rs.early.length > 0 && (
              <p className="small dash-early">
                <span className="muted">
                  Za bieżący tydzień ({weekLabel(rs.current)}) już
                  przysłali:{" "}
                </span>
                {rs.early.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && ", "}
                    <button
                      className="link"
                      onClick={() => openClient(c.id, "Przegląd")}
                    >
                      {c.name}
                    </button>
                    {rs.earlyUnread.some((x) => x.c.id === c.id) && (
                      <span className="dash-new-mark"> (nowy)</span>
                    )}
                  </span>
                ))}
              </p>
            )}
          </>
        ),
      });
  }

  const dueRow = (p: PaymentRow, late: boolean) => (
    <li key={p.id} className="row">
      <div className="grow">
        <button
          className="link"
          onClick={() => openClient(p.client.id, "Płatności")}
        >
          {p.client.name}
        </button>
        <div className={`small ${late ? "dash-due-late" : "muted"}`}>
          {paymentLabel(p)} ·{" "}
          {p.dueDate ? `termin ${fmtDate(p.dueDate)}` : "bez terminu"}
          {late && p.dueDate
            ? ` · ${daysBetween(p.dueDate, today)} ${plural(daysBetween(p.dueDate, today), "dzień", "dni", "dni")} po`
            : ""}
        </div>
      </div>
      <strong className="nowrap">{pln(p.amount)}</strong>
      <IconBtn
        icon="check"
        label="Oznacz opłacone"
        onClick={() => void markPaid({ apply, toast }, p.client, p.id, today)}
      />
    </li>
  );
  secs.push({
    id: "due",
    title: "Do zapłaty",
    className: "dash-due",
    badge: dues.overdue.length
      ? `${pln(dues.overdueSum)} po terminie`
      : dues.thisWeek.length
        ? pln(dues.thisWeekSum)
        : "",
    tone: dues.overdue.length ? "danger" : undefined,
    body:
      !dues.overdue.length && !dues.thisWeek.length && !dues.later.length ? (
        <Empty>Wszystko opłacone.</Empty>
      ) : (
        <>
          {dues.overdue.length > 0 && (
            <div className="dash-due-group dash-due-overdue">
              <h5 className="dash-due-h">
                Po terminie ({dues.overdue.length}){" "}
                <span className="nowrap">· {pln(dues.overdueSum)}</span>
              </h5>
              <ul className="rows">
                {dues.overdue.slice(0, 6).map((p) => dueRow(p, true))}
              </ul>
              {dues.overdue.length > 6 && (
                <p className="small muted">
                  i jeszcze {dues.overdue.length - 6}…
                </p>
              )}
            </div>
          )}
          <div className="dash-due-group">
            <h5 className="dash-due-h">
              Do zapłaty w tym tygodniu ({dues.thisWeek.length})
              {dues.thisWeek.length > 0 && (
                <span className="nowrap"> · {pln(dues.thisWeekSum)}</span>
              )}
            </h5>
            {dues.thisWeek.length ? (
              <ul className="rows">
                {dues.thisWeek.slice(0, 6).map((p) => dueRow(p, false))}
              </ul>
            ) : (
              <p className="small muted">Nic w tym tygodniu.</p>
            )}
          </div>
          {dues.later.length > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => go("Płatności")}
            >
              Później: {dues.later.length}{" "}
              {plural(dues.later.length, "płatność", "płatności", "płatności")}{" "}
              · {pln(dues.laterSum)} ›
            </button>
          )}
        </>
      ),
  });

  secs.push({
    id: "packages",
    title: "Kończące się pakiety",
    className: "dash-packages",
    badge: packages.length || "",
    tone: packages.some((x) => x.pk!.left <= 0)
      ? "danger"
      : packages.length
        ? "warn"
        : undefined,
    body:
      packages.length === 0 ? (
        <Empty>Brak.</Empty>
      ) : (
        <ul className="rows">
          {packages.map(({ c, pk }) => (
            <li key={c.id} className="row">
              <Avatar name={c.name} size={30} />
              <button
                className="link grow"
                onClick={() => openClient(c.id, "Płatności")}
              >
                {c.name}
              </button>
              <Tag tone={pk!.left <= 0 ? "danger" : "warn"}>
                {pk!.left < 0
                  ? `${-pk!.left} ponad pakiet`
                  : `zostało ${pk!.left}`}
              </Tag>
            </li>
          ))}
        </ul>
      ),
  });

  secs.push({
    id: "idle",
    title: "Bez treningu 10+ dni",
    className: "dash-idle",
    badge: idle.length || "",
    body:
      idle.length === 0 ? (
        <Empty>Wszyscy trenują regularnie.</Empty>
      ) : (
        <ul className="rows">
          {idle.map(({ c, last }) => (
            <li key={c.id} className="row">
              <Avatar name={c.name} size={30} />
              <button className="link grow" onClick={() => openClient(c.id)}>
                {c.name}
              </button>
              <span className="small muted">{ago(last)}</span>
            </li>
          ))}
        </ul>
      ),
  });

  if (clubs.length > 0) {
    const outs = clubs
      .map((c) => clubOutstanding(c, db.sessions, today).amount)
      .reduce((a, b) => a + b, 0);
    secs.push({
      id: "clubs",
      title: "Rozliczenia z klubami",
      className: "dash-clubs",
      badge: outs > 0 ? `do wypłaty ${pln(outs)}` : "",
      tone: outs > 0 ? "warn" : undefined,
      action: (
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => go("Płatności")}
        >
          Szczegóły
        </button>
      ),
      body: (
        <ul className="rows">
          {clubs.map((c) => {
            const out = clubOutstanding(c, db.sessions, today);
            const curList = clubSessions(db.sessions, c.id, today.slice(0, 7));
            const cur = curList.length;
            return (
              <li key={c.id} className="row row-top">
                <span className="loc-dot" style={locStyle(c)} />
                <div className="grow">
                  <strong>{c.name}</strong>
                  <div className="small muted">
                    w tym miesiącu {cur}{" "}
                    {plural(cur, "trening", "treningi", "treningów")} ·{" "}
                    {pln(clubAmount(c, curList))}
                  </div>
                </div>
                {out.amount > 0 ? (
                  <Tag tone="warn">do wypłaty {pln(out.amount)}</Tag>
                ) : (
                  <Tag tone="ok">rozliczone</Tag>
                )}
              </li>
            );
          })}
        </ul>
      ),
    });
  }

  secs.push({
    id: "recent",
    title: "Ostatnie treningi",
    className: "span-2 dash-recent",
    body:
      recent.length === 0 ? (
        <Empty>Brak zapisanych treningów.</Empty>
      ) : (
        <ul className="rows">
          {recent.map((s) => {
            const c = clientById(db, s.clientId);
            return (
              <li key={s.id} className="row">
                <span className="row-time">{fmtDay(s.date)}</span>
                <div className="grow">
                  <button
                    className="link"
                    onClick={() => c && openClient(c.id, "Treningi")}
                  >
                    {c?.name}
                  </button>
                  <div className="small muted">
                    {s.workoutName || "Trening"}
                  </div>
                </div>
                {s.srpe != null && s.duration != null && (
                  <span
                    className="small muted nowrap"
                    title="Obciążenie treningu = RPE × minuty (AU — jednostki umowne)"
                  >
                    {s.srpe * s.duration} AU
                  </span>
                )}
                <IconBtn
                  icon="edit"
                  label="Edytuj trening"
                  onClick={() => openModal({ kind: "session", session: s })}
                />
              </li>
            );
          })}
        </ul>
      ),
  });

  const card = (x: Sec | undefined) =>
    x ? (
      <Card
        key={x.id}
        title={x.title}
        className={x.className}
        action={x.action}
      >
        {x.body}
      </Card>
    ) : null;
  const byId = (id: string) => secs.find((x) => x.id === id);

  return (
    <div className={`page fade page-dash ${phone ? "dash-phone" : ""}`}>
      <div className="page-head">
        <div>
          <h2>Pulpit</h2>
          <p className="muted first-cap">{fmtLong(today)}</p>
        </div>
      </div>

      {phone ? (
        // telefon: Dziś → Sygnały → Wiadomości → Do przejrzenia, reszta pod „Więcej” (zwijana, stan zapamiętany)
        <div className="dash-stack">
          {todayCard}
          {alertsCard}
          {msgsCard}
          {reviewCard}
          {videosCard}
          {overdueApptsCard}
          <h3 className="dash-more-h">Więcej</h3>
          {secs.map((x) => (
            <Fold
              key={x.id}
              id={x.id}
              title={x.title}
              badge={x.badge}
              tone={x.tone}
              open={!!folds[x.id]}
              onToggle={toggleFold}
              className={x.className.replace("span-2", "")}
            >
              {x.action && <div className="dash-fold-action">{x.action}</div>}
              {x.body}
            </Fold>
          ))}
          {kpis}
        </div>
      ) : (
        <div className="dash-grid dash-split">
          <div className="dash-col dash-col-main">
            {todayCard}
            {kpis}
            {msgsCard}
            {card(byId("reports"))}
            {videosCard}
            {overdueApptsCard}
            {card(byId("recent"))}
          </div>
          <div className="dash-col dash-col-side">
            {reviewCard}
            {alertsCard}
            {card(byId("renew"))}
            {card(byId("due"))}
            {card(byId("clubs"))}
            {card(byId("packages"))}
            {card(byId("idle"))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Szybka odpowiedź z Pulpitu (bez wchodzenia w kartę podopiecznego) — oznacza jego wiadomości jako przeczytane. */
function QuickReply({ client }: { client: Client }) {
  const send = useSendMessage(client, true);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const first = client.name.split(" ")[0];
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const ok = await send(text, {
      okMessage: `Wysłano — ${first} zobaczy odpowiedź w aplikacji.`,
    });
    setBusy(false);
    if (ok) setText("");
  };
  return (
    <form
      className="quick-reply"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        className="input"
        value={text}
        maxLength={2000}
        placeholder={`Odpowiedz ${first}…`}
        aria-label={`Szybka odpowiedź dla ${client.name}`}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        className="btn btn-primary btn-sm"
        type="submit"
        disabled={!text.trim() || busy}
        aria-label="Wyślij odpowiedź"
      >
        <Icon name="up" size={16} /> <span className="hide-xs">Wyślij</span>
      </button>
    </form>
  );
}
