import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, Modal } from '../components/ui';
import { useStore } from '../data/store';
import { supabase } from '../data/supabase';
import { useNav } from '../nav';
import { todayISO } from '../lib/dates';
import {
  AUTO_KINDS,
  AUTO_META,
  DEFAULT_TEXT,
  dueMessages,
  fillTemplate,
  firstName,
  normalizeRules,
  parseCounts,
  rulesPayload,
  sampleVars,
  type AutoKind,
  type AutoRule,
  type AutoRules,
  type AutoSent,
} from '../lib/autoMessages';

/** W trybie lokalnym reguły zapisują się w tej przeglądarce (wysyłka działa tylko z bazą). */
const LOCAL_KEY = 'fitowa-auto-rules';

function readLocal(): AutoRules {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return normalizeRules(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeRules(null);
  }
}

const fmtAt = (at: string) => (at ? new Date(at).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Ustawienia → „Automatyczne wiadomości”: reguły (włącz / wyłącz, treść, podgląd), co pójdzie przy najbliższym
 * sprawdzeniu i 10 ostatnio wysłanych. Wysyłkę robi baza (hardening.sql, sekcja 25) codziennie o 9:00.
 */
export function AutoMessages() {
  const { db, cloud, toast } = useStore();
  const { closeModal } = useNav();
  const [rules, setRules] = useState<AutoRules>(() => (cloud ? normalizeRules(null) : readLocal()));
  const [sent, setSent] = useState<AutoSent[]>([]);
  const [ready, setReady] = useState(!cloud);
  const [dbError, setDbError] = useState('');
  const [editing, setEditing] = useState<AutoKind | null>(null);
  const [busy, setBusy] = useState(false);

  const loadCloud = async () => {
    const [r, l] = await Promise.all([
      supabase.from('auto_message_rules').select('data').eq('id', 'rules').maybeSingle(),
      supabase.from('auto_message_log').select('client_id, kind, key, text, at').order('at', { ascending: false }).limit(500),
    ]);
    if (r.error || l.error) {
      const msg = (r.error ?? l.error)!.message;
      setDbError(/does not exist|schema cache|relation/i.test(msg) ? 'Baza wymaga aktualizacji: uruchom w Supabase sekcję 25 z hardening.sql.' : `Nie udało się wczytać ustawień (${msg}).`);
    } else {
      setDbError('');
      setRules(normalizeRules((r.data as { data?: unknown } | null)?.data ?? null));
      setSent(((l.data ?? []) as { client_id: string; kind: AutoKind; key: string; text: string | null; at: string }[]).map((x) => ({ clientId: x.client_id, kind: x.kind, key: x.key, text: x.text ?? '', at: x.at })));
    }
    setReady(true);
  };

  useEffect(() => {
    if (cloud) void loadCloud();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud]);

  const save = async (next: AutoRules, msg: string): Promise<boolean> => {
    if (cloud) {
      const { error } = await supabase.from('auto_message_rules').upsert({ id: 'rules', data: rulesPayload(next), updated_at: new Date().toISOString() });
      if (error) {
        toast(/does not exist|schema cache|relation/i.test(error.message) ? 'Nie zapisano — uruchom w Supabase sekcję 25 z hardening.sql.' : `Nie zapisano (${error.message}).`);
        return false;
      }
    } else {
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(rulesPayload(next)));
      } catch {
        // brak localStorage — zostaje do zamknięcia okna
      }
    }
    setRules(next);
    toast(msg);
    return true;
  };

  const sample = db.clients.find((c) => c.status === 'aktywny' && c.email) ?? db.clients[0];
  const sampleName = sample ? firstName(sample) : 'Ania';
  const today = todayISO();
  const due = useMemo(() => dueMessages(db, rules, today, sent), [db, rules, today, sent]);
  const nameOf = (id: string) => db.clients.find((c) => c.id === id)?.name ?? 'Podopieczny (usunięty)';
  const anyOn = AUTO_KINDS.some((k) => rules[k].on);

  const runNow = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('auto_messages_run_now');
      if (error) toast(/function|schema cache|does not exist/i.test(error.message) ? 'Uruchom w Supabase sekcję 25 z hardening.sql.' : `Nie udało się (${error.message}).`);
      else {
        const n = Number(data) || 0;
        toast(n ? `Wysłano: ${n}.` : 'Nic nowego do wysłania.');
        await loadCloud();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Automatyczne wiadomości" onClose={closeModal} wide>
      <div className="am">
        <p className="small am-intro">
          Wiadomość idzie od Ciebie — jako zwykła wiadomość w rozmowie, z powiadomieniem na telefon podopiecznego. Treść zatwierdzasz raz, włączając regułę.
          Sprawdzanie codziennie o 9:00; każde zdarzenie najwyżej raz, najwyżej jedna wiadomość dziennie na osobę. Tylko podopieczni z kontem w aplikacji.
        </p>
        {!cloud && (
          <p className="am-note small" role="status">
            <Icon name="alert" size={16} /> Automatyczne wiadomości działają po podłączeniu bazy. Teraz reguły zapisują się tylko w tej przeglądarce, a poniżej widać, co by dziś poszło.
          </p>
        )}
        {dbError && (
          <p className="am-note am-error small" role="alert">
            <Icon name="alert" size={16} /> {dbError}
          </p>
        )}

        <ul className="am-rules" aria-busy={!ready}>
          {AUTO_KINDS.map((k) => (
            <RuleCard
              key={k}
              kind={k}
              rules={rules}
              sampleName={sampleName}
              disabled={!ready || !!dbError}
              editing={editing === k}
              onEdit={(on) => setEditing(on ? k : null)}
              onToggle={() => void save({ ...rules, [k]: { ...rules[k], on: !rules[k].on } }, rules[k].on ? `Wyłączono: ${AUTO_META[k].title.toLowerCase()}.` : `Włączono: ${AUTO_META[k].title.toLowerCase()}.`)}
              onSave={async (rule) => (await save({ ...rules, [k]: rule }, 'Zapisano treść.')) && setEditing(null)}
            />
          ))}
        </ul>

        <section className="am-section" aria-labelledby="am-due">
          <div className="am-section-head">
            <h4 id="am-due">Do wysłania przy najbliższym sprawdzeniu</h4>
            {cloud && !dbError && anyOn && (
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !ready} onClick={() => void runNow()}>
                Sprawdź teraz
              </button>
            )}
          </div>
          {!anyOn ? (
            <p className="muted small">Włącz regułę, żeby zobaczyć, do kogo pójdzie wiadomość.</p>
          ) : due.length === 0 ? (
            <p className="muted small">Dziś nic — żadne zdarzenie nie pasuje albo wiadomość już poszła.</p>
          ) : (
            <ul className="am-list">
              {due.map((m) => (
                <li key={`${m.clientId}-${m.kind}`}>
                  <span className="am-who">{nameOf(m.clientId)}</span>
                  <span className="am-kind muted small">{AUTO_META[m.kind].title}</span>
                  <span className="am-text small">{m.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="am-section" aria-labelledby="am-sent">
          <h4 id="am-sent">Ostatnio wysłane</h4>
          {sent.length === 0 ? (
            <p className="muted small">{cloud ? 'Jeszcze nic nie wysłano.' : 'W trybie lokalnym nic nie jest wysyłane.'}</p>
          ) : (
            <ul className="am-list">
              {sent.slice(0, 10).map((m) => (
                <li key={`${m.clientId}-${m.kind}-${m.key}`}>
                  <span className="am-who">{nameOf(m.clientId)}</span>
                  <span className="am-kind muted small">
                    {AUTO_META[m.kind]?.title ?? m.kind} · <time dateTime={m.at}>{fmtAt(m.at)}</time>
                  </span>
                  {m.text && <span className="am-text small">{m.text}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}

function RuleCard({
  kind,
  rules,
  sampleName,
  disabled,
  editing,
  onEdit,
  onToggle,
  onSave,
}: {
  kind: AutoKind;
  rules: AutoRules;
  sampleName: string;
  disabled: boolean;
  editing: boolean;
  onEdit: (on: boolean) => void;
  onToggle: () => void;
  onSave: (rule: AutoRule) => Promise<unknown>;
}) {
  const rule = rules[kind];
  const meta = AUTO_META[kind];
  const [text, setText] = useState(rule.text);
  const [days, setDays] = useState(String(rule.days ?? 7));
  const [left, setLeft] = useState(String(rule.left ?? 2));
  const [counts, setCounts] = useState((rule.counts ?? []).join(', '));
  const area = useRef<HTMLTextAreaElement>(null);
  const id = `am-${kind}`;

  useEffect(() => {
    if (!editing) return;
    setText(rule.text);
    setDays(String(rule.days ?? 7));
    setLeft(String(rule.left ?? 2));
    setCounts((rule.counts ?? []).join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // podgląd: z edytowanymi wartościami, gdy edytujesz
  const draft: AutoRules = editing
    ? { ...rules, [kind]: { ...rule, text, days: Number(days) || rule.days, left: Number(left) || rule.left, counts: parseCounts(counts).length ? parseCounts(counts) : rule.counts } }
    : rules;
  const preview = fillTemplate(editing ? text : rule.text, sampleVars(kind, draft, sampleName));

  const insert = (f: string) => {
    const el = area.current;
    const tag = `{${f}}`;
    if (!el) return setText((t) => t + tag);
    const a = el.selectionStart ?? text.length;
    const b = el.selectionEnd ?? text.length;
    setText(text.slice(0, a) + tag + text.slice(b));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + tag.length, a + tag.length);
    });
  };

  const daysN = Number(days);
  const leftN = Number(left);
  const problem = !text.trim()
    ? 'Wpisz treść wiadomości.'
    : text.length > 1000
      ? 'Najwyżej 1000 znaków.'
      : kind === 'inactive' && !(Number.isInteger(daysN) && daysN >= 3 && daysN <= 90)
        ? 'Liczba dni: od 3 do 90.'
        : kind === 'package' && !(Number.isInteger(leftN) && leftN >= 1 && leftN <= 10)
          ? 'Liczba treningów: od 1 do 10.'
          : kind === 'milestone' && parseCounts(counts).length === 0
            ? 'Podaj co najmniej jedną liczbę treningów (2–1000).'
            : '';

  const submit = () => {
    if (problem) return;
    const next: AutoRule = { ...rule, text: text.trim() };
    if (kind === 'inactive') next.days = daysN;
    if (kind === 'package') next.left = leftN;
    if (kind === 'milestone') next.counts = parseCounts(counts);
    void onSave(next);
  };

  const param = kind === 'inactive' ? `po ${rule.days} dniach` : kind === 'package' ? `zostało ≤ ${rule.left}` : kind === 'milestone' ? (rule.counts ?? []).join(', ') : '';

  return (
    <li className={`am-rule card${rule.on ? ' is-on' : ''}`}>
      <div className="am-rule-head">
        <div className="am-rule-title">
          <h4 id={`${id}-t`}>
            {meta.title}
            {param && <span className="am-param"> · {param}</span>}
          </h4>
          <p className="muted small">{meta.when}</p>
        </div>
        <button type="button" role="switch" className={`push-switch ${rule.on ? 'on' : ''}`} aria-checked={rule.on} aria-labelledby={`${id}-t`} disabled={disabled} onClick={onToggle}>
          <i />
        </button>
      </div>

      <div className="am-preview" aria-label={`Podgląd dla: ${sampleName}`}>
        <span className="am-preview-label small muted">Podgląd · {sampleName}</span>
        <p className="am-bubble">{preview}</p>
      </div>

      {editing ? (
        <div className="am-edit">
          <label className="field">
            <span className="small">Treść</span>
            <textarea ref={area} className="input" rows={4} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="am-fields" aria-label="Wstaw pole">
            {meta.fields.map((f) => (
              <button key={f} type="button" className="chip am-chip" onClick={() => insert(f)}>
                {`{${f}}`}
              </button>
            ))}
          </div>
          {kind === 'inactive' && (
            <label className="field am-num">
              <span className="small">Po ilu dniach bez treningu</span>
              <input className="input" type="number" inputMode="numeric" min={3} max={90} value={days} onChange={(e) => setDays(e.target.value)} />
            </label>
          )}
          {kind === 'package' && (
            <label className="field am-num">
              <span className="small">Gdy w pakiecie zostało najwyżej</span>
              <input className="input" type="number" inputMode="numeric" min={1} max={10} value={left} onChange={(e) => setLeft(e.target.value)} />
            </label>
          )}
          {kind === 'milestone' && (
            <label className="field">
              <span className="small">Po których treningach (po przecinku)</span>
              <input className="input" inputMode="numeric" value={counts} onChange={(e) => setCounts(e.target.value)} />
            </label>
          )}
          {problem && <p className="small am-problem">{problem}</p>}
          <div className="am-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setText(DEFAULT_TEXT[kind])} disabled={text === DEFAULT_TEXT[kind]}>
              Przywróć domyślną
            </button>
            <span className="grow" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(false)}>
              Anuluj
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={!!problem || disabled} onClick={submit}>
              Zapisz treść
            </button>
          </div>
        </div>
      ) : (
        <div className="am-actions">
          <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => onEdit(true)}>
            <Icon name="edit" size={16} /> Edytuj treść
          </button>
        </div>
      )}
    </li>
  );
}
