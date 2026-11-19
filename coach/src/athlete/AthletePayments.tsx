import { useState } from 'react';
import type { Client } from '../domain';
import { sessionsOf } from '../data/ops';
import { useStore } from '../data/store';
import { useTrainerProfile } from '../data/trainerProfile';
import { Icon } from '../components/ui';
import { packageStatus } from '../lib/billing';
import { todayISO } from '../lib/dates';
import { dm, dueItems, dueLine, fmtAccount, fmtZl, packageLine, packageValidTo, paidInYear, paidItems, paidMessage, reportedAt, transferTitle, type DueItem, type PaidVia } from '../lib/athletePay';
import { pastForm } from '../lib/gender';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // starsze przeglądarki / brak uprawnień — zaznaczenie z pola tekstowego
    try {
      const t = document.createElement('textarea');
      t.value = text;
      t.style.position = 'fixed';
      t.style.opacity = '0';
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand('copy');
      t.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function CopyRow({ label, value, copy }: { label: string; value: string; copy?: string }) {
  const { toast } = useStore();
  return (
    <div className="r7-copy-row">
      <span className="grow">
        <span className="muted small">{label}</span>
        <b className="r7-copy-val">{value}</b>
      </span>
      <button type="button" className="btn btn-ghost btn-sm" aria-label={`Kopiuj: ${label}`} onClick={async () => toast((await copyText(copy ?? value)) ? `Skopiowano: ${label.toLowerCase()}.` : 'Nie udało się skopiować. Przepisz ręcznie.')}>
        <Icon name="copy" size={16} /> Kopiuj
      </button>
    </div>
  );
}

/**
 * Karta „Płatności” w zakładce Trener: stan pakietu, kwoty do zapłaty (bursztyn; po terminie czerwony),
 * dane do przelewu z profilu trenera i „Zapłaciłam / Zapłaciłem” → wiadomość do trenera.
 */
export function AthletePayments({ client, preview }: { client: Client; preview?: boolean }) {
  const { db, sendClientMessage, toast } = useStore();
  const { profile } = useTrainerProfile();
  const today = todayISO();
  const due = dueItems(client, today);
  const pkg = packageLine(packageStatus(client, sessionsOf(db, client.id)), packageValidTo(client.payments ?? []));
  const [open, setOpen] = useState<string | null>(null);
  const [via, setVia] = useState<PaidVia>('przelew');
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const paid = paidItems(client);
  if (!pkg && !due.length && !paid.length) return null;
  const year = today.slice(0, 4);
  const yearSum = paidInYear(paid, year);
  const shown = all ? paid : paid.slice(0, 5);
  const paidWord = pastForm(client as Client & { sex?: string }, 'Zapłaciłam', 'Zapłaciłem');
  const hasBank = !!profile.bankAccount?.trim();
  const hasBlik = !!profile.blikPhone?.trim();

  const report = async (d: DueItem) => {
    if (preview) return toast('Podgląd. U podopiecznego ten przycisk wysyła trenerowi wiadomość o wpłacie.');
    setBusy(true);
    const ok = await sendClientMessage(client.id, paidMessage(d, via), {});
    setBusy(false);
    if (ok) setOpen(null);
  };

  return (
    <section className="acard r7-pay" aria-label="Płatności">
      <span className="eyebrow">Płatności</span>
      {pkg && <p className="r7-pay-pkg">{pkg}</p>}
      {due.map((d) => {
        const sent = reportedAt(client, d);
        const p = client.payments.find((x) => x.id === d.id)!;
        const title = transferTitle(client.name, p);
        return (
          <div key={d.id} className={`r7-due ${d.overdue ? 'over' : ''}`}>
            <p className={`r7-due-line ${d.overdue ? 'r7-bad' : 'warn-text'}`}>
              <Icon name="alert" size={16} /> {dueLine(d)}
              {d.overdue ? ', po terminie' : ''}
            </p>
            {sent ? (
              <p className="small ok-text">
                <Icon name="check" size={14} /> Zgłoszone trenerowi {new Date(sent).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })}. Czeka na potwierdzenie.
              </p>
            ) : open === d.id ? (
              <div className="r7-pay-how">
                {(hasBank || hasBlik) && (
                  <>
                    {hasBank && <CopyRow label="Numer konta" value={fmtAccount(profile.bankAccount!)} copy={profile.bankAccount!.replace(/\s/g, '')} />}
                    {hasBank && profile.bankName && <p className="muted small">{profile.bankName}{profile.name ? ` · odbiorca: ${profile.name}` : ''}</p>}
                    <CopyRow label="Tytuł przelewu" value={title} />
                    {hasBlik && <CopyRow label="BLIK na telefon" value={profile.blikPhone!} copy={profile.blikPhone!.replace(/[^\d+]/g, '')} />}
                  </>
                )}
                {!hasBank && !hasBlik && <p className="muted small">Trener nie podał danych do przelewu. Zapytaj w rozmowie poniżej.</p>}
                <div className="seg r7-via" role="radiogroup" aria-label="Jak zapłacono">
                  {(['przelew', 'BLIK'] as PaidVia[]).map((v) => (
                    <button key={v} type="button" role="radio" aria-checked={via === v} className={via === v ? 'active' : ''} onClick={() => setVia(v)}>
                      {v}
                    </button>
                  ))}
                </div>
                <div className="actions">
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void report(d)}>
                    <Icon name="check" size={16} /> {busy ? 'Wysyłam…' : paidWord}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setOpen(null)}>
                    Zamknij
                  </button>
                </div>
              </div>
            ) : (
              <div className="actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(d.id)}>
                  Jak zapłacić
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void report(d)}>
                  {paidWord}
                </button>
              </div>
            )}
          </div>
        );
      })}
      {paid.length > 0 && (
        <div className="r7-pay-hist">
          <div className="r7-pay-hist-head">
            <b>Historia wpłat</b>
            {yearSum > 0 && <span className="muted small">{year}: {fmtZl(yearSum)}</span>}
          </div>
          <ul>
            {shown.map((x) => (
              <li key={x.id}>
                <span className="r7-pay-hist-date num">{dm(x.date)}{x.date.slice(0, 4) !== year ? `.${x.date.slice(0, 4)}` : ''}</span>
                <span className="grow">
                  {x.label.charAt(0).toUpperCase() + x.label.slice(1)}
                  {(x.method || x.doc) && <span className="muted small"> · {[x.method, x.doc && `dok. ${x.doc}`].filter(Boolean).join(' · ')}</span>}
                </span>
                <b className="num">{fmtZl(x.amount)}</b>
              </li>
            ))}
          </ul>
          {paid.length > 5 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll(!all)}>
              {all ? 'Pokaż mniej' : `Pokaż wszystkie (${paid.length})`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
