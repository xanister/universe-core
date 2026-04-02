/**
 * Template Matcher
 *
 * Matches characters from WorldBible (document extraction) to template characters.
 * Uses fuzzy name matching to identify when a document character corresponds
 * to an existing template character.
 */

import { logger } from '@dmnpc/core/infra/logger.js';
import { listTemplateCharacters } from '@dmnpc/core/stores/template-character-store.js';
import type { TemplateCharacterDefinition } from '@dmnpc/types/npc';
import type { WorldBible, WorldBibleCharacterRef } from '@dmnpc/types/world';

// ============================================================================
// Types
// ============================================================================

/** Reference to a character extracted from documents */
export type CharacterRef = WorldBibleCharacterRef;

/** Result of matching a WorldBible character to a template */
export interface TemplateMatch {
  /** The template that was matched */
  template: TemplateCharacterDefinition;
  /** The character reference from the WorldBible */
  characterRef: CharacterRef;
  /** Confidence score for the match (0-1) */
  confidence: number;
}

/** Result of the matching process */
export interface MatchResult {
  /** Characters that matched templates */
  matched: TemplateMatch[];
  /** Characters that did not match any template */
  unmatched: CharacterRef[];
}

// ============================================================================
// Name Normalization
// ============================================================================

/**
 * Normalize a name for comparison.
 * Lowercases, removes punctuation, and trims whitespace.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[''`]/g, '') // Remove apostrophes
    .replace(/[^a-z0-9\s]/g, ' ') // Replace non-alphanumeric with spaces
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim();
}

/**
 * Extract name parts (first name, last name, etc.)
 */
function getNameParts(name: string): string[] {
  return normalizeName(name).split(' ').filter(Boolean);
}

/**
 * Extract nicknames from a name and return the base name without nicknames.
 * Handles quoted nicknames: "Pip", 'Pip', and parenthesized: (Pip)
 *
 * Example: 'Pipras "Pip" Pennyroyal' → { baseName: 'Pipras Pennyroyal', nicknames: ['Pip'] }
 */
function extractNicknamesAndName(fullName: string): {
  baseName: string;
  nicknames: string[];
} {
  const nicknames: string[] = [];
  // Match quoted portions: "Pip", 'Pip', "Pip", 'Pip', and parenthesized (Pip)
  const nicknamePattern =
    /[""\u201C\u201D]([^""\u201C\u201D]+)[""\u201C\u201D]|[''\u2018\u2019]([^''\u2018\u2019]+)[''\u2018\u2019]|\(([^)]+)\)/g;
  let match;

  while ((match = nicknamePattern.exec(fullName)) !== null) {
    // match[1] is double-quoted, match[2] is single-quoted, match[3] is parenthesized
    const nickname = match[1] || match[2] || match[3];
    if (nickname) {
      nicknames.push(nickname.trim());
    }
  }

  // Remove nicknames from base name
  const baseName = fullName.replace(nicknamePattern, '').replace(/\s+/g, ' ').trim();

  return { baseName, nicknames };
}

// ============================================================================
// Fuzzy Matching
// ============================================================================

/**
 * Calculate similarity between two strings using Levenshtein distance.
 * Returns a score from 0 (no match) to 1 (exact match).
 */
function stringSimilarity(a: string, b: string): number {
  const aNorm = normalizeName(a);
  const bNorm = normalizeName(b);

  if (aNorm === bNorm) return 1;
  if (aNorm.length === 0 || bNorm.length === 0) return 0;

  // Calculate Levenshtein distance
  const matrix: number[][] = [];

  for (let i = 0; i <= aNorm.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= bNorm.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= aNorm.length; i++) {
    for (let j = 1; j <= bNorm.length; j++) {
      const cost = aNorm[i - 1] === bNorm[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost, // substitution
      );
    }
  }

  const distance = matrix[aNorm.length][bNorm.length];
  const maxLength = Math.max(aNorm.length, bNorm.length);

  return 1 - distance / maxLength;
}

/**
 * Calculate match confidence between a document character name and a template name.
 *
 * Key principles:
 * - First name is the PRIMARY identifier - must match for high confidence
 * - Last name alone is INSUFFICIENT for a match (prevents "Ashina Majere" matching "Xanister Majere")
 * - Nicknames in quotes can match first names (e.g., "Pip" matching "Pipras")
 */
