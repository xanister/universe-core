import { describe, it, expect } from 'vitest';
import { TEST_FANTASY_CALENDAR, SIMPLE_CALENDAR } from '@dmnpc/core/game-time/calendars.js';
import {
  GameDate,
  getTotalDaysInYear,
  getHoursPerDay,
  getMinutesPerHour,
  getMonthByName,
  validateCalendarConfig,
} from '@dmnpc/core/game-time/game-date.js';
import type { CalendarConfig } from '@dmnpc/types/world';

describe('GameDate', () => {
  describe('construction and validation', () => {
    it('creates a valid date-time with fantasy calendar', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 14,
        minute: 30,
        era: 4,
      });

      expect(date.year).toBe(1472);
      expect(date.month).toBe(3);
      expect(date.day).toBe(15);
      expect(date.hour).toBe(14);
      expect(date.minute).toBe(30);
      expect(date.era).toBe(4);
    });

    it('defaults hour and minute to 0 when null', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: null,
        minute: null,
        era: null,
      });

      expect(date.hour).toBe(0);
      expect(date.minute).toBe(0);
    });

    it('uses default era when null', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: null,
        minute: null,
        era: null,
      });

      expect(date.era).toBe(4); // TEST_FANTASY_CALENDAR defaultEra is 4
    });

    it('throws on invalid month', () => {
      expect(
        () =>
          new GameDate(TEST_FANTASY_CALENDAR, {
            year: 1472,
            month: 0,
            day: 15,
            hour: null,
            minute: null,
            era: null,
          })
      ).toThrow('Invalid month 0');

      expect(
        () =>
          new GameDate(TEST_FANTASY_CALENDAR, {
            year: 1472,
            month: 11,
            day: 15,
            hour: null,
            minute: null,
            era: null,
          })
      ).toThrow('Invalid month 11');
    });

    it('throws on invalid day', () => {
      expect(
        () =>
          new GameDate(TEST_FANTASY_CALENDAR, {
            year: 1472,
            month: 1,
            day: 0,
            hour: null,
            minute: null,
            era: null,
          })
      ).toThrow('Invalid day 0');

      expect(
        () =>
          new GameDate(TEST_FANTASY_CALENDAR, {
            year: 1472,
            month: 1,
            day: 31,
            hour: null,
            minute: null,
            era: null,
          })
      ).toThrow('Invalid day 31');
    });

    it('throws on invalid hour (22-hour day)', () => {
      expect(
        () =>
          new GameDate(TEST_FANTASY_CALENDAR, {
            year: 1472,
            month: 1,
            day: 1,
            hour: 22, // Invalid: 22-hour day means 0-21
            minute: null,
            era: null,
          })
      ).toThrow('Invalid hour 22');

      expect(
        () =>
          new GameDate(TEST_FANTASY_CALENDAR, {
            year: 1472,
            month: 1,
            day: 1,
            hour: -1,
            minute: null,
            era: null,
          })
      ).toThrow('Invalid hour -1');
    });

    it('throws on invalid minute', () => {
      expect(
        () =>
          new GameDate(TEST_FANTASY_CALENDAR, {
            year: 1472,
            month: 1,
            day: 1,
            hour: null,
            minute: 60,
            era: null,
          })
      ).toThrow('Invalid minute 60');
    });

    it('throws on invalid era', () => {
      expect(
        () =>
          new GameDate(TEST_FANTASY_CALENDAR, {
            year: 1472,
            month: 1,
            day: 1,
            hour: null,
            minute: null,
            era: 99,
          })
      ).toThrow('Invalid era 99');
    });
  });

  describe('accessors', () => {
    it('returns correct month name', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: null,
        minute: null,
        era: null,
      });

      expect(date.monthName).toBe('Stormvakt');
    });

    it('returns correct days in month', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 1,
        hour: null,
        minute: null,
        era: null,
      });

      expect(date.daysInMonth).toBe(30);
    });

    it('returns correct days per year', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 1,
        hour: null,
        minute: null,
        era: null,
      });

      expect(date.daysPerYear).toBe(300);
    });

    it('returns correct hours per day', () => {
      const fantasyDate = new GameDate(TEST_FANTASY_CALENDAR, { year: 1472, month: 1, day: 1, hour: null, minute: null, era: null });
      expect(fantasyDate.hoursPerDay).toBe(22);

      const simpleDate = new GameDate(SIMPLE_CALENDAR, { year: 2024, month: 1, day: 1, hour: null, minute: null, era: null });
      expect(simpleDate.hoursPerDay).toBe(24);
    });

    it('returns correct era name', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 1,
        hour: null,
        minute: null,
        era: 4,
      });

      expect(date.eraName).toBe('4th Age');
      expect(date.eraShortName).toBe('4A');
    });

    it('returns correct day of year', () => {
      // First day of year
      const jan1 = new GameDate(TEST_FANTASY_CALENDAR, { year: 1472, month: 1, day: 1, hour: null, minute: null, era: null });
      expect(jan1.dayOfYear).toBe(1);

      // Last day of first month
      const jan30 = new GameDate(TEST_FANTASY_CALENDAR, { year: 1472, month: 1, day: 30, hour: null, minute: null, era: null });
      expect(jan30.dayOfYear).toBe(30);

      // First day of second month
      const feb1 = new GameDate(TEST_FANTASY_CALENDAR, { year: 1472, month: 2, day: 1, hour: null, minute: null, era: null });
      expect(feb1.dayOfYear).toBe(31);

      // Last day of year
      const dec30 = new GameDate(TEST_FANTASY_CALENDAR, { year: 1472, month: 10, day: 30, hour: null, minute: null, era: null });
      expect(dec30.dayOfYear).toBe(300);
    });

    it('returns correct time of day', () => {
      // Night (early)
      const night = new GameDate(TEST_FANTASY_CALENDAR, { year: 1472, month: 1, day: 1, hour: 2, minute: null, era: null });
      expect(night.timeOfDay).toBe('night');

      // Dawn (~20-27% of day, so ~4-6 in 22-hour day)
      const dawn = new GameDate(TEST_FANTASY_CALENDAR, { year: 1472, month: 1, day: 1, hour: 5, minute: null, era: null });
      expect(dawn.timeOfDay).toBe('dawn');

      // Morning (~27-42%, so ~6-9)
      const morning = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 1,
        hour: 7,
        minute: null,
        era: null,
      });
      expect(morning.timeOfDay).toBe('morning');

      // Midday (~42-52%, so ~9-11)
      const midday = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 1,
        hour: 10,
        minute: null,
        era: null,
      });
      expect(midday.timeOfDay).toBe('midday');

      // Afternoon (~52-70%, so ~11-15)
      const afternoon = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 1,
        hour: 13,
        minute: null,
        era: null,
      });
      expect(afternoon.timeOfDay).toBe('afternoon');

      // Evening (~70-80%, so ~15-18)
      const evening = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 1,
        hour: 16,
        minute: null,
        era: null,
      });
      expect(evening.timeOfDay).toBe('evening');

      // Night (late)
      const lateNight = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 1,
        hour: 20,
        minute: null,
        era: null,
      });
      expect(lateNight.timeOfDay).toBe('night');
    });

    it('returns dayFraction as continuous 0-1 value including minutes', () => {
      // Midnight: hour=0, minute=0 → 0.0
      const midnight = new GameDate(SIMPLE_CALENDAR, { year: 1, month: 1, day: 1, hour: 0, minute: 0, era: null });
      expect(midnight.dayFraction).toBeCloseTo(0.0, 5);

      // Noon: hour=12, minute=0 → 0.5 (for 24-hour day)
      const noon = new GameDate(SIMPLE_CALENDAR, { year: 1, month: 1, day: 1, hour: 12, minute: 0, era: null });
      expect(noon.dayFraction).toBeCloseTo(0.5, 5);

      // 6 AM: hour=6, minute=0 → 0.25
      const sixAm = new GameDate(SIMPLE_CALENDAR, { year: 1, month: 1, day: 1, hour: 6, minute: 0, era: null });
      expect(sixAm.dayFraction).toBeCloseTo(0.25, 5);

      // 6:30 AM: includes minutes → (6 + 30/60) / 24 = 6.5/24 ≈ 0.2708
      const sixThirty = new GameDate(SIMPLE_CALENDAR, { year: 1, month: 1, day: 1, hour: 6, minute: 30, era: null });
      expect(sixThirty.dayFraction).toBeCloseTo(6.5 / 24, 4);

      // Fantasy calendar (22 hours/day): hour=11 → 0.5
      const fantasyNoon = new GameDate(TEST_FANTASY_CALENDAR, { year: 1472, month: 1, day: 1, hour: 11, minute: 0, era: null });
      expect(fantasyNoon.dayFraction).toBeCloseTo(11 / 22, 4);

      // End of day: hour=23, minute=59 → close to 1.0
      const endOfDay = new GameDate(SIMPLE_CALENDAR, { year: 1, month: 1, day: 1, hour: 23, minute: 59, era: null });
      expect(endOfDay.dayFraction).toBeCloseTo(23.9833 / 24, 3);
    });
  });

  describe('addMinutes', () => {
    it('adds minutes within the same hour', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 15,
        hour: 10,
        minute: 20,
        era: null,
      });

      const result = date.addMinutes(15);

      expect(result.minute).toBe(35);
      expect(result.hour).toBe(10);
    });

    it('adds minutes crossing hour boundary', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 15,
        hour: 10,
        minute: 45,
        era: null,
      });

      const result = date.addMinutes(30);

      expect(result.minute).toBe(15);
      expect(result.hour).toBe(11);
    });

    it('adds minutes crossing day boundary (22-hour day)', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 15,
        hour: 21, // Last hour of 22-hour day
        minute: 30,
        era: null,
      });

      const result = date.addMinutes(60);

      expect(result.day).toBe(16);
      expect(result.hour).toBe(0);
      expect(result.minute).toBe(30);
    });
  });

  describe('addHours', () => {
    it('adds hours within the same day', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 15,
        hour: 10,
        minute: null,
        era: null,
      });

      const result = date.addHours(5);

      expect(result.hour).toBe(15);
      expect(result.day).toBe(15);
    });

    it('adds hours crossing day boundary (22-hour day)', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 15,
        hour: 20,
        minute: null,
        era: null,
      });

      const result = date.addHours(5);

      expect(result.day).toBe(16);
      expect(result.hour).toBe(3); // 20 + 5 = 25, 25 - 22 = 3
    });

    it('adds hours crossing month boundary', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 30,
        hour: 20,
        minute: null,
        era: null,
      });

      const result = date.addHours(10);

      expect(result.day).toBe(1);
      expect(result.month).toBe(2);
      expect(result.hour).toBe(8); // 20 + 10 = 30, 30 - 22 = 8
    });
  });

  describe('addDays', () => {
    it('adds days preserving time', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 15,
        hour: 14,
        minute: 30,
        era: null,
      });

      const result = date.addDays(5);

      expect(result.day).toBe(20);
      expect(result.hour).toBe(14);
      expect(result.minute).toBe(30);
    });

    it('adds fractional days', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 15,
        hour: 0,
        minute: 0,
        era: null,
      });

      const result = date.addDays(0.5);

      expect(result.day).toBe(15);
      expect(result.hour).toBe(11); // Half of 22 hours
      expect(result.minute).toBe(0);
    });

    it('adds days crossing month boundary', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 28,
        hour: 10,
        minute: null,
        era: null,
      });

      const result = date.addDays(5);

      expect(result.day).toBe(3);
      expect(result.month).toBe(2);
      expect(result.hour).toBe(10);
    });

    it('adds days crossing year boundary', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 10,
        day: 28,
        hour: 10,
        minute: null,
        era: null,
      });

      const result = date.addDays(5);

      expect(result.day).toBe(3);
      expect(result.month).toBe(1);
      expect(result.year).toBe(1473);
    });

    it('adds zero days returns same date', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 15,
        hour: 10,
        minute: null,
        era: null,
      });

      const result = date.addDays(0);

      expect(result).toBe(date); // Same instance
    });

    it('preserves era when adding days', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 15,
        hour: null,
        minute: null,
        era: 4,
      });

      const result = date.addDays(500);

      expect(result.era).toBe(4);
    });
  });

  describe('subtractHours/subtractDays', () => {
    it('subtracts hours crossing day boundary', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 2,
        day: 5,
        hour: 3,
        minute: null,
        era: null,
      });

      const result = date.subtractHours(5);

      expect(result.day).toBe(4);
      expect(result.hour).toBe(20); // 3 - 5 = -2 + 22 = 20
    });

    it('subtracts days crossing year boundary', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 5,
        hour: 10,
        minute: null,
        era: null,
      });

      const result = date.subtractDays(10);

      expect(result.day).toBe(25);
      expect(result.month).toBe(10);
      expect(result.year).toBe(1471);
    });
  });

  describe('addMonths', () => {
    it('adds months preserving time', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 14,
        minute: 30,
        era: null,
      });

      const result = date.addMonths(2);

      expect(result.month).toBe(5);
      expect(result.hour).toBe(14);
      expect(result.minute).toBe(30);
    });
  });

  describe('addYears', () => {
    it('adds years preserving time', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 14,
        minute: 30,
        era: 4,
      });

      const result = date.addYears(10);

      expect(result.year).toBe(1482);
      expect(result.hour).toBe(14);
      expect(result.minute).toBe(30);
    });
  });

  describe('withTime', () => {
    it('changes time preserving date', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 10,
        minute: 30,
        era: 4,
      });

      const result = date.withTime(18, 45);

      expect(result.hour).toBe(18);
      expect(result.minute).toBe(45);
      expect(result.day).toBe(15);
      expect(result.month).toBe(3);
      expect(result.year).toBe(1472);
    });
  });

  describe('comparison', () => {
    it('equals returns true for same date-time', () => {
      const date1 = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 14,
        minute: 30,
        era: 4,
      });
      const date2 = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 14,
        minute: 30,
        era: 4,
      });

      expect(date1.equals(date2)).toBe(true);
    });

    it('equals returns false for different times', () => {
      const date1 = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 14,
        minute: 30,
        era: null,
      });
      const date2 = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 14,
        minute: 31,
        era: null,
      });

      expect(date1.equals(date2)).toBe(false);
    });

    it('equalsDate ignores time', () => {
      const date1 = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 10,
        minute: 0,
        era: null,
      });
      const date2 = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 20,
        minute: 45,
        era: null,
      });

      expect(date1.equalsDate(date2)).toBe(true);
    });

    it('isBefore considers time', () => {
      const earlier = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 10,
        minute: null,
        era: null,
      });
      const later = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 11,
        minute: null,
        era: null,
      });

      expect(earlier.isBefore(later)).toBe(true);
      expect(later.isBefore(earlier)).toBe(false);
    });

    it('compares across eras', () => {
      const era3 = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1500,
        month: 1,
        day: 1,
        hour: null,
        minute: null,
        era: 3,
      });
      const era4 = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 100,
        month: 1,
        day: 1,
        hour: null,
        minute: null,
        era: 4,
      });

      expect(era3.isBefore(era4)).toBe(true);
      expect(era4.isAfter(era3)).toBe(true);
    });

    it('diffHours calculates correctly', () => {
      const date1 = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 1,
        hour: 10,
        minute: null,
        era: null,
      });
      const date2 = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 1,
        hour: 15,
        minute: null,
        era: null,
      });

      expect(date2.diffHours(date1)).toBe(5);
      expect(date1.diffHours(date2)).toBe(-5);
    });

    it('diffDays works with time precision', () => {
      const date1 = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 1,
        hour: 0,
        minute: null,
        era: null,
      });
      const date2 = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 1,
        day: 2,
        hour: 11, // Half day later
        minute: null,
        era: null,
      });

      expect(date2.diffDays(date1)).toBe(1.5);
    });
  });

  describe('formatting', () => {
    it('formats full date-time with default options', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 14,
        minute: 30,
        era: 4,
      });

      expect(date.format()).toBe('15.03.1472 4A 14:30');
    });

    it('formats date only', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 14,
        minute: 30,
        era: 4,
      });

      expect(date.formatDate()).toBe('15.03.1472 4A');
    });

    it('formats time only', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 14,
        minute: 30,
        era: null,
      });

      expect(date.formatTime()).toBe('14:30');
    });

    it('formats without time when includeTime is false', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 14,
        minute: 30,
        era: 4,
      });

      expect(date.format({ includeTime: false })).toBe('15.03.1472 4A');
    });

    it('formatLong includes time', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 14,
        minute: 30,
        era: 4,
      });

      expect(date.formatLong()).toBe('15 Stormvakt 1472 4A, 14:30');
    });

    it('formatFull includes time', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 14,
        minute: 30,
        era: 4,
      });

      expect(date.formatFull()).toBe('15 Stormvakt, Year 1472 of the 4th Age at 14:30');
    });

    it('formatNatural formats with month name and 12-hour time (PM)', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 14,
        minute: 30,
        era: 4,
      });

      expect(date.formatNatural()).toBe('15 Stormvakt · 2:30 PM');
    });

    it('formatNatural formats with 12-hour time (AM)', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 9,
        minute: 15,
        era: 4,
      });

      expect(date.formatNatural()).toBe('15 Stormvakt · 9:15 AM');
    });

    it('formatNatural handles midnight (12:00 AM)', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 0,
        minute: 0,
        era: 4,
      });

      expect(date.formatNatural()).toBe('15 Stormvakt · 12:00 AM');
    });

    it('formatNatural handles noon (12:00 PM)', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 12,
        minute: 0,
        era: 4,
      });

      expect(date.formatNatural()).toBe('15 Stormvakt · 12:00 PM');
    });

    it('toString returns formatted date-time', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 14,
        minute: 30,
        era: 4,
      });

      expect(date.toString()).toBe('15.03.1472 4A 14:30');
    });

    it('formats with SIMPLE_CALENDAR', () => {
      const date = new GameDate(SIMPLE_CALENDAR, {
        year: 2024,
        month: 3,
        day: 15,
        hour: 10,
        minute: 30,
        era: null,
      });

      expect(date.format()).toBe('2024-03-15 10:30');
    });
  });

  describe('toJSON', () => {
    it('returns date-time components', () => {
      const date = new GameDate(TEST_FANTASY_CALENDAR, {
        year: 1472,
        month: 3,
        day: 15,
        hour: 14,
        minute: 30,
        era: 4,
      });

      expect(date.toJSON()).toEqual({
        year: 1472,
        month: 3,
        day: 15,
        hour: 14,
        minute: 30,
        era: 4,
      });
    });
  });

  describe('parse', () => {
    it('parses date-time with era', () => {
      const date = GameDate.parse(TEST_FANTASY_CALENDAR, '15.03.1472 4A 14:30');

      expect(date.day).toBe(15);
      expect(date.month).toBe(3);
      expect(date.year).toBe(1472);
      expect(date.hour).toBe(14);
      expect(date.minute).toBe(30);
      expect(date.era).toBe(4);
    });

    it('parses date without time (defaults to 00:00)', () => {
      const date = GameDate.parse(TEST_FANTASY_CALENDAR, '15.03.1472 4A');

      expect(date.day).toBe(15);
      expect(date.month).toBe(3);
      expect(date.year).toBe(1472);
      expect(date.hour).toBe(0);
      expect(date.minute).toBe(0);
      expect(date.era).toBe(4);
    });

    it('parses with era prefix', () => {
      const date = GameDate.parse(TEST_FANTASY_CALENDAR, '3A 15.03.1472 14:30');

      expect(date.day).toBe(15);
      expect(date.era).toBe(3);
      expect(date.hour).toBe(14);
      expect(date.minute).toBe(30);
    });

    it('parses ISO-style format with SIMPLE_CALENDAR', () => {
      const date = GameDate.parse(SIMPLE_CALENDAR, '2024-03-15 10:30');

      expect(date.year).toBe(2024);
      expect(date.month).toBe(3);
      expect(date.day).toBe(15);
      expect(date.hour).toBe(10);
      expect(date.minute).toBe(30);
    });

    it('throws on invalid format', () => {
      expect(() => GameDate.parse(TEST_FANTASY_CALENDAR, 'invalid')).toThrow('Invalid date format');
    });
  });

  describe('static factory methods', () => {
    it('startOfYear creates first moment of year', () => {
      const date = GameDate.startOfYear(TEST_FANTASY_CALENDAR, 1472, 4);

      expect(date.year).toBe(1472);
      expect(date.month).toBe(1);
      expect(date.day).toBe(1);
      expect(date.hour).toBe(0);
      expect(date.minute).toBe(0);
      expect(date.era).toBe(4);
    });

    it('endOfYear creates last moment of year', () => {
      const date = GameDate.endOfYear(TEST_FANTASY_CALENDAR, 1472, 4);

      expect(date.year).toBe(1472);
      expect(date.month).toBe(10);
      expect(date.day).toBe(30);
      expect(date.hour).toBe(21); // 22-hour day, last hour is 21
      expect(date.minute).toBe(59);
    });

    it('startOfDay creates first moment of day', () => {
      const date = GameDate.startOfDay(TEST_FANTASY_CALENDAR, 1472, 5, 15, 4);

      expect(date.day).toBe(15);
      expect(date.month).toBe(5);
      expect(date.hour).toBe(0);
      expect(date.minute).toBe(0);
    });

    it('endOfDay creates last moment of day', () => {
      const date = GameDate.endOfDay(TEST_FANTASY_CALENDAR, 1472, 5, 15, 4);

      expect(date.day).toBe(15);
      expect(date.month).toBe(5);
      expect(date.hour).toBe(21);
      expect(date.minute).toBe(59);
    });
  });
});

