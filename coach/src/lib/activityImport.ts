import type { SessionExercise, SetLog } from '../domain';
import { todayISO } from './dates';
import { paceText } from './running';

/**
 * Import biegu z zegarka / eksportu Stravy: GPX, TCX i FIT (binarny) — wszystko w przeglądarce, bez serwera.
 * Plik ładowany dynamicznie (`import()`), więc parser nie zwiększa głównej paczki.
 *
 * FIT: własny, mały dekoder (nagłówek, definicje, dane, skompresowany znacznik czasu) tylko dla wiadomości
 * session (18), lap (19) i record (20). Pola deweloperskie i nieznane wiadomości są pomijane. CRC nie jest sprawdzane.
 */

export interface TrackPoint {
  /** ms od epoki; null — punkt bez czasu. */
  t: number | null;
  lat?: number;
  lon?: number;
  /** Dystans narastająco (m), jeśli zapisał go zegarek. */
  dist?: number;
  hr?: number;
}

export interface ActivitySplit {
  km: number;
  /** Czas w ruchu (min). */
  min: number;
  hr?: number;
}

export interface Activity {
  source: 'gpx' | 'tcx' | 'fit';
  name?: string;
  sport?: string;
  /** Start (ISO, UTC). */
  start: string | null;
  /** Data startu w lokalnej strefie (YYYY-MM-DD). */
  date: string | null;
  km: number;
  /** Czas całkowity i w ruchu (min). */
  elapsedMin: number;
  movingMin: number;
  avgHr?: number;
  maxHr?: number;
  /** Średnie tempo „5:24/km”. */
  pace: string;
  /** Odcinki co 1 km (ostatni niepełny, jeśli ≥ 50 m). */
  splits: ActivitySplit[];
  /** Okrążenia z zegarka (lap) — puste, gdy brak albo tylko jedno. */
  laps: ActivitySplit[];
}

/* ---------- wspólne ---------- */

