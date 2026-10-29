import type { Client, Plan, TrainingSession } from '../domain';
import { targetText, ZONES } from './running';
import { fmtWeekdayDate, planGrid, type GridCell } from './planGrid';
import { cardioByName, loadPerOf } from './run';
import { currentMax, resolveLoad, rounderFor } from './strength';
import { nextDate, nextWorkout } from './plan';
import { addDays, todayISO } from './dates';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** Liczba po polsku: przecinek dziesiętny, maks. 1 miejsce. */
const pl = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');
const lsiOf = (t: { lsi?: number }) => (t.lsi != null ? `${String(t.lsi).replace('.', ',')}%` : '');
const fmtD = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' });

/* czarno-biało: tylko czerń, biel i odcienie szarości (przezroczystość czerni), bez wpisanych kolorów */
const CSS = `
  *{box-sizing:border-box} html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font:11.5px/1.45 Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:black;margin:16mm 14mm;background:white}
  .num,h1,h2{font-family:'Barlow Condensed','Arial Narrow','Roboto Condensed',sans-serif}
  h1{font-size:30px;line-height:1.05;font-weight:600;margin:0 0 4px;letter-spacing:0}
  h2{font-size:19px;font-weight:600;margin:20px 0 6px;padding-bottom:3px;border-bottom:1.5px solid black;letter-spacing:0}
  h3{font-size:13px;margin:12px 0 4px} .muted{color:rgb(0 0 0 / 60%)} .note{font-size:10.5px;color:rgb(0 0 0 / 68%)}
  table{border-collapse:collapse;width:100%;margin:4px 0 8px}
  th,td{border:1px solid rgb(0 0 0 / 22%);padding:4px 7px;text-align:left;vertical-align:top}
  th{background:rgb(0 0 0 / 7%);font-weight:600;color:black}
  .lbl{font-weight:700;width:34px} .box{border:1px solid rgb(0 0 0 / 22%);border-left:3px solid black;padding:6px 10px;margin:8px 0;border-radius:2px}
  .done{display:inline-block;width:10px;height:10px;border:1.2px solid rgb(0 0 0 / 75%);border-radius:2px;margin-right:5px;vertical-align:-1px}
  .doc-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;padding-bottom:8px;border-bottom:3px solid black;margin-bottom:10px}
  .doc-brand{font-family:'Barlow Condensed','Arial Narrow',sans-serif;font-size:13px;font-weight:600;color:rgb(0 0 0 / 60%);white-space:nowrap}
  @page{size:A4;margin:0} @media print{.noprint{display:none}}
`;

