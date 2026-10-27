import type { Client } from '../domain';
import { ACCOUNT_LABEL, accountKnown, accountOf, refreshAccounts, useAccounts, type AccountsState } from '../data/accounts';
import { inviteState } from '../lib/onboarding';
import { InviteButton, InviteStatusTag } from './Onboarding';
import { useStore } from '../data/store';
import { fmtDate } from '../format';
import { Tag } from './ui';

const TONE = { active: 'ok', unconfirmed: 'warn', none: 'neutral', 'no-email': 'neutral' } as const;
const day = (iso?: string | null) => (iso ? fmtDate(iso.slice(0, 10)) : '—');

/** Znacznik konta na karcie podopiecznego: połączył konto / niepotwierdzone / zaproszony (data) / nie zaproszony.
 *  W chmurze z listy kont; w podglądzie lokalnym — po wpisach podopiecznego. Podczas wczytywania nic. */
export function AccountBadge({ client, state }: { client: Client; state: AccountsState }) {
  if (state.status === 'loading') return null;
  const st = inviteState(client, accountKnown(client, state));
  if (st === 'connected' && state.status === 'ok') return <Tag tone="ok">konto ✓</Tag>;
  if (st === 'unconfirmed') return <Tag tone="warn">niepotwierdzone</Tag>;
  if (client.status === 'zakończony' && st !== 'connected') return null;
  return <InviteStatusTag client={client} state={st} />;
}

/** Stan konta w profilu podopiecznego: czy założył konto, czy potwierdził e-mail, kiedy się logował. */
export function AccountStatusCard({ client }: { client: Client }) {
  const { cloud } = useStore();
  const state = useAccounts(cloud);
  let body: React.ReactNode;
  if (state.status === 'off') body = <InviteStatusTag client={client} state={inviteState(client, 'unknown')} />;
  else if (state.status === 'loading') body = <span className="muted small">Sprawdzam…</span>;
  else if (state.status !== 'ok') body = <span className="muted small">Lista kont niedostępna — zobacz Ustawienia → Konta w aplikacji.</span>;
  else {
    const { status, account } = accountOf(client, state.list);
    body = (
      <>
        <Tag tone={TONE[status]}>{ACCOUNT_LABEL[status]}</Tag>
        <span className="muted small">
          {status === 'active' && `założone ${day(account!.created_at)} · ostatnie logowanie ${day(account!.last_sign_in_at)}`}
          {status === 'unconfirmed' && `założone ${day(account!.created_at)} — podopieczny musi kliknąć link w mailu, inaczej nie zobaczy swoich danych.`}
          {status === 'none' && (client.invitedAt ? `Zaproszenie wysłane ${day(client.invitedAt)} — nikt jeszcze nie założył konta na ${client.email}.` : `Nikt nie założył konta na ${client.email}. Wyślij zaproszenie — link sam wpisze ten e-mail na ekranie „Nowe konto”.`)}
          {status === 'no-email' && 'Wpisz e-mail podopiecznego poniżej — tym adresem założy konto i zobaczy swoje treningi.'}
        </span>
      </>
    );
  }
  return (
    <div className="card account-card">
      <div className="account-card-head">
        <span className="eyebrow">Konto w aplikacji</span>
        <InviteButton client={client} />
      </div>
      <div className="row-inline wrap">{body}</div>
    </div>
  );
}

/** Ustawienia: wszystkie konta i dopasowanie do podopiecznych (także konta, które do nikogo nie pasują). */
export function AccountsPanel() {
  const { db, cloud } = useStore();
  const state = useAccounts(cloud);
  if (state.status === 'off') return <p className="muted small">Konta są widoczne po zalogowaniu w wersji online (sebastianpalej.pl/app).</p>;
  if (state.status === 'loading') return <p className="muted small">Wczytuję konta…</p>;
  if (state.status === 'missing')
    return (
      <p className="small">
        Żeby widzieć konta, uruchom w Supabase (SQL Editor) ostatnią część pliku <code>supabase/hardening.sql</code> — funkcję <code>trainer_accounts</code>.
      </p>
    );
  if (state.status === 'error') return <p className="small text-danger">Nie udało się wczytać kont: {state.message}</p>;
  const byEmail = new Map(db.clients.filter((c) => c.email).map((c) => [c.email!.trim().toLowerCase(), c]));
  const orphans = state.list.filter((a) => !a.is_trainer && !byEmail.has(a.email)).length;
  return (
    <>
      <p className="muted small">
        {state.list.length} kont · {orphans > 0 ? `${orphans} nie pasuje do żadnego podopiecznego (inny e-mail w profilu?)` : 'wszystkie przypisane'}
      </p>
      <ul className="rows account-list">
        {state.list.map((a) => {
          const c = byEmail.get(a.email);
          return (
            <li key={a.email} className="row row-top">
              <div className="grow">
                <strong>{a.is_trainer ? 'Ty (trener)' : (c?.name ?? a.email)}</strong>
                <div className="muted small">
                  {c || a.is_trainer ? `${a.email} · ` : ''}założone {day(a.created_at)} · logowanie {day(a.last_sign_in_at)}
                </div>
              </div>
              {a.is_trainer ? null : !a.confirmed ? <Tag tone="warn">niepotwierdzone</Tag> : c ? <Tag tone="ok">✓</Tag> : <Tag tone="danger">bez podopiecznego</Tag>}
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refreshAccounts()}>
        Odśwież
      </button>
    </>
  );
}
