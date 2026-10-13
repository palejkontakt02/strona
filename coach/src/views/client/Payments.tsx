import { Card, Empty, IconBtn, Tag } from '../../components/ui';
import type { Client } from '../../domain';
import { put } from '../../data/db';
import { paymentLabel, sessionsOf, setPaymentStatus } from '../../data/ops';
import { useStore } from '../../data/store';
import { fmtDate, pln } from '../../format';
import { isOverdue, packageStatus } from '../../lib/billing';
import { todayISO } from '../../lib/dates';
import { useNav } from '../../nav';

/** Sztanga z talerzami: każdy talerz = jedna sesja z ostatniego pakietu; pełne = pozostałe. */
export function Barbell({ left, size }: { left: number; size: number }) {
  const n = Math.max(size, 1);
  const plates = Array.from({ length: n }, (_, i) => i < Math.max(0, Math.min(left, n)));
  const half = Math.ceil(n / 2);
  const side = (arr: boolean[]) =>
    arr.map((full, i) => <rect key={i} className={full ? 'plate' : 'plate plate-empty'} x={0} y={0} width={10} height={44 - Math.min(i, 4) * 3} rx={2} />);
  const left_ = plates.slice(0, half);
  const right_ = plates.slice(half);
  return (
    <svg className="barbell" viewBox="0 0 300 60" role="img" aria-label={`Zostało ${left} z ${size}`}>
      <rect x={10} y={27} width={280} height={6} rx={3} className="bar-shaft" />
      <rect x={58} y={20} width={6} height={20} rx={1} className="bar-shaft" />
      <rect x={236} y={20} width={6} height={20} rx={1} className="bar-shaft" />
      {side(left_).map((r, i) => (
        <g key={'l' + i} transform={`translate(${46 - i * 12}, ${8 + Math.min(i, 4) * 1.5})`}>
          {r}
        </g>
      ))}
      {side(right_).map((r, i) => (
        <g key={'r' + i} transform={`translate(${244 + i * 12}, ${8 + Math.min(i, 4) * 1.5})`}>
          {r}
        </g>
      ))}
    </svg>
  );
}

export function ClientPayments({ client }: { client: Client }) {
  const { db, apply, ask } = useStore();
  const { openModal } = useNav();
  const today = todayISO();
  const pk = packageStatus(client, sessionsOf(db, client.id));
  const pays = [...client.payments].sort((a, b) => b.date.localeCompare(a.date));
  const unpaid = pays.filter((p) => p.status !== 'paid').reduce((a, p) => a + p.amount, 0);

  return (
    <>
      <div className="toolbar">
        <h3>Płatności</h3>
        <div className="actions">
          <button className="btn btn-secondary btn-sm" onClick={() => openModal({ kind: 'payment', clientId: client.id, type: 'pakiet' })}>
            + Pakiet
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => openModal({ kind: 'payment', clientId: client.id, type: 'abonament' })}>
            + Abonament
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => openModal({ kind: 'payment', clientId: client.id, type: 'pojedyncza' })}>
            + Sesja
          </button>
        </div>
      </div>

      <div className="two-col">
        {pk && (
          <Card title="Pakiet">
            <Barbell left={pk.left} size={pk.size || 10} />
            <p className="lead center">
              {pk.left < 0 ? (
                <span className="text-danger">{-pk.left} {-pk.left === 1 ? 'trening' : 'treningi'} ponad pakiet</span>
              ) : (
                <>
                  Zostało <strong>{pk.left}</strong> z {pk.total} wykupionych
                </>
              )}
            </p>
            <p className="muted small center">Wykorzystano {pk.used} · ostatni pakiet: {pk.size} sesji</p>
          </Card>
        )}
        <Card title="Podsumowanie">
          <div className="rows">
            <div className="row">
              <span className="grow muted">Do zapłaty</span>
              <strong className={unpaid ? 'text-warn' : ''}>{pln(unpaid)}</strong>
            </div>
            <div className="row">
              <span className="grow muted">Wpłacono łącznie</span>
              <strong>{pln(pays.filter((p) => p.status === 'paid').reduce((a, p) => a + p.amount, 0))}</strong>
            </div>
            <div className="row">
              <span className="grow muted">Stawki</span>
              <span className="small">
                {[client.singleRate && `sesja ${pln(client.singleRate)}`, client.subRate && `abonament ${pln(client.subRate)}`, client.pkgPrice && `pakiet ${client.pkgSize ?? ''} × ${pln(client.pkgPrice)}`].filter(Boolean).join(' · ') || '—'}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {pays.length === 0 ? (
        <Empty>Brak płatności.</Empty>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Opis</th>
                <th className="num">Kwota</th>
                <th>Termin</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pays.map((p) => (
                <tr key={p.id}>
                  <td className="nowrap">{fmtDate(p.date)}</td>
                  <td>{paymentLabel(p)}</td>
                  <td className="num">{pln(p.amount)}</td>
                  <td className="nowrap">{p.status === 'paid' ? <span className="muted small">opł. {fmtDate(p.paidDate)}</span> : fmtDate(p.dueDate)}</td>
                  <td>{p.status === 'paid' ? <Tag tone="ok">Opłacone</Tag> : isOverdue(p, today) ? <Tag tone="danger">Zaległe</Tag> : <Tag>Do zapłaty</Tag>}</td>
                  <td className="actions">
                    {p.status === 'paid' ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => apply([setPaymentStatus(client, p.id, false, today)])}>
                        Cofnij
                      </button>
                    ) : (
                      <button className="btn btn-secondary btn-sm" onClick={() => apply([setPaymentStatus(client, p.id, true, today)], 'Oznaczono jako opłacone.')}>
                        Oznacz opłacone
                      </button>
                    )}
                    <IconBtn icon="edit" label="Edytuj płatność" onClick={() => openModal({ kind: 'payment', clientId: client.id, type: p.type, payment: p })} />
                    <IconBtn
                      icon="trash"
                      label="Usuń płatność"
                      danger
                      onClick={async () => {
                        if (await ask('Usunąć tę płatność?')) await apply([put('clients', { ...client, payments: client.payments.filter((x) => x.id !== p.id) })], 'Płatność usunięta.');
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
