import { describe, expect, it } from 'vitest';
import { cardioByName } from './run';

describe('cardioByName', () => {
  const cardio = ['Nordic walking', 'Marsz nordic walking', 'Spacer', 'Spacer 30 min', 'Marsz szybki', 'Marsz pod górę na bieżni', 'Schody', 'Schody (marsz)', 'Bieg po schodach', 'Stairmaster', 'Rower stacjonarny', 'Bieg ciągły', 'Ergometr wioślarski', 'Skakanka'];
  const strength = ['Nordic hamstring curl', 'Nordic curl', 'Nordic hamstring', 'Spacer farmera', 'Marsz farmera', 'Spacer z hantlami', 'Wykroki w marszu', 'Wejścia na schody z hantlami', 'Wejścia na schody', 'Step-up na skrzynię', 'Przysiad', 'Wiosłowanie hantlem'];
  it.each(cardio)('cardio: %s', (n) => expect(cardioByName(n)).toBe(true));
  it.each(strength)('siłowe: %s', (n) => expect(cardioByName(n)).toBe(false));
});
