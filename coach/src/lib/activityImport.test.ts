import { describe, expect, it } from 'vitest';
import { activityExercise, activityRows, decodeFit, parseActivity, parseFit, parseGpx, parseTcx } from './activityImport';
import { runTotals } from './running';

/* ---------- fixtures (generowane w teście) ---------- */

const T0 = Date.UTC(2026, 9, 20, 6, 30, 0); // 20.10.2026 08:30 czasu PL
const M_PER_DEG = 111195; // ~ metry na stopień szerokości
const iso = (ms: number) => new Date(ms).toISOString();

/** Bieg na północ: `speed` m/s, punkt co `step` s, tętno rośnie liniowo; opcjonalna pauza (stoi `pause` s po `pauseAt` m). */
function track(meters: number, speed = 1000 / 300, step = 5, pause?: { at: number; secs: number }) {
  const pts: { t: number; lat: number; lon: number; d: number; hr: number }[] = [];
  let t = T0;
  let d = 0;
  let paused = false;
  while (d <= meters + 1e-6) {
    pts.push({ t, lat: 52 + d / M_PER_DEG, lon: 21, d, hr: Math.round(140 + (20 * d) / meters) });
    if (pause && !paused && d >= pause.at) {
      paused = true;
      t += pause.secs * 1000;
      pts.push({ t, lat: 52 + d / M_PER_DEG, lon: 21, d, hr: 120 });
    }
    t += step * 1000;
    d += speed * step;
  }
  return pts;
}

function gpx(pts: ReturnType<typeof track>) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="StravaGPX" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
 <metadata><time>${iso(T0)}</time></metadata>
 <trk><name>Poranny bieg &amp; kawa</name><type>running</type><trkseg>
${pts.map((p) => `  <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon}"><ele>100</ele><time>${iso(p.t)}</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${p.hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>`).join('\n')}
 </trkseg></trk>
</gpx>`;
}

function tcx() {
  // dwa okrążenia po 1 km: 5:00 i 5:10, tętno 150 / 160
  const lap = (start: number, secs: number, d0: number, hr: number, max: number) => `
   <Lap StartTime="${iso(start)}">
    <TotalTimeSeconds>${secs}</TotalTimeSeconds><DistanceMeters>1000</DistanceMeters>
    <AverageHeartRateBpm><Value>${hr}</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>${max}</Value></MaximumHeartRateBpm>
    <Intensity>Active</Intensity><TriggerMethod>Distance</TriggerMethod>
    <Track>${Array.from({ length: 11 }, (_, i) => `
     <Trackpoint><Time>${iso(start + (i * secs * 1000) / 10)}</Time><Position><LatitudeDegrees>52</LatitudeDegrees><LongitudeDegrees>21</LongitudeDegrees></Position><DistanceMeters>${d0 + i * 100}</DistanceMeters><HeartRateBpm><Value>${hr}</Value></HeartRateBpm></Trackpoint>`).join('')}
    </Track>
   </Lap>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
 <Activities>
  <Activity Sport="Running">
   <Id>${iso(T0)}</Id>${lap(T0, 300, 0, 150, 158)}${lap(T0 + 300000, 310, 1000, 160, 171)}
  </Activity>
 </Activities>
