/**
 * Unit tests for place label validation.
 *
 * Tests the centralized place validation logic in lib/place-validation.ts.
 * This module is used by:
 * - object-generator.ts (exit generation)
 * - place-generator.ts
 * - place-awareness.ts
 * - describe-transition.ts
 */

import { describe, it, expect } from 'vitest';
import {
  isObjectOrContainer,
  isNonEnterableLocation,
  isGenericLabel,
  isSubLocation,
  validatePlaceLabel,
  validateRegionLabel,
  isGenericRegionLabel,
  hasNavigationSyntax,
  hasLocationSuffix,
  hasParentheticalDetail,
} from '@dmnpc/core/entities/place-validation.js';

describe('lib/place-validation.ts', () => {
  describe('isObjectOrContainer', () => {
    it('rejects containers and storage', () => {
      expect(isObjectOrContainer('research kit')).toBe('kit');
      expect(isObjectOrContainer('Guide Research Kit')).toBe('kit');
      expect(isObjectOrContainer('storage crate')).toBe('crate');
      expect(isObjectOrContainer('supply cabinet')).toBe('cabinet');
      expect(isObjectOrContainer('the chest')).toBe('chest');
    });

    it('rejects equipment and devices', () => {
      expect(isObjectOrContainer('terminal')).toBe('terminal');
      expect(isObjectOrContainer('control panel')).toBe('panel');
      expect(isObjectOrContainer('navigation equipment')).toBe('equipment');
    });

    it('rejects virtual/abstract concepts', () => {
      expect(isObjectOrContainer('research database')).toBe('database');
      expect(isObjectOrContainer('computer system')).toBe('system');
      expect(isObjectOrContainer('communication network')).toBe('network');
    });

    it('rejects furniture parts that are not rooms', () => {
      expect(isObjectOrContainer('storage shelf')).toBe('shelf');
      expect(isObjectOrContainer('cargo compartment')).toBe('compartment');
    });

    it('accepts locations with room-type words even if they contain object words', () => {
      expect(isObjectOrContainer('Storage Bay')).toBeNull();
      expect(isObjectOrContainer('Equipment Room')).toBeNull();
      expect(isObjectOrContainer('Server Chamber')).toBeNull();
      expect(isObjectOrContainer('Database Hall')).toBeNull();
      // Transportation terminals with gate/platform override "terminal" detection
      expect(isObjectOrContainer('Terminal Gate')).toBeNull();
      expect(isObjectOrContainer('Spur 9 Terminal Gate')).toBeNull();
      expect(isObjectOrContainer('Platform 3')).toBeNull();
    });

    it('accepts proper room/location types', () => {
      expect(isObjectOrContainer('Medical Bay')).toBeNull();
      expect(isObjectOrContainer('The Bridge')).toBeNull();
      expect(isObjectOrContainer('Cargo Hold')).toBeNull();
      expect(isObjectOrContainer("Captain's Quarters")).toBeNull();
      expect(isObjectOrContainer('The Galley')).toBeNull();
      expect(isObjectOrContainer('Recreation Deck')).toBeNull();
    });
  });

  describe('isNonEnterableLocation', () => {
    it('rejects bare street/road types', () => {
      expect(isNonEnterableLocation('street')).toBe('street');
      expect(isNonEnterableLocation('road')).toBe('road');
      expect(isNonEnterableLocation('lane')).toBe('lane');
      expect(isNonEnterableLocation('alley')).toBe('alley');
    });

    it('rejects street types with articles', () => {
      expect(isNonEnterableLocation('the street')).toBe('street');
      expect(isNonEnterableLocation('a road')).toBe('road');
    });

    it('rejects street types with generic modifiers', () => {
      expect(isNonEnterableLocation('main street')).toBe('street');
      expect(isNonEnterableLocation('back alley')).toBe('alley');
      expect(isNonEnterableLocation('the north road')).toBe('road');
    });

    it('accepts properly named streets', () => {
      expect(isNonEnterableLocation('Market Street')).toBeNull();
      expect(isNonEnterableLocation('Riverside Lane')).toBeNull();
      expect(isNonEnterableLocation('Crimson Alley')).toBeNull();
    });

    it('accepts enterable location types', () => {
      expect(isNonEnterableLocation('The Market Square')).toBeNull();
      expect(isNonEnterableLocation('Harbor District')).toBeNull();
      expect(isNonEnterableLocation('The Rusty Mug')).toBeNull();
    });
  });

  describe('isGenericLabel', () => {
    it('rejects objects and containers', () => {
      expect(isGenericLabel('research kit')).toBe(true);
      expect(isGenericLabel('Guide Research Kit')).toBe(true);
      expect(isGenericLabel('storage crate')).toBe(true);
    });

    it('rejects bare structure words', () => {
      expect(isGenericLabel('room')).toBe(true);
      expect(isGenericLabel('door')).toBe(true);
      expect(isGenericLabel('stairs')).toBe(true);
    });

    it('rejects structure words with generic modifiers', () => {
      expect(isGenericLabel('the room')).toBe(true);
      expect(isGenericLabel('second door')).toBe(true);
      expect(isGenericLabel('back passage')).toBe(true);
      expect(isGenericLabel('your room')).toBe(true);
    });

    it('accepts distinctive place names', () => {
      expect(isGenericLabel('The Private Chamber')).toBe(false);
      expect(isGenericLabel("Grimshaw's Workshop")).toBe(false);
      expect(isGenericLabel('The Wine Cellar')).toBe(false);
      expect(isGenericLabel('Harbor District')).toBe(false);
    });

    it('accepts names with distinctive adjectives before structure words', () => {
      expect(isGenericLabel('Crimson Chamber')).toBe(false);
      expect(isGenericLabel('Golden Door')).toBe(false);
      expect(isGenericLabel('Velvet Room')).toBe(false);
    });

    it('rejects labels with navigation syntax (arrows and relative directions)', () => {
      expect(isGenericLabel('Second door past the lantern arch → Intake and Seals')).toBe(true);
      expect(isGenericLabel('Through the gate -> Market Square')).toBe(true);
      expect(isGenericLabel('past the fountain')).toBe(true);
      expect(isGenericLabel('via the bridge')).toBe(true);
      expect(isGenericLabel('beyond the walls')).toBe(true);
    });
  });

  describe('hasNavigationSyntax', () => {
    it('detects arrow notation', () => {
      expect(hasNavigationSyntax('Second door → Intake')).toBe(true);
      expect(hasNavigationSyntax('Gate -> Market')).toBe(true);
    });

    it('detects relative direction phrases', () => {
      expect(hasNavigationSyntax('past the fountain')).toBe(true);
      expect(hasNavigationSyntax('through the gate')).toBe(true);
      expect(hasNavigationSyntax('via the bridge')).toBe(true);
      expect(hasNavigationSyntax('beyond the walls')).toBe(true);
      expect(hasNavigationSyntax('toward the harbor')).toBe(true);
      expect(hasNavigationSyntax('down the hallway')).toBe(true);
      expect(hasNavigationSyntax('up the stairs')).toBe(true);
      expect(hasNavigationSyntax('across the courtyard')).toBe(true);
      expect(hasNavigationSyntax('along the path')).toBe(true);
    });

    it('accepts proper place names without navigation syntax', () => {
      expect(hasNavigationSyntax('Lantern Hall Intake and Seals')).toBe(false);
      expect(hasNavigationSyntax('The Prancing Pony Backroom')).toBe(false);
      expect(hasNavigationSyntax('Harbor District Warehouse')).toBe(false);
      expect(hasNavigationSyntax('The Rusty Anchor')).toBe(false);
    });
  });

  describe('hasLocationSuffix', () => {
    it('detects location suffixes with road types', () => {
      expect(hasLocationSuffix('The Crossroads Inn, Trident Road')).toBe(', Trident Road');
      expect(hasLocationSuffix('The Rusty Anchor, Harbor Street')).toBe(', Harbor Street');
      expect(hasLocationSuffix("Blacksmith's Forge, Market Lane")).toBe(', Market Lane');
      expect(hasLocationSuffix('The Golden Cup, Kings Avenue')).toBe(', Kings Avenue');
    });

    it('detects various location suffix types', () => {
      expect(hasLocationSuffix('Temple of Light, Pilgrim Way')).toBe(', Pilgrim Way');
      expect(hasLocationSuffix('The Gilded Rose, Noble Boulevard')).toBe(', Noble Boulevard');
      expect(hasLocationSuffix('Corner Shop, Market Row')).toBe(', Market Row');
      expect(hasLocationSuffix('The Hideout, Shadow Alley')).toBe(', Shadow Alley');
    });

    it('returns null for valid place names without location suffixes', () => {
      expect(hasLocationSuffix('The Crossroads Inn')).toBeNull();
      expect(hasLocationSuffix('The Rusty Anchor')).toBeNull();
      expect(hasLocationSuffix('Harbor District')).toBeNull();
      expect(hasLocationSuffix("Holst's Forge")).toBeNull();
    });

    it('returns null for places that are roads themselves', () => {
      // These are roads/streets, not places with location suffixes
      expect(hasLocationSuffix('Trident Road')).toBeNull();
      expect(hasLocationSuffix('Market Street')).toBeNull();
      expect(hasLocationSuffix('Kings Avenue')).toBeNull();
    });

    it('returns null for places with commas that are not location suffixes', () => {
      // Comma followed by something that is not a road type
      expect(hasLocationSuffix('The Inn, First Floor')).toBeNull();
      expect(hasLocationSuffix('Warehouse, Section A')).toBeNull();
    });
  });

  describe('hasParentheticalDetail', () => {
    it('detects parenthetical details', () => {
      expect(hasParentheticalDetail('Market Square (Fish Stalls)')).toBe(true);
      expect(hasParentheticalDetail('Rope Tables (Chokepoint)')).toBe(true);
      expect(hasParentheticalDetail('Main Deck (Fore Section)')).toBe(true);
    });

    it('accepts proper place names without parentheses', () => {
      expect(hasParentheticalDetail('The Rope Tables')).toBe(false);
      expect(hasParentheticalDetail('Fish Market')).toBe(false);
      expect(hasParentheticalDetail('The Foredeck')).toBe(false);
    });
  });

  describe('validatePlaceLabel with parenthetical patterns', () => {
    it('rejects parenthetical details', () => {
      const result = validatePlaceLabel('Market Square (Fish Stalls)');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('parenthetical details');
      expect(result.detectedType).toBe('parenthetical_detail');
    });

    it('accepts properly named places without forbidden patterns', () => {
      expect(validatePlaceLabel('The Rope Tables').valid).toBe(true);
      expect(validatePlaceLabel('Fish Market').valid).toBe(true);
      expect(validatePlaceLabel('Crownchain Quayside').valid).toBe(true);
    });
  });

  describe('validatePlaceLabel', () => {
    it('returns valid: true for proper place names', () => {
      expect(validatePlaceLabel('The Rusty Mug')).toEqual({ valid: true });
      expect(validatePlaceLabel('Harbor District')).toEqual({ valid: true });
      expect(validatePlaceLabel("Captain's Quarters")).toEqual({ valid: true });
      expect(validatePlaceLabel('Medical Bay')).toEqual({ valid: true });
    });

    it('returns detailed error for empty labels', () => {
      const result = validatePlaceLabel('');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('empty');
    });

    it('returns detailed error for objects/containers', () => {
      const result = validatePlaceLabel('Guide Research Kit');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('object/container');
      expect(result.detectedType).toBe('kit');
    });

    it('returns detailed error for non-enterable locations', () => {
      const result = validatePlaceLabel('main street');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('non-enterable');
      expect(result.detectedType).toBe('street');
    });

    it('returns detailed error for generic labels', () => {
      const result = validatePlaceLabel('the room');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('generic');
    });
  });

  describe('real-world bug examples', () => {
    it('rejects "Guide Research Kit" (the original bug)', () => {
      const result = validatePlaceLabel('Guide Research Kit');
      expect(result.valid).toBe(false);
    });

    it('rejects "The Crossroads Inn, Trident Road" (location suffix bug)', () => {
      const result = validatePlaceLabel('The Crossroads Inn, Trident Road');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('location suffix');
      expect(result.detectedType).toBe(', Trident Road');
    });

    it('accepts "The Crossroads Inn" without location suffix', () => {
      const result = validatePlaceLabel('The Crossroads Inn');
      expect(result.valid).toBe(true);
    });

    it('rejects "Guide research databases via ship communications"', () => {
      const result = validatePlaceLabel('Guide research databases via ship communications');
      expect(result.valid).toBe(false);
    });

    it('rejects "storage terminal"', () => {
      const result = validatePlaceLabel('storage terminal');
      expect(result.valid).toBe(false);
    });

    it('rejects "communications console"', () => {
      const result = validatePlaceLabel('communications console');
      expect(result.valid).toBe(false);
    });

    it('accepts "Galley Stores" (room with storage-like name)', () => {
      // This is a proper room name even though it contains "stores"
      // Note: "stores" is not in the object list because it commonly refers to a room
      const result = validatePlaceLabel('Galley Stores');
      expect(result.valid).toBe(true);
    });

    it('accepts "Medical Bay" (room with object-like modifier)', () => {
      const result = validatePlaceLabel('Medical Bay');
      expect(result.valid).toBe(true);
    });

    it('rejects "Second door past the lantern arch → Intake and Seals" (navigation syntax bug)', () => {
      const result = validatePlaceLabel('Second door past the lantern arch → Intake and Seals');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('navigation');
    });

    it('accepts "Lantern Hall Intake and Seals" (proper canonical name)', () => {
      const result = validatePlaceLabel('Lantern Hall Intake and Seals');
      expect(result.valid).toBe(true);
    });
  });

  describe('building types require proper noun prefixes', () => {
    it('rejects bare building types', () => {
      expect(isGenericLabel('dungeon')).toBe(true);
      expect(isGenericLabel('tower')).toBe(true);
      expect(isGenericLabel('gatehouse')).toBe(true);
      expect(isGenericLabel('castle')).toBe(true);
      expect(isGenericLabel('tavern')).toBe(true);
      expect(isGenericLabel('temple')).toBe(true);
      expect(isGenericLabel('prison')).toBe(true);
      expect(isGenericLabel('forge')).toBe(true);
    });

    it('rejects building types with generic modifiers', () => {
      expect(isGenericLabel('the dungeon')).toBe(true);
      expect(isGenericLabel('a tower')).toBe(true);
      expect(isGenericLabel('the gatehouse')).toBe(true);
      expect(isGenericLabel('old castle')).toBe(true);
      expect(isGenericLabel('main tavern')).toBe(true);
      expect(isGenericLabel('the temple')).toBe(true);
    });

    it('accepts building types with proper noun prefixes', () => {
      expect(isGenericLabel('Farsreach Castle Dungeon')).toBe(false);
      expect(isGenericLabel('The Ironhold Dungeon')).toBe(false);
      expect(isGenericLabel('The Crimson Tower')).toBe(false);
      expect(isGenericLabel('The Watchfire Tower')).toBe(false);
      expect(isGenericLabel('Saltfog Harbor Gatehouse')).toBe(false);
      expect(isGenericLabel('The Northern Gate')).toBe(false);
      expect(isGenericLabel('The Rusty Anchor')).toBe(false);
      expect(isGenericLabel("The Wanderer's Rest")).toBe(false);
      expect(isGenericLabel('Temple of the Silver Moon')).toBe(false);
      expect(isGenericLabel('Blackstone Prison')).toBe(false);
      expect(isGenericLabel("Holst's Forge")).toBe(false);
    });

    it('validatePlaceLabel returns detailed errors for building types', () => {
      const dungeonResult = validatePlaceLabel('dungeon');
      expect(dungeonResult.valid).toBe(false);
      expect(dungeonResult.reason).toContain('generic');

      const towerResult = validatePlaceLabel('tower');
      expect(towerResult.valid).toBe(false);

      // With proper noun prefix - should pass
      expect(validatePlaceLabel('The Ironhold Dungeon').valid).toBe(true);
      expect(validatePlaceLabel('The Crimson Tower').valid).toBe(true);
    });
  });

  describe('isSubLocation', () => {
    it('detects positional modifiers', () => {
      expect(isSubLocation('The Back Room')).toBe(true);
      expect(isSubLocation('Front Office')).toBe(true);
      expect(isSubLocation('Upper Floor')).toBe(true);
      expect(isSubLocation('Lower Deck')).toBe(true);
      expect(isSubLocation('Private Chamber')).toBe(true);
      expect(isSubLocation('Inner Sanctum')).toBe(true);
    });

    it('detects room/space types', () => {
      expect(isSubLocation('The Tavern Back Room')).toBe(true);
      expect(isSubLocation('Storage Cellar')).toBe(true);
      expect(isSubLocation("Captain's Quarters")).toBe(true);
      expect(isSubLocation('Kitchen Wing')).toBe(true);
      expect(isSubLocation('Library Annex')).toBe(true);
      expect(isSubLocation('Guard Hall')).toBe(true);
    });

    it('detects storage areas', () => {
      expect(isSubLocation('Storage Area')).toBe(true);
      expect(isSubLocation('The Cellar')).toBe(true);
      expect(isSubLocation('Basement Level')).toBe(true);
      expect(isSubLocation('Attic Space')).toBe(true);
      expect(isSubLocation('Treasure Vault')).toBe(true);
      expect(isSubLocation('Wine Storeroom')).toBe(true);
    });

    it('returns false for top-level locations', () => {
      expect(isSubLocation('The Rusty Mug')).toBe(false);
      expect(isSubLocation('Harbor District')).toBe(false);
      expect(isSubLocation('Market Square')).toBe(false);
      expect(isSubLocation("Holst's Forge")).toBe(false);
      expect(isSubLocation('Temple of the Silver Moon')).toBe(false);
      expect(isSubLocation('The Docks')).toBe(false);
    });

    it('correctly identifies "The Tavern Back Room" as sub-location', () => {
      // This is the specific case that was causing the bug
      expect(isSubLocation('The Tavern Back Room')).toBe(true);
      expect(isSubLocation('The Tavern')).toBe(false);
    });
  });

  describe('validateRegionLabel', () => {
    it('rejects generic region names without context', () => {
      const result = validateRegionLabel('Harbor District');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('too generic');
      // The code finds "harbor" first in the word list
      expect(result.genericType).toBe('harbor');
    });

    it('rejects single generic words', () => {
      expect(validateRegionLabel('The Docks').valid).toBe(false);
      expect(validateRegionLabel('Market Square').valid).toBe(false);
      expect(validateRegionLabel('Harbor').valid).toBe(false);
    });

    it('rejects generic regions with only non-distinctive modifiers', () => {
      expect(validateRegionLabel('Old Harbor').valid).toBe(false);
      expect(validateRegionLabel('Upper District').valid).toBe(false);
      expect(validateRegionLabel('The Central Market').valid).toBe(false);
      expect(validateRegionLabel('North Docks').valid).toBe(false);
    });

    it('accepts region names with proper noun context', () => {
      expect(validateRegionLabel('Saltfog Harbor Ward').valid).toBe(true);
      expect(validateRegionLabel('Oxenfurt Harbor District').valid).toBe(true);
      expect(validateRegionLabel('Novigrad Market Square').valid).toBe(true);
      expect(validateRegionLabel('Icehold Upper Wards').valid).toBe(true);
    });

    it('accepts regions without generic type words', () => {
      // Just a proper noun without generic type word is fine
      expect(validateRegionLabel('Farsreach').valid).toBe(true);
      expect(validateRegionLabel('Oxenfurt').valid).toBe(true);
      expect(validateRegionLabel('The Undercroft').valid).toBe(true);
    });

    it('still validates basic place label rules', () => {
      // Empty labels
      expect(validateRegionLabel('').valid).toBe(false);
      expect(validateRegionLabel('   ').valid).toBe(false);

      // Objects/containers (would fail basic validation)
      expect(validateRegionLabel('storage crate').valid).toBe(false);
    });
  });

  describe('isGenericRegionLabel', () => {
    it('returns true for generic region labels', () => {
      expect(isGenericRegionLabel('Harbor District')).toBe(true);
      expect(isGenericRegionLabel('The Docks')).toBe(true);
      expect(isGenericRegionLabel('Market Square')).toBe(true);
    });

    it('returns false for proper noun region labels', () => {
      expect(isGenericRegionLabel('Saltfog Harbor Ward')).toBe(false);
      expect(isGenericRegionLabel('Oxenfurt Docks')).toBe(false);
      expect(isGenericRegionLabel('Farsreach')).toBe(false);
    });
  });
});
