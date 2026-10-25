import { describe, expect, it } from 'vitest';
import type { Appointment, Client } from '../domain';
import { apptReplyState, apptStart, apptWithReply, hoursUntil, isLateCancel } from './appts';
import { extFor, fmtClock, mediaLabel, pickAudioMime, refFor, refText, splitStamps, threadForSession } from './chat';
import { apptIcs, icsEscape, icsFold } from './ics';

const appt = (p: Partial<Appointment> = {}): Appointment => ({ id: 'a1', clientId: 'c1', date: '2026-10-27', time: '18:00', status: 'planned', ...p });

describe('wizyty: czas polski i odwołanie', () => {
  it('początek wizyty w strefie Europe/Warsaw (zima i lato)', () => {
    expect(apptStart(appt()).toISOString()).toBe('2026-10-27T17:00:00.000Z'); // CET +1
    expect(apptStart(appt({ date: '2026-07-01', time: '07:30' })).toISOString()).toBe('2026-07-01T05:30:00.000Z'); // CEST +2
    // dzień zmiany czasu (25 paź 2026, 3:00 → 2:00)
    expect(apptStart(appt({ date: '2026-10-25', time: '12:00' })).toISOString()).toBe('2026-10-25T11:00:00.000Z');
  });
  it('odwołanie krócej niż 24 h przed = późne', () => {
    const now = new Date('2026-10-26T18:00:00Z'); // 19:00 w Polsce, wizyta jutro 18:00 → 23 h
    expect(Math.round(hoursUntil(appt(), now))).toBe(23);
    expect(isLateCancel(appt(), now)).toBe(true);
    expect(isLateCancel(appt(), new Date('2026-10-26T16:00:00Z'))).toBe(false);
  });
  it('odpowiedź: potwierdzenie nie zmienia statusu, odwołanie ustawia cancel z powodem', () => {
    const now = new Date('2026-10-26T18:00:00Z');
    const c = apptWithReply(appt(), 'confirm', 'nieważne', now);
    expect(c.status).toBe('planned');
    expect(c.reply).toEqual({ kind: 'confirm', at: now.toISOString() });
    expect(apptReplyState(c)).toBe('confirmed');
    const x = apptWithReply(appt(), 'cancel', '  Choroba  ', now);
    expect(x.status).toBe('cancel');
    expect(x.reply).toEqual({ kind: 'cancel', at: now.toISOString(), reason: 'Choroba', late: true });
    expect(apptReplyState(x)).toBe('cancelled-late');
    expect(apptReplyState(apptWithReply(appt(), 'cancel', '', new Date('2026-10-20T10:00:00Z')))).toBe('cancelled');
    expect(apptReplyState(appt())).toBeNull();
  });
});

describe('.ics', () => {
  it('wydarzenie w Europe/Warsaw z VTIMEZONE, CRLF i przypomnieniem', () => {
    const ics = apptIcs(appt({ duration: 90, location: 'Studio, sala 2', note: 'Zabierz buty' }), { now: new Date('2026-10-25T10:00:00Z') });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('TZID:Europe/Warsaw');
    expect(ics).toContain('DTSTART;TZID=Europe/Warsaw:20261027T180000');
    expect(ics).toContain('DTEND;TZID=Europe/Warsaw:20261027T193000');
    expect(ics).toContain('LOCATION:Studio\\, sala 2');
    expect(ics).toContain('DTSTAMP:20261025T100000Z');
    expect(ics).toContain('UID:a1@fitowa');
    expect(ics).toContain('TRIGGER:-PT1H');
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
  it('wizyta przez północ kończy się następnego dnia', () => {
    expect(apptIcs(appt({ time: '23:30', duration: 60 }))).toContain('DTEND;TZID=Europe/Warsaw:20261028T003000');
  });
  it('escape i łamanie długich linii (UTF-8)', () => {
    expect(icsEscape('a;b,c\\d\ne')).toBe('a\;b\\,c\\\\d\\ne');
    const long = 'DESCRIPTION:' + 'ż'.repeat(60);
    const folded = icsFold(long);
    expect(folded.split('\r\n ').join('')).toBe(long);
    expect(folded.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
});

describe('rozmowa: kontekst, znaczniki czasu, media', () => {
  const s = { id: 's1', date: '2026-10-25', workoutName: 'Trening 1', exercises: [{ name: 'Wyciskanie' }, { name: 'Przysiad' }] } as never;
  it('ref z treningu i ćwiczenia → „Trening 1 · Przysiad, 25 paź”', () => {
    const r = refFor(s, 1);
    expect(r).toEqual({ sessionId: 's1', exIndex: 1, exName: 'Przysiad', workout: 'Trening 1', date: '2026-10-25' });
    expect(refText(r)).toBe('Trening 1 · Przysiad, 25 paź');
    expect(refText(refFor(s))).toBe('Trening 1, 25 paź');
    // trening w trakcie (bez zapisu) — nazwa ćwiczenia z etykiety
    expect(refText(refFor(undefined, 0, { label: 'Martwy ciąg', date: '2026-10-25' }))).toBe('Trening · Martwy ciąg, 25 paź');
  });
  it('wątek treningu: przypięte wiadomości i odpowiedzi trenera na nie', () => {
    const c: Pick<Client, 'inbox' | 'replies'> = {
      inbox: [
        { id: 'n1', at: '2026-10-25T10:00:00Z', text: 'Bolało przy 3. serii', ref: { sessionId: 's1', exIndex: 1 } },
        { id: 'n2', at: '2026-10-25T11:00:00Z', text: 'Inny temat' },
        { id: 'n3', at: '2026-10-25T09:00:00Z', text: 'Z podsumowania', sessionId: 's1' },
      ],
      replies: [
        { id: 'r1', at: '2026-10-25T12:00:00Z', text: 'Zmniejsz ciężar', replyTo: 'n1' },
        { id: 'r2', at: '2026-10-25T12:30:00Z', text: 'Ogólnie', ref: { sessionId: 's1' } },
        { id: 'r3', at: '2026-10-25T13:00:00Z', text: 'Nie o tym' },
      ],
    };
    expect(threadForSession(c, 's1').map((m) => m.id)).toEqual(['n3', 'n1', 'r1', 'r2']);
  });
  it('znaczniki czasu m:ss', () => {
    expect(splitStamps('0:07 — kolana do środka, 1:12 lepiej')).toEqual([
      { text: '0:07', t: 7 },
      { text: ' — kolana do środka, ' },
      { text: '1:12', t: 72 },
      { text: ' lepiej' },
    ]);
    expect(splitStamps('o 18:00:00 nie')).toEqual([{ text: 'o 18:00:00 nie' }]);
    expect(splitStamps('bez czasu')).toEqual([{ text: 'bez czasu' }]);
    expect(fmtClock(7.9)).toBe('0:07');
    expect(fmtClock(65)).toBe('1:05');
  });
  it('format głosu: mp4 gdy wspierany (iOS), inaczej webm (Android)', () => {
    expect(pickAudioMime((m) => m.startsWith('audio/mp4'))).toBe('audio/mp4;codecs=mp4a.40.2');
    expect(pickAudioMime((m) => m.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus');
    expect(pickAudioMime(() => false)).toBe('');
    expect(extFor('audio/mp4')).toBe('m4a');
    expect(extFor('audio/webm;codecs=opus')).toBe('webm');
    expect(mediaLabel('audio')).toBe('Wiadomość głosowa');
  });
});
