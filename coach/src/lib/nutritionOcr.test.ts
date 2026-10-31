import { describe, expect, it } from 'vitest';
import { extractJson, fitBox, ocrErrorMessage, ocrNumber, ocrToText, validateOcr } from './nutritionOcr';

describe('nutritionOcr', () => {
  it('extracts JSON from model text', () => {
    expect(extractJson('{"kcal":1850}')).toEqual({ kcal: 1850 });
    expect(extractJson('Oto wynik:\n```json\n{"kcal": 1850, "protein": 120}\n```')).toEqual({ kcal: 1850, protein: 120 });
    expect(extractJson('brak')).toBeNull();
    expect(extractJson('{zepsute')).toBeNull();
    expect(extractJson('{"a": }')).toBeNull();
  });

  it('parses numbers in Polish formats', () => {
    expect(ocrNumber(1850, 10000)).toBe(1850);
    expect(ocrNumber('1 850', 10000)).toBe(1850);
    expect(ocrNumber('1 850', 10000)).toBe(1850);
    expect(ocrNumber('85,46', 1000)).toBe(85.5);
    expect(ocrNumber('1850 kcal', 10000)).toBe(1850);
    expect(ocrNumber('120 g', 1000)).toBe(120);
    expect(ocrNumber(null, 1000)).toBeNull();
    expect(ocrNumber('', 1000)).toBeNull();
    expect(ocrNumber(-5, 1000)).toBeUndefined();
    expect(ocrNumber(10001, 10000)).toBeUndefined();
    expect(ocrNumber('dużo', 1000)).toBeUndefined();
    expect(ocrNumber({}, 1000)).toBeUndefined();
  });

  it('validates full result', () => {
    expect(validateOcr({ kcal: 2150, protein: 142, fat: 70.2, carbs: 230, date: '2026-10-30', confidence: 'high', remaining: 17 })).toEqual({
      kcal: 2150,
      protein: 142,
      fat: 70.2,
      carbs: 230,
      date: '2026-10-30',
      confidence: 'high',
      remaining: 17,
    });
  });

  it('marks out-of-range or garbage as low confidence and drops the value', () => {
    const r = validateOcr({ kcal: 25000, protein: 120, fat: 'x', carbs: null, confidence: 'high' })!;
    expect(r.kcal).toBeUndefined();
    expect(r.fat).toBeUndefined();
    expect(r.carbs).toBeUndefined();
    expect(r.protein).toBe(120);
    expect(r.confidence).toBe('low');
    expect(r.note).toMatch(/sprawdź/);
  });

  it('macro over 1000 g is rejected (range from the brief)', () => {
    const r = validateOcr({ kcal: 2000, carbs: 1200, confidence: 'high' })!;
    expect(r.carbs).toBeUndefined();
    expect(r.confidence).toBe('low');
  });

  it('returns null when nothing readable', () => {
    expect(validateOcr(null)).toBeNull();
    expect(validateOcr('tekst')).toBeNull();
    expect(validateOcr([1, 2])).toBeNull();
    expect(validateOcr({ kcal: null, protein: null, fat: null, carbs: null, confidence: 'low', note: 'To nie jest Fitatu' })).toBeNull();
  });

  it('keeps note, ignores bad date and unknown confidence', () => {
    const r = validateOcr({ kcal: 1800, date: '30.10.2026', confidence: 'pewnie', note: '  Widać tylko śniadanie  ' })!;
    expect(r.date).toBeUndefined();
    expect(r.confidence).toBe('low');
    expect(r.note).toBe('Widać tylko śniadanie');
  });

  it('maps to form text with decimal comma', () => {
    expect(ocrToText({ kcal: 2150, fat: 70.5, confidence: 'high' })).toEqual({ kcal: '2150', fat: '70,5' });
  });

  it('fits image box to 1200 px without upscaling', () => {
    expect(fitBox(1170, 2532)).toEqual({ w: 555, h: 1200 });
    expect(fitBox(3000, 1500)).toEqual({ w: 1200, h: 600 });
    expect(fitBox(800, 600)).toEqual({ w: 800, h: 600 });
    expect(fitBox(0, 100)).toEqual({ w: 0, h: 0 });
  });

  it('error messages in Polish', () => {
    expect(ocrErrorMessage(503, { error: 'Odczyt AI nie jest skonfigurowany.' })).toBe('Odczyt AI nie jest skonfigurowany.');
    expect(ocrErrorMessage(404, null)).toMatch(/nie jest jeszcze włączony/);
    expect(ocrErrorMessage(429, {})).toMatch(/limit/);
    expect(ocrErrorMessage(500, 'x')).toMatch(/ręcznie/);
  });
});
