import { describe, expect, it } from 'vitest';
import { onboardingAutoHidden, recordRow } from './clientCard';

describe('karta podopiecznego', () => {
  const r3 = { load: 92.5, reps: 3, e1: 101.8, date: '2026-10-01' };
  const r1 = { load: 100, reps: 1, e1: 100, date: '2026-10-02' };
  it('1RM tylko z serii pojedynczej', () => {
    expect(recordRow(1, r3)).toBeNull();
    expect(recordRow(1, r1)).toBe(r1);
    expect(recordRow(3, r3)).toBe(r3);
    expect(recordRow(5, null)).toBeNull();
  });
  it('pierwsze kroki znikają po 3 treningach', () => {
    expect(onboardingAutoHidden(2)).toBe(false);
    expect(onboardingAutoHidden(3)).toBe(true);
  });
});
