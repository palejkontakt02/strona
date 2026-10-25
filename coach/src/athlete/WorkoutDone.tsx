import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/ui';
import { RefComment } from '../components/RefComment';
import { useStore } from '../data/store';
import { plural } from '../format';
import { signed, type WorkoutStats } from '../lib/lastResult';

const nf = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 });

export interface DoneInfo {
  sessionId: string;
  clientId: string;
  name: string;
  date: string;
  /** Minuty. */
  duration?: number;
  stats: WorkoutStats;
  records: { name: string; text: string }[];
  /** Różnica do poprzedniego wykonania tego treningu. */
  diff: { tonnage: number; sets: number; date: string } | null;
  /** Kto podpisany na grafice (trener albo „Fitowa”). */
  brand: string;
}

const dayText = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
const durText = (m?: number) => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

/** Pełny ekran po zapisie treningu: liczby, rekordy, porównanie, udostępnienie grafiki, komentarz. */
export function WorkoutDone({ info, onDone }: { info: DoneInfo; onDone: () => void }) {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
    head.current?.focus({ preventScroll: true });
  }, []);
  const { stats, diff } = info;

  const share = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await shareImage(info);
      if (!blob) return toast('Nie udało się przygotować grafiki.');
      const file = new File([blob], `trening-${info.date}.png`, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        try {
          await nav.share({ files: [file], title: info.name });
          return;
        } catch (e) {
          if ((e as Error)?.name === 'AbortError') return; // zamknięte okno udostępniania
        }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Grafika zapisana w pobranych plikach.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wdone fade" role="region" aria-label="Trening zakończony">
      <div className="wdone-top">
        <span className="wdone-check" aria-hidden="true">
          <Icon name="check" size={28} />
        </span>
        <h1 ref={head} tabIndex={-1}>
          Trening zakończony
        </h1>
        <p className="muted">
          {info.name} · {dayText(info.date)}
        </p>
      </div>
      <dl className="wdone-stats">
        <div>
          <dt>Czas</dt>
          <dd>{durText(info.duration)}</dd>
        </div>
        <div>
          <dt>Tonaż</dt>
          <dd>
            {stats.tonnage ? nf.format(stats.tonnage) : '—'}
            {stats.tonnage ? <small> kg</small> : null}
          </dd>
        </div>
        <div>
          <dt>Serie</dt>
          <dd>{stats.sets}</dd>
        </div>
        <div>
          <dt>Rekordy</dt>
          <dd className={info.records.length ? 'is-pr' : undefined}>{info.records.length}</dd>
        </div>
      </dl>
      {diff ? (
        <div className="wdone-cmp">
          <span className="eyebrow">W porównaniu z poprzednim razem ({new Date(`${diff.date}T12:00:00`).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })})</span>
          <p>
            Tonaż <b>{diff.tonnage ? signed(diff.tonnage, 'kg') : 'bez zmian'}</b> · serie <b>{diff.sets ? signed(diff.sets) : 'bez zmian'}</b>
          </p>
        </div>
      ) : (
        <p className="muted small wdone-cmp">Pierwsze wykonanie tego treningu — następnym razem zobaczysz porównanie.</p>
      )}
      {info.records.length > 0 && (
        <div className="pr-summary">
          <span className="eyebrow">
            <Icon name="trophy" size={14} /> {info.records.length === 1 ? 'Nowy rekord' : `Nowe rekordy (${info.records.length})`}
          </span>
          <ul>
            {info.records.map((p) => (
              <li key={p.name}>
                <span className="pr-name">{p.name}</span>
                <span className="pr-val">{p.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="wdone-comment">
        <RefComment clientId={info.clientId} sessionId={info.sessionId} label="Komentarz do treningu" />
      </div>
      <div className="wdone-actions">
        <button type="button" className="btn btn-secondary btn-lg btn-block" onClick={() => void share()} disabled={busy} aria-busy={busy}>
          <Icon name="image" size={18} /> {busy ? 'Przygotowuję…' : 'Udostępnij'}
        </button>
        <button type="button" className="btn btn-primary btn-lg btn-block" onClick={onDone}>
          Gotowe
        </button>
      </div>
    </div>
  );
}

/** Grafika 1080×1920 (czarno-biała, duże liczby) do relacji / wiadomości. */
export async function shareImage(info: DoneInfo): Promise<Blob | null> {
  const W = 1080;
  const H = 1920;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g) return null;
  const DISP = '"Barlow Condensed", "Arial Narrow", sans-serif';
  const BODY = 'Inter, system-ui, sans-serif';
  try {
    await Promise.all([document.fonts?.load(`700 300px ${DISP}`), document.fonts?.load(`600 60px ${DISP}`), document.fonts?.load(`500 40px ${BODY}`)]);
  } catch {
    // zapasowa czcionka systemowa
  }
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff';
  g.textBaseline = 'alphabetic';
  const M = 96;
  // nagłówek
  g.font = `600 44px ${BODY}`;
  g.fillStyle = '#9a9a9a';
  g.fillText(dayText(info.date), M, 180);
  g.fillStyle = '#fff';
  g.font = `700 112px ${DISP}`;
  wrap(g, info.name, M, 310, W - 2 * M, 112, 2);
  // liczby
  const rows: [string, string, string][] = [
    ['Tonaż', info.stats.tonnage ? nf.format(info.stats.tonnage) : '—', info.stats.tonnage ? 'kg' : ''],
    ['Serie', String(info.stats.sets), ''],
    ...(info.duration != null ? [['Czas', String(info.duration), 'min'] as [string, string, string]] : []),
    ['Rekordy', String(info.records.length), info.records.length ? plural(info.records.length, 'nowy', 'nowe', 'nowych') : ''],
  ];
  let y = 760;
  for (const [label, val, unit] of rows) {
    g.fillStyle = '#333';
    g.fillRect(M, y - 235, W - 2 * M, 2);
    g.fillStyle = '#9a9a9a';
    g.font = `500 40px ${BODY}`;
    g.fillText(label, M, y - 180);
    g.fillStyle = '#fff';
    g.font = `700 220px ${DISP}`;
    g.fillText(val, M, y);
    const w = g.measureText(val).width;
    if (unit) {
      g.font = `600 64px ${DISP}`;
      g.fillText(unit, M + w + 20, y);
    }
    y += 280;
  }
  if (info.diff) {
    g.fillStyle = '#9a9a9a';
    g.font = `500 40px ${BODY}`;
    g.fillText(`Względem poprzedniego razu: ${info.diff.tonnage ? signed(info.diff.tonnage, 'kg') : 'tonaż bez zmian'}`, M, 1680);
  }
  // podpis
  g.fillStyle = '#fff';
  g.fillRect(M, H - 200, 80, 6);
  g.font = `700 64px ${DISP}`;
  g.fillText(info.brand, M, H - 110);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number, lines: number) {
  const words = text.split(/\s+/);
  let line = '';
  let n = 0;
  for (let i = 0; i < words.length; i++) {
    const t = line ? `${line} ${words[i]}` : words[i];
    if (g.measureText(t).width > max && line) {
      if (n === lines - 1) {
        g.fillText(`${line}…`, x, y + n * lh);
        return;
      }
      g.fillText(line, x, y + n * lh);
      n++;
      line = words[i];
    } else line = t;
  }
  g.fillText(line, x, y + n * lh);
}