describe('Calendar utilities', () => {
  describe('getTotalDaysInYear', () => {
    it('returns 300 for fantasy calendar', () => {
      expect(getTotalDaysInYear(TEST_FANTASY_CALENDAR)).toBe(300);
    });

    it('returns 365 for simple calendar', () => {
      expect(getTotalDaysInYear(SIMPLE_CALENDAR)).toBe(365);
    });
  });

  describe('getHoursPerDay', () => {
    it('returns 22 for fantasy calendar', () => {
      expect(getHoursPerDay(TEST_FANTASY_CALENDAR)).toBe(22);
    });

    it('returns 24 for simple calendar', () => {
      expect(getHoursPerDay(SIMPLE_CALENDAR)).toBe(24);
    });
  });

  describe('getMinutesPerHour', () => {
    it('returns 60 for both calendars', () => {
      expect(getMinutesPerHour(TEST_FANTASY_CALENDAR)).toBe(60);
      expect(getMinutesPerHour(SIMPLE_CALENDAR)).toBe(60);
    });
  });

  describe('getMonthByName', () => {
    it('finds month by name', () => {
      expect(getMonthByName(TEST_FANTASY_CALENDAR, 'Stormvakt')).toBe(3);
      expect(getMonthByName(TEST_FANTASY_CALENDAR, 'stormvakt')).toBe(3); // Case insensitive
    });

    it('returns undefined for unknown month', () => {
      expect(getMonthByName(TEST_FANTASY_CALENDAR, 'NotAMonth')).toBeUndefined();
    });
  });

  describe('validateCalendarConfig', () => {
    it('returns no errors for valid config', () => {
      expect(validateCalendarConfig(TEST_FANTASY_CALENDAR)).toEqual([]);
    });

    it('returns errors for missing name', () => {
      const config: CalendarConfig = {
        name: '',
        months: [{ name: 'Month', days: 30 }],
      };
      const errors = validateCalendarConfig(config);
      expect(errors).toContain('Calendar must have a name');
    });

    it('returns errors for empty months', () => {
      const config: CalendarConfig = {
        name: 'Test',
        months: [],
      };
      const errors = validateCalendarConfig(config);
      expect(errors).toContain('Calendar must have at least one month');
    });

    it('returns errors for invalid month days', () => {
      const config: CalendarConfig = {
        name: 'Test',
        months: [{ name: 'BadMonth', days: 0 }],
      };
      const errors = validateCalendarConfig(config);
      expect(errors).toContain('Month 1 (BadMonth) must have at least 1 day');
    });

    it('returns errors for invalid time config', () => {
      const config: CalendarConfig = {
        name: 'Test',
        months: [{ name: 'Month', days: 30 }],
        time: { hoursPerDay: 0 },
      };
      const errors = validateCalendarConfig(config);
      expect(errors).toContain('hoursPerDay must be a positive number');
    });

    it('returns errors for duplicate era IDs', () => {
      const config: CalendarConfig = {
        name: 'Test',
        months: [{ name: 'Month', days: 30 }],
        eras: [
          { id: 1, name: 'Era 1' },
          { id: 1, name: 'Era 2' },
        ],
      };
      const errors = validateCalendarConfig(config);
      expect(errors).toContain('Duplicate era ID: 1');
    });

    it('returns errors for invalid default era', () => {
      const config: CalendarConfig = {
        name: 'Test',
        months: [{ name: 'Month', days: 30 }],
        eras: [{ id: 1, name: 'Era 1' }],
        defaultEra: 99,
      };
      const errors = validateCalendarConfig(config);
      expect(errors).toContain('Default era 99 not found in eras list');
    });
  });
});