const R = 6371008.8;
function haversine(a: TrackPoint, b: TrackPoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat! - a.lat!) * rad;
  const dLon = (b.lon! - a.lon!) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat! * rad) * Math.cos(b.lat! * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Poniżej tej prędkości (m/s) odcinek między punktami to postój (bez auto-pauzy w pliku). */
const MOVING_MS = 0.5;

/** Dystans narastająco (m): z zegarka, a jeśli go brak — z GPS. Punkty bez czasu odpadają. */
function cumulative(pts: TrackPoint[]): { t: number; d: number; hr?: number }[] {
  const timed = pts.filter((p) => p.t != null).sort((a, b) => a.t! - b.t!);
  const useDist = timed.filter((p) => p.dist != null).length >= timed.length * 0.5 && timed.some((p) => (p.dist ?? 0) > 0);
  const out: { t: number; d: number; hr?: number }[] = [];
  let d = 0;
  let prevGeo: TrackPoint | null = null;
  for (const p of timed) {
    if (useDist) {
      if (p.dist != null && p.dist >= d) d = p.dist;
    } else if (p.lat != null && p.lon != null) {
      if (prevGeo) d += haversine(prevGeo, p);
      prevGeo = p;
    }
    out.push({ t: p.t!, d, hr: p.hr });
  }
  return out;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** Minuty z dokładnością do ~0,01 s — sumy okrążeń zgadzają się co do sekundy z zegarkiem. */
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** Podsumowanie z punktów trasy: dystans, czasy, tętno, odcinki co 1 km. */
export function summarize(pts: TrackPoint[], over: Partial<Activity> & { source: Activity['source'] }): Activity {
  const c = cumulative(pts);
  let moving = 0;
  let hrSum = 0;
  let hrW = 0;
  let maxHr = 0;
  const splits: ActivitySplit[] = [];
  let splitStartMove = 0;
  let splitHrSum = 0;
  let splitHrW = 0;
  let nextKm = 1000;
  let lastSplitD = 0;
  for (let i = 0; i < c.length; i++) {
    const p = c[i];
    if (p.hr && p.hr > 25 && p.hr < 250) maxHr = Math.max(maxHr, p.hr);
    if (i === 0) continue;
    const a = c[i - 1];
    const dt = (p.t - a.t) / 1000;
    const dd = p.d - a.d;
    if (dt <= 0) continue;
    const isMoving = dd / dt >= MOVING_MS;
    const mv = isMoving ? dt : 0;
    const hr = p.hr && p.hr > 25 && p.hr < 250 ? p.hr : a.hr && a.hr > 25 && a.hr < 250 ? a.hr : undefined;
    // granica kilometra w środku odcinka: czas i tętno dzielone proporcjonalnie
    let from = a.d;
    let movedHere = 0;
    while (p.d >= nextKm && dd > 0) {
      const frac = (nextKm - from) / dd;
      const part = mv * frac;
      movedHere += part;
      if (hr && part > 0) (splitHrSum += hr * part), (splitHrW += part);
      const min = (moving + movedHere - splitStartMove) / 60;
      splits.push({ km: 1, min: r4(min), hr: splitHrW ? Math.round(splitHrSum / splitHrW) : undefined });
      splitStartMove = moving + movedHere;
      splitHrSum = 0;
      splitHrW = 0;
      lastSplitD = nextKm;
      from = nextKm;
      nextKm += 1000;
    }
    const rest = mv - movedHere;
    if (hr && rest > 0) (splitHrSum += hr * rest), (splitHrW += rest);
    if (hr && mv > 0) (hrSum += hr * mv), (hrW += mv);
    moving += mv;
  }
  const total = c.length ? c[c.length - 1].d : 0;
  if (total - lastSplitD >= 50) {
    splits.push({ km: r3((total - lastSplitD) / 1000), min: r4((moving - splitStartMove) / 60), hr: splitHrW ? Math.round(splitHrSum / splitHrW) : undefined });
  }
  const elapsed = c.length > 1 ? (c[c.length - 1].t - c[0].t) / 60000 : 0;
  const start = c.length ? new Date(c[0].t).toISOString() : null;
  const km = r3(total / 1000);
  const a: Activity = {
    source: over.source,
    start,
    date: start ? todayISO(new Date(start)) : null,
    km,
    elapsedMin: r2(elapsed),
    movingMin: r4(moving / 60),
    avgHr: hrW ? Math.round(hrSum / hrW) : undefined,
    maxHr: maxHr || undefined,
    pace: '',
    splits,
    laps: [],
  };
  // wartości z podsumowania zegarka (lap / session) mają pierwszeństwo przed liczonymi z punktów
  for (const [k, v] of Object.entries(over)) if (v !== undefined && v !== null && !(Array.isArray(v) && !v.length)) (a as unknown as Record<string, unknown>)[k] = v;
  if (a.start && !over.date) a.date = todayISO(new Date(a.start));
  if (!a.elapsedMin || a.elapsedMin < a.movingMin) a.elapsedMin = a.movingMin;
  a.pace = paceText(a.movingMin || a.elapsedMin, a.km);
  return a;
}

/* ---------- XML (GPX, TCX) — bez DOMParsera, żeby działało też w testach i workerach ---------- */

/** Treść pierwszego znacznika o nazwie (z dowolnym prefiksem przestrzeni nazw). */
function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'i'));
  return m ? m[1].trim() : undefined;
}
function blocks(xml: string, name: string): { attrs: string; body: string }[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${name}(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>)`, 'gi');
  return [...xml.matchAll(re)].map((m) => ({ attrs: m[1] ?? '', body: m[2] ?? '' }));
}
function attr(attrs: string, name: string): string | undefined {
  return attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
}
const numOf = (v: string | undefined) => (v != null && v !== '' && Number.isFinite(+v) ? +v : undefined);
const timeOf = (v: string | undefined) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};
const unxml = (s: string | undefined) => s?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim() || undefined;

export function parseGpx(xml: string): Activity {
  const pts: TrackPoint[] = blocks(xml, 'trkpt').map(({ attrs, body }) => ({
    t: timeOf(tag(body, 'time')),
    lat: numOf(attr(attrs, 'lat')),
    lon: numOf(attr(attrs, 'lon')),
    // Garmin / Strava: <gpxtpx:hr>, inne: <hr>, <heartrate>
    hr: numOf(tag(body, 'hr') ?? tag(body, 'heartrate')),
  }));
  if (!pts.length) throw new Error('W pliku GPX nie ma punktów trasy (trkpt).');
  const trk = tag(xml, 'trk') ?? '';
  return summarize(pts, { source: 'gpx', name: unxml(tag(trk, 'name')), sport: unxml(tag(trk, 'type')) });
}

export function parseTcx(xml: string): Activity {
  const act = blocks(xml, 'Activity')[0];
  if (!act) throw new Error('W pliku TCX nie ma treningu (Activity).');
  const pts: TrackPoint[] = [];
  const laps: (ActivitySplit & { max?: number; secs: number })[] = [];
  for (const lap of blocks(act.body, 'Lap')) {
    const secs = numOf(tag(lap.body, 'TotalTimeSeconds'));
    // dystans okrążenia: znacznik bezpośrednio w Lap, nie w punktach (te są w <Track>)
    const head = lap.body.replace(/<(?:[\w-]+:)?Track[\s>][\s\S]*$/i, '');
    const m = numOf(tag(head, 'DistanceMeters'));
    const avg = numOf(tag(tag(head, 'AverageHeartRateBpm') ?? '', 'Value'));
    const max = numOf(tag(tag(head, 'MaximumHeartRateBpm') ?? '', 'Value'));
    if (secs != null && m != null) laps.push({ km: r3(m / 1000), min: r4(secs / 60), secs, hr: avg ? Math.round(avg) : undefined, max });
    for (const tp of blocks(lap.body, 'Trackpoint')) {
      const pos = tag(tp.body, 'Position') ?? '';
      pts.push({
        t: timeOf(tag(tp.body, 'Time')),
        lat: numOf(tag(pos, 'LatitudeDegrees')),
        lon: numOf(tag(pos, 'LongitudeDegrees')),
        dist: numOf(tag(tp.body, 'DistanceMeters')),
        hr: numOf(tag(tag(tp.body, 'HeartRateBpm') ?? '', 'Value')),
      });
    }
  }
  // suma z sekund (nie z zaokrąglonych minut okrążeń): 12 okrążeń nie „gubi” sekundy
  const sum = laps.reduce((a, l) => ({ km: a.km + l.km, min: a.min + l.secs / 60 }), { km: 0, min: 0 });
  const hrLaps = laps.filter((l) => l.hr);
  const avgHr = hrLaps.length && sum.min ? Math.round(hrLaps.reduce((a, l) => a + l.hr! * l.min, 0) / hrLaps.reduce((a, l) => a + l.min, 0)) : undefined;
  const maxHr = laps.reduce((a, l) => Math.max(a, l.max ?? 0), 0) || undefined;
  if (!pts.length && !laps.length) throw new Error('W pliku TCX nie ma okrążeń ani punktów.');
  return summarize(pts, {
    source: 'tcx',
    sport: attr(act.attrs, 'Sport'),
    name: unxml(tag(act.body, 'Notes')),
    start: (() => {
      const t = timeOf(tag(act.body, 'Id')) ?? timeOf(attr(blocks(act.body, 'Lap')[0]?.attrs ?? '', 'StartTime'));
      return t != null ? new Date(t).toISOString() : undefined;
    })() as string | undefined,
    // okrążenia zegarka: TotalTimeSeconds = czas stopera (bez auto-pauzy) → czas w ruchu
    ...(laps.length ? { km: r3(sum.km), movingMin: r4(sum.min), avgHr, maxHr } : {}),
    laps: laps.length > 1 ? laps.map(({ max: _m, secs: _s, ...l }) => l) : [],
  });
}

/* ---------- FIT ---------- */

/** Sekundy między 1970-01-01 a epoką FIT (1989-12-31 00:00 UTC). */
const FIT_EPOCH = 631065600;

interface FieldDef {
  num: number;
  size: number;
  base: number;
}
interface MsgDef {
  global: number;
  little: boolean;
  fields: FieldDef[];
  devSize: number;
}
type FitMsg = Record<number, number>;

/** Wartość „brak” dla typu bazowego FIT (same jedynki / 0 dla typów z „z”). */
function invalid(base: number, v: number): boolean {
  switch (base & 0x1f) {
    case 0x00: // enum
    case 0x02: // uint8
    case 0x0d: // byte
      return v === 0xff;
    case 0x01:
      return v === 0x7f;
    case 0x03:
      return v === 0x7fff;
    case 0x04:
      return v === 0xffff;
    case 0x05:
      return v === 0x7fffffff;
    case 0x06:
      return v === 0xffffffff;
    case 0x0a:
    case 0x0b:
    case 0x0c:
      return v === 0;
    default:
      return false;
  }
}

/** Rozmiar (bajty) typu bazowego FIT; pole dłuższe to tablica — czytamy pierwszy element. */
const BASE_SIZE: Record<number, number> = { 0x00: 1, 0x01: 1, 0x02: 1, 0x03: 2, 0x04: 2, 0x05: 4, 0x06: 4, 0x08: 4, 0x09: 8, 0x0a: 1, 0x0b: 2, 0x0c: 4, 0x0d: 1 };

function readNum(dv: DataView, off: number, f: FieldDef, little: boolean): number | undefined {
  const t = f.base & 0x1f;
  const n = BASE_SIZE[t];
  if (!n || f.size < n) return undefined; // tekst, 64-bit i nieznane typy — pomijamy
  const v =
    t === 0x01 ? dv.getInt8(off)
    : n === 1 ? dv.getUint8(off)
    : t === 0x03 ? dv.getInt16(off, little)
    : n === 2 ? dv.getUint16(off, little)
    : t === 0x05 ? dv.getInt32(off, little)
    : t === 0x08 ? dv.getFloat32(off, little)
    : t === 0x09 ? dv.getFloat64(off, little)
    : dv.getUint32(off, little);
  return invalid(f.base, v) || !Number.isFinite(v) ? undefined : v;
}

/** Wiadomości session / lap / record z pliku FIT (wartości surowe — skale w `parseFit`). */
export function decodeFit(buf: ArrayBuffer | Uint8Array): { session: FitMsg[]; lap: FitMsg[]; record: FitMsg[] } {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length < 12) throw new Error('Plik FIT jest za krótki.');
  const hsize = u8[0];
  if ((hsize !== 12 && hsize !== 14) || String.fromCharCode(u8[8], u8[9], u8[10], u8[11]) !== '.FIT') throw new Error('To nie jest plik FIT.');
  const dataSize = dv.getUint32(4, true);
  const end = Math.min(u8.length, hsize + dataSize);
  const defs = new Map<number, MsgDef>();
  const out = { session: [] as FitMsg[], lap: [] as FitMsg[], record: [] as FitMsg[] };
  const want: Record<number, keyof typeof out> = { 18: 'session', 19: 'lap', 20: 'record' };
  let pos = hsize;
  let lastTs = 0;
  while (pos < end) {
    const h = u8[pos++];
    if (h & 0x80) {
      // skompresowany nagłówek: lokalny typ w bitach 5–6, przesunięcie czasu (5 bitów)
      const local = (h >> 5) & 0x03;
      const off = h & 0x1f;
      const def = defs.get(local);
      if (!def) throw new Error('Uszkodzony plik FIT (brak definicji).');
      lastTs = lastTs - (lastTs % 32) + off + (off < lastTs % 32 ? 32 : 0);
      const msg = readData(dv, pos, def);
      pos += def.fields.reduce((a, f) => a + f.size, 0) + def.devSize;
      if (msg[253] == null) msg[253] = lastTs;
      if (want[def.global]) out[want[def.global]].push(msg);
      continue;
    }
    const local = h & 0x0f;
    if (h & 0x40) {
      const little = u8[pos + 1] === 0;
      const global = little ? dv.getUint16(pos + 2, true) : dv.getUint16(pos + 2, false);
      const n = u8[pos + 4];
      pos += 5;
      const fields: FieldDef[] = [];
      for (let i = 0; i < n; i++, pos += 3) fields.push({ num: u8[pos], size: u8[pos + 1], base: u8[pos + 2] });
      let devSize = 0;
      if (h & 0x20) {
        const nd = u8[pos++];
        for (let i = 0; i < nd; i++, pos += 3) devSize += u8[pos + 1];
      }
      defs.set(local, { global, little, fields, devSize });
      continue;
    }
    const def = defs.get(local);
    if (!def) throw new Error('Uszkodzony plik FIT (brak definicji).');
    const msg = readData(dv, pos, def);
    pos += def.fields.reduce((a, f) => a + f.size, 0) + def.devSize;
    if (msg[253] != null) lastTs = msg[253];
    if (want[def.global]) out[want[def.global]].push(msg);
  }
  return out;
}

function readData(dv: DataView, pos: number, def: MsgDef): FitMsg {
  const msg: FitMsg = {};
  let off = pos;
  for (const f of def.fields) {
    if (off + f.size > dv.byteLength) throw new Error('Uszkodzony plik FIT (ucięty).');
    const v = readNum(dv, off, f, def.little);
    if (v !== undefined) msg[f.num] = v;
    off += f.size;
  }
  return msg;
}

const fitTime = (v: number | undefined) => (v != null ? (v + FIT_EPOCH) * 1000 : null);
const SPORTS: Record<number, string> = { 1: 'running', 2: 'cycling', 5: 'swimming', 11: 'walking', 17: 'hiking' };

export function parseFit(buf: ArrayBuffer | Uint8Array): Activity {
  const { session, lap, record } = decodeFit(buf);
  const semi = 180 / 2 ** 31;
  const pts: TrackPoint[] = record.map((r) => ({
    t: fitTime(r[253]),
    lat: r[0] != null ? r[0] * semi : undefined,
    lon: r[1] != null ? r[1] * semi : undefined,
    dist: r[5] != null ? r[5] / 100 : undefined,
    hr: r[3],
  }));
  // pola lap: 2 start, 7 czas całkowity, 8 czas stopera (ms), 9 dystans (cm), 15 / 16 tętno śr. / maks.
  const laps: ActivitySplit[] = lap.filter((l) => l[9] != null && (l[8] ?? l[7]) != null).map((l) => ({ km: r3(l[9] / 100000), min: r4((l[8] ?? l[7]) / 60000), hr: l[15] }));
  const s = session[0];
  if (!pts.length && !s && !laps.length) throw new Error('W pliku FIT nie ma treningu (session / lap / record).');
  // pola session: 2 start, 5 sport, 7 czas całkowity, 8 czas stopera, 9 dystans, 16 / 17 tętno śr. / maks.
  const st = fitTime(s?.[2]) ?? fitTime(lap[0]?.[2]);
  return summarize(pts, {
    source: 'fit',
    sport: s?.[5] != null ? SPORTS[s[5]] ?? String(s[5]) : undefined,
    start: st != null ? new Date(st).toISOString() : (undefined as unknown as string),
    km: s?.[9] != null ? r3(s[9] / 100000) : undefined,
    elapsedMin: s?.[7] != null ? r4(s[7] / 60000) : undefined,
    movingMin: s?.[8] != null ? r4(s[8] / 60000) : undefined,
    avgHr: s?.[16],
    maxHr: s?.[17],
    laps: laps.length > 1 ? laps : [],
  });
}

/* ---------- wejście ---------- */

/** Rozpoznaje format po rozszerzeniu albo zawartości i parsuje. */
export function parseActivity(name: string, data: ArrayBuffer): Activity {
  const u8 = new Uint8Array(data);
  const ext = name.toLowerCase().split('.').pop();
  const isFit = u8.length >= 12 && String.fromCharCode(u8[8], u8[9], u8[10], u8[11]) === '.FIT';
  if (isFit || ext === 'fit') return parseFit(u8);
  const xml = new TextDecoder('utf-8').decode(u8);
  if (/<(?:[\w-]+:)?TrainingCenterDatabase/i.test(xml) || ext === 'tcx') return parseTcx(xml);
  if (/<gpx[\s>]/i.test(xml) || ext === 'gpx') return parseGpx(xml);
  throw new Error('Nieznany format — wybierz plik GPX, TCX albo FIT.');
}

/**
 * Odcinki do zapisu: okrążenia z zegarka (gdy jest ich kilka), inaczej odcinki co 1 km.
 * Wiersz = czas (min) w `reps`, km w `dist`, średnie tętno w `hr` — jak odcinki cardio w aplikacji.
 */
export function activityRows(a: Activity, useLaps = a.laps.length > 1): SetLog[] {
  const segs = useLaps && a.laps.length ? a.laps : a.splits.length ? a.splits : [{ km: a.km, min: a.movingMin || a.elapsedMin, hr: a.avgHr }];
  return segs.filter((x) => x.km > 0 || x.min > 0).map((x) => ({ reps: r4(x.min), unit: 'min' as const, dist: r3(x.km), ...(x.hr ? { hr: Math.round(x.hr) } : {}), done: true }));
}

/** Ćwiczenie cardio do treningu z zaimportowanej aktywności. */
export function activityExercise(a: Activity, useLaps?: boolean): SessionExercise {
  const name = /cycl|bik|rower/i.test(a.sport ?? '') ? 'Rower' : /walk|hik|spacer|marsz/i.test(a.sport ?? '') ? 'Marsz' : 'Bieg';
  return { name, cardio: true, setsLog: activityRows(a, useLaps) };
}
