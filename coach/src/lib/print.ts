import type { Client, Plan, TrainingSession } from '../domain';
import { exerciseLabels } from './plan';
import { buildRunExercise } from './run';
import { addDays, todayISO } from './dates';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const kg = (v: string) => (v ? `${v.replace('.', ',')} kg` : '');
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

/** Plan do druku: tygodnie, jednostki, każda seria z ciężarem wyliczonym z historii / testu (jak w treningu). */
export function printPlan(plan: Plan, client: Client, sessions: TrainingSession[]) {
  const parts = plan.weeks.map((w) => {
    const wos = w.workouts
      .map((k) => {
        const labels = exerciseLabels(k.exercises);
        const rows = k.exercises
          .map((e, ei) => {
            if (!e.name) return '';
            const run = buildRunExercise(e, sessions, undefined, client.tests);
            // bieg / cardio: bloki odcinków („Rozgrzewka 15 min · Z2”, „6 × 800 m · Z5”)
            const sets = run.cardio
              ? run.sets.filter((x) => x.first).map((x) => `<span class="done"></span>${esc(x.gdesc)}${x.rest ? ` · przerwa ${esc(x.rest)}` : ''}`).join('<br>')
              : run.sets
              .map((x) => `<span class="done"></span>${x.warmup ? 'R: ' : ''}${esc(x.reps || '?')}${x.unit ? ` ${x.unit}` : ''}${run.perSide ? '/str.' : ''}${x.load ? ` × ${esc(kg(x.load))}` : ''}${x.tRpe ? ` @${esc(x.tRpe)}` : ''}`)
              .join('&nbsp;&nbsp; ');
            return `<tr><td class="lbl">${esc(labels[ei])}</td><td><b>${esc(e.name)}</b>${e.notes ? `<div class="note">${esc(e.notes)}</div>` : ''}</td><td>${sets}</td><td>${esc(e.rest || '')}</td></tr>`;
          })
          .join('');
        return `<h3>${esc(k.name)}</h3><table><tr><th></th><th>Ćwiczenie</th><th>Serie (powt. × kg @RPE)</th><th>Przerwa</th></tr>${rows}</table>`;
      })
      .join('');
    return `<h2>${esc(w.name)}</h2>${wos}`;
  });
  openPrint(
    `${plan.name} — ${client.name}`,
    `<h1>${esc(plan.name)}</h1><div class="muted">${esc(client.name)}${plan.startDate ? ` · start ${fmtD(plan.startDate)}` : ''} · wydruk ${fmtD(todayISO())}</div>${plan.notes ? `<div class="box">${esc(plan.notes)}</div>` : ''}${parts.join('')}`,
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
