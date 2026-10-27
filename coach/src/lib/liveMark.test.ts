import { describe, expect, it } from 'vitest';
import { liveMarkActive, markNeedsUpdate, wantedMark } from './liveMark';

const now = Date.parse('2026-10-27T11:00:00Z');
describe('liveMark', () => {
  it('aktywny przez 4 h', () => {
    expect(liveMarkActive({ at: '2026-10-27T10:00:00Z', name: 'A' }, now)).toBe(true);
    expect(liveMarkActive({ at: '2026-10-27T06:00:00Z', name: 'A' }, now)).toBe(false);
    expect(liveMarkActive(undefined, now)).toBe(false);
  });
  it('poprawki zapisanego treningu nie blokują podopiecznego', () => {
    expect(wantedMark({ name: 'A', workoutId: 'w', editSessionId: 's' })).toBeNull();
    expect(wantedMark({ name: 'A', workoutId: 'w' })).toEqual({ name: 'A', workoutId: 'w' });
  });
  it('kiedy zapisać zmianę', () => {
    const m = { at: '2026-10-27T10:30:00Z', name: 'A', workoutId: 'w' };
    expect(markNeedsUpdate({ liveBy: m }, { name: 'A', workoutId: 'w' }, now)).toBe(false);
    expect(markNeedsUpdate({ liveBy: m }, null, now)).toBe(true);
    expect(markNeedsUpdate({}, null, now)).toBe(false);
    expect(markNeedsUpdate({}, { name: 'A', workoutId: 'w' }, now)).toBe(true);
    expect(markNeedsUpdate({ liveBy: m }, { name: 'B', workoutId: 'x' }, now)).toBe(true);
  });
});
