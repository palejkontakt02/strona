import { describe, expect, it } from 'vitest';
import { encodeQr, qrSvgPath } from './qr';

const rows = (m: boolean[][]) => m.map((r) => r.map((b) => (b ? '1' : '0')).join(''));

// Wzorce z biblioteki segno 1.6 (ta sama wersja, poziom korekcji i maska); dekodowanie sprawdzone zxing-cpp.
const HELLO_L_MASK0 = ['111111100101101111111', '100000100111001000001', '101110101101101011101', '101110100101001011101', '101110100010101011101', '100000100000101000001', '111111101010101111111', '000000001101100000000', '111011111111011000100', '000100001000001000010', '101000100010100011111', '110010001010001000010', '101001100110101010100', '000000001101010100110', '111111101001011100111', '100000101111110110000', '101110101001011100111', '101110100010001100110', '101110101110100010101', '100000101100001010010', '111111101100101100111'];
const URL_M_MASK2 = ['111111100010010000111011001111111', '100000100010011100101010001000001', '101110101110010100101101101011101', '101110101100101111001010101011101', '101110101100010101111101001011101', '100000101110011111100110001000001', '111111101010101010101010101111111', '000000001011001100111100100000000', '101111100001010111110010001111100', '000001011100101011111001001101111', '011000100011000100000010010010110', '011001000111001100101100110011110', '010011101010100100110010110111000', '111100001010111111110001001000111', '100110100110011001000100011110110', '011011011010101010100110011111100', '110111101100110011010011110111001', '111110000010101011011101011101101', '101010111001000111001100111110110', '100101011011101101100111101111101', '100100110011001110001000010011001', '101001010001100100111101101000101', '101010100110000110100100000010010', '100101000100111100100110011101101', '100101111011111101000010111110010', '000000001010110010111100100010111', '111111100100010110100111101010110', '100000101010010010000111100011111', '101110101101010000101000111111011', '101110101110100111010011110011011', '101110101001010000000011101101000', '100000100011111010101100001011100', '111111101111011001101011110101010'];

describe('kod QR', () => {
  it('wersja 1-L, maska 0 — identyczny z wzorcem', () => {
    const q = encodeQr('HELLO', { ecc: 'L', mask: 0 });
    expect(q.version).toBe(1);
    expect(rows(q.modules)).toEqual(HELLO_L_MASK0);
  });
  it('link zaproszenia, wersja 4-M, maska 2 — identyczny z wzorcem', () => {
    const q = encodeQr('https://sebastianpalej.pl/app/?zaproszenie=anna%40x.pl', { ecc: 'M', mask: 2 });
    expect(q.version).toBe(4);
    expect(rows(q.modules)).toEqual(URL_M_MASK2);
  });
  it('dobiera wersję do długości i ma wzory pozycjonujące w rogach', () => {
    const q = encodeQr('https://sebastianpalej.pl/app/?zaproszenie=' + encodeURIComponent('bardzo.dlugi.adres.email@przyklad-firmy.com.pl'));
    expect(q.size).toBe(q.version * 4 + 17);
    expect(q.version).toBeGreaterThanOrEqual(5);
    expect(q.mask).toBeGreaterThanOrEqual(0);
    const finder = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
    const r = rows(q.modules);
    expect(r.slice(0, 7).map((x) => x.slice(0, 7))).toEqual(finder);
    expect(r.slice(0, 7).map((x) => x.slice(-7))).toEqual(finder);
    expect(r.slice(-7).map((x) => x.slice(0, 7))).toEqual(finder);
  });
  it('polskie znaki (UTF-8) i za długi tekst', () => {
    expect(encodeQr('Zażółć gęślą jaźń').version).toBeGreaterThanOrEqual(2);
    expect(() => encodeQr('x'.repeat(3000), { ecc: 'H' })).toThrow();
  });
  it('ścieżka SVG z ramką ciszy', () => {
    const q = encodeQr('HELLO', { ecc: 'L', mask: 0 });
    const d = qrSvgPath(q);
    expect(d.startsWith('M4 4h7v1h-7z')).toBe(true);
    expect(d).not.toMatch(/NaN/);
  });
});
