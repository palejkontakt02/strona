import type { Client, Plan, TrainingSession } from '../domain';
import { targetText, ZONES } from './running';
import { fmtWeekdayDate, planGrid } from './planGrid';
import { addDays, todayISO } from './dates';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** Liczba po polsku: przecinek dziesiętny, maks. 1 miejsce. */
const pl = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');
const lsiOf = (t: { lsi?: number }) => (t.lsi != null ? `${String(t.lsi).replace('.', ',')}%` : '');
const fmtD = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' });

const CSS = `
  *{box-sizing:border-box} html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font:11.5px/1.45 Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#141a24;margin:16mm 14mm;background:#fff}
  .num,h1,h2{font-family:'Barlow Condensed','Arial Narrow','Roboto Condensed',sans-serif}
  h1{font-size:30px;line-height:1.05;font-weight:600;margin:0 0 4px;letter-spacing:0}
  h2{font-size:19px;font-weight:600;margin:20px 0 6px;padding-bottom:3px;border-bottom:1.5px solid #141a24;letter-spacing:0}
  h3{font-size:13px;margin:12px 0 4px} .muted{color:#5b6475} .note{font-size:10.5px;color:#4a5263}
  table{border-collapse:collapse;width:100%;margin:4px 0 8px}
  th,td{border:1px solid #c9ced8;padding:4px 7px;text-align:left;vertical-align:top}
  th{background:#e8ecf4;font-weight:600;color:#141a24}
  .lbl{font-weight:700;width:34px} .box{border:1px solid #c9ced8;border-left:3px solid #141a24;padding:6px 10px;margin:8px 0;border-radius:2px}
  .done{display:inline-block;width:10px;height:10px;border:1.2px solid #3a4150;border-radius:2px;margin-right:5px;vertical-align:-1px}
  .doc-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;padding-bottom:8px;border-bottom:3px solid #141a24;margin-bottom:10px}
  .doc-brand{font-family:'Barlow Condensed','Arial Narrow',sans-serif;font-size:13px;font-weight:600;color:#5b6475;white-space:nowrap}
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

/**
 * Plan do druku — jak tabela w aplikacji: dla każdego treningu wiersz na serię, kolumny = tygodnie,
 * w komórce „powt. × ciężar @RPE” (ciężar, gdy wpisany) i kratka do odhaczenia; rozgrzewki szare.
 * Przy więcej niż 3 tygodniach strona pozioma.
 */
/** Bieg w planie: legenda stref z tętnem / tempem podopiecznego (na wydruku „Z2” samo nic nie mówi). */
function zoneLegend(slots: ReturnType<typeof planGrid>, client: Client): string {
  if (!slots.some((s) => s.rows.some((r) => r.cardio))) return '';
  const items = ZONES.map((z) => `<li><b>${esc(z.z)}</b> ${esc(targetText(z.z, client.run, client.dob))}</li>`).join('');
  return `<h2>Strefy</h2><ul class="note">${items}</ul>`;
}

export function printPlan(plan: Plan, client: Client, _sessions?: TrainingSession[]) {
  const slots = planGrid(plan, () => true);
  const wide = Math.max(0, ...slots.map((s) => s.cols.length)) > 3;
  const tables = slots
    .map((slot) => {
      if (!slot.rows.length) return `<h2>${esc(slot.name)}</h2><p class="muted">Brak ćwiczeń.</p>`;
      const run = slot.rows.every((r) => r.cardio);
      const head = `<thead><tr><th class="ex" rowspan="2">Ćwiczenie</th><th class="no" rowspan="2">Seria</th><th class="no" rowspan="2">Przerwa</th>${slot.cols.map((c) => `<th colspan="3" class="wk band">${esc(c.week.name)}${c.date ? `<span class="date">${esc(fmtWeekdayDate(c.date))}</span>` : ''}</th>`).join('')}</tr><tr>${slot.cols.map(() => (run ? '<th class="wk sub">Odcinek</th><th class="sub">Cel</th><th class="sub rpe">RPE</th>' : '<th class="wk sub">Powt.</th><th class="sub">Ciężar</th><th class="sub rpe">RPE</th>')).join('')}</tr></thead>`;
      let zebra = 0;
      const body = slot.rows
        .map((r) =>
          r.lines
            .map((line, i) => {
              const ex = i === 0 ? `<td class="ex" rowspan="${r.lines.length}"><span class="lab">${esc(r.label)}</span>${esc(r.name)}${r.loadPer ? `<div class="note">kg: ${esc(r.loadPer)}</div>` : ''}${r.notes ? `<div class="note">${esc(r.notes)}</div>` : ''}</td>` : '';
              const rest = i === 0 ? `<td class="no num rest" rowspan="${r.lines.length}">${esc(r.rest || '—')}</td>` : '';
              const cells = line.cells
                .map((c) =>
                  c === 'none'
                    ? '<td class="wk muted none" colspan="3">—</td>'
                    : c
                      ? `<td class="wk num reps ${c.warm ? 'warm' : ''}"><span class="done"></span>${esc(c.reps)}</td><td class="num load ${c.warm ? 'warm' : ''}">${esc(c.load)}</td><td class="num rpe ${c.warm ? 'warm' : ''}">${esc(c.rpe)}</td>`
                      : '<td class="wk"></td><td></td><td></td>',
                )
                .join('');
              const warm = line.no.startsWith('R');
              return `<tr class="${i === 0 ? 'first' : ''} ${zebra++ % 2 ? 'z' : ''} ${warm ? 'wline' : ''}">${ex}<td class="no num">${esc(line.no)}</td>${rest}${cells}</tr>`;
            })
            .join(''),
        )
        .join('');
      return `<section class="slot"><h2>${esc(slot.name)}</h2><table class="grid">${head}<tbody>${body}</tbody></table></section>`;
    })
    .join('') + zoneLegend(slots, client);
  openPrint(
    `${plan.name} — ${client.name}`,
    `<style>@page{size:A4 ${wide ? 'landscape' : 'portrait'};margin:0} body{margin:${wide ? '11mm 10mm' : '16mm 14mm'}}
      table.grid{font-size:11px;border:1.5px solid #141a24;margin-top:6px}
      table.grid td,table.grid th{padding:3px 6px;white-space:nowrap;border-color:#d3d8e1;vertical-align:middle}
      table.grid thead th{background:#e8ecf4;font-size:10px;font-weight:600;color:#3a4150;vertical-align:bottom}
      table.grid thead th.band{background:#d6e0f5;color:#0f1d3d;font-family:'Barlow Condensed','Arial Narrow',sans-serif;font-size:14.5px;line-height:1.1;text-align:center;padding:5px 6px 4px;border-bottom:1px solid #9aa6bd}
      table.grid thead th.sub{background:#eef2fa;font-weight:500;color:#3a4150;text-align:center;font-size:9.5px;padding:2px 4px;border-bottom:1.5px solid #141a24}
      table.grid thead th.ex,table.grid thead th.no{border-bottom:1.5px solid #141a24}
      .date{display:block;font-family:Inter,system-ui,sans-serif;font-size:9px;font-weight:500;color:#3a4a6b;margin-top:1px}
      table.grid td.ex{white-space:normal;min-width:120px;max-width:210px;font-weight:600;vertical-align:top;padding-top:5px;background:#fff;border-right:1px solid #9aa6bd}
      table.grid .lab{display:inline-block;min-width:18px;padding:0 3px;margin-right:5px;border:1px solid #3a4150;border-radius:3px;font-size:9.5px;text-align:center;font-weight:700;line-height:13px}
      table.grid .note{font-weight:400;margin-top:1px}
      table.grid .num{font-family:'Barlow Condensed','Arial Narrow',sans-serif;font-size:13.5px;font-weight:500;font-variant-numeric:tabular-nums}
      table.grid .no{text-align:center;color:#5b6475;width:1%} table.grid td.rest{vertical-align:top;padding-top:5px}
      table.grid .wk{border-left:1.5px solid #141a24} table.grid td.reps{text-align:left} table.grid td.load{text-align:right;min-width:42px} table.grid td.rpe,table.grid th.rpe{text-align:center;width:1%}
      table.grid tr.z td:not(.ex):not(.rest){background:#f4f6fa}
      table.grid tr.first td{border-top:1.2px solid #6b7486} table.grid tbody tr:first-child td{border-top:0}
      table.grid tr:not(.first) td{border-top-color:#e3e7ee}
      table.grid .warm{color:#7b8292;font-style:italic} table.grid .warm .done{border-color:#9aa1ae}
      table.grid td.none{text-align:center;color:#9aa1ae}
      h2{break-after:avoid} .slot{break-inside:auto} table.grid{break-inside:auto} table.grid tr{break-inside:avoid} thead{display:table-header-group}
      .legend{font-size:10.5px;color:#4a5263;margin:2px 0 4px} ul.note{margin:4px 0;padding-left:18px;columns:2;column-gap:24px} ul.note li{margin:1px 0}</style>
    <div class="doc-head"><div><h1>${esc(plan.name)}</h1><div class="muted">${esc(client.name)}${plan.startDate ? ` · start ${fmtD(plan.startDate)}` : ''} · ${plan.weeks.length} tyg.</div></div><div class="doc-brand">wydruk ${fmtD(todayISO())}</div></div>${plan.notes ? `<div class="box">${esc(plan.notes)}</div>` : ''}
    <p class="legend">Każdy tydzień: powtórzenia (lub czas) · ciężar · RPE dla każdej serii · R = rozgrzewka · kratka do odhaczenia</p>${tables}`,
  );
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
