/**
 * Weather, climate, and environment types.
 */

// ============================================================================
// Weather Types
// ============================================================================

/**
 * Atmospheric weather conditions that affect gameplay, narrative, and ambient audio.
 * Updated on time advance (sleep, wait) with season-influenced probabilities.
 *
 * Non-atmospheric environments (space, underwater) have no weather — their
 * weather field is null. Environment behavior is driven by EnvironmentConfig.
 */
export type WeatherCondition = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog';

// ============================================================================
// Environment Types
// ============================================================================

/**
 * Temperature configuration for an environment.
 * Absorbs the old PlaceInfo.baseTemperature field.
 */
export interface EnvironmentTemperatureConfig {
  /** Whether temperature is meaningful in this environment. False for space/underwater. */
  enabled: boolean;
  /** Base temperature in °C. Replaces PlaceInfo.baseTemperature. Null = use universe climate default. */
  base: number | null;
  /** Whether season/weather/time-of-day modifiers apply. False for interior environments. */
  modifiersApply: boolean;
}

/**
 * Data-driven environment configuration.
 * Replaces the old PlaceEnvironment string enum ('interior' | 'exterior' | 'space' | 'underwater').
 *
 * Each place and layout template variant stores a full EnvironmentConfig object.
 * Use preset factories (ENVIRONMENT_PRESETS) for the standard environment types.
 * Use helpers (isEnclosed, hasAtmosphericWeather) instead of string comparisons.
 */
export interface EnvironmentConfig {
  /** Identifier for this environment type (e.g. 'interior', 'exterior', 'space', 'underwater'). */
  type: string;
  /** Whether atmospheric weather applies. False for space/underwater. */
  hasWeather: boolean;
  /** Temperature behavior for this environment. */
  temperature: EnvironmentTemperatureConfig;
  /** Maximum ambient darkness this environment can reach (0-1). Null = use time-of-day curve (outdoor default). */
  maxDarkness: number | null;
}

/**
 * Standard environment preset names.
 * Used for migration, LLM inference, and admin UI preset selection.
 */
export const ENVIRONMENT_PRESET_NAMES = ['interior', 'exterior', 'space', 'underwater'] as const;

/** Valid preset name for environment presets. */
export type EnvironmentPresetName = (typeof ENVIRONMENT_PRESET_NAMES)[number];

/** Factory functions for the 4 standard environment types. */
export const ENVIRONMENT_PRESETS: Record<EnvironmentPresetName, () => EnvironmentConfig> = {
  interior: () => ({
    type: 'interior',
    hasWeather: false,
    temperature: { enabled: true, base: 18, modifiersApply: false },
    maxDarkness: 0.5,
  }),
  exterior: () => ({
    type: 'exterior',
    hasWeather: true,
    temperature: { enabled: true, base: null, modifiersApply: true },
    maxDarkness: null,
  }),
  space: () => ({
    type: 'space',
    hasWeather: false,
    temperature: { enabled: false, base: null, modifiersApply: false },
    maxDarkness: 0.6,
  }),
  underwater: () => ({
    type: 'underwater',
    hasWeather: false,
    temperature: { enabled: false, base: null, modifiersApply: false },
    maxDarkness: 0.4,
  }),
};

// ============================================================================
// Environment Helpers
// ============================================================================

/** Whether the environment is an interior (enclosed) space. Derived from type. */
export function isEnclosed(env: EnvironmentConfig): boolean {
  return env.type === 'interior';
}

/** Whether the environment has atmospheric weather (replaces !== 'space' && !== 'underwater'). */
export function hasAtmosphericWeather(env: EnvironmentConfig): boolean {
  return env.hasWeather;
}

/** Human-readable label for an environment type (for admin UI display). */
export function getEnvironmentLabel(env: EnvironmentConfig): string {
  switch (env.type) {
    case 'interior':
      return 'Interior';
    case 'exterior':
      return 'Exterior';
    case 'space':
      return 'Space';
    case 'underwater':
      return 'Underwater';
    default:
      return env.type;
  }
}

/**
 * Resolve an EnvironmentConfig from a preset name.
 * Used when LLM returns a preset name string.
 * Throws if the name is not a valid preset.
 */
export function isEnvironmentPresetName(name: string): name is EnvironmentPresetName {
  return (ENVIRONMENT_PRESET_NAMES as readonly string[]).includes(name);
}

export function environmentFromPreset(name: string): EnvironmentConfig {
  if (!isEnvironmentPresetName(name)) {
    throw new Error(
      `Unknown environment preset: ${name}. Valid presets: ${ENVIRONMENT_PRESET_NAMES.join(', ')}`,
    );
  }
  return ENVIRONMENT_PRESETS[name]();
}

// ============================================================================
// Temperature Types
// ============================================================================

/**
 * Temperature bands for display and narrative.
 * Derived from numeric temperature values.
 */
export type TemperatureBand = 'freezing' | 'cold' | 'cool' | 'mild' | 'warm' | 'hot';

/**
 * Climate configuration for a universe.
 * Provides the default temperature baseline for all places in the universe.
 * Used as fallback when EnvironmentConfig.temperature.base is null.
 */
export interface ClimateConfig {
  /** Default baseline temperature for the universe (e.g., -20 for Icehold, 12 for Farsreach) */
  baseTemperature: number;
}
