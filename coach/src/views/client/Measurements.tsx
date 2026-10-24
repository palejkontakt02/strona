import { allMeasurements } from '../../data/ops';
import { useState } from 'react';
import { LineChart } from '../../components/charts';
import { Card, Empty, IconBtn, Tag } from '../../components/ui';
import type { Client, TestResult } from '../../domain';
import { put } from '../../data/db';
import { useStore } from '../../data/store';
import { fmtDate, fnum } from '../../format';
import { relativeStrength } from '../../lib/tests';
import { useNav } from '../../nav';

export const MEASURE_FIELDS = [
  // [pole, nazwa, jednostka, min, max] — zakres chroni przed literówką (725 zamiast 72,5)
  ['weight', 'Masa', 'kg', 25, 300],
  ['waist', 'Talia', 'cm', 40, 200],
  ['hips', 'Biodra', 'cm', 50, 200],
  ['chest', 'Klatka', 'cm', 50, 200],
  ['arm', 'Ramię', 'cm', 15, 70],
  ['thigh', 'Udo', 'cm', 30, 100],
  ['bf', '%BF', '%', 2, 70],
] as const;

export function lsiTone(lsi: number) {
  return lsi >= 90 ? 'ok' : lsi >= 80 ? 'warn' : 'danger';
}

export function testValue(t: TestResult) {
  if (t.left != null && t.right != null) return `L ${fnum(t.left)} / P ${fnum(t.right)}${t.unit ? ' ' + t.unit : ''}`;
  if (t.value == null || t.value === '') return '—';
  return `${typeof t.value === 'number' ? fnum(t.value, 2) : t.value}${t.unit ? ' ' + t.unit : ''}`;
}

export function ClientMeasurements({ client }: { client: Client }) {
  const { apply, ask } = useStore();
  const { openModal } = useNav();
  const ms = allMeasurements(client).sort((a, b) => b.date.localeCompare(a.date));
  const weight = ms.find((m) => m.weight != null)?.weight ?? null;
  const [field, setField] = useState<(typeof MEASURE_FIELDS)[number][0]>('weight');
  const pts = ms.filter((m) => m[field] != null).map((m) => ({ x: m.date, y: m[field]! }));

  const byName: Record<string, TestResult[]> = {};
  for (const t of client.tests) (byName[t.name] ??= []).push(t);
  for (const k in byName) byName[k].sort((a, b) => b.date.localeCompare(a.date));
  const names = Object.keys(byName).sort((a, b) => byName[b][0].date.localeCompare(byName[a][0].date));
  const [testName, setTestName] = useState<string | null>(null);
  const chosen = testName && byName[testName] ? testName : names[0];
  const testPts = chosen
    ? byName[chosen]
        .map((t) => ({ x: t.date, y: typeof t.value === 'number' ? t.value : t.lsi ?? NaN }))
        .filter((p) => Number.isFinite(p.y))
    : [];

  const removeMeasurement = async (id: string) => {
    if (!(await ask('Usunąć ten pomiar?'))) return;
    // pomiar od podopiecznego tylko ukrywamy (baza nie pozwala trenerowi nadpisać jego wpisów)
    await apply([put('clients', { ...client, measurements: client.measurements.filter((m) => m.id !== id), selfMeasurements: client.selfMeasurements?.map((m) => (m.id === id ? { ...m, hidden: true } : m)) })], 'Pomiar usunięty.');
  };
  const removeTest = async (id: string) => {
    if (await ask('Usunąć ten wynik testu?')) await apply([put('clients', { ...client, tests: client.tests.filter((t) => t.id !== id) })], 'Wynik usunięty.');
  };

  return (
    <>
      <div className="toolbar">
        <h3>Pomiary</h3>
        <button className="btn btn-primary" onClick={() => openModal({ kind: 'measurement', clientId: client.id })}>
          + Pomiar
        </button>
      </div>
      {ms.length === 0 ? (
        <Empty>Brak pomiarów.</Empty>
      ) : (
        <div className="two-col">
          <Card>
            <div className="chips">
              {MEASURE_FIELDS.filter(([k]) => ms.some((m) => m[k] != null)).map(([k, label]) => (
                <button key={k} className={`chip ${k === field ? 'active' : ''}`} onClick={() => setField(k)}>
                  {label}
                </button>
              ))}
            </div>
            <LineChart label="Pomiary" series={[{ label: field, pts }]} />
          </Card>
          <div className="card table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th>
                  {MEASURE_FIELDS.map(([k, label]) => (
                    <th key={k} className="num">
                      {label}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {ms.map((m) => (
                  <tr key={m.id} title={m.note}>
                    <td className="nowrap">{fmtDate(m.date)}{m.by === 'client' && <span className="muted small"> · podopieczny</span>}</td>
                    {MEASURE_FIELDS.map(([k]) => (
                      <td key={k} className="num">
                        {fnum(m[k])}
                      </td>
                    ))}
                    <td className="actions">
                      {m.by !== 'client' && client.measurements.some((x) => x.id === m.id) && <IconBtn icon="edit" label="Edytuj pomiar" onClick={() => openModal({ kind: 'measurement', clientId: client.id, measurement: m })} />}
                      <IconBtn icon="trash" label="Usuń pomiar" danger onClick={() => removeMeasurement(m.id)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="toolbar section-gap">
        <h3>Testy</h3>
        <button className="btn btn-primary" onClick={() => openModal({ kind: 'test', clientId: client.id })}>
          + Wynik testu
        </button>
      </div>
      {names.length === 0 ? (
        <Empty>Brak wyników testów.</Empty>
      ) : (
        <div className="two-col">
          <div className="stack">
            {names.map((n) => {
              const [last, prev] = byName[n];
              const rel = /^1RM/.test(n) && typeof last.value === 'number' ? relativeStrength(last.value, weight) : null;
              return (
                <button key={n} className={`card test-card ${n === chosen ? 'selected' : ''}`} onClick={() => setTestName(n)}>
                  <div className="row">
                    <strong className="grow">{n}</strong>
                    {last.lsi != null && <Tag tone={lsiTone(last.lsi)}>LSI {fnum(last.lsi)}%</Tag>}
                  </div>
                  <div className="row small">
                    <span className="grow">{testValue(last)}</span>
                    {rel != null && <span className="muted">{fnum(rel, 2)} × masa ciała</span>}
                    <span className="muted">{fmtDate(last.date)}</span>
                  </div>
                  {prev && <div className="muted small">poprzednio: {testValue(prev)}{prev.lsi != null ? ` · LSI ${fnum(prev.lsi)}%` : ''} ({fmtDate(prev.date)})</div>}
                </button>
              );
            })}
          </div>
          {chosen && (
            <Card title={chosen} action={<button className="btn btn-ghost btn-sm" onClick={() => openModal({ kind: 'test', clientId: client.id, name: chosen })}>+ Wynik</button>}>
              {testPts.length >= 2 && <LineChart label={chosen} series={[{ label: chosen, pts: testPts }]} />}
              <ul className="rows">
                {byName[chosen].map((t) => (
                  <li key={t.id} className="row">
                    <span className="row-time">{fmtDate(t.date)}</span>
                    <span className="grow">
                      {testValue(t)}
                      {t.involved && <span className="muted small"> · operowana: {t.involved === 'L' ? 'lewa' : 'prawa'}</span>}
                      {t.note && <div className="muted small">{t.note}</div>}
                    </span>
                    {t.lsi != null && <Tag tone={lsiTone(t.lsi)}>LSI {fnum(t.lsi)}%</Tag>}
                    <IconBtn icon="trash" label="Usuń wynik" danger onClick={() => removeTest(t.id)} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
