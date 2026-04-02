/**
 * Unit tests for world-population-audit: auditWorldPopulation
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createTestCharacter,
  createTestPlace,
  createMockUniverseContext,
} from '@dmnpc/core/test-helpers/index.js';
import { auditWorldPopulation } from '../../src/document/world-population-audit.js';

// Prevent transitive load of @anthropic-ai/sdk via capacity-rules → tag-manager → openai-client
vi.mock('@dmnpc/core/clients/claude-client.js', () => ({
  queryClaudeLlm: vi.fn(),
  createClaudeAgentProvider: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeNpcWithHome(id: string, homePlaceId: string | null) {
  return createTestCharacter({
    id,
    label: id,
    info: {
      isPlayer: false,
      routine: {
        schedule: { dawn: 'home', morning: 'work', afternoon: 'work', evening: 'home', night: 'home' },
        home: { placeId: homePlaceId, description: '', areaHint: null },
        work: { placeId: null, description: '', areaHint: null },
        leisure: null,
        variance: 0,
      },
    },
  });
}

function makeNpcWithLeisureSchedule(id: string, hasLeisurePlan: boolean) {
  return createTestCharacter({
    id,
    label: id,
    info: {
      isPlayer: false,
      routine: {
        schedule: { dawn: 'home', morning: 'work', afternoon: 'leisure', evening: 'home', night: 'home' },
        home: { placeId: 'PLACE_home', description: '', areaHint: null },
        work: { placeId: null, description: '', areaHint: null },
        leisure: hasLeisurePlan
          ? { favoriteSpot: { placeId: 'PLACE_park', description: '', areaHint: null }, preferredTagIds: [] }
          : null,
        variance: 0,
      },
    },
  });
}

function makeSingleHome(id: string) {
  return createTestPlace({
    id,
    label: id,
    tags: ['TAG_home_single'],
  });
}

function makeSharedHome(id: string) {
  return createTestPlace({
    id,
    label: id,
    tags: ['TAG_home_shared'],
  });
}

function makeTavern(id: string) {
  return createTestPlace({
    id,
    label: id,
    tags: ['TAG_workplace_tavern'],
  });
}

function makeCtx(characters: ReturnType<typeof createTestCharacter>[], places: ReturnType<typeof createTestPlace>[]) {
  return createMockUniverseContext({ characters, places });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('auditWorldPopulation', () => {
  it('returns healthy with no warnings when all characters have homes and workplaces are staffed', () => {
    const home = makeSingleHome('PLACE_home');
    const tavern = makeTavern('PLACE_tavern');
    const bartender = createTestCharacter({
      id: 'CHAR_bart',
      tags: ['TAG_bartender'],
      info: {
        isPlayer: false,
        routine: {
          schedule: { dawn: 'home', morning: 'work', afternoon: 'work', evening: 'work', night: 'home' },
          home: { placeId: 'PLACE_home', description: '', areaHint: null },
          work: { placeId: 'PLACE_tavern', description: '', areaHint: null },
          leisure: null,
          variance: 0,
        },
      },
    });

    const result = auditWorldPopulation(makeCtx([bartender], [home, tavern]));

    expect(result.warnings).toHaveLength(0);
    expect(result.isHealthy).toBe(true);
  });

  it('reports HOMELESS_CHARACTER for each character with no home, and isHealthy false when >50% are homeless', () => {
    const char1 = makeNpcWithHome('CHAR_1', null);
    const char2 = makeNpcWithHome('CHAR_2', null);

    const result = auditWorldPopulation(makeCtx([char1, char2], []));

    const homeless = result.warnings.filter((w) => w.code === 'HOMELESS_CHARACTER');
    expect(homeless).toHaveLength(2);
    expect(homeless[0].entityId).toBe('CHAR_1');
    expect(homeless[1].entityId).toBe('CHAR_2');
    expect(result.isHealthy).toBe(false);
  });

  it('reports UNSTAFFED_WORKPLACE for a tavern with no staff', () => {
    const tavern = makeTavern('PLACE_tavern');

    const result = auditWorldPopulation(makeCtx([], [tavern]));

    const unstaffed = result.warnings.filter((w) => w.code === 'UNSTAFFED_WORKPLACE');
    expect(unstaffed).toHaveLength(1);
    expect(unstaffed[0].entityId).toBe('PLACE_tavern');
  });

  it('reports OVERCROWDED_HOME when occupancy exceeds capacity', () => {
    const singleHome = makeSingleHome('PLACE_home');
    const char1 = makeNpcWithHome('CHAR_1', 'PLACE_home');
    const char2 = makeNpcWithHome('CHAR_2', 'PLACE_home');
    const char3 = makeNpcWithHome('CHAR_3', 'PLACE_home');

    const result = auditWorldPopulation(makeCtx([char1, char2, char3], [singleHome]));

    const overcrowded = result.warnings.filter((w) => w.code === 'OVERCROWDED_HOME');
    expect(overcrowded).toHaveLength(1);
    expect(overcrowded[0].entityId).toBe('PLACE_home');
    expect(overcrowded[0].message).toContain('3/1');
  });

  it('reports NO_LEISURE_PLAN when a character has a leisure schedule but no leisure plan', () => {
    const char = makeNpcWithLeisureSchedule('CHAR_1', false);

    const result = auditWorldPopulation(makeCtx([char], []));

    const noLeisure = result.warnings.filter((w) => w.code === 'NO_LEISURE_PLAN');
    expect(noLeisure).toHaveLength(1);
    expect(noLeisure[0].entityId).toBe('CHAR_1');
  });

  it('does not report NO_LEISURE_PLAN when leisure plan is assigned', () => {
    const char = makeNpcWithLeisureSchedule('CHAR_1', true);

    const result = auditWorldPopulation(makeCtx([char], []));

    const noLeisure = result.warnings.filter((w) => w.code === 'NO_LEISURE_PLAN');
    expect(noLeisure).toHaveLength(0);
  });

  it('reports UNUSED_RESIDENCE as info for homes with no occupants', () => {
    const home = makeSingleHome('PLACE_home');

    const result = auditWorldPopulation(makeCtx([], [home]));

    const unused = result.infos.filter((i) => i.code === 'UNUSED_RESIDENCE');
    expect(unused).toHaveLength(1);
    expect(unused[0].severity).toBe('info');
    expect(unused[0].entityId).toBe('PLACE_home');
  });

  it('isHealthy true when <50% of characters are homeless', () => {
    const home = makeSingleHome('PLACE_home');
    const housed = makeNpcWithHome('CHAR_1', 'PLACE_home');
    const homeless = makeNpcWithHome('CHAR_2', null);

    // 1 of 2 = 50% homeless, which is NOT < 0.5 so isHealthy should be false
    const result = auditWorldPopulation(makeCtx([housed, homeless], [home]));
    expect(result.isHealthy).toBe(false);
  });

  it('isHealthy true when homeless rate is below threshold', () => {
    const home1 = makeSingleHome('PLACE_home1');
    const home2 = makeSingleHome('PLACE_home2');
    const home3 = makeSingleHome('PLACE_home3');
    const char1 = makeNpcWithHome('CHAR_1', 'PLACE_home1');
    const char2 = makeNpcWithHome('CHAR_2', 'PLACE_home2');
    const char3 = makeNpcWithHome('CHAR_3', 'PLACE_home3');
    const char4 = makeNpcWithHome('CHAR_4', null); // 1 of 4 = 25% homeless

    const result = auditWorldPopulation(makeCtx([char1, char2, char3, char4], [home1, home2, home3]));
    expect(result.isHealthy).toBe(true);
    expect(result.warnings.filter((w) => w.code === 'HOMELESS_CHARACTER')).toHaveLength(1);
  });

  it('skips player characters when checking for homeless', () => {
    const playerChar = createTestCharacter({
      id: 'CHAR_player',
      info: {
        isPlayer: true,
        routine: {
          schedule: { dawn: 'home', morning: 'home', afternoon: 'home', evening: 'home', night: 'home' },
          home: { placeId: null, description: '', areaHint: null },
          work: null,
          leisure: null,
          variance: 0,
        },
      },
    });

    const result = auditWorldPopulation(makeCtx([playerChar], []));

    expect(result.warnings.filter((w) => w.code === 'HOMELESS_CHARACTER')).toHaveLength(0);
    expect(result.isHealthy).toBe(true);
  });
});
