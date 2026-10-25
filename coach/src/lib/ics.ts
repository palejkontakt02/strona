import type { Appointment } from '../domain';

/** Plik kalendarza (.ics) z wizytą — czas w strefie Europe/Warsaw (z definicją strefy, działa w Apple / Google / Outlook). */

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Warsaw',
  'X-LIC-LOCATION:Europe/Warsaw',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/** Tekst w polu iCalendar: \\ ; , i nowe linie. */
export const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Łamanie linii po 75 bajtach (UTF-8), kontynuacja od spacji. */
export function icsFold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const max = out.length ? 74 : 75;
    if (bytes + b > max) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const local = (date: string, mins: number) => {
  // data + minuty od północy (może przejść na następny dzień)
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(mins);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}00`;
};

const stamp = (now: Date) => now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

export function apptIcs(a: Appointment, opts: { title?: string; location?: string; now?: Date } = {}): string {
  const [hh, mm] = /^\d{1,2}:\d{2}$/.test(a.time) ? a.time.split(':').map(Number) : [0, 0];
  const start = hh * 60 + mm;
  const dur = a.duration || 60;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Fitowa//Wizyty//PL',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...VTIMEZONE,
    'BEGIN:VEVENT',
    `UID:${a.id}@fitowa`,
    `DTSTAMP:${stamp(opts.now ?? new Date())}`,
    `DTSTART;TZID=Europe/Warsaw:${local(a.date, start)}`,
    `DTEND;TZID=Europe/Warsaw:${local(a.date, start + dur)}`,
    `SUMMARY:${icsEscape(opts.title ?? 'Trening z trenerem')}`,
    ...(opts.location || a.location ? [`LOCATION:${icsEscape(opts.location || a.location || '')}`] : []),
    ...(a.note ? [`DESCRIPTION:${icsEscape(a.note)}`] : []),
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Trening za godzinę',
    'TRIGGER:-PT1H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

/** Nazwa pliku: „trening-2026-10-27.ics”. */
export const icsName = (a: Pick<Appointment, 'date'>) => `trening-${a.date}.ics`;