// ============================================================================
// Year-Only Calendar Tests
// ============================================================================

describe('Year-Only Calendars', () => {
  const STAR_WARS_CALENDAR: CalendarConfig = {
    name: 'Galactic Standard Calendar',
    calendarType: 'year-only',
    months: [{ name: 'Year', days: 368 }],
    time: { hoursPerDay: 24, minutesPerHour: 60 },
    eras: [
      {
        id: 1,
        name: 'Before Battle of Yavin',
        shortName: 'BBY',
        backwards: true,
        transitionEra: 2,
      },
      { id: 2, name: 'After Battle of Yavin', shortName: 'ABY' },
    ],
    defaultEra: 1,
    format: {
      dateSeparator: '.',
      timeSeparator: ':',
      eraPosition: 'suffix',
      yearOnlyTemplate: '${year} ${era}',
    },
  };

  const MIDDLE_EARTH_CALENDAR: CalendarConfig = {
    name: 'Shire Reckoning',
    calendarType: 'year-only',
    months: [{ name: 'Year', days: 365 }],
    time: { hoursPerDay: 24, minutesPerHour: 60 },
    eras: [
      { id: 1, name: 'First Age', shortName: 'F.A.' },
      { id: 2, name: 'Second Age', shortName: 'S.A.' },
      { id: 3, name: 'Third Age', shortName: 'T.A.' },
      { id: 4, name: 'Fourth Age', shortName: 'Fo.A.' },
    ],
    defaultEra: 3,
    format: {
      dateSeparator: '.',
      timeSeparator: ':',
      eraPosition: 'prefix',
      yearOnlyTemplate: '${era} ${year}',
    },
  };

  describe('formatYearOnly', () => {
    it('formats Star Wars BBY dates', () => {
      const date = new GameDate(STAR_WARS_CALENDAR, {
        year: 19,
        month: 1,
        day: 1,
        hour: 14,
        minute: 30,
        era: 1,
      });

      expect(date.formatYearOnly()).toBe('19 BBY');
    });

    it('formats Middle-earth T.A. dates with prefix era', () => {
      const date = new GameDate(MIDDLE_EARTH_CALENDAR, {
        year: 2940,
        month: 1,
        day: 1,
        hour: 10,
        minute: 0,
        era: 3,
      });

      expect(date.formatYearOnly()).toBe('T.A. 2940');
    });
  });

  describe('format() with year-only calendar', () => {
    it('formats full date-time with year-only style', () => {
      const date = new GameDate(STAR_WARS_CALENDAR, {
        year: 19,
        month: 1,
        day: 1,
        hour: 14,
        minute: 30,
        era: 1,
      });

      expect(date.format()).toBe('19 BBY 14:30');
    });

    it('formats without time when requested', () => {
      const date = new GameDate(STAR_WARS_CALENDAR, {
        year: 19,
        month: 1,
        day: 1,
        hour: 14,
        minute: 30,
        era: 1,
      });

      expect(date.format({ includeTime: false })).toBe('19 BBY');
    });
  });

  describe('formatNatural with year-only calendar', () => {
    it('formats natural display for Star Wars dates', () => {
      const date = new GameDate(STAR_WARS_CALENDAR, {
        year: 19,
        month: 1,
        day: 1,
        hour: 14,
        minute: 30,
        era: 1,
      });

      expect(date.formatNatural()).toBe('19 BBY · 2:30 PM');
    });

    it('formats natural display for Middle-earth dates', () => {
      const date = new GameDate(MIDDLE_EARTH_CALENDAR, {
        year: 2940,
        month: 1,
        day: 1,
        hour: 10,
        minute: 0,
        era: 3,
      });

      expect(date.formatNatural()).toBe('T.A. 2940 · 10:00 AM');
    });
  });

  describe('formatLong with year-only calendar', () => {
    it('formats long date for year-only calendar', () => {
      const date = new GameDate(STAR_WARS_CALENDAR, {
        year: 19,
        month: 1,
        day: 1,
        hour: 14,
        minute: 30,
        era: 1,
      });

      expect(date.formatLong()).toBe('19 BBY, 14:30');
    });
  });

  describe('parse year-only format', () => {
    it('parses "19 BBY 14:30"', () => {
      const date = GameDate.parse(STAR_WARS_CALENDAR, '19 BBY 14:30');

      expect(date.year).toBe(19);
      expect(date.month).toBe(1);
      expect(date.day).toBe(1);
      expect(date.hour).toBe(14);
      expect(date.minute).toBe(30);
      expect(date.era).toBe(1);
    });

    it('parses "T.A. 2940 10:00"', () => {
      const date = GameDate.parse(MIDDLE_EARTH_CALENDAR, 'T.A. 2940 10:00');

      expect(date.year).toBe(2940);
      expect(date.month).toBe(1);
      expect(date.day).toBe(1);
      expect(date.hour).toBe(10);
      expect(date.minute).toBe(0);
      expect(date.era).toBe(3);
    });

    it('parses year-only without time', () => {
      const date = GameDate.parse(STAR_WARS_CALENDAR, '19 BBY');

      expect(date.year).toBe(19);
      expect(date.hour).toBe(0);
      expect(date.minute).toBe(0);
    });

    it('parses concatenated era+year format like "FY38"', () => {
      const HITCHHIKER_CALENDAR: CalendarConfig = {
        name: 'Galactic Standard Calendar',
        calendarType: 'year-only',
        months: [{ name: 'Fiscal Year', days: 364 }],
        time: { hoursPerDay: 24, minutesPerHour: 60 },
        eras: [
          {
            id: 1,
            name: 'Pre-Standardization',
            shortName: 'PSDR',
            backwards: true,
            transitionEra: 2,
          },
          { id: 2, name: 'Galactic Standard Fiscal Year', shortName: 'FY' },
        ],
        defaultEra: 2,
        format: {
          dateSeparator: '.',
          timeSeparator: ':',
          eraPosition: 'suffix',
          yearOnlyTemplate: 'GSW ${era}${year}',
        },
      };

      const date = GameDate.parse(HITCHHIKER_CALENDAR, 'GSW FY38 10:00');

      expect(date.year).toBe(38);
      expect(date.era).toBe(2);
      expect(date.hour).toBe(10);
      expect(date.minute).toBe(0);
    });

    it('parses concatenated era+year without time', () => {
      const HITCHHIKER_CALENDAR: CalendarConfig = {
        name: 'Galactic Standard Calendar',
        calendarType: 'year-only',
        months: [{ name: 'Fiscal Year', days: 364 }],
        time: { hoursPerDay: 24, minutesPerHour: 60 },
        eras: [{ id: 2, name: 'Galactic Standard Fiscal Year', shortName: 'FY' }],
        defaultEra: 2,
        format: {
          dateSeparator: '.',
          timeSeparator: ':',
          eraPosition: 'suffix',
          yearOnlyTemplate: 'GSW ${era}${year}',
        },
      };

      const date = GameDate.parse(HITCHHIKER_CALENDAR, 'GSW FY38');

      expect(date.year).toBe(38);
      expect(date.era).toBe(2);
      expect(date.hour).toBe(0);
    });
  });
});

