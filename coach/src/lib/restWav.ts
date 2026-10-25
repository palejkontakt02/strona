/**
 * Dźwięk przerwy jako plik WAV w pamięci: cisza przez czas przerwy, potem wyraźny sygnał.
 * Element <audio> z takim plikiem gra dalej przy zablokowanym ekranie (setInterval w tle stoi),
 * więc koniec przerwy słychać nawet z telefonem w kieszeni.
 * 8-bit PCM mono, 8 kHz — 8 KB na sekundę (10 min ≈ 4,8 MB w pamięci).
 */
export const WAV_RATE = 8000;
/** Sygnał końca: trzy krótkie tony (s). */
export const BEEP_PATTERN: [on: number, off: number][] = [
  [0.18, 0.1],
  [0.18, 0.1],
  [0.45, 0.15],
];
export const BEEP_SEC = BEEP_PATTERN.reduce((a, [on, off]) => a + on + off, 0);

/** Plik WAV: `silenceSec` ciszy, potem sygnał (`freq` Hz). */
export function buildRestWav(silenceSec: number, freq = 880, rate = WAV_RATE): Uint8Array {
  const silence = Math.max(0, Math.round(silenceSec * rate));
  const beep = Math.round(BEEP_SEC * rate);
  const n = silence + beep;
  const buf = new Uint8Array(44 + n);
  const v = new DataView(buf.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true); // bajty na sekundę (8 bit × 1 kanał)
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  str(36, 'data');
  v.setUint32(40, n, true);
  buf.fill(128, 44); // cisza w 8-bit PCM
  let o = 44 + silence;
  for (const [on, off] of BEEP_PATTERN) {
    const len = Math.round(on * rate);
    for (let i = 0; i < len; i++) {
      // krótkie wygaszenie na brzegach — bez trzasku
      const env = Math.min(1, i / (0.01 * rate), (len - i) / (0.01 * rate));
      buf[o + i] = 128 + Math.round(110 * env * Math.sin((2 * Math.PI * freq * i) / rate));
    }
    o += len + Math.round(off * rate);
  }
  return buf;
}
