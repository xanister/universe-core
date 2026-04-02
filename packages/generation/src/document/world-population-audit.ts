/**
 * World Population Audit
 *
 * Post-generation read-only scan that checks population consistency.
 * Runs after the full universe generation pipeline and produces a structured
 * result with warnings (advisory) and a health verdict (blocking threshold).
 */

import type { Character, Place } from '@dmnpc/types/entity';
import { getHomeOccupancy, getWorkplaceOccupancy } from '../place/occupancy.js';

// ============================================================================
// Types
// ============================================================================

export interface AuditFinding {
  severity: 'warning' | 'info';
  /** Machine-readable code, e.g. 'UNSTAFFED_WORKPLACE' */
  code: string;
  message: string;
  /** Place or character ID, if applicable */
  entityId?: string;
}

export interface PopulationAuditResult {
  warnings: AuditFinding[];
  infos: AuditFinding[];
  /** False if >50% of characters are homeless OR >50% of workplaces are unstaffed */
  isHealthy: boolean;
}

// ============================================================================
// Audit
// ============================================================================

/**
 * Runs a read-only population consistency audit against the universe context.
 * Does not modify any entity data.
 */
export function auditWorldPopulation(ctx: {
  getAllCharacters(): Character[];
  getAllPlaces(): Place[];
}): PopulationAuditResult {
  const warnings: AuditFinding[] = [];
  const infos: AuditFinding[] = [];

  const allCharacters = ctx.getAllCharacters();
  const allPlaces = ctx.getAllPlaces();

  // ── 1. Unstaffed workplaces ───────────────────────────────────────────────
  const workplaceOccupancy = getWorkplaceOccupancy(allCharacters, allPlaces);
  for (const occ of workplaceOccupancy) {
    if (occ.totalCurrent === 0) {
      const place = allPlaces.find((p) => p.id === occ.placeId);
      warnings.push({
        severity: 'warning',
        code: 'UNSTAFFED_WORKPLACE',
        message: `Workplace "${place?.label ?? occ.placeId}" has no staff`,
        entityId: occ.placeId,
      });
    }
  }

  // ── 2. Homeless characters ────────────────────────────────────────────────
  const routineCharacters = allCharacters.filter(
    (c) => !c.info.isPlayer && c.info.routine !== null,
  );
  for (const char of routineCharacters) {
    if (char.info.routine!.home.placeId === null) {
      warnings.push({
        severity: 'warning',
        code: 'HOMELESS_CHARACTER',
        message: `Character "${char.label}" has no home`,
        entityId: char.id,
      });
    }
  }

  // ── 3. Overcrowded homes ──────────────────────────────────────────────────
  const homeOccupancy = getHomeOccupancy(allCharacters, allPlaces);
  for (const occ of homeOccupancy) {
    if (occ.totalCurrent > occ.totalCapacity) {
      const place = allPlaces.find((p) => p.id === occ.placeId);
      warnings.push({
        severity: 'warning',
        code: 'OVERCROWDED_HOME',
        message: `Home "${place?.label ?? occ.placeId}" is overcrowded (${occ.totalCurrent}/${occ.totalCapacity})`,
        entityId: occ.placeId,
      });
    }
  }

  // ── 4. Leisure-less characters ────────────────────────────────────────────
  for (const char of routineCharacters) {
    const routine = char.info.routine!;
    const hasLeisurePeriod = Object.values(routine.schedule).includes('leisure');
    if (hasLeisurePeriod && routine.leisure === null) {
      warnings.push({
        severity: 'warning',
        code: 'NO_LEISURE_PLAN',
        message: `Character "${char.label}" has a leisure schedule but no leisure plan`,
        entityId: char.id,
      });
    }
  }

  // ── 5. Orphaned residences ────────────────────────────────────────────────
  for (const occ of homeOccupancy) {
    if (occ.totalCurrent === 0) {
      const place = allPlaces.find((p) => p.id === occ.placeId);
      infos.push({
        severity: 'info',
        code: 'UNUSED_RESIDENCE',
        message: `Home "${place?.label ?? occ.placeId}" has no occupants`,
        entityId: occ.placeId,
      });
    }
  }

  // ── Health thresholds ─────────────────────────────────────────────────────
  const homelessCount = warnings.filter((w) => w.code === 'HOMELESS_CHARACTER').length;
  const homelessRate = routineCharacters.length > 0 ? homelessCount / routineCharacters.length : 0;

  const unstaffedCount = warnings.filter((w) => w.code === 'UNSTAFFED_WORKPLACE').length;
  const unstaffedRate =
    workplaceOccupancy.length > 0 ? unstaffedCount / workplaceOccupancy.length : 0;

  const isHealthy = homelessRate < 0.5 && unstaffedRate < 0.5;

  return { warnings, infos, isHealthy };
}
