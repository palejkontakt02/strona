import { describe, expect, it } from 'vitest';
import { pastedWorkout } from './pasteWorkout';

const NOTE = `DL
8x40kg
8x50kg
8x60kg (RPE 9)
8x65❌

(przysiad)
6x45
6x50
6x55
3x60

pompki
8/8/8
poziom 16/16/16

odwodzenie na wyciągu
8+8x15kg
10+10x20kg

ghb pośladek
12x20kg
12x20kg`;

describe('„Zadaj trening” — wklejona notatka', () => {
  const r = pastedWorkout(NOTE, '2026-11-18')!;
  const by = (n: string) => r.exercises.find((e) => e.name === n)!;
  it('wszystkie linie odczytane', () => {
    expect(r.from).toBe('note');
    expect(r.skipped).toEqual([]);
    expect(r.exercises.map((e) => e.name)).toEqual(['DL', 'Przysiad', 'Pompki', 'Odwodzenie na wyciągu', 'Ghb pośladek']);
  });
  it('„(RPE 9)” w nawiasie, ❌ — seria zostaje, uwaga o nieudanej', () => {
    expect(by('DL').groups.map((g) => [g.reps, g.load, g.rpe])).toEqual([['8', '40', ''], ['8', '50', ''], ['8', '60', '9'], ['8', '65', '']]);
    expect(by('DL').notes).toMatch(/Seria 4 \(8x65\) — nieudana/);
  });
  it('nazwa w nawiasie, „8/8/8” = 3 serie, „poziom 16/16/16” do uwag', () => {
    expect(by('Przysiad').groups.map((g) => g.reps)).toEqual(['6', '6', '6', '3']);
    expect(by('Pompki').groups.map((g) => [g.reps, g.load])).toEqual([['8', ''], ['8', ''], ['8', '']]);
    expect(by('Pompki').notes).toBe('Poziom 16');
  });
  it('„8+8x15kg” = 8 na stronę, nie kompleks', () => {
    const o = by('Odwodzenie na wyciągu');
    expect(o.perSide).toBe(true);
    expect(o.groups.map((g) => [g.reps, g.load])).toEqual([['8', '15'], ['10', '20']]);
    expect(o.notes ?? '').not.toMatch(/Kompleks/);
  });
  it('kompleks „2+1x60kg” dalej jako kompleks', () => {
    const k = pastedWorkout('Rwanie\n2+1x60kg', '2026-11-18')!;
    expect(k.exercises[0].notes).toMatch(/Kompleks 2\+1/);
  });
});

describe('„Zadaj trening” — zakres z arkusza', () => {
  it('nagłówki Ćwiczenie / Serie / Powt. / Ciężar / RPE', () => {
    const r = pastedWorkout('Ćwiczenie\tSerie\tPowt.\tCiężar\tRPE\nPrzysiad\t4\t6\t100\t8\nA1 Wiosłowanie\t3\t8/str.\t20\t\nA2 Face pull\t3\t12\t15\t', '2026-11-18')!;
    expect(r.from).toBe('sheet');
    expect(r.exercises.map((e) => [e.name, e.groups.length, !!e.linked])).toEqual([['Przysiad', 4, false], ['Wiosłowanie', 3, false], ['Face pull', 3, true]]);
    expect(r.exercises[0].groups[0]).toMatchObject({ reps: '6', load: '100', rpe: '8' });
  });
  it('pusty tekst → nic', () => {
    expect(pastedWorkout('  ', '2026-11-18')).toBeNull();
  });
});

describe('„Zadaj trening” — notatka z sekcjami i superserią', () => {
  const TXT = `PLYOMETRIA
pogo jumps
10
10
skoki boczne jednonóż
4/str
4/str
——————————————-
zarzut siłowy z zawisu + podrzut
2+1 x 30kg
2+1 x 37,5kg
——————————————-
SUPERSERIA – RDL + wiosłowanie
(seria RDL → od razu seria wiosłowania → przerwa 90 s → powtórz, razem 3 rundy)

RDL sztanga
8 x 45kg
8 x 45kg
+
wiosłowanie hantlem jednorącz
8/str x 16kg
8/str x 16kg
——————————————-
odwodzenie biodra na wyciągu dolnym (ciężko, RPE 9)
8/nogę x 12,5kg
——————————————-
uginanie nóg siedząc (ostatnie 2 powt. opuszczanie 3 s)
6-8 x ?kg
8 x ?kg (RPE 8)
——————————————-
dipy
6-8 x mc
CORE
copenhagen plank
20 s/str
pallof press
8/str`;
  const r = pastedWorkout(TXT, '2026-11-18')!;
  const by = (n: string) => r.exercises.find((e) => e.name === n)!;
  it('kreski, nagłówki sekcji i opis w nawiasie nie są ćwiczeniami', () => {
    expect(r.skipped).toEqual([]);
    expect(r.exercises.map((e) => e.name)).toEqual(['Pogo jumps', 'Skoki boczne jednonóż', 'Zarzut siłowy z zawisu + podrzut', 'RDL sztanga', 'Wiosłowanie hantlem jednorącz', 'Odwodzenie biodra na wyciągu dolnym', 'Uginanie nóg siedząc', 'Dipy', 'Copenhagen plank', 'Pallof press']);
  });
  it('same liczby = powtórzenia bez ciężaru, „4/str” na stronę', () => {
    expect(by('Pogo jumps').groups.map((g) => [g.reps, g.load])).toEqual([['10', ''], ['10', '']]);
    expect(by('Skoki boczne jednonóż').perSide).toBe(true);
    expect(by('Skoki boczne jednonóż').groups.map((g) => g.reps)).toEqual(['4', '4']);
  });
  it('superseria: opis do pierwszego ćwiczenia, drugie połączone; „8/str x 16kg”', () => {
    expect(by('RDL sztanga').notes).toMatch(/^Seria RDL → od razu/);
    expect(by('RDL sztanga').linked).toBeFalsy();
    const w = by('Wiosłowanie hantlem jednorącz');
    expect(w.linked).toBe(true);
    expect(w.perSide).toBe(true);
    expect(w.groups.map((g) => [g.reps, g.load])).toEqual([['8', '16'], ['8', '16']]);
    expect(by('Odwodzenie biodra na wyciągu dolnym').linked).toBeFalsy();
  });
  it('„(ciężko, RPE 9)” w nazwie → uwaga i RPE serii; „8/nogę x 12,5kg”', () => {
    const o = by('Odwodzenie biodra na wyciągu dolnym');
    expect(o.notes).toBe('Ciężko, RPE 9');
    expect(o.perSide).toBe(true);
    expect(o.groups[0]).toMatchObject({ reps: '8', load: '12.5', rpe: '9' });
  });
  it('„6-8 x ?kg” → zakres, bez ciężaru, uwaga „do dobrania”; „x mc”; „20 s/str”', () => {
    const u = by('Uginanie nóg siedząc');
    expect(u.groups.map((g) => [g.reps, g.load, g.rpe])).toEqual([['6–8', '', ''], ['8', '', '8']]);
    expect(u.notes).toMatch(/Ostatnie 2 powt\. opuszczanie 3 s · Ciężar do dobrania/);
    expect(by('Dipy').groups[0]).toMatchObject({ reps: '6–8', load: '' });
    expect(by('Copenhagen plank').groups[0].reps).toBe('20 s');
    expect(by('Copenhagen plank').perSide).toBe(true);
  });
});
