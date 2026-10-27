/**
 * Minimalny odczyt pierwszego arkusza z pliku .xlsx (bez bibliotek): ZIP przez DecompressionStream
 * („deflate-raw”, wbudowane w przeglądarki), XML przez wyrażenia regularne. Zwraca wiersze komórek jako tekst.
 * Daty zostają liczbami seryjnymi Excela (import rozpoznaje je w kolumnie dnia). Formuły — ostatnia wyliczona wartość.
 */

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/** Pliki z archiwum ZIP (wg katalogu centralnego). */
export async function unzip(buf: Uint8Array, want: (name: string) => boolean): Promise<Map<string, string>> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('To nie jest plik .xlsx');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commLen;
    if (!want(name)) continue;
    const lStart = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = buf.subarray(lStart, lStart + size);
    out.set(name, dec.decode(method === 0 ? raw : await inflate(raw)));
  }
  return out;
}

const ent = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => ent(m[1])).join('');
const colIdx = (ref: string) => {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
  return [...letters].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
};

/** Wiersze pierwszego arkusza skoroszytu. */
export async function readXlsx(buf: ArrayBuffer | Uint8Array): Promise<string[][]> {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const files = await unzip(bytes, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const shared = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  // pierwszy arkusz wg kolejności w skoroszycie
  let sheet: string | undefined;
  const rid = files.get('xl/workbook.xml')?.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
  const target = rid && files.get('xl/_rels/workbook.xml.rels')?.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1];
  if (target) sheet = files.get(`xl/${target.replace(/^\/?xl\//, '')}`);
  sheet ??= [...files.entries()].filter(([n]) => n.startsWith('xl/worksheets/')).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))[0]?.[1];
  if (!sheet) throw new Error('Brak arkusza w pliku');
  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rn = Number(rm[1].match(/\br="(\d+)"/)?.[1] ?? rows.length + 1) - 1;
    const row: string[] = [];
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      const ci = ref ? colIdx(ref) : row.length;
      const t = attrs.match(/\bt="(\w+)"/)?.[1];
      const body = cm[2] ?? '';
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val = '';
      if (t === 's' && v != null) val = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') val = texts(body);
      else if (t === 'b') val = v === '1' ? 'TAK' : 'NIE';
      else if (v != null) val = ent(v);
      while (row.length < ci) row.push('');
      row[ci] = val.trim();
    }
    while (rows.length < rn) rows.push([]);
    rows[rn] = row;
  }
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => [...(r ?? []), ...Array(width - (r?.length ?? 0)).fill('')]);
}
