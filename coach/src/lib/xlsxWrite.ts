/**
 * Minimalny zapis skoroszytu .xlsx (bez bibliotek): arkusze z tekstem i liczbami, pogrubiony nagłówek, szerokości kolumn,
 * zamrożony pierwszy wiersz. ZIP bez kompresji (metoda „store”) — Excel, Arkusze Google i Numbers otwierają go bez problemu.
 */

export type XBorder = 'thin' | 'medium' | 'dotted' | 'hair';
/** Wygląd komórki: czcionka, wypełnienie, ramki, wyrównanie, format liczby. */
export interface XStyle {
  bold?: boolean;
  italic?: boolean;
  /** Wcięcie tekstu (poziomy). */
  indent?: number;
  /** Kolor cienkich ramek (grube zawsze czarne). */
  bc?: string;
  /** Kolor czcionki / wypełnienia jako „RRGGBB”. */
  color?: string;
  fill?: string;
  size?: number;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'center' | 'bottom';
  wrap?: boolean;
  /** Format liczby, np. „0.0”. */
  fmt?: string;
  border?: { l?: XBorder; r?: XBorder; t?: XBorder; b?: XBorder };
}

export type XCell = string | number | null | undefined | { v: string | number | null | undefined; bold?: boolean; st?: XStyle };