// ============================================================================
// Backwards Era Tests (BBY -> ABY)
// ============================================================================

describe('Backwards Era Arithmetic', () => {
  const STAR_WARS_CALENDAR: CalendarConfig = {
    name: 'Galactic Standard Calendar',
    calendarType: 'year-only',
    months: [{ name: 'Year', days: 368 }],
    time: { hoursPerDay: 24, minutesPerHour: 60 },
    eras: [
      {
        id: 1,
        name: 'Before Battle of Yavin',
        shortName: 'BBY',
        backwards: true,
        transitionEra: 2,
      },
      { id: 2, name: 'After Battle of Yavin', shortName: 'ABY' },
    ],
    defaultEra: 1,
    format: {
      dateSeparator: '.',
      timeSeparator: ':',
      eraPosition: 'suffix',
      yearOnlyTemplate: '${year} ${era}',
    },
  };

  describe('addYears with backwards era', () => {
    it('decrements year when adding years to BBY', () => {
      const date = new GameDate(STAR_WARS_CALENDAR, {
        year: 19,
        month: 1,
        day: 1,
        hour: null,
        minute: null,
        era: 1,
      });

      const result = date.addYears(1);

      expect(result.year).toBe(18);
      expect(result.era).toBe(1); // Still BBY
    });

    it('transitions from BBY to ABY when year crosses 0', () => {
      const date = new GameDate(STAR_WARS_CALENDAR, {
        year: 1,
        month: 1,
        day: 1,
        hour: null,
        minute: null,
        era: 1, // 1 BBY
      });

      const result = date.addYears(1);

      expect(result.year).toBe(1); // 1 ABY
      expect(result.era).toBe(2); // ABY
    });

    it('correctly handles multi-year transition', () => {
      const date = new GameDate(STAR_WARS_CALENDAR, {
        year: 1,
        month: 1,
        day: 1,
        hour: null,
        minute: null,
        era: 1, // 1 BBY
      });

      const result = date.addYears(3);

      expect(result.year).toBe(3); // 3 ABY
      expect(result.era).toBe(2); // ABY
    });
  });

  describe('comparison with backwards era', () => {
    it('isBefore works correctly with backwards era', () => {
      const earlier = new GameDate(STAR_WARS_CALENDAR, {
        year: 19,
        month: 1,
        day: 1,
        hour: null,
        minute: null,
        era: 1, // 19 BBY
      });
      const later = new GameDate(STAR_WARS_CALENDAR, {
        year: 5,
        month: 1,
        day: 1,
        hour: null,
        minute: null,
        era: 1, // 5 BBY (closer to Battle of Yavin)
      });

      expect(earlier.isBefore(later)).toBe(true);
      expect(later.isBefore(earlier)).toBe(false);
    });

    it('BBY is before ABY', () => {
      const bby = new GameDate(STAR_WARS_CALENDAR, {
        year: 1,
        month: 1,
        day: 1,
        hour: null,
        minute: null,
        era: 1, // 1 BBY
      });
      const aby = new GameDate(STAR_WARS_CALENDAR, {
        year: 1,
        month: 1,
        day: 1,
        hour: null,
        minute: null,
        era: 2, // 1 ABY
      });

      expect(bby.isBefore(aby)).toBe(true);
      expect(aby.isAfter(bby)).toBe(true);
    });
  });
});

