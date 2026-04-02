/**
 * @dmnpc/types - Shared type definitions for the DMNPC monorepo
 *
 * This package contains all shared TypeScript types used across the codebase.
 * Types are organized into logical modules and re-exported from this index.
 */

// Foundation types (no dependencies on other type modules)
export * from './world/calendar.js';
export * from './entity/core.js';
export * from './world/weather.js';
export * from './ui/music.js';
export * from './ui/voice.js';

// Event types (depends on core)
export * from './entity/events.js';

// NPC types (depends on core)
export * from './npc/npc.js';

// Plot types (depends on storyteller for StorytellerEvent)
export * from './npc/plot.js';

// Storyteller types (depends on plot, voice)
export * from './npc/storyteller.js';

// Travel types (depends on entities, plot)
export * from './world/travel.js';

// Interaction context types (standalone)
export * from './game/interaction-context.js';

// Entity types (depends on calendar, core, events, music, npc, storyteller, travel, voice, weather, interaction-context)
export * from './entity/entities.js';

// Object types (depends on nothing - standalone catalog types)
export * from './world/object-types.js';

// Place layout types (depends on nothing - standalone layout types)
export * from './world/place-layout.js';

// Autotile types (depends on nothing - standalone config types)
export * from './world/autotile.js';

// Action types (depends on entities, ruleset)
export * from './game/action.js';

// Action registry types (standalone — no dependencies)
export * from './combat/action-registry.js';

// Weapon types (standalone — no dependencies)
export * from './combat/weapon.js';

// Item types (standalone — no dependencies)
export * from './game/item.js';

// Battle types (depends on ruleset, weapon)
export * from './combat/battle.js';

// Ruleset types (depends on entities, action)
export * from './combat/ruleset.js';

// Chat types (depends on action)
export * from './game/chat.js';

// Scenario types (depends on entities, events, npc, plot, storyteller)
export * from './npc/scenario.js';

// Template types (depends on events, voice, entities)
export * from './npc/templates.js';

// WorldBible types (depends on weather, entity-registry)
export * from './world/worldbible.js';

// Terrain layer types (layer configs, noise params, environment presets)
export * from './world/terrain-layers.js';

// Place template types (depends on terrain-layers for TerrainLayerConfig)
export * from './world/place-templates.js';

// Movement types (depends on terrain-layers for TerrainTag)
export * from './world/movement.js';

// Entity registry types (depends on place-templates)
export * from './world/entity-registry.js';

// API types (standalone)
export * from './api.js';

// Validation types (depends on voice)
export * from './entity/validation.js';

// Sound effect registry types (standalone)
export * from './ui/audio.js';

// Sprite constants (pure data, safe for browser)
export * from './ui/sprites.js';

// Arbiter types (shared between game engine and agent tools)
export * from './game/arbiter.js';
