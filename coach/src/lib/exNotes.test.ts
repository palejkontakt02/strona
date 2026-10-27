import { describe, expect, it } from 'vitest';
import { exNoteEntry, exNoteFor, exNoteKey } from './exNotes';

describe('notatki do ćwiczeń', () => {
  it('klucz bez wielkości liter i polskich znaków', () => {
    expect(exNoteKey('  Wyciskanie hantli — skos ')).toBe('wyciskanie hantli skos');
    expect(exNoteKey('Ściąganie drążka')).toBe(exNoteKey('sciaganie DRĄŻKA'));
    expect(exNoteKey('x'.repeat(100))).toHaveLength(64);
  });
  it('notatka wraca po nazwie; pusta = brak', () => {
    const notes = [exNoteEntry('Wiosłowanie linką', ' siedzisko na 4 ', 't'), exNoteEntry('Przysiad', '', 't')];
    expect(notes[0].text).toBe('siedzisko na 4');
    expect(exNoteFor(notes, 'wiosłowanie  LINKĄ')?.text).toBe('siedzisko na 4');
    expect(exNoteFor(notes, 'Przysiad')).toBeNull();
    expect(exNoteFor(undefined, 'Przysiad')).toBeNull();
  });
});
