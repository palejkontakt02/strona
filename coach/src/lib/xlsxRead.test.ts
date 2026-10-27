import { describe, expect, it } from 'vitest';
import { readXlsx } from './xlsxRead';
import { detectColumns, sheetToPlan } from './sheetImport';

// mały skoroszyt: nagłówki PL, scalona komórka tygodnia (A2:A4), pusty wiersz 3, tekst inline, encje XML
const XLSX = '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';

describe('readXlsx', () => {
  it('czyta pierwszy arkusz i daje się zaimportować jako plan', async () => {
    const rows = await readXlsx(Uint8Array.from(atob(XLSX), (c) => c.charCodeAt(0)));
    expect(rows[0]).toEqual(['Tydzień', 'Ćwiczenie', 'Serie', 'Powt.', 'Ciężar']);
    expect(rows[1]).toEqual(['1', 'Przysiad ze sztangą', '3', '5', '102.5']);
    expect(rows[2]).toEqual(['', '', '', '', '']);
    expect(rows[3]).toEqual(['', 'Wyciskanie & wiosłowanie', '2', '8-10', '']);
    const g = detectColumns(rows);
    const { plan } = sheetToPlan(rows, g.map, g.headerRow, { clientId: 'c', startDate: '2026-11-02' });
    expect(plan.weeks).toHaveLength(1);
    expect(plan.weeks[0].workouts[0].exercises.map((e) => [e.name, e.groups.length, e.groups[0].reps])).toEqual([['Przysiad ze sztangą', 3, '5'], ['Wyciskanie & wiosłowanie', 2, '8–10']]);
  });
  it('inny plik — czytelny błąd', async () => {
    await expect(readXlsx(new TextEncoder().encode('to nie zip'))).rejects.toThrow(/xlsx/);
  });
});
