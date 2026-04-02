/**
 * Calendar configuration types for custom game calendars.
 * Used by universes to define their own date/time systems.
 */

export interface MonthDefinition {
  name: string;
  days: number;
}

export interface EraDefinition {
  id: number;
  name: string;
  shortName: string | null; // e.g., "4A" for "4th Age"
  /** If true, years count backwards (19 -> 18 -> ... -> 1 -> transition) */
  backwards: boolean;
  /** Era ID to transition to when year crosses 0 (for backwards eras like BBY -> ABY) */
  transitionEra: number | null;
}

export interface SeasonDefinition {
  name: string; // e.g., "Winter", "Spring", "Summer", "Autumn"
  monthStart: number; // First month of season (1-indexed)
  monthEnd: number; // Last month of season (1-indexed)
}

export interface TimeConfig {
  hoursPerDay: number; // e.g., 22 for Anslem, 24 for Earth
  minutesPerHour?: number; // Default: 60
}

export interface CalendarConfig {
  name: string; // e.g., "Muraiian Calendar"
  months: MonthDefinition[];
  time: TimeConfig | null; // If not specified, defaults to 24 hours/day, 60 min/hour
  eras: EraDefinition[] | null;
  defaultEra: number | null; // Era ID to use when not specified
  seasons: SeasonDefinition[] | null; // Season definitions for weather/narrative
  /** Calendar display type: standard (full date), year-only, or millennium notation */
  calendarType: 'standard' | 'year-only' | 'millennium' | null;
  format: {
    dateSeparator: string | null; // Default: "."
    timeSeparator: string | null; // Default: ":"
    eraPosition: 'suffix' | 'prefix' | 'none' | null; // Default: "suffix"
    monthDisplay: 'number' | 'name' | 'shortName' | null; // Default: "number"
    yearFirst: boolean; // Default: false (day.month.year)
    use24Hour: boolean; // Default: true
    /** Template for year-only calendars, e.g., "${era} ${year}" or "${year} ${era}" */
    yearOnlyTemplate: string | null;
    /** Prefix for millennium notation, e.g., "M" for "M41". Default: "M" */
    millenniumPrefix: string | null;
  } | null;
}

export interface GameDateTimeComponents {
  year: number;
  month: number; // 1-indexed
  day: number;
  hour: number | null; // 0 to hoursPerDay-1, default 0
  minute: number | null; // 0-59, default 0
  era: number | null;
}