// ============================================================================
// Millennium Calendar Tests
// ============================================================================

describe('Millennium Calendars', () => {
  const WARHAMMER_CALENDAR: CalendarConfig = {
    name: 'Imperial Calendar',
    calendarType: 'millennium',
    months: [{ name: 'Year', days: 365 }],
    time: { hoursPerDay: 24, minutesPerHour: 60 },
    eras: [
      { id: 41, name: '41st Millennium', shortName: 'M41' },
      { id: 42, name: '42nd Millennium', shortName: 'M42' },
    ],
    defaultEra: 41,
    format: {
      dateSeparator: '.',
      timeSeparator: ':',
      eraPosition: 'suffix',
      millenniumPrefix: 'M',
    },
  };

  describe('formatMillennium', () => {
    it('formats Warhammer 40K dates', () => {
      const date = new GameDate(WARHAMMER_CALENDAR, {
        year: 999,
        month: 1,
        day: 1,
        hour: 8,
        minute: 0,
        era: 41,
      });

      expect(date.formatMillennium()).toBe('999.M41');
    });
  });

  describe('format() with millennium calendar', () => {
    it('formats full date-time with millennium style', () => {
      const date = new GameDate(WARHAMMER_CALENDAR, {
        year: 999,
        month: 1,
        day: 1,
        hour: 8,
        minute: 0,
        era: 41,
      });

      expect(date.format()).toBe('999.M41 08:00');
    });
  });

  describe('formatNatural with millennium calendar', () => {
    it('formats natural display for Warhammer dates', () => {
      const date = new GameDate(WARHAMMER_CALENDAR, {
        year: 999,
        month: 1,
        day: 1,
        hour: 14,
        minute: 30,
        era: 41,
      });

      expect(date.formatNatural()).toBe('999.M41 · 2:30 PM');
    });
  });

  describe('parse millennium format', () => {
    it('parses "999.M41 08:00"', () => {
      const date = GameDate.parse(WARHAMMER_CALENDAR, '999.M41 08:00');

      expect(date.year).toBe(999);
      expect(date.month).toBe(1);
      expect(date.day).toBe(1);
      expect(date.hour).toBe(8);
      expect(date.minute).toBe(0);
      expect(date.era).toBe(41);
    });

    it('parses millennium without time', () => {
      const date = GameDate.parse(WARHAMMER_CALENDAR, '999.M41');

      expect(date.year).toBe(999);
      expect(date.hour).toBe(0);
      expect(date.minute).toBe(0);
    });
  });
});

