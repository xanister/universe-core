/**
 * Job Matching Module
 *
 * Matches character occupation tags to available job openings.
 * Used by routine generator to prefer jobs that fit character skills.
 */

import type { Character } from '@dmnpc/types/entity';
import type { PlaceOccupancy } from './place/occupancy.js';

/**
 * Groups of related occupations.
 * All members within a group are considered related to each other (bidirectional).
 */
export const OCCUPATION_GROUPS: string[][] = [
  // Hospitality
  ['TAG_bartender', 'TAG_server', 'TAG_innkeeper', 'TAG_cook'],
  // Security
  ['TAG_guard', 'TAG_soldier'],
  // Religious
  ['TAG_priest', 'TAG_acolyte', 'TAG_healer'],
  // Maritime / Vessel crew
  ['TAG_fisher', 'TAG_sailor', 'TAG_captain', 'TAG_helmsman'],
  // Commerce
  ['TAG_merchant', 'TAG_clerk'],
  // Labor
  ['TAG_laborer'],
];

export interface JobMatch {
  placeId: string;
  roleTag: string;
  matchType: 'exact' | 'related' | 'unrelated';
  openings: number;
}

export interface JobMatchResult {
  matching: JobMatch[];
  other: JobMatch[];
}

/**
 * Checks if two occupation tags are related (in the same group).
 */
export function areRelatedOccupations(tagA: string, tagB: string): boolean {
  if (tagA === tagB) return true;
  return OCCUPATION_GROUPS.some((group) => group.includes(tagA) && group.includes(tagB));
}

/**
 * Gets the occupation tag from a character's tags.
 */
export function getCharacterOccupation(character: Character): string | undefined {
  const allOccupations = OCCUPATION_GROUPS.flat();
  return character.tags.find((tag) => allOccupations.includes(tag));
}

/**
 * Finds job matches for a character based on their occupation tags.
 *
 * @param character - The character looking for work
 * @param workplaces - Available workplaces with occupancy data
 * @returns Matching jobs (exact/related) and other available jobs
 */
export function findJobMatches(character: Character, workplaces: PlaceOccupancy[]): JobMatchResult {
  const characterOccupation = getCharacterOccupation(character);

  const matching: JobMatch[] = [];
  const other: JobMatch[] = [];

  for (const workplace of workplaces) {
    for (const opening of workplace.openings) {
      if (!opening.roleTag || opening.count <= 0) continue;

      const jobMatch: JobMatch = {
        placeId: workplace.placeId,
        roleTag: opening.roleTag,
        openings: opening.count,
        matchType: 'unrelated',
      };

      if (characterOccupation) {
        if (opening.roleTag === characterOccupation) {
          jobMatch.matchType = 'exact';
          matching.push(jobMatch);
        } else if (areRelatedOccupations(opening.roleTag, characterOccupation)) {
          jobMatch.matchType = 'related';
          matching.push(jobMatch);
        } else {
          other.push(jobMatch);
        }
      } else {
        // Character has no occupation tag - all jobs are "other"
        other.push(jobMatch);
      }
    }
  }

  matching.sort((a, b) => {
    if (a.matchType === 'exact' && b.matchType !== 'exact') return -1;
    if (a.matchType !== 'exact' && b.matchType === 'exact') return 1;
    return 0;
  });

  return { matching, other };
}
