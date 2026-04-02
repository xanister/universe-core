import { describe, it, expect } from 'vitest';
import { canonicalUniverseIdFromName } from '@dmnpc/core/entities/id-utils.js';

describe('canonicalUniverseIdFromName', () => {
  it('produces same ID for "Guardia 1000 AD", "Guardia 1000ad", and "Guardia 1000 A.D."', () => {
    const id1 = canonicalUniverseIdFromName('Guardia 1000 AD');
    const id2 = canonicalUniverseIdFromName('Guardia 1000ad');
    const id3 = canonicalUniverseIdFromName('Guardia 1000 A.D.');
    expect(id1).toBe('guardia_1000_ad');
    expect(id2).toBe('guardia_1000_ad');
    expect(id3).toBe('guardia_1000_ad');
  });

  it('produces valid slug for normal names', () => {
    expect(canonicalUniverseIdFromName('Farsreach')).toBe('farsreach');
    expect(canonicalUniverseIdFromName('Starfall Station')).toBe('starfall_station');
    expect(canonicalUniverseIdFromName('The Shadow Realm')).toBe('the_shadow_realm');
  });

  it('prefixes with u_ when slug would start with a number', () => {
    expect(canonicalUniverseIdFromName('500 BC Rome')).toBe('u_500_bc_rome');
    expect(canonicalUniverseIdFromName('2024 AD')).toBe('u_2024_ad');
  });

  it('returns u_unknown for empty or whitespace-only name', () => {
    expect(canonicalUniverseIdFromName('')).toBe('u_unknown');
    expect(canonicalUniverseIdFromName('   ')).toBe('u_unknown');
    expect(canonicalUniverseIdFromName('\t\n')).toBe('u_unknown');
  });

  it('returns u_unknown for name that becomes empty after slugification', () => {
    expect(canonicalUniverseIdFromName('!!!')).toBe('u_unknown');
    expect(canonicalUniverseIdFromName('---')).toBe('u_unknown');
  });

  it('throws on null/undefined since name is required', () => {
    expect(() => canonicalUniverseIdFromName(null as unknown as string)).toThrow();
    expect(() => canonicalUniverseIdFromName(undefined as unknown as string)).toThrow();
  });

  it('output always matches ^[a-z][a-z0-9_]*$', () => {
    const names = [
      'Guardia 1000 AD',
      'Farsreach',
      '500 BC',
      '',
      'Starfall Station',
      'The Planet (A.D.)',
    ];
    const regex = /^[a-z][a-z0-9_]*$/;
    for (const name of names) {
      const id = canonicalUniverseIdFromName(name);
      expect(id).toMatch(regex);
    }
  });
});
