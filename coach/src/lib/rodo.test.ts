import { describe, expect, it } from 'vitest';
import type { Client } from '../domain';
import { createSeed } from '../data/seed';
import { ERASURE_PREFIX, consentDate, consentEntry, consentState, consentWithdrawn, erasureStatus, exportData, exportFileName, hasConsent, isArchived, needsConsentPrompt, sessionsCsv } from './rodo';

const base = { id: 'c1', name: 'Jan', status: 'aktywny', payments: [], measurements: [], tests: [], injuryLog: [], checkins: [] } as Client;

describe('rodo: zgody', () => {
  it('brak decyzji = brak zgody; stara zgoda z ankiety liczy się dla zdrowia', () => {
    expect(hasConsent(base, 'health')).toBe(false);
    expect(consentState(base, 'media')).toBe('unset');
    expect(needsConsentPrompt(base)).toBe(true);
    const legacy = { ...base, intake: { answers: {}, consentAt: '2026-01-02T10:00:00Z' } };
    expect(hasConsent(legacy, 'health')).toBe(true);
    expect(consentDate(legacy, 'health')).toBe('2026-01-02T10:00:00Z');
    expect(hasConsent(legacy, 'media')).toBe(false);
  });

  it('udzielenie, wycofanie, ponowne udzielenie — daty i historia', () => {
    const a = consentEntry(undefined, 'media', true, '2026-10-01T00:00:00Z');
    expect(a).toMatchObject({ id: 'media', on: true, givenAt: '2026-10-01T00:00:00Z', v: 1 });
    const b = consentEntry(a, 'media', false, '2026-10-05T00:00:00Z');
    expect(b).toMatchObject({ on: false, givenAt: '2026-10-01T00:00:00Z', withdrawnAt: '2026-10-05T00:00:00Z' });
    const c = consentEntry(b, 'media', true, '2026-10-09T00:00:00Z');
    expect(c.givenAt).toBe('2026-10-09T00:00:00Z');
    expect(c.log).toHaveLength(3);
    // ten sam stan — bez nowej daty
    expect(consentEntry(c, 'media', true, '2026-10-10T00:00:00Z').at).toBe('2026-10-09T00:00:00Z');

    const cl = { ...base, consents: [a, b] };
    expect(hasConsent(cl, 'media')).toBe(false);
    expect(consentWithdrawn(cl, 'media')).toBe(true);
    expect(consentDate(cl, 'media')).toBe('2026-10-05T00:00:00Z');
    // wycofanie zdrowia wygrywa ze starą zgodą z ankiety
    const h = { ...base, intake: { answers: {}, consentAt: '2026-01-01' }, consents: [consentEntry(undefined, 'health', false)] };
    expect(hasConsent(h, 'health')).toBe(false);
    expect(needsConsentPrompt({ ...base, consents: [a, consentEntry(undefined, 'health', false)] })).toBe(false);
  });

  it('prośba o usunięcie: wysłana → odczytana', () => {
    const e = consentEntry(undefined, 'erasure', true, '2026-10-20T08:00:00Z');
    const c = { ...base, consents: [e], inbox: [{ id: 'n0', at: '2026-10-01T08:00:00Z', text: 'Cześć', read: true }, { id: 'n1', at: '2026-10-20T08:00:00Z', text: ERASURE_PREFIX + ': proszę…' }] };
    expect(erasureStatus(c)).toEqual({ state: 'sent', at: '2026-10-20T08:00:00Z' });
    expect(erasureStatus({ ...c, inbox: [c.inbox[0], { ...c.inbox[1], read: true }] }).state).toBe('read');
    expect(erasureStatus({ ...c, consents: [e, consentEntry(e, 'erasure', false)] }).state).toBe('none');
    expect(isArchived({ status: 'zakończony' })).toBe(true);
    expect(isArchived({ status: 'pauza' })).toBe(false);
  });
});

describe('rodo: eksport', () => {
  const db = createSeed('2026-10-25');
  const me = db.clients[0];
  const other = db.clients[1];

  it('tylko dane tego podopiecznego, bez odwołań do innych', () => {
    // trening w parze z innym klientem
    const s0 = db.sessions.find((s) => s.clientId === me.id)!;
    const withPair = { ...db, sessions: db.sessions.map((s) => (s.id === s0.id ? { ...s, withIds: [other.id] } : s)) };
    const out = exportData(withPair, me.id, new Date('2026-10-25T10:00:00Z'))!;
    expect(out.profile.id).toBe(me.id);
    expect(out.sessions.length).toBeGreaterThan(0);
    expect(out.sessions.every((s) => s.clientId === me.id)).toBe(true);
    expect(out.plans.every((p) => p.clientId === me.id && !p.template)).toBe(true);
    expect(out.appointments.every((a) => a.clientId === me.id)).toBe(true);
    const json = JSON.stringify(out);
    expect(json).not.toContain(other.id);
    expect(json).not.toContain(other.name);
    expect(exportData(db, 'nie-ma')).toBeNull();
  });

  it('CSV treningów: średnik, przecinek dziesiętny, cudzysłowy', () => {
    const csv = sessionsCsv([
      { id: 's', clientId: 'c1', date: '2026-10-01', charge: 'brak', workoutName: 'A; siła', exercises: [{ name: 'Przysiad "high bar"', setsLog: [{ load: 62.5, reps: 5, rpe: 8 }, { load: 70, reps: 3 }] }] },
    ]);
    const lines = csv.replace('﻿', '').trim().split('\r\n');
    expect(lines[0].startsWith('data;trening')).toBe(true);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"A; siła"');
    expect(lines[1]).toContain('"Przysiad ""high bar"""');
    expect(lines[1]).toContain(';62,5;5;');
    expect(sessionsCsv([{ id: 't', clientId: 'c1', date: '2026-10-02', charge: 'brak', exercises: [{ name: 'Wyciskanie', load: '72.5', reps: '8' }] }])).toContain(';72,5;8;');
    expect(exportFileName('Łukasz Żółć', 'json', '2026-10-25')).toBe('fitowa-dane-lukasz-zolc-2026-10-25.json');
  });
});
