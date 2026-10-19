import type { Client, Plan, TrainingSession } from '../domain';
import { planGrid } from './planGrid';
import { addDays, todayISO } from './dates';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** Liczba po polsku: przecinek dziesiętny, maks. 1 miejsce. */
const pl = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');
const lsiOf = (t: { lsi?: number }) => (t.lsi != null ? `${String(t.lsi).replace('.', ',')}%` : '');
const fmtD = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' });

const CSS = `
  *{box-sizing:border-box} body{font:12px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:18mm 14mm}
  h1{font-size:20px;margin:0 0 2px} h2{font-size:15px;margin:18px 0 6px;border-bottom:2px solid #111;padding-bottom:2px}
  h3{font-size:13px;margin:12px 0 4px} .muted{color:#666} table{border-collapse:collapse;width:100%;margin:4px 0 8px}
  th,td{border:1px solid #bbb;padding:3px 6px;text-align:left;vertical-align:top} th{background:#f0f0f0;font-weight:600}
  .lbl{font-weight:700;width:34px} .note{font-size:11px;color:#444} .box{border:1px solid #bbb;padding:6px 8px;margin:6px 0}
  .done{display:inline-block;width:12px;height:12px;border:1px solid #333;margin-right:4px;vertical-align:-2px}
  @page{size:A4;margin:0} @media print{.noprint{display:none}}
`;

/** Otwiera stronę do druku / zapisu PDF (systemowe „Drukuj → Zapisz jako PDF”). */
function openPrint(title: string, body: string) {
  const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}
    <p class="noprint muted" style="margin-top:20px">Drukuj albo zapisz jako PDF (Udostępnij → Drukuj → rozsuń podgląd, by zapisać PDF na iPhonie).</p>
    <script>setTimeout(function(){window.print()},300)</script></body></html>`;
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
export function printPlan(plan: Plan, client: Client, _sessions?: TrainingSession[]) {
  const slots = planGrid(plan, () => true);
  const wide = Math.max(0, ...slots.map((s) => s.cols.length)) > 3;
  const tables = slots
    .map((slot) => {
      if (!slot.rows.length) return `<h2>${esc(slot.name)}</h2><p class="muted">Brak ćwiczeń.</p>`;
      const head = `<tr><th rowspan="2">Ćwiczenie</th><th class="no" rowspan="2">Seria</th><th class="no" rowspan="2">Przerwa</th>${slot.cols.map((c) => `<th colspan="3" class="wk">${esc(c.week.name)}</th>`).join('')}</tr><tr>${slot.cols.map(() => '<th class="wk sub">Powt.</th><th class="sub">Ciężar</th><th class="sub no">RPE</th>').join('')}</tr>`;
      const body = slot.rows
        .map((r) =>
          r.lines
            .map((line, i) => {
              const ex = i === 0 ? `<td class="ex" rowspan="${r.lines.length}"><b>${esc(r.label)}</b> ${esc(r.name)}${r.notes ? `<div class="note">${esc(r.notes)}</div>` : ''}</td>` : '';
              const rest = i === 0 ? `<td class="no" rowspan="${r.lines.length}">${esc(r.rest || '—')}</td>` : '';
              const cells = line.cells
                .map((c) =>
                  c === 'none'
                    ? '<td class="wk muted" colspan="3">—</td>'
                    : c
                      ? `<td class="wk ${c.warm ? 'warm' : ''}"><span class="done"></span>${esc(c.reps)}</td><td class="${c.warm ? 'warm' : ''}">${esc(c.load)}</td><td class="no ${c.warm ? 'warm' : ''}">${esc(c.rpe)}</td>`
                      : '<td class="wk"></td><td></td><td></td>',
                )
                .join('');
              return `<tr class="${i === 0 ? 'first' : ''}">${ex}<td class="no">${esc(line.no)}</td>${rest}${cells}</tr>`;
            })
            .join(''),
        )
        .join('');
      return `<h2>${esc(slot.name)}</h2><table class="grid">${head}${body}</table>`;
    })
    .join('');
  openPrint(
    `${plan.name} — ${client.name}`,
    `<style>@page{size:A4 ${wide ? 'landscape' : 'portrait'};margin:0} body{margin:${wide ? '12mm 10mm' : '18mm 14mm'}}
      table.grid{font-size:11px} table.grid td,table.grid th{padding:3px 5px;white-space:nowrap} table.grid td.ex{white-space:normal;min-width:120px;max-width:200px}
      table.grid .no{text-align:center;color:#555;width:1%} table.grid .wk{border-left:2px solid #777} table.grid .sub{font-size:9px;font-weight:600} table.grid tr.first td{border-top:2px solid #777} table.grid .warm{color:#888}
      h2{break-after:avoid} table.grid{break-inside:auto} table.grid tr{break-inside:avoid}</style>
    <h1>${esc(plan.name)}</h1><div class="muted">${esc(client.name)}${plan.startDate ? ` · start ${fmtD(plan.startDate)}` : ''} · wydruk ${fmtD(todayISO())}</div>${plan.notes ? `<div class="box">${esc(plan.notes)}</div>` : ''}
    <p class="note">Każdy tydzień: powtórzenia (lub czas) · ciężar · RPE dla każdej serii · R = rozgrzewka · kratka do odhaczenia</p>${tables}`,
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