export interface XSheet {
  name: string;
  rows: XCell[][];
  /** Szerokości kolumn w znakach. Brak — liczone z zawartości. */
  widths?: number[];
  /** Pierwszy wiersz to nagłówek: pogrubiony i zamrożony. */
  header?: boolean;
  /** Scalone komórki, np. „B2:C2”. */
  merges?: string[];
  /** Wysokości wierszy (punkty) wg indeksu wiersza. */
  heights?: Record<number, number>;
  /** Bez linii siatki (gdy arkusz ma własne ramki). */
  noGrid?: boolean;
  /** Wydruk poziomo, dopasowany do szerokości strony. */
  landscape?: boolean;
  /** Wydruk dopasowany do szerokości strony (pionowo, gdy bez `landscape`). */
  fitWidth?: boolean;
  /** Zamrożone kolumny z lewej (np. 1 — nazwa ćwiczenia widoczna przy przewijaniu w bok). */
  freezeCols?: number;
  /** Ręczne podziały stron: numer (od 1) ostatniego wiersza na stronie. */
  rowBreaks?: number[];
  /** Nagłówek / stopka wydruku (kody Excela: &P strona, &N liczba stron, &L/&C/&R sekcje). */
  pageHeader?: string;
  pageFooter?: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// XML 1.0 nie dopuszcza znaków sterujących (poza tab / nowa linia)
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

export function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const val = (c: XCell) => (c != null && typeof c === 'object' ? c.v : c);

/** Nazwa arkusza: maks. 31 znaków, bez []:*?/\ . */
export function sheetName(name: string, taken: string[] = []): string {
  const base = (name.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Arkusz').slice(0, 31);
  let out = base;
  for (let n = 2; taken.some((t) => t.toLowerCase() === out.toLowerCase()); n++) out = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
  return out;
}

class Styles {
  fonts = ['<font><sz val="10"/><name val="Arial"/></font>', '<font><b/><sz val="10"/><name val="Arial"/></font>'];
  fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  fmts: string[] = [];
  xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>', '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'];
  private keys = new Map<string, number>();
  private idx(list: string[], x: string) {
    const i = list.indexOf(x);
    if (i >= 0) return i;
    list.push(x);
    return list.length - 1;
  }
  get(st: XStyle): number {
    const key = JSON.stringify(st);
    const hit = this.keys.get(key);
    if (hit != null) return hit;
    const font = this.idx(this.fonts, `<font>${st.bold ? '<b/>' : ''}${st.italic ? '<i/>' : ''}<sz val="${st.size ?? 10}"/>${st.color ? `<color rgb="FF${st.color}"/>` : ''}<name val="Arial"/></font>`);
    const fill = st.fill ? this.idx(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${st.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const side = (n: string, v?: XBorder) => (v ? `<${n} style="${v}"><color rgb="FF${v === 'medium' ? '000000' : (st.bc ?? '000000')}"/></${n}>` : `<${n}/>`);
    const bd = st.border;
    const border = bd ? this.idx(this.borders, `<border>${side('left', bd.l)}${side('right', bd.r)}${side('top', bd.t)}${side('bottom', bd.b)}<diagonal/></border>`) : 0;
    const fmt = st.fmt ? 164 + this.idx(this.fmts, st.fmt) : 0;
    const al = st.align || st.valign || st.wrap || st.indent ? `<alignment${st.align ? ` horizontal="${st.align}"` : ''} vertical="${st.valign ?? 'center'}"${st.wrap ? ' wrapText="1"' : ''}${st.indent ? ` indent="${st.indent}"` : ''}/>` : '';
    this.xfs.push(
      `<xf numFmtId="${fmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyFont="1"${fill ? ' applyFill="1"' : ''}${border ? ' applyBorder="1"' : ''}${fmt ? ' applyNumberFormat="1"' : ''}${al ? ' applyAlignment="1">' + al + '</xf>' : '/>'}`,
    );
    this.keys.set(key, this.xfs.length - 1);
    return this.xfs.length - 1;
  }
  xml(): string {
    const nf = this.fmts.length ? `<numFmts count="${this.fmts.length}">${this.fmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(f)}"/>`).join('')}</numFmts>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${nf}<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts><fills count="${this.fills.length}">${this.fills.join('')}</fills><borders count="${this.borders.length}">${this.borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }
}

/** Wspólna tabela tekstów (czytają ją wszystkie programy, także podgląd na iPhonie). */
class Strings {
  list: string[] = [];
  private map = new Map<string, number>();
  count = 0;
  get(t: string): number {
    this.count++;
    const hit = this.map.get(t);
    if (hit != null) return hit;
    this.list.push(t);
    this.map.set(t, this.list.length - 1);
    return this.list.length - 1;
  }
  xml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${this.count}" uniqueCount="${this.list.length}">${this.list.map((t) => `<si><t xml:space="preserve">${esc(t)}</t></si>`).join('')}</sst>`;
  }
}

function sheetXml(sh: XSheet, styles: Styles, strings: Strings): string {
  const ncol = Math.max(1, ...sh.rows.map((r) => r.length));
  const widths =
    sh.widths ??
    Array.from({ length: ncol }, (_, ci) =>
      Math.min(60, Math.max(6, ...sh.rows.map((r) => String(val(r[ci]) ?? '').split('\n').reduce((a, l) => Math.max(a, l.length), 0) + 2))),
    );
  const cols = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;
  const grid = sh.noGrid ? ' showGridLines="0"' : '';
  const fc = sh.freezeCols ?? 0;
  const pane =
    sh.header && sh.rows.length > 1
      ? `<sheetViews><sheetView${grid} workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      : fc
        ? `<sheetViews><sheetView${grid} workbookViewId="0"><pane xSplit="${fc}" topLeftCell="${colName(fc)}1" activePane="topRight" state="frozen"/></sheetView></sheetViews>`
        : grid
          ? `<sheetViews><sheetView${grid} workbookViewId="0"/></sheetViews>`
          : '';
  const rows = sh.rows
    .map((r, ri) => {
      const cells = r
        .map((c, ci) => {
          const v = val(c);
          const st = c != null && typeof c === 'object' ? c.st : undefined;
          if ((v == null || v === '') && !st) return '';
          const bold = (sh.header && ri === 0) || (c != null && typeof c === 'object' && c.bold);
          const ref = `${colName(ci)}${ri + 1}`;
          const s = st ? ` s="${styles.get(bold ? { ...st, bold: true } : st)}"` : bold ? ' s="1"' : '';
          if (v == null || v === '') return `<c r="${ref}"${s}/>`;
          if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
          const t = clean(String(v));
          return `<c r="${ref}"${s} t="s"><v>${strings.get(t)}</v></c>`;
        })
        .join('');
      const h = sh.heights?.[ri];
      return `<row r="${ri + 1}"${h ? ` ht="${h}" customHeight="1"` : ''}>${cells}</row>`;
    })
    .join('');
  const fit = sh.landscape || sh.fitWidth;
  const pr = fit ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : '';
  const hf =
    sh.pageHeader || sh.pageFooter
      ? `<headerFooter>${sh.pageHeader ? `<oddHeader>${esc(sh.pageHeader)}</oddHeader>` : ''}${sh.pageFooter ? `<oddFooter>${esc(sh.pageFooter)}</oddFooter>` : ''}</headerFooter>`
      : '';
  const br = sh.rowBreaks?.length ? `<rowBreaks count="${sh.rowBreaks.length}" manualBreakCount="${sh.rowBreaks.length}">${sh.rowBreaks.map((r) => `<brk id="${r}" max="16383" man="1"/>`).join('')}</rowBreaks>` : '';
  const page = fit
    ? `<printOptions horizontalCentered="1"/><pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.25" footer="0.25"/><pageSetup paperSize="9" orientation="${sh.landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>${hf}${br}`
    : hf || br
      ? `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.25" footer="0.25"/>${hf}${br}`
      : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pr}${pane}${cols}<sheetData>${rows}</sheetData>${sh.merges?.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}${page}</worksheet>`;
}

/* ---------- ZIP (metoda store) ---------- */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // nazwy w UTF-8
    lv.setUint16(8, 0, true); // store
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x21, true); // 1980-01-01
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, f.data);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, off, true);
    cen.set(name, 46);
    central.push(cen);
    off += local.length + f.data.length;
  }
  const cenSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, off, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let p = 0;
  for (const a of all) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}

/** Skoroszyt .xlsx jako bajty. */
export function xlsx(sheets: XSheet[]): Uint8Array {
  const enc = new TextEncoder();
  const taken: string[] = [];
  const named = sheets.map((s) => {
    const n = sheetName(s.name, taken);
    taken.push(n);
    return { ...s, name: n };
  });
  const styles = new Styles();
  const strings = new Strings();
  const sheetXmls = named.map((s) => sheetXml(s, styles, strings));
  const files = [
    {
      name: '[Content_Types].xml',
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>${named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    },
    {
      name: '_rels/.rels',
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${named.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${named.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    },
    { name: 'xl/styles.xml', xml: styles.xml() },
    { name: 'xl/sharedStrings.xml', xml: strings.xml() },
    ...sheetXmls.map((xml, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, xml })),
  ];
  return zip(files.map((f) => ({ name: f.name, data: enc.encode(f.xml) })));
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Liczba z tekstu „62,5” / „8” → number; inny tekst bez zmian (np. „-10%”, „8/str.”). */
export function numOrText(v: string | number | null | undefined): string | number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const t = v.trim();
  if (/^-?\d+(?:[.,]\d+)?$/.test(t)) return Number(t.replace(',', '.'));
  return t;
}

/** Pobranie pliku: na telefonie przez menu udostępniania (gdy dostępne), inaczej zwykłe pobranie. */
export async function downloadXlsx(fileName: string, sheets: XSheet[]): Promise<void> {
  const bytes = xlsx(sheets);
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: XLSX_TYPE });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const file = typeof File !== 'undefined' ? new File([blob], fileName, { type: XLSX_TYPE }) : null;
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  if (touch && file && nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: fileName });
      return;
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