function calculateNameMatchConfidence(docName: string, templateName: string): number {
  // Extract nicknames from both names
  const docParsed = extractNicknamesAndName(docName);
  const templateParsed = extractNicknamesAndName(templateName);

  const docBaseName = docParsed.baseName;
  const templateBaseName = templateParsed.baseName;

  // Exact match after normalization (excluding nicknames)
  if (normalizeName(docBaseName) === normalizeName(templateBaseName)) {
    return 1.0;
  }

  const docParts = getNameParts(docBaseName);
  const templateParts = getNameParts(templateBaseName);

  // Need at least one part in each name to compare
  if (docParts.length === 0 || templateParts.length === 0) {
    return 0;
  }

  const docFirstName = docParts[0];
  const templateFirstName = templateParts[0];

  // Collect all "first name equivalents" for each side (first name + nicknames)
  const docFirstNameEquivalents = [
    docFirstName,
    ...docParsed.nicknames.map((n) => normalizeName(n)),
  ];
  const templateFirstNameEquivalents = [
    templateFirstName,
    ...templateParsed.nicknames.map((n) => normalizeName(n)),
  ];

  // Check if any first-name equivalent matches
  const firstNameMatches = docFirstNameEquivalents.some((docFirst) =>
    templateFirstNameEquivalents.some((templateFirst) => docFirst === templateFirst),
  );

  // Check if document first name is contained in template first name or vice versa
  // This handles "Xanister" matching template "Xanister Majere" when doc only has first name
  const firstNameContained =
    templateFirstName.includes(docFirstName) || docFirstName.includes(templateFirstName);

  // Check for first name fuzzy match (handles typos)
  const firstNameSimilarity = stringSimilarity(docFirstName, templateFirstName);
  const firstNameFuzzyMatch = firstNameSimilarity >= 0.8;

  // CRITICAL: Reject if first names don't match at all
  // This prevents "Ashina Majere" from matching "Xanister Majere"
  if (!firstNameMatches && !firstNameContained && !firstNameFuzzyMatch) {
    // Check if doc name might be a nickname matching template first name
    const docNameMatchesTemplateNickname = templateFirstNameEquivalents.some(
      (templateEquiv) => normalizeName(docBaseName) === templateEquiv,
    );
    if (!docNameMatchesTemplateNickname) {
      return 0;
    }
  }

  // First name exact match
  if (firstNameMatches) {
    // Check how many other parts also match (last name, etc.)
    const otherDocParts = docParts.slice(1);
    const otherTemplateParts = templateParts.slice(1);
    const otherMatchCount = otherDocParts.filter((p) => otherTemplateParts.includes(p)).length;

    if (otherMatchCount > 0 && otherDocParts.length > 0) {
      // First name + last name match
      return 0.95;
    }
    // Just first name match
    return 0.85;
  }

  // First name contained (e.g., doc="Xanister" matching template="Xanister Majere")
  if (firstNameContained) {
    // If doc is just first name matching template's first name, that's a good match
    if (docParts.length === 1 && docFirstName === templateFirstName) {
      return 0.85;
    }
    // Partial containment
    return (
      0.7 +
      0.2 * (Math.min(docFirstName.length, templateFirstName.length) / templateFirstName.length)
    );
  }

  // First name fuzzy match (typos)
  if (firstNameFuzzyMatch) {
    return 0.7 + 0.15 * firstNameSimilarity;
  }

  return 0;
}

// ============================================================================
// Main Matching Function
// ============================================================================

/** Minimum confidence threshold to consider a match valid */
const MATCH_THRESHOLD = 0.6;

/**
 * Match WorldBible characters to template characters.
 *
 * For each character in the WorldBible, attempts to find a matching template
 * using fuzzy name matching. Returns matched pairs and unmatched characters.
 */
export async function matchCharactersToTemplates(worldBible: WorldBible): Promise<MatchResult> {
  const templates = await listTemplateCharacters();

  if (templates.length === 0) {
    logger.info('TemplateMatcher', 'No template characters available for matching');
    return {
      matched: [],
      unmatched: worldBible.characters,
    };
  }

  const matched: TemplateMatch[] = [];
  const unmatched: CharacterRef[] = [];
  const usedTemplates = new Set<string>();

  // Process each character from the WorldBible
  for (const charRef of worldBible.characters) {
    let bestMatch: {
      template: TemplateCharacterDefinition;
      confidence: number;
    } | null = null;

    // Find the best matching template
    for (const template of templates) {
      // Skip already-used templates (each template can only match one character)
      if (usedTemplates.has(template.id)) continue;

      const confidence = calculateNameMatchConfidence(charRef.name, template.label);

      if (confidence >= MATCH_THRESHOLD) {
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { template, confidence };
        }
      }
    }

    if (bestMatch) {
      matched.push({
        template: bestMatch.template,
        characterRef: charRef,
        confidence: bestMatch.confidence,
      });
      usedTemplates.add(bestMatch.template.id);

      logger.info(
        'TemplateMatcher',
        `Matched "${charRef.name}" to template "${bestMatch.template.label}" (confidence: ${bestMatch.confidence.toFixed(2)})`,
      );
    } else {
      unmatched.push(charRef);
    }
  }

  logger.info(
    'TemplateMatcher',
    `Matching complete: ${matched.length} matched, ${unmatched.length} unmatched`,
  );

  return { matched, unmatched };
}

/**
 * Check if a single character name matches any template.
 * Returns the matched template and confidence, or null if no match.
 */
export async function findTemplateMatch(characterName: string): Promise<{
  template: TemplateCharacterDefinition;
  confidence: number;
} | null> {
  const templates = await listTemplateCharacters();

  let bestMatch: {
    template: TemplateCharacterDefinition;
    confidence: number;
  } | null = null;

  for (const template of templates) {
    const confidence = calculateNameMatchConfidence(characterName, template.label);

    if (confidence >= MATCH_THRESHOLD) {
      if (!bestMatch || confidence > bestMatch.confidence) {
        bestMatch = { template, confidence };
      }
    }
  }

  return bestMatch;
}
