import { describe, it, expect } from 'vitest';
import { getMinutesBetween } from '@dmnpc/rulesets/basic/date-utils.js';

describe('getMinutesBetween', () => {
  it('returns positive minutes when dateB is after dateA', () => {
    expect(getMinutesBetween('2026-01-01T00:00:00Z', '2026-01-01T00:30:00Z')).toBe(30);
  });

  it('returns 0 for identical dates', () => {
    expect(getMinutesBetween('2026-01-01T12:00:00Z', '2026-01-01T12:00:00Z')).toBe(0);
  });

  it('returns negative minutes when dateB is before dateA', () => {
    expect(getMinutesBetween('2026-01-01T01:00:00Z', '2026-01-01T00:30:00Z')).toBe(-30);
  });
});