</TrainingCenterDatabase>`;
}

/** Mały, poprawny plik FIT: definicje + dane record / lap / session, jeden rekord ze skompresowanym czasem i jedna definicja big-endian. */
function fit(): Uint8Array {
  const bytes: number[] = [];
  const u8 = (v: number) => bytes.push(v & 0xff);
  const u16 = (v: number, be = false) => (be ? [v >> 8, v] : [v, v >> 8]).forEach(u8);
  const u32 = (v: number, be = false) => (be ? [v >>> 24, v >>> 16, v >>> 8, v] : [v, v >>> 8, v >>> 16, v >>> 24]).forEach(u8);
  const def = (local: number, global: number, fields: [number, number, number][], be = false) => {
    u8(0x40 | local);
    u8(0);
    u8(be ? 1 : 0);
    u16(global, be);
    u8(fields.length);
    for (const f of fields) f.forEach(u8);
  };
  const fitTs = (ms: number) => Math.round(ms / 1000) - 631065600;
  // record: timestamp, hr, distance (cm)
  def(0, 20, [
    [253, 4, 0x86],
    [3, 1, 0x02],
    [5, 4, 0x86],
  ]);
  const speed = 1000 / 300; // 5:00/km
  let lastT = 0;
  for (let s = 0; s <= 600; s += 10) {
    u8(0);
    lastT = fitTs(T0 + s * 1000);
    u32(lastT);
    u8(s === 300 ? 0xff : 150); // jedno brakujące tętno (0xFF = brak)
    u32(Math.round(speed * s * 100));
  }
  // skompresowany nagłówek: +2 s po ostatnim rekordzie (definicja z tylko hr + dystans, bez timestamp)
  def(3, 20, [
    [3, 1, 0x02],
    [5, 4, 0x86],
  ]);
  const off = (lastT + 2) % 32;
  u8(0x80 | (3 << 5) | off);
  u8(170);
  u32(Math.round(speed * 602 * 100));
  // lap (big-endian): timestamp, start, elapsed (ms), timer (ms), distance (cm), avg / max hr
  def(
    1,
    19,
    [
      [253, 4, 0x86],
      [2, 4, 0x86],
      [7, 4, 0x86],
      [8, 4, 0x86],
      [9, 4, 0x86],
      [15, 1, 0x02],
      [16, 1, 0x02],
    ],
    true,
  );
  for (const [i, [ms, hr]] of [
    [300000, 148],
    [302000, 152],
  ].entries()) {
    u8(1);
    u32(fitTs(T0 + (i + 1) * 300000), true);
    u32(fitTs(T0 + i * 300000), true);
    u32(ms, true);
    u32(ms, true);
    u32(100000, true);
    u8(hr);
    u8(hr + 10);
  }
  // session: start, sport, elapsed, timer, distance, avg / max hr
  def(2, 18, [
    [253, 4, 0x86],
    [2, 4, 0x86],
    [5, 1, 0x00],
    [7, 4, 0x86],
    [8, 4, 0x86],
    [9, 4, 0x86],
    [16, 1, 0x02],
    [17, 1, 0x02],
  ]);
  u8(2);
  u32(fitTs(T0 + 602000));
  u32(fitTs(T0));
  u8(1); // running
  u32(605000);
  u32(602000);
  u32(200000);
  u8(150);
  u8(170);
  const data = bytes;
  const head = [14, 0x20, ...[2132 & 0xff, 2132 >> 8], ...[0, 8, 16, 24].map((s) => (data.length >>> s) & 0xff), ...'.FIT'.split('').map((c) => c.charCodeAt(0)), 0, 0];
  return new Uint8Array([...head, ...data, 0, 0]);
}

/* ---------- testy ---------- */

describe('import GPX', () => {
  const a = parseGpx(gpx(track(2500, 1000 / 300, 5, { at: 1200, secs: 60 })));
  it('dystans, czasy (pauza poza czasem w ruchu), tętno, tempo, start', () => {
    expect(a.source).toBe('gpx');
    expect(a.name).toBe('Poranny bieg & kawa');
    expect(a.km).toBeCloseTo(2.5, 1);
    expect(a.movingMin).toBeCloseTo(12.5, 0);
    expect(a.elapsedMin).toBeCloseTo(13.5, 0);
    expect(a.pace).toBe('5:00/km');
    expect(a.maxHr).toBe(160);
    expect(a.avgHr).toBeGreaterThan(145);
    expect(a.avgHr).toBeLessThan(155);
    expect(a.start).toBe(iso(T0));
    expect(a.date).toBe('2026-10-20');
    expect(a.laps).toEqual([]);
  });
  it('odcinki co 1 km + końcówka', () => {
    expect(a.splits.map((s) => s.km)).toEqual([1, 1, 0.5]);
    for (const s of a.splits) expect(s.min / s.km).toBeCloseTo(5, 1);
    expect(a.splits[0].hr!).toBeLessThan(a.splits[2].hr!);
  });
  it('wiersze treningu: min, km, tętno; sumy jak w aplikacji', () => {
    const ex = activityExercise(a);
    expect(ex).toMatchObject({ name: 'Bieg', cardio: true });
    expect(ex.setsLog).toHaveLength(3);
    expect(ex.setsLog![0]).toMatchObject({ unit: 'min', dist: 1, done: true });
    const t = runTotals({ id: 's', clientId: 'c', date: '2026-10-20', charge: 'brak', exercises: [ex] }, true)!;
    expect(t.km).toBeCloseTo(2.5, 1);
    expect(t.pace).toBe('5:00/km');
  });
  it('błędny plik', () => expect(() => parseGpx('<gpx></gpx>')).toThrow(/trkpt/));
});

describe('import TCX', () => {
  const a = parseTcx(tcx());
  it('okrążenia z zegarka: czas stopera, tętno ważone, maks.', () => {
    expect(a.source).toBe('tcx');
    expect(a.sport).toBe('Running');
    expect(a.km).toBe(2);
    expect(a.movingMin).toBeCloseTo(10.17, 2);
    expect(a.laps).toEqual([
      { km: 1, min: 5, hr: 150 },
      { km: 1, min: 5.1667, hr: 160 },
    ]);
    expect(a.avgHr).toBe(155);
    expect(a.maxHr).toBe(171);
    expect(a.start).toBe(iso(T0));
  });
  it('okrążenia zamiast kilometrów, gdy jest ich kilka', () => {
    expect(activityRows(a).map((r) => [r.reps, r.dist, r.hr])).toEqual([
      [5, 1, 150],
      [5.1667, 1, 160],
    ]);
    expect(activityRows(a, false)).toHaveLength(2); // z punktów: też 2 × 1 km
  });
  it('rozpoznanie formatu po treści', () => {
    const buf = new TextEncoder().encode(tcx()).buffer as ArrayBuffer;
    expect(parseActivity('export.xml', buf).source).toBe('tcx');
  });
});

describe('import — sumy co do sekundy', () => {
  // 12 okrążeń po 4:45,083 s (r2 minut gubiło sekundę: 57:01 → 57:00)
  const laps = Array.from({ length: 12 }, (_, i) => `<Lap StartTime="${iso(T0 + i * 285083)}"><TotalTimeSeconds>285.083</TotalTimeSeconds><DistanceMeters>1000</DistanceMeters></Lap>`).join('');
  const xml = `<TrainingCenterDatabase><Activities><Activity Sport="Running"><Id>${iso(T0)}</Id>${laps}</Activity></Activities></TrainingCenterDatabase>`;
  it('czas w ruchu z sekund okrążeń, wiersze sumują się do tego samego czasu', () => {
    const a = parseTcx(xml);
    expect(Math.round(a.movingMin * 60)).toBe(3421); // 57:01
    expect(a.splits).toEqual([]); // bez GPS — brak odcinków co 1 km
    expect(a.laps).toHaveLength(12);
    const rows = activityRows(a);
    expect(Math.round(rows.reduce((s, r) => s + r.reps!, 0) * 60)).toBe(3421);
  });
});

describe('import FIT', () => {
  const f = fit();
  it('dekoder: record / lap / session, brakujące wartości, skompresowany czas, big-endian', () => {
    const d = decodeFit(f);
    expect(d.record).toHaveLength(62);
    expect(d.record[30][3]).toBeUndefined(); // 0xFF = brak tętna
    const last = d.record[61];
    expect(last[253] - d.record[60][253]).toBe(2);
    expect(last[3]).toBe(170);
    expect(d.lap).toHaveLength(2);
    expect(d.lap[1][8]).toBe(302000);
    expect(d.session[0][9]).toBe(200000);
  });
  it('podsumowanie z session, okrążenia z lap', () => {
    const a = parseFit(f);
    expect(a).toMatchObject({ source: 'fit', sport: 'running', km: 2, movingMin: 10.0333, elapsedMin: 10.0833, avgHr: 150, maxHr: 170, start: iso(T0), date: '2026-10-20' });
    expect(a.pace).toBe('5:01/km');
    expect(a.laps).toEqual([
      { km: 1, min: 5, hr: 148 },
      { km: 1, min: 5.0333, hr: 152 },
    ]);
    expect(a.splits.map((s) => s.km)).toEqual([1, 1]);
  });
  it('rozpoznanie po sygnaturze .FIT i błędy', () => {
    expect(parseActivity('bieg.bin', f.buffer as ArrayBuffer).source).toBe('fit');
    expect(() => parseFit(new Uint8Array(20))).toThrow(/FIT/);
    expect(() => parseActivity('x.txt', new TextEncoder().encode('hello').buffer as ArrayBuffer)).toThrow(/GPX, TCX albo FIT/);
  });
});
