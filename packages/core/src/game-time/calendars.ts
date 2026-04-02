/**
 * Pre-defined calendar configurations for testing.
 * Production universes define their calendars in their index.json.
 */

import type { CalendarConfig } from '@dmnpc/types/world';

/**
 * Simple Earth-like calendar for testing or simple universes.
 * Standard 12-month Gregorian-style calendar (no leap years for simplicity).
 * Uses 24-hour days.
 */
export const SIMPLE_CALENDAR: CalendarConfig = {
  name: 'Standard Calendar',
  months: [
    { name: 'January', days: 31 },
    { name: 'February', days: 28 },
    { name: 'March', days: 31 },
    { name: 'April', days: 30 },
    { name: 'May', days: 31 },
    { name: 'June', days: 30 },
    { name: 'July', days: 31 },
    { name: 'August', days: 31 },
    { name: 'September', days: 30 },
    { name: 'October', days: 31 },
    { name: 'November', days: 30 },
    { name: 'December', days: 31 },
  ],
  time: {
    hoursPerDay: 24,
    minutesPerHour: 60,
  },
  eras: null,
  defaultEra: null,
  seasons: null,
  calendarType: null,
  format: {
    dateSeparator: '-',
    timeSeparator: ':',
    eraPosition: 'none',
    monthDisplay: 'number',
    yearFirst: true, // ISO format: YYYY-MM-DD
    use24Hour: true,
    yearOnlyTemplate: null,
    millenniumPrefix: null,
  },
};

/**
 * Test calendar matching the Muraiian calendar structure (10 months x 30 days with eras).
 * Uses 22-hour days as per Anslem lore.
 * Used for unit tests. The actual Muraiian calendar is defined in universes/definitions/farsreach/index.json.
 */
export const TEST_FANTASY_CALENDAR: CalendarConfig = {
  name: 'Test Fantasy Calendar',
  months: [
    { name: 'Frostmoot', days: 30 },
    { name: 'Runvakr', days: 30 },
    { name: 'Stormvakt', days: 30 },
    { name: 'Austursól', days: 30 },
    { name: 'Solbrand', days: 30 },
    { name: 'Midskald', days: 30 },
    { name: 'Haflund', days: 30 },
    { name: 'Álfsól', days: 30 },
    { name: 'Skjaldsfang', days: 30 },
    { name: 'Vetrmyrk', days: 30 },
  ],
  time: {
    hoursPerDay: 22,
    minutesPerHour: 60,
  },
  eras: [
    { id: 1, name: '1st Age', shortName: '1A', backwards: false, transitionEra: null },
    { id: 2, name: '2nd Age', shortName: '2A', backwards: false, transitionEra: null },
    { id: 3, name: '3rd Age', shortName: '3A', backwards: false, transitionEra: null },
    { id: 4, name: '4th Age', shortName: '4A', backwards: false, transitionEra: null },
    { id: 5, name: '5th Age', shortName: '5A', backwards: false, transitionEra: null },
  ],
  defaultEra: 4,
  seasons: [
    { name: 'Winter', monthStart: 10, monthEnd: 2 }, // Vetrmyrk, Frostmoot, Runvakr
    { name: 'Spring', monthStart: 3, monthEnd: 4 }, // Stormvakt, Austursól
    { name: 'Summer', monthStart: 5, monthEnd: 7 }, // Solbrand, Midskald, Haflund
    { name: 'Autumn', monthStart: 8, monthEnd: 9 }, // Álfsól, Skjaldsfang
  ],
  calendarType: null,
  format: {
    dateSeparator: '.',
    timeSeparator: ':',
    eraPosition: 'suffix',
    monthDisplay: 'number',
    yearFirst: false,
    use24Hour: true,
    yearOnlyTemplate: null,
    millenniumPrefix: null,
  },
};
