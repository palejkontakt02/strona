/**
 * Mały generator kodów QR (tryb bajtowy, UTF-8, poziomy korekcji L/M/Q/H, wersje 1–40) — bez zależności.
 * Algorytm wg ISO/IEC 18004, na wzór „QR Code generator library” Projektu Nayuki (MIT).
 * Zgodność sprawdzona z biblioteką segno (identyczna macierz przy tej samej wersji i masce) i dekoderem zxing.
 */

export type QrEcc = 'L' | 'M' | 'Q' | 'H';

const ECC_ORD: Record<QrEcc, number> = { L: 0, M: 1, Q: 2, H: 3 };
const ECC_FORMAT: Record<QrEcc, number> = { L: 1, M: 0, Q: 3, H: 2 };

// prettier-ignore
const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
// prettier-ignore
const NUM_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

function rawModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

const dataCodewords = (ver: number, e: number) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[e][ver] * NUM_BLOCKS[e][ver];

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}

function rsRemainder(data: number[], div: number[]): number[] {
  const r = div.map(() => 0);
  for (const b of data) {
    const f = b ^ (r.shift() as number);
    r.push(0);
    div.forEach((d, i) => (r[i] ^= gfMul(d, f)));
  }
  return r;
}

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const size = ver * 4 + 17;
  const n = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

export interface QrCode {
  version: number;
  size: number;
  mask: number;
  /** modules[y][x] — true = ciemny moduł. */
  modules: boolean[][];
}

/** Koduje tekst (UTF-8) jako QR. Najmniejsza wersja, która się mieści; maska z najniższą karą (albo podana). */
export function encodeQr(text: string, opts: { ecc?: QrEcc; minVersion?: number; mask?: number } = {}): QrCode {
  const eccName = opts.ecc ?? 'M';
  const e = ECC_ORD[eccName];
  const bytes = Array.from(new TextEncoder().encode(text));
  let ver = Math.max(1, opts.minVersion ?? 1);
  for (; ; ver++) {
    if (ver > 40) throw new Error('Tekst za długi na kod QR.');
    const ccBits = ver <= 9 ? 8 : 16;
    if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver, e) * 8) break;
  }
  // strumień bitów: tryb bajtowy (0100), długość, dane, terminator, wyrównanie, bajty dopełnienia
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(4, 4);
  push(bytes.length, ver <= 9 ? 8 : 16);
  bytes.forEach((b) => push(b, 8));
  const cap = dataCodewords(ver, e) * 8;
  push(0, Math.min(4, cap - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // korekcja błędów i przeplot bloków
  const nBlocks = NUM_BLOCKS[e][ver];
  const eccLen = ECC_PER_BLOCK[e][ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const nShort = nBlocks - (raw % nBlocks);
  const shortLen = Math.floor(raw / nBlocks);
  const div = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < nShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const words: number[] = [];
  for (let i = 0; i < blocks[0].length; i++)
    blocks.forEach((b, j) => {
      if (i !== shortLen - eccLen || j >= nShort) words.push(b[i]);
    });

  // wzory funkcyjne
  const size = ver * 4 + 17;
  const mod = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const setF = (x: number, y: number, dark: boolean) => {
    mod[y][x] = dark;
    fn[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    setF(6, i, i % 2 === 0);
    setF(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4);
      }
  const al = alignmentPositions(ver);
  al.forEach((ay, i) =>
    al.forEach((ax, j) => {
      const last = al.length - 1;
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  const drawFormat = (mask: number) => {
    const d = (ECC_FORMAT[eccName] << 3) | mask;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setF(8, i, bit(b, i));
    setF(8, 7, bit(b, 6));
    setF(8, 8, bit(b, 7));
    setF(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(b, i));
    setF(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const b = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const c = Math.floor(i / 3);
      setF(a, c, bit(b, i));
      setF(c, a, bit(b, i));
    }
  }

  // dane zygzakiem
  let n = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - v : v;
        if (!fn[y][x] && n < words.length * 8) {
          mod[y][x] = bit(words[n >>> 3], 7 - (n & 7));
          n++;
        }
      }
  }

  const applyMask = (m: number) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        if (fn[y][x]) continue;
        const inv =
          m === 0 ? (x + y) % 2 === 0
          : m === 1 ? y % 2 === 0
          : m === 2 ? x % 3 === 0
          : m === 3 ? (x + y) % 3 === 0
          : m === 4 ? (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
          : m === 5 ? ((x * y) % 2) + ((x * y) % 3) === 0
          : m === 6 ? (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
          : (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        if (inv) mod[y][x] = !mod[y][x];
      }
  };

  let mask = opts.mask ?? -1;
  if (mask < 0) {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m);
      drawFormat(m);
      const p = penalty(mod);
      if (p < best) {
        best = p;
        mask = m;
      }
      applyMask(m); // cofnij (XOR)
    }
  }
  applyMask(mask);
  drawFormat(mask);
  return { version: ver, size, mask, modules: mod };
}

/** Kara za maskę (reguły N1–N4 normy) — wybór najczytelniejszej maski. */
function penalty(m: boolean[][]): number {
  const size = m.length;
  let score = 0;
  const lines: boolean[][] = [...m, ...m[0].map((_, x) => m.map((row) => row[x]))];
  const F1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0].join('');
  const F2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1].join('');
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    const s = line.map((b) => (b ? 1 : 0)).join('');
    for (let i = s.indexOf(F1); i >= 0; i = s.indexOf(F1, i + 1)) score += 40;
    for (let i = s.indexOf(F2); i >= 0; i = s.indexOf(F2, i + 1)) score += 40;
  }
  let dark = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (m[y][x]) dark++;
      if (x < size - 1 && y < size - 1) {
        const c = m[y][x];
        if (m[y][x + 1] === c && m[y + 1][x] === c && m[y + 1][x + 1] === c) score += 3;
      }
    }
  const total = size * size;
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return score;
}

/** Ścieżka SVG (jednostka = moduł) z ramką ciszy `quiet` modułów. Kolor przez `fill="currentColor"`. */
export function qrSvgPath(qr: QrCode, quiet = 4): string {
  const parts: string[] = [];
  qr.modules.forEach((row, y) => {
    let x = 0;
    while (x < qr.size) {
      if (!row[x]) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < qr.size && row[x + w]) w++;
      parts.push(`M${x + quiet} ${y + quiet}h${w}v1h-${w}z`);
      x += w;
    }
  });
  return parts.join('');
}