/** Otwiera stronę do druku / zapisu PDF (systemowe „Drukuj → Zapisz jako PDF”). */
function openPrint(title: string, body: string) {
  const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${esc(title)}</title><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap"><style>${CSS}</style></head><body>${body}
    <p class="noprint muted" style="margin-top:20px">Drukuj albo zapisz jako PDF (Udostępnij → Drukuj → rozsuń podgląd, by zapisać PDF na iPhonie).</p>
    <script>(document.fonts&&document.fonts.ready?Promise.race([document.fonts.ready,new Promise(function(r){setTimeout(r,1500)})]):Promise.resolve()).then(function(){setTimeout(function(){window.print()},200)})</script></body></html>`;
  const w = window.open('', '_blank');
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
    return;
  }
  // zablokowane okno (np. aplikacja z ekranu głównego) — druk przez ukrytą ramkę
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.appendChild(f);
  f.contentDocument!.open();
  f.contentDocument!.write(html.replace(/<script>.*<\/script>/s, ''));
  f.contentDocument!.close();
  setTimeout(() => {
    f.contentWindow?.print();
    setTimeout(() => f.remove(), 2000);
  }, 300);
}

/** Bieg w planie: legenda stref z tętnem / tempem podopiecznego (na wydruku „Z2” samo nic nie mówi). */
function zoneLegend(slots: ReturnType<typeof planGrid>, client: Client): string {
  if (!slots.some((s) => s.rows.some((r) => r.cardio))) return '';
  const items = ZONES.map((z) => `<li><b>${esc(z.z)}</b> ${esc(targetText(z.z, client.run, client.dob))}</li>`).join('');
  return `<h2>Strefy</h2><ul class="note">${items}</ul>`;
}

/** „75%” / „-10%” → „75% ≈105 kg” z maksa podopiecznego (test 1RM albo e1RM z treningów); bez maksa — bez zmian. */
function withKg(plan: Plan, client: Client, sessions: TrainingSession[]): Plan {
  const out = structuredClone(plan);
  for (const w of out.weeks)
    for (const k of w.workouts)
      for (const e of k.exercises) {
        if (e.cardio ?? cardioByName(e.name)) continue;
        if (!e.groups.some((g) => /%/.test(g.load))) continue;
        const mx = currentMax(sessions, client.tests ?? [], e.name.trim());
        const round = rounderFor(e.name, loadPerOf(e));
        let prev: number | null = null;
        for (const g of e.groups) {
          const r = resolveLoad(g.load, mx?.value ?? null, g.reps, g.rpe, prev, { round });
          if (r.load != null) prev = r.load;
          if (r.load != null && /%/.test(g.load)) g.load = `${g.load.trim()} ≈${pl(r.load)} kg`;
        }
      }
  return out;
}

const GRID_CSS = (wide: boolean) => `<style>@page{size:A4 ${wide ? 'landscape' : 'portrait'};margin:0} body{margin:${wide ? '11mm 10mm' : '16mm 14mm'}}
      table.grid{font-size:11px;border:1.5px solid black;margin-top:6px}
      table.grid td,table.grid th{padding:3px 6px;white-space:nowrap;border-color:rgb(0 0 0 / 18%);vertical-align:middle}
      table.grid thead th{background:white;font-size:10px;font-weight:600;color:rgb(0 0 0 / 75%);vertical-align:bottom}
      table.grid thead th.band{background:black;color:white;font-family:'Barlow Condensed','Arial Narrow',sans-serif;font-size:14.5px;line-height:1.1;text-align:center;padding:5px 6px 4px;border-bottom:1px solid black}
      table.grid thead th.sub{background:rgb(0 0 0 / 8%);font-weight:500;color:rgb(0 0 0 / 75%);text-align:center;font-size:9.5px;padding:2px 4px;border-bottom:1.5px solid black}
      table.grid thead th.ex,table.grid thead th.no{border-bottom:1.5px solid black}
      .date{display:block;font-family:Inter,system-ui,sans-serif;font-size:9px;font-weight:500;opacity:.8;margin-top:1px}
      table.grid td.ex{white-space:normal;min-width:120px;max-width:210px;font-weight:600;vertical-align:top;padding-top:5px;background:white;border-right:1px solid rgb(0 0 0 / 40%)}
      table.grid .lab{display:inline-block;min-width:18px;padding:0 3px;margin-right:5px;border:1px solid rgb(0 0 0 / 75%);border-radius:3px;font-size:9.5px;text-align:center;font-weight:700;line-height:13px}
      table.grid .note{font-weight:400;margin-top:1px}
      table.grid .num{font-family:'Barlow Condensed','Arial Narrow',sans-serif;font-size:13.5px;font-weight:500;font-variant-numeric:tabular-nums}
      table.grid .no{text-align:center;color:rgb(0 0 0 / 60%);width:1%} table.grid td.rest{vertical-align:top;padding-top:5px}
      table.grid .wk{border-left:1.5px solid black} table.grid td.reps{text-align:left} table.grid td.load{text-align:right;min-width:42px} table.grid td.rpe,table.grid th.rpe{text-align:center;width:1%}
      table.grid tr.z td:not(.ex):not(.rest){background:rgb(0 0 0 / 4%)}
      table.grid tr.first td{border-top:1.2px solid rgb(0 0 0 / 55%)} table.grid tbody tr:first-child td{border-top:0}
      table.grid tr:not(.first) td{border-top-color:rgb(0 0 0 / 10%)}
      table.grid .warm{color:rgb(0 0 0 / 55%);font-style:italic} table.grid .warm .done{border-color:rgb(0 0 0 / 40%)}
      table.grid td.none{text-align:center;color:rgb(0 0 0 / 40%)}
      table.grid td.dl{background:rgb(0 0 0 / 6%)} table.grid th.band.dl{background:rgb(0 0 0 / 60%)}
      table.grid th.didit{min-width:150px} table.grid td.didit{min-width:150px;border-left:1.5px solid black}
      h2{break-after:avoid} .slot{break-inside:auto} table.grid{break-inside:auto} table.grid tr{break-inside:avoid} thead{display:table-header-group}
      .legend{font-size:10.5px;color:rgb(0 0 0 / 68%);margin:2px 0 4px} ul.note{margin:4px 0;padding-left:18px;columns:2;column-gap:24px} ul.note li{margin:1px 0}</style>`;

/** Przerwa jako m:ss („90” → „1:30”). */
const restText = (r: string | undefined) => {
  const t = String(r ?? '').trim();
  const m = t.match(/^(\d+(?:[.,]\d+)?)$/);
  if (!m) return t;
  const v = parseFloat(m[1].replace(',', '.'));
  const sec = Math.round(v <= 5 ? v * 60 : v);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};
const RUN_NO: Record<string, string> = { R: 'Rozgrz.', S: 'Schł.', trucht: 'trucht' };

/** Tabele planu (slot = trening A, B…; kolumny = tygodnie). `didit` — pusta kolumna „Zrobiono” do wpisania wykonania. */
function gridTables(slots: ReturnType<typeof planGrid>, opts: { didit?: boolean; dateOf?: (id: string) => string | undefined } = {}): string {
  return slots
    .map((slot) => {
      if (!slot.rows.length) return `<h2>${esc(slot.name)}</h2><p class="muted">Brak ćwiczeń.</p>`;
      const run = slot.rows.every((r) => r.cardio);
      const dl = (name: string) => (/deload/i.test(name) ? ' dl' : '');
      const head = `<thead><tr><th class="ex" rowspan="2">Ćwiczenie</th><th class="no" rowspan="2">Seria</th><th class="no" rowspan="2">Przerwa</th>${slot.cols
        .map((c) => {
          const d = opts.dateOf?.(c.k.id) ?? c.date;
          return `<th colspan="3" class="wk band${dl(c.week.name)}">${esc(opts.didit ? `${slot.name} · ${c.week.name}` : c.week.name)}${d ? `<span class="date">${esc(fmtWeekdayDate(d))}</span>` : ''}</th>`;
        })
        .join('')}${opts.didit ? '<th class="didit band" rowspan="2">Zrobiono</th>' : ''}</tr><tr>${slot.cols.map(() => (run ? '<th class="wk sub">Odcinek</th><th class="sub">Cel</th><th class="sub rpe">RPE</th>' : '<th class="wk sub">Powt.</th><th class="sub">Ciężar</th><th class="sub rpe">RPE</th>')).join('')}</tr></thead>`;
      let zebra = 0;
      const body = slot.rows
        .map((r) =>
          r.lines
            .map((line, i) => {
              const ex = i === 0 ? `<td class="ex" rowspan="${r.lines.length}"><span class="lab">${esc(r.label)}</span>${esc(r.name)}${r.loadPer ? `<div class="note">kg: ${esc(r.loadPer)}</div>` : ''}${r.notes ? `<div class="note">${esc(r.notes)}</div>` : ''}</td>` : '';
              const rest = i === 0 ? `<td class="no num rest" rowspan="${r.lines.length}">${esc(restText(r.rest) || '—')}</td>` : '';
              const first = line.cells.find((c) => c && c !== 'none') as (GridCell & { no?: string }) | undefined;
              const no = r.cardio && first?.no ? (RUN_NO[first.no] ?? first.no) : line.no;
              const cells = line.cells
                .map((c, ci) => {
                  const d = dl(slot.cols[ci].week.name);
                  if (c === 'none') return `<td class="wk muted none${d}" colspan="3">—</td>`;
                  if (!c) return `<td class="wk${d}"></td><td class="${d}"></td><td class="${d}"></td>`;
                  const cn = (c as GridCell & { no?: string }).no;
                  const reps = r.cardio && cn && RUN_NO[cn] ? c.reps.replace(new RegExp(`^${cn} `), '') : c.reps;
                  return `<td class="wk num reps ${c.warm ? 'warm' : ''}${d}"><span class="done"></span>${esc(reps)}</td><td class="num load ${c.warm ? 'warm' : ''}${d}">${esc(c.load)}</td><td class="num rpe ${c.warm ? 'warm' : ''}${d}">${esc(c.rpe)}</td>`;
                })
                .join('');
              const warm = line.no.startsWith('R') || (r.cardio && !!first?.warm);
              return `<tr class="${i === 0 ? 'first' : ''} ${zebra++ % 2 ? 'z' : ''} ${warm ? 'wline' : ''}">${ex}<td class="no num">${esc(no)}</td>${rest}${cells}${opts.didit ? '<td class="didit"></td>' : ''}</tr>`;
            })
            .join(''),
        )
        .join('');
      return `<section class="slot">${opts.didit ? '' : `<h2>${esc(slot.name)}</h2>`}<table class="grid">${head}<tbody>${body}</tbody></table></section>`;
    })
    .join('');
}

/**
 * Plan do druku — jak tabela w aplikacji: dla każdego treningu wiersz na serię, kolumny = tygodnie,
 * w komórce powtórzenia · ciężar (przy % także ≈ kg) · RPE i kratka do odhaczenia; rozgrzewki szare.
 * Przy więcej niż 3 tygodniach strona pozioma. `nextWeek` — tylko tydzień następnej jednostki, z pustą kolumną „Zrobiono”.
 */
export function printPlan(plan: Plan, client: Client, sessions: TrainingSession[] = [], opts: { nextWeek?: boolean } = {}) {
  const p = withKg(plan, client, sessions);
  const head = (sub: string) =>
    `<div class="doc-head"><div><h1>${esc(plan.name)}</h1><div class="muted">${esc(client.name)}${sub}</div></div><div class="doc-brand">wydruk ${fmtD(todayISO())}</div></div>${plan.notes ? `<div class="box">${esc(plan.notes)}</div>` : ''}`;
  const legend = '<p class="legend">Każdy tydzień: powtórzenia (lub czas) · ciężar (przy % ≈ kg z maksa) · RPE dla każdej serii · R = rozgrzewka · kratka do odhaczenia</p>';
  if (opts.nextWeek) {
    const nx = nextWorkout(plan, sessions);
    const wi = nx ? plan.weeks.findIndex((w) => w.id === nx.week.id) : 0;
    const week = p.weeks[Math.max(0, wi)];
    if (week) {
      const one: Plan = { ...p, weeks: [week] };
      const slots = planGrid(one, () => true);
      const today = todayISO();
      // realne daty jednostek tego tygodnia (plan cykliczny — daty z planu mogą być przeszłe)
      const dateOf = (id: string) => {
        const k = week.workouts.find((x) => x.id === id);
        return k ? nextDate(plan, { week: plan.weeks[Math.max(0, wi)], workout: k }, today) : undefined;
      };
      openPrint(`${plan.name} — ${week.name} — ${client.name}`, `${GRID_CSS(false)}${head(` · ${week.name}`)}${legend}<p class="legend">Kolumna „Zrobiono”: wpisz wykonane ciężary / powtórzenia, uwagi, ból.</p>${gridTables(slots, { didit: true, dateOf })}${zoneLegend(slots, client)}`);
      return;
    }
  }
  const slots = planGrid(p, () => true);
  const wide = Math.max(0, ...slots.map((s) => s.cols.length)) > 3;
  openPrint(`${plan.name} — ${client.name}`, `${GRID_CSS(wide)}${head(`${plan.startDate ? ` · start ${fmtD(plan.startDate)}` : ''} · ${plan.weeks.length} tyg.`)}${legend}${gridTables(slots)}${zoneLegend(slots, client)}`);
}

/**
 * Raport z treningów dla lekarza / fizjoterapeuty: testy z LSI, regularność, ból i samopoczucie,
 * ostatnie treningi. To raport treningowy, nie dokument medyczny.
 */
export function printReport(client: Client, sessions: TrainingSession[], opts: { plan?: Plan | null; comment?: string; weeks?: number } = {}) {
  const weeks = opts.weeks ?? 8;
  const from = addDays(todayISO(), -weeks * 7);
  const recent = sessions.filter((s) => s.date >= from).sort((a, b) => a.date.localeCompare(b.date));
  // średnia z faktycznego okresu (krótsza współpraca niż 8 tyg. → mniej tygodni)
  const firstDate = recent[0]?.date ?? from;
  const spanW = Math.max(1, Math.min(weeks, (Date.now() - new Date(`${firstDate}T12:00:00`).getTime()) / (7 * 864e5)));
  const pains = recent.filter((s) => s.pain != null);
  const tests = [...client.tests].sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date));
  const inj = client.injuryLog.filter((i) => i.status !== 'wyleczony');
  const body = `
    <h1>Raport z treningów</h1>
    <div class="muted">${esc(client.name)} · okres ${fmtD(recent.length ? firstDate : from)} – ${fmtD(todayISO())}</div>
    <div class="box note">Raport treningowy przygotowany przez trenera — nie jest dokumentacją medyczną ani diagnozą.</div>
    ${client.goal ? `<p><b>Cel:</b> ${esc(client.goal)}</p>` : ''}
    ${inj.length ? `<p><b>Urazy / stany:</b> ${inj.map((i) => `${esc(i.name)}${i.side ? ` (${esc(i.side)})` : ''} — ${esc(i.status)} od ${fmtD(i.date)}`).join('; ')}</p>` : ''}
    ${opts.plan ? `<p><b>Aktualny plan:</b> ${esc(opts.plan.name)} (${opts.plan.weeks.length} tyg.)</p>` : ''}
    <h2>Regularność</h2>
    <p>${recent.length} treningów w ${pl(spanW)} tyg. (średnio ${pl(recent.length / spanW)} / tydz.)</p>
    <h2>Ból i odczucia po treningu</h2>
    ${pains.length ? `<table><tr><th>Data</th><th>Trening</th><th>Ból 0–10</th><th>Wysiłek 0–10</th><th>Uwagi</th></tr>${pains.map((s) => `<tr><td>${fmtD(s.date)}</td><td>${esc(s.workoutName || 'Trening')}</td><td>${esc(s.pain)}</td><td>${esc(s.srpe ?? '')}</td><td>${esc(s.notes || '')}</td></tr>`).join('')}</table>` : '<p class="muted">Brak zapisów bólu w tym okresie.</p>'}
    <h2>Testy</h2>
    ${tests.length ? `<table><tr><th>Test</th><th>Data</th><th>Wynik</th><th>LSI</th></tr>${tests.map((t) => `<tr><td>${esc(t.name)}</td><td>${fmtD(t.date)}</td><td>${t.left != null && t.right != null ? `L ${pl(t.left)} / P ${pl(t.right)}` : typeof t.value === 'number' ? pl(t.value) : esc(t.value ?? '')} ${esc(t.unit || '')}</td><td>${lsiOf(t)}</td></tr>`).join('')}</table>` : '<p class="muted">Brak testów.</p>'}
    <h2>Ostatnie treningi</h2>
    <table><tr><th>Data</th><th>Trening</th><th>Ćwiczenia</th></tr>${recent
      .slice(-10)
      .reverse()
      .map((s) => `<tr><td>${fmtD(s.date)}</td><td>${esc(s.workoutName || 'Trening')}${(s.solo ?? s.charge === 'brak') ? ' <span class="muted">(samodzielnie)</span>' : ''}</td><td>${s.exercises.map((e) => esc(e.name)).join(', ')}</td></tr>`)
      .join('')}</table>
    ${opts.comment ? `<h2>Komentarz trenera</h2><div class="box">${esc(opts.comment)}</div>` : ''}
    <p class="muted" style="margin-top:24px">Trener: ____________________</p>`;
  openPrint(`Raport — ${client.name}`, body);
}
