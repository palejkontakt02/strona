import { useState } from 'react';
import { Card, Empty, Icon, Kpi } from '../../components/ui';
import { paymentLabel } from '../../data/ops';
import { useStore } from '../../data/store';
import { fmtMonth, plural, pln } from '../../format';
import { shiftMonth } from '../../lib/billing';
import { todayISO } from '../../lib/dates';
import { csvFileName, exportRows, monthReport, toCsv, type Bucket } from '../../lib/paymentsReport';

function downloadCsv(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Buckets({ list, total }: { list: Bucket[]; total: number }) {
  if (!list.length) return <p className="muted small">Brak wpłat.</p>;
  return (
    <ul className="pay-rep-list">
      {list.map((b) => (
        <li key={b.key}>
          <span className="pay-rep-row">
            <span className="grow">{b.label}</span>
            <span className="muted small tnum">{b.count}×</span>
            <strong className="tnum">{pln(b.amount)}</strong>
          </span>
          <span className="pay-rep-bar" aria-hidden="true">
            <span style={{ width: `${total ? Math.max(2, (b.amount / total) * 100) : 0}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function PaymentsReport() {
  const { db, toast } = useStore();
  const today = todayISO();
  const [month, setMonth] = useState(today.slice(0, 7));
  const input = { clients: db.clients, sessions: db.sessions, locations: db.locations, appointments: db.appointments };
  const r = monthReport(input, month, paymentLabel);
  const isFuture = month > today.slice(0, 7);
  const diffTxt =
    r.prevTotal || r.total
      ? `${r.diff >= 0 ? '+' : '−'}${pln(Math.abs(r.diff))}${r.diffPct != null ? ` (${r.diff >= 0 ? '+' : '−'}${Math.abs(r.diffPct).toLocaleString('pl-PL')}%)` : ''} vs ${fmtMonth(r.prevMonth).split(' ')[0]}`
      : undefined;

  return (
    <div className="pay-report">
      <div className="pay-rep-head">
        <div className="pay-rep-month" role="group" aria-label="Miesiąc raportu">
          <button type="button" className="icon-btn" aria-label="Poprzedni miesiąc" onClick={() => setMonth(shiftMonth(month, -1))}>
            <Icon name="chevL" />
          </button>
          <strong className="pay-rep-title">{fmtMonth(month)}</strong>
          <button type="button" className="icon-btn" aria-label="Następny miesiąc" onClick={() => setMonth(shiftMonth(month, 1))} disabled={isFuture}>
            <Icon name="chevR" />
          </button>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            const rows = exportRows(input, month, paymentLabel);
            if (!rows.length) return toast(`Brak płatności w miesiącu: ${fmtMonth(month)}.`);
            downloadCsv(csvFileName(month), toCsv(rows));
            toast(`Pobrano CSV: ${rows.length} ${plural(rows.length, 'pozycja', 'pozycje', 'pozycji')}.`);
          }}
        >
          <Icon name="download" size={16} /> Eksport CSV
        </button>
      </div>

      <div className="kpi-grid kpi-strip">
        <Kpi label="Wpłaty razem" value={pln(r.total)} sub={diffTxt ?? `${r.count} ${plural(r.count, 'wpłata', 'wpłaty', 'wpłat')}`} />
        <Kpi label="Poprzedni miesiąc" value={pln(r.prevTotal)} sub={fmtMonth(r.prevMonth)} />
        <Kpi
          label="Zaległości na koniec miesiąca"
          value={pln(r.arrears.amount)}
          tone={r.arrears.amount ? 'danger' : undefined}
          sub={r.arrears.count ? `${r.arrears.count} ${plural(r.arrears.count, 'pozycja', 'pozycje', 'pozycji')} · ${r.arrears.clients} ${plural(r.arrears.clients, 'osoba', 'osoby', 'osób')}` : 'brak'}
        />
        <Kpi
          label="Niewykorzystane sesje z pakietów"
          value={pln(r.unusedPackages.value)}
          hint="Wartość sesji wykupionych, a jeszcze nieodbytych na koniec miesiąca (cena za sesję z ostatniego pakietu)."
          sub={`${r.unusedPackages.sessions} ${plural(r.unusedPackages.sessions, 'sesja', 'sesje', 'sesji')} · ${r.unusedPackages.clients} ${plural(r.unusedPackages.clients, 'osoba', 'osoby', 'osób')}`}
        />
      </div>

      {r.count === 0 ? (
        <Empty>Brak wpłat w miesiącu: {fmtMonth(month)}.</Empty>
      ) : (
        <div className="pay-rep-grid">
          <Card title="Wg formy">
            <Buckets list={r.byMethod} total={r.total} />
            {r.byMethod.some((b) => b.key === 'brak') && <p className="muted small">„Bez formy” — uzupełnij formę w edycji płatności.</p>}
          </Card>
          <Card title="Wg rodzaju">
            <Buckets list={r.byKind} total={r.total} />
          </Card>
          <Card title="Wg klienta" className="pay-rep-clients">
            <Buckets list={r.byClient} total={r.total} />
          </Card>
        </div>
      )}
      <p className="muted small">Eksport CSV: wpłaty z miesiąca i nieopłacone płatności wystawione w tym miesiącu (średnik, przecinek dziesiętny — otwiera się w Excelu).</p>
    </div>
  );
}