describe('GameDate seasons', () => {
  describe('season accessor', () => {
    it('returns correct season for months within range', () => {
      // Winter: months 10, 1, 2 (wrap-around)
      const winter1 = new GameDate(TEST_FANTASY_CALENDAR, { year: 1472, month: 10, day: 15, hour: null, minute: null, era: null });
      expect(winter1.season).toBe('Winter');

      const winter2 = new GameDate(TEST_FANTASY_CALENDAR, { year: 1472, month: 1, day: 15, hour: null, minute: null, era: null });
      expect(winter2.season).toBe('Winter');

      const winter3 = new GameDate(TEST_FANTASY_CALENDAR, { year: 1472, month: 2, day: 15, hour: null, minute: null, era: null });
      expect(winter3.season).toBe('Winter');
    });

    it('returns correct season for non-wrap-around ranges', () => {
      // Spring: months 3-4
      const spring = new GameDate(TEST_FANTASY_CALENDAR, { year: 1472, month: 3, day: 15, hour: null, minute: null, era: null });
      expect(spring.season).toBe('Spring');

      // Summer: months 5-7
      const summer = new GameDate(TEST_FANTASY_CALENDAR, { year: 1472, month: 6, day: 15, hour: null, minute: null, era: null });
      expect(summer.season).toBe('Summer');

      // Autumn: months 8-9
      const autumn = new GameDate(TEST_FANTASY_CALENDAR, { year: 1472, month: 9, day: 15, hour: null, minute: null, era: null });
      expect(autumn.season).toBe('Autumn');
    });

    it('returns undefined when calendar has no seasons', () => {
      const date = new GameDate(SIMPLE_CALENDAR, { year: 2024, month: 6, day: 15, hour: null, minute: null, era: null });
      expect(date.season).toBeUndefined();
    });

    it('returns undefined when month matches no season', () => {
      // Create a calendar where not all months have seasons defined
      const partialSeasonCalendar: CalendarConfig = {
        name: 'Partial Season Calendar',
        months: [
          { name: 'Month1', days: 30 },
          { name: 'Month2', days: 30 },
          { name: 'Month3', days: 30 },
          { name: 'Month4', days: 30 },
        ],
        seasons: [
          { name: 'OnlySummer', monthStart: 2, monthEnd: 2 }, // Only month 2
        ],
      };

      // Month 1 has no season
      const date = new GameDate(partialSeasonCalendar, { year: 1000, month: 1, day: 15, hour: null, minute: null, era: null });
      expect(date.season).toBeUndefined();

      // Month 2 has OnlySummer
      const summerDate = new GameDate(partialSeasonCalendar, { year: 1000, month: 2, day: 15, hour: null, minute: null, era: null });
      expect(summerDate.season).toBe('OnlySummer');
    });
  });

  describe('season wrap-around edge cases', () => {
    it('handles season starting in later month and ending in earlier month', () => {
      // Winter starts at month 10 and ends at month 2 (wraps around year end)
      // Month 10 should be Winter
      const lateDec = new GameDate(TEST_FANTASY_CALENDAR, { year: 1472, month: 10, day: 1, hour: null, minute: null, era: null });
      expect(lateDec.season).toBe('Winter');

      // Month 1 should also be Winter
      const earlyJan = new GameDate(TEST_FANTASY_CALENDAR, { year: 1472, month: 1, day: 1, hour: null, minute: null, era: null });
      expect(earlyJan.season).toBe('Winter');

      // Month 2 should be Winter
      const feb = new GameDate(TEST_FANTASY_CALENDAR, { year: 1472, month: 2, day: 30, hour: null, minute: null, era: null });
      expect(feb.season).toBe('Winter');
    });

    it('correctly identifies non-wrap season boundaries', () => {
      // Spring starts at month 3, ends at month 4
      const month3 = new GameDate(TEST_FANTASY_CALENDAR, { year: 1472, month: 3, day: 1, hour: null, minute: null, era: null });
      expect(month3.season).toBe('Spring');

      const month4 = new GameDate(TEST_FANTASY_CALENDAR, { year: 1472, month: 4, day: 30, hour: null, minute: null, era: null });
      expect(month4.season).toBe('Spring');

      // Month 5 should be Summer, not Spring
      const month5 = new GameDate(TEST_FANTASY_CALENDAR, { year: 1472, month: 5, day: 1, hour: null, minute: null, era: null });
      expect(month5.season).toBe('Summer');
    });
  });
});
