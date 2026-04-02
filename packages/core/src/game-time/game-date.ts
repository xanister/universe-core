/**
 * Generic game date-time system supporting custom calendars per universe.
 *
 * Each universe can define its own calendar with:
 * - Custom month names and days per month
 * - Custom hours per day (e.g., 22 for Anslem)
 * - Optional era/age system
 * - Season definitions (with wrap-around support for multi-month seasons)
 * - Custom date/time formatting
 */

import type {
  CalendarConfig,
  GameDateTimeComponents,
  MonthDefinition,
  EraDefinition,
  SeasonDefinition,
  TimeConfig,
} from '@dmnpc/types/world';
import { logger } from '../infra/logger.js';

export type {
  CalendarConfig,
  GameDateTimeComponents,
  MonthDefinition,
  EraDefinition,
  SeasonDefinition,
  TimeConfig,
};

/**
 * Immutable date-time class for custom game calendars.
 * All mutation methods return new instances.
 */
export class GameDate {
  readonly year: number;
  readonly month: number; // 1-indexed (1 = first month)
  readonly day: number;
  readonly hour: number; // 0 to hoursPerDay-1
  readonly minute: number; // 0 to minutesPerHour-1
  readonly era: number | null;

  private readonly config: CalendarConfig;
  private readonly _daysPerYear: number;
  private readonly _hoursPerDay: number;
  private readonly _minutesPerHour: number;
  private readonly _minutesPerDay: number;
  private readonly _monthDayOffsets: number[]; // Cumulative days at start of each month

  constructor(config: CalendarConfig, components: GameDateTimeComponents) {
    this.config = config;
    this.year = components.year;
    this.month = components.month;
    this.day = components.day;
    this.hour = components.hour ?? 0;
    this.minute = components.minute ?? 0;
    this.era = components.era ?? config.defaultEra;

    // Pre-compute calendar constants
    this._daysPerYear = config.months.reduce((sum, m) => sum + m.days, 0);
    this._hoursPerDay = config.time?.hoursPerDay ?? 24;
    this._minutesPerHour = config.time?.minutesPerHour ?? 60;
    this._minutesPerDay = this._hoursPerDay * this._minutesPerHour;

    this._monthDayOffsets = [0];
    for (let i = 0; i < config.months.length - 1; i++) {
      this._monthDayOffsets.push(this._monthDayOffsets[i] + config.months[i].days);
    }

    // Validate
    this._validate();
  }

  private _validate(): void {
    if (this.month < 1 || this.month > this.config.months.length) {
      throw new Error(
        `Invalid month ${this.month}. Must be between 1 and ${this.config.months.length}`,
      );
    }
    const daysInMonth = this.config.months[this.month - 1].days;
    if (this.day < 1 || this.day > daysInMonth) {
      throw new Error(
        `Invalid day ${this.day} for month ${this.month} (${this.monthName}). Must be between 1 and ${daysInMonth}`,
      );
    }
    if (this.hour < 0 || this.hour >= this._hoursPerDay) {
      throw new Error(`Invalid hour ${this.hour}. Must be between 0 and ${this._hoursPerDay - 1}`);
    }
    if (this.minute < 0 || this.minute >= this._minutesPerHour) {
      throw new Error(
        `Invalid minute ${this.minute}. Must be between 0 and ${this._minutesPerHour - 1}`,
      );
    }
    if (this.era !== null && this.config.eras) {
      const validEra = this.config.eras.find((e) => e.id === this.era);
      if (!validEra) {
        const validIds = this.config.eras.map((e) => e.id).join(', ');
        throw new Error(`Invalid era ${this.era}. Valid era IDs: ${validIds}`);
      }
    }
  }

  /** Get the month name from the calendar config */
  get monthName(): string {
    return this.config.months[this.month - 1].name;
  }

  /** Get the number of days in the current month */
  get daysInMonth(): number {
    return this.config.months[this.month - 1].days;
  }

  /** Get the total days in a year for this calendar */
  get daysPerYear(): number {
    return this._daysPerYear;
  }

  /** Get hours per day for this calendar */
  get hoursPerDay(): number {
    return this._hoursPerDay;
  }

  /** Get minutes per hour for this calendar */
  get minutesPerHour(): number {
    return this._minutesPerHour;
  }

  /** Get the era name if eras are defined */
  get eraName(): string | undefined {
    if (this.era === null || !this.config.eras) return undefined;
    return this.config.eras.find((e) => e.id === this.era)?.name;
  }

  /** Get the short era name if defined */
  get eraShortName(): string | undefined {
    if (this.era === null || !this.config.eras) return undefined;
    const eraDef = this.config.eras.find((e) => e.id === this.era);
    return eraDef?.shortName ?? eraDef?.name;
  }

  /** Get the day of the year (1-indexed) */
  get dayOfYear(): number {
    return this._monthDayOffsets[this.month - 1] + this.day;
  }

  /** Get the calendar configuration */
  get calendar(): CalendarConfig {
    return this.config;
  }

  /** Continuous 0-1 fraction through the day (0 = midnight, 0.5 = noon, 1 = next midnight). Includes minutes for smooth transitions. */
  get dayFraction(): number {
    return (this.hour + this.minute / this._minutesPerHour) / this._hoursPerDay;
  }

  /** Get time of day as a descriptive string */
  get timeOfDay(): 'night' | 'dawn' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'dusk' {
    const dayFraction = this.hour / this._hoursPerDay;
    if (dayFraction < 0.2) return 'night'; // 0-20% of day
    if (dayFraction < 0.27) return 'dawn'; // 20-27%
    if (dayFraction < 0.42) return 'morning'; // 27-42%
    if (dayFraction < 0.52) return 'midday'; // 42-52%
    if (dayFraction < 0.7) return 'afternoon'; // 52-70%
    if (dayFraction < 0.8) return 'evening'; // 70-80%
    if (dayFraction < 0.87) return 'dusk'; // 80-87%
    return 'night'; // 87-100%
  }

  /** Get the current season name if seasons are defined in the calendar */
  get season(): string | undefined {
    if (!this.config.seasons || this.config.seasons.length === 0) return undefined;
    const season = this.config.seasons.find((s) => {
      // Handle wrap-around case (e.g., Winter: month 10 to month 2)
      if (s.monthStart > s.monthEnd) {
        return this.month >= s.monthStart || this.month <= s.monthEnd;
      }
      return this.month >= s.monthStart && this.month <= s.monthEnd;
    });
    return season?.name;
  }

  /** Add minutes to the date-time, returning a new GameDate */
  addMinutes(minutes: number): GameDate {
    if (minutes === 0) return this;
    return this._fromAbsoluteMinutes(this._toAbsoluteMinutes() + minutes);
  }

  /** Subtract minutes from the date-time, returning a new GameDate */
  subtractMinutes(minutes: number): GameDate {
    return this.addMinutes(-minutes);
  }

  /** Add hours to the date-time, returning a new GameDate */
  addHours(hours: number): GameDate {
    if (hours === 0) return this;
    return this.addMinutes(hours * this._minutesPerHour);
  }

  /** Subtract hours from the date-time, returning a new GameDate */
  subtractHours(hours: number): GameDate {
    return this.addHours(-hours);
  }

  /** Add days to the date-time, returning a new GameDate */
  addDays(days: number): GameDate {
    if (days === 0) return this;
    return this.addMinutes(days * this._minutesPerDay);
  }

  /** Subtract days from the date-time, returning a new GameDate */
  subtractDays(days: number): GameDate {
    return this.addDays(-days);
  }

  /** Add months to the date, returning a new GameDate */
  addMonths(months: number): GameDate {
    if (months === 0) return this;

    let newYear = this.year;
    let newMonth = this.month + months;

    // Handle overflow/underflow
    while (newMonth > this.config.months.length) {
      newMonth -= this.config.months.length;
      newYear++;
    }
    while (newMonth < 1) {
      newMonth += this.config.months.length;
      newYear--;
    }

    // Clamp day to valid range for new month
    const daysInNewMonth = this.config.months[newMonth - 1].days;
    const newDay = Math.min(this.day, daysInNewMonth);

    return new GameDate(this.config, {
      year: newYear,
      month: newMonth,
      day: newDay,
      hour: this.hour,
      minute: this.minute,
      era: this.era,
    });
  }

  /** Subtract months from the date, returning a new GameDate */
  subtractMonths(months: number): GameDate {
    return this.addMonths(-months);
  }

  /** Add years to the date, returning a new GameDate */
  addYears(years: number): GameDate {
    if (years === 0) return this;

    // Check if current era is backwards-counting
    const currentEraDef =
      this.era !== null && this.config.eras
        ? this.config.eras.find((e) => e.id === this.era)
        : undefined;
    const isBackwards = currentEraDef?.backwards ?? false;

    // Clamp day if current month has fewer days in any year (though our calendars are fixed)
    const daysInMonth = this.config.months[this.month - 1].days;
    const newDay = Math.min(this.day, daysInMonth);

    // For backwards eras, adding years means decrementing the year number
    let newYear = isBackwards ? this.year - years : this.year + years;
    let newEra: number | null = this.era;

    // Handle era transition for backwards eras (e.g., 1 BBY + 1 year = 1 ABY)
    if (isBackwards && newYear <= 0 && currentEraDef?.transitionEra != null) {
      // Transition to the new era
      // Year 1 BBY + 1 year = Year 1 ABY (skip year 0)
      newYear = 1 - newYear; // Convert: 0 -> 1, -1 -> 2, etc.
      newEra = currentEraDef.transitionEra;
    }

    return new GameDate(this.config, {
      year: newYear,
      month: this.month,
      day: newDay,
      hour: this.hour,
      minute: this.minute,
      era: newEra,
    });
  }

  /** Subtract years from the date, returning a new GameDate */
  subtractYears(years: number): GameDate {
    return this.addYears(-years);
  }

  /** Change the era, returning a new GameDate */
  withEra(era: number): GameDate {
    return new GameDate(this.config, {
      year: this.year,
      month: this.month,
      day: this.day,
      hour: this.hour,
      minute: this.minute,
      era,
    });
  }

  /** Set the time, returning a new GameDate */
  withTime(hour: number, minute: number = 0): GameDate {
    return new GameDate(this.config, {
      year: this.year,
      month: this.month,
      day: this.day,
      hour,
      minute,
      era: this.era,
    });
  }

  /** Calculate the difference in minutes between two date-times (this - other) */
  diffMinutes(other: GameDate): number {
    return this._toAbsoluteMinutes() - other._toAbsoluteMinutes();
  }

  /** Calculate the difference in hours between two date-times (this - other) */
  diffHours(other: GameDate): number {
    return this.diffMinutes(other) / this._minutesPerHour;
  }

  /** Calculate the difference in days between two date-times (this - other) */
  diffDays(other: GameDate): number {
    return this.diffMinutes(other) / this._minutesPerDay;
  }

  /** Check if this date-time equals another (including time) */
  equals(other: GameDate): boolean {
    return (
      this.year === other.year &&
      this.month === other.month &&
      this.day === other.day &&
      this.hour === other.hour &&
      this.minute === other.minute &&
      this.era === other.era
    );
  }

  /** Check if this date-time equals another (date only, ignoring time) */
  equalsDate(other: GameDate): boolean {
    return (
      this.year === other.year &&
      this.month === other.month &&
      this.day === other.day &&
      this.era === other.era
    );
  }

  /** Check if this date-time is before another */
  isBefore(other: GameDate): boolean {
    // Era comparison (if both have eras)
    if (this.era !== null && other.era !== null && this.era !== other.era) {
      // Check if either era is backwards-counting
      const thisEraDef = this.config.eras?.find((e) => e.id === this.era);
      const otherEraDef = other.config.eras?.find((e) => e.id === other.era);

      // Backwards eras (like BBY) come before their transition eras (like ABY)
      if (thisEraDef?.backwards && thisEraDef.transitionEra === other.era) {
        return true; // BBY is before ABY
      }
      if (otherEraDef?.backwards && otherEraDef.transitionEra === this.era) {
        return false; // ABY is not before BBY
      }

      return this.era < other.era;
    }

    // Same era - check if it's a backwards era
    const currentEraDef =
      this.era !== null && this.config.eras
        ? this.config.eras.find((e) => e.id === this.era)
        : undefined;
    const isBackwards = currentEraDef?.backwards ?? false;

    if (isBackwards) {
      // In backwards eras, higher year numbers are chronologically earlier
      if (this.year !== other.year) {
        return this.year > other.year;
      }
      // Same year, compare within-year time
      return this._toAbsoluteMinutes() < other._toAbsoluteMinutes();
    }

    return this._toAbsoluteMinutes() < other._toAbsoluteMinutes();
  }

  /** Check if this date-time is after another */
  isAfter(other: GameDate): boolean {
    // Era comparison (if both have eras)
    if (this.era !== null && other.era !== null && this.era !== other.era) {
      // Check if either era is backwards-counting
      const thisEraDef = this.config.eras?.find((e) => e.id === this.era);
      const otherEraDef = other.config.eras?.find((e) => e.id === other.era);

      // Backwards eras (like BBY) come before their transition eras (like ABY)
      if (thisEraDef?.backwards && thisEraDef.transitionEra === other.era) {
        return false; // BBY is not after ABY
      }
      if (otherEraDef?.backwards && otherEraDef.transitionEra === this.era) {
        return true; // ABY is after BBY
      }

      return this.era > other.era;
    }

    // Same era - check if it's a backwards era
    const currentEraDef =
      this.era !== null && this.config.eras
        ? this.config.eras.find((e) => e.id === this.era)
        : undefined;
    const isBackwards = currentEraDef?.backwards ?? false;

    if (isBackwards) {
      // In backwards eras, lower year numbers are chronologically later
      if (this.year !== other.year) {
        return this.year < other.year;
      }
      // Same year, compare within-year time
      return this._toAbsoluteMinutes() > other._toAbsoluteMinutes();
    }

    return this._toAbsoluteMinutes() > other._toAbsoluteMinutes();
  }

  /** Check if this date-time is before or equal to another */
  isBeforeOrEqual(other: GameDate): boolean {
    return this.isBefore(other) || this.equals(other);
  }

  /** Check if this date-time is after or equal to another */
  isAfterOrEqual(other: GameDate): boolean {
    return this.isAfter(other) || this.equals(other);
  }

  /**
   * Format the date as a string (without time).
   * Uses the calendar's format config, or can be overridden.
   */
  formatDate(options?: {
    dateSeparator?: string;
    eraPosition?: 'suffix' | 'prefix' | 'none';
    monthDisplay?: 'number' | 'name';
    yearFirst?: boolean;
    padDay?: boolean;
    padMonth?: boolean;
  }): string {
    const sep = options?.dateSeparator ?? this.config.format?.dateSeparator ?? '.';
    const eraPos = options?.eraPosition ?? this.config.format?.eraPosition ?? 'suffix';
    const monthDisp = options?.monthDisplay ?? this.config.format?.monthDisplay ?? 'number';
    const yearFirst = options?.yearFirst ?? this.config.format?.yearFirst ?? false;
    const padDay = options?.padDay ?? true;
    const padMonth = options?.padMonth ?? true;

    const dayStr = padDay ? String(this.day).padStart(2, '0') : String(this.day);
    const monthStr =
      monthDisp === 'name'
        ? this.monthName
        : padMonth
          ? String(this.month).padStart(2, '0')
          : String(this.month);
    const yearStr = String(this.year);

    let dateStr: string;
    if (yearFirst) {
      dateStr = `${yearStr}${sep}${monthStr}${sep}${dayStr}`;
    } else {
      dateStr = `${dayStr}${sep}${monthStr}${sep}${yearStr}`;
    }

    // Add era if present and requested
    if (eraPos !== 'none' && this.eraShortName) {
      if (eraPos === 'prefix') {
        dateStr = `${this.eraShortName} ${dateStr}`;
      } else {
        dateStr = `${dateStr} ${this.eraShortName}`;
      }
    }

    return dateStr;
  }

  /**
   * Format the time as a string.
   */
  formatTime(options?: { timeSeparator?: string; padHour?: boolean; padMinute?: boolean }): string {
    const sep = options?.timeSeparator ?? this.config.format?.timeSeparator ?? ':';
    const padHour = options?.padHour ?? true;
    const padMinute = options?.padMinute ?? true;

    const hourStr = padHour ? String(this.hour).padStart(2, '0') : String(this.hour);
    const minuteStr = padMinute ? String(this.minute).padStart(2, '0') : String(this.minute);

    return `${hourStr}${sep}${minuteStr}`;
  }

  /**
   * Format the full date-time as a string.
   * Format depends on calendarType:
   * - standard: "DD.MM.YYYY ERA HH:MM" (e.g., "27.10.1476 4A 18:30")
   * - year-only: "ERA YEAR HH:MM" (e.g., "T.A. 2940 14:30")
   * - millennium: "YEAR.M## HH:MM" (e.g., "999.M41 08:00")
   */
  format(options?: {
    dateSeparator?: string;
    timeSeparator?: string;
    eraPosition?: 'suffix' | 'prefix' | 'none';
    monthDisplay?: 'number' | 'name';
    yearFirst?: boolean;
    includeTime?: boolean;
  }): string {
    const includeTime = options?.includeTime ?? true;
    const calendarType = this.config.calendarType ?? 'standard';

    // Handle year-only calendars
    if (calendarType === 'year-only') {
      let result = this.formatYearOnly();
      if (includeTime) {
        result += ` ${this.formatTime({ timeSeparator: options?.timeSeparator })}`;
      }
      return result;
    }

    // Handle millennium calendars
    if (calendarType === 'millennium') {
      let result = this.formatMillennium();
      if (includeTime) {
        result += ` ${this.formatTime({ timeSeparator: options?.timeSeparator })}`;
      }
      return result;
    }

    // Standard calendar formatting
    // Build date portion (without era first)
    const sep = options?.dateSeparator ?? this.config.format?.dateSeparator ?? '.';
    const monthDisp = options?.monthDisplay ?? this.config.format?.monthDisplay ?? 'number';
    const yearFirst = options?.yearFirst ?? this.config.format?.yearFirst ?? false;

    const dayStr = String(this.day).padStart(2, '0');
    const monthStr = monthDisp === 'name' ? this.monthName : String(this.month).padStart(2, '0');
    const yearStr = String(this.year);

    let result: string;
    if (yearFirst) {
      result = `${yearStr}${sep}${monthStr}${sep}${dayStr}`;
    } else {
      result = `${dayStr}${sep}${monthStr}${sep}${yearStr}`;
    }

    // Add era (before time)
    const eraPos = options?.eraPosition ?? this.config.format?.eraPosition ?? 'suffix';
    if (eraPos !== 'none' && this.eraShortName) {
      if (eraPos === 'prefix') {
        result = `${this.eraShortName} ${result}`;
      } else {
        result = `${result} ${this.eraShortName}`;
      }
    }

    // Add time last
    if (includeTime) {
      result += ` ${this.formatTime({ timeSeparator: options?.timeSeparator })}`;
    }

    return result;
  }

  /** Format with month name (e.g., "15 Runvakr 1472 4A, 14:30") */
  formatLong(): string {
    const calendarType = this.config.calendarType ?? 'standard';

    // For year-only calendars, use a simpler format
    if (calendarType === 'year-only') {
      return `${this.formatYearOnly()}, ${this.formatTime()}`;
    }

    // For millennium calendars
    if (calendarType === 'millennium') {
      return `${this.formatMillennium()}, ${this.formatTime()}`;
    }

    // Standard calendar
    let result = `${this.day} ${this.monthName} ${this.year}`;
    if (this.eraShortName) {
      result += ` ${this.eraShortName}`;
    }
    result += `, ${this.formatTime()}`;
    return result;
  }

  /** Format with full era name (e.g., "15 Runvakr, Year 1472 of the 4th Age at 14:30") */
  formatFull(): string {
    const calendarType = this.config.calendarType ?? 'standard';

    // For year-only calendars
    if (calendarType === 'year-only') {
      let result = `Year ${this.year}`;
      if (this.eraName) {
        result += ` of the ${this.eraName}`;
      }
      result += ` at ${this.formatTime()}`;
      return result;
    }

    // For millennium calendars
    if (calendarType === 'millennium') {
      let result = `Year ${this.year}`;
      if (this.eraName) {
        result += ` of the ${this.eraName}`;
      }
      result += ` at ${this.formatTime()}`;
      return result;
    }

    // Standard calendar
    let result = `${this.day} ${this.monthName}, Year ${this.year}`;
    if (this.eraName) {
      result += ` of the ${this.eraName}`;
    }
    result += ` at ${this.formatTime()}`;
    return result;
  }

  /**
   * Format for natural UI display (e.g., "27 Frostfall · 2:30 PM")
   * Uses full month name with 12-hour time and AM/PM.
   * For year-only calendars, shows "T.A. 2940 · 2:30 PM"
   * For millennium calendars, shows "999.M41 · 2:30 PM"
   */
  formatNatural(): string {
    const hour12 = this.hour === 0 ? 12 : this.hour > 12 ? this.hour - 12 : this.hour;
    const ampm = this.hour < 12 ? 'AM' : 'PM';
    const minuteStr = String(this.minute).padStart(2, '0');
    const timeStr = `${hour12}:${minuteStr} ${ampm}`;

    const calendarType = this.config.calendarType ?? 'standard';

    if (calendarType === 'year-only') {
      const yearOnlyDate = this.formatYearOnly();
      return `${yearOnlyDate} · ${timeStr}`;
    }

    if (calendarType === 'millennium') {
      const millenniumDate = this.formatMillennium();
      return `${millenniumDate} · ${timeStr}`;
    }

    return `${this.day} ${this.monthName} · ${timeStr}`;
  }

  /**
   * Format for year-only calendars (e.g., "T.A. 2940" or "19 BBY")
   * Uses the yearOnlyTemplate if provided, otherwise defaults to "${era} ${year}" or "${year} ${era}"
   * Supported placeholders: ${era}, ${year}
   */
  formatYearOnly(): string {
    const template = this.config.format?.yearOnlyTemplate;
    const eraPos = this.config.format?.eraPosition ?? 'suffix';
    const eraStr = this.eraShortName ?? '';

    if (template) {
      // Replace template variables (only ${era} and ${year} are supported)
      const result = template.replace('${era}', eraStr).replace('${year}', String(this.year));

      // Check for unsubstituted placeholders - indicates an unsupported variable in the template
      const unsubstituted = result.match(/\$\{(\w+)\}/g);
      if (unsubstituted) {
        logger.error(
          'GameDate',
          `yearOnlyTemplate contains unsupported placeholders: ${unsubstituted.join(', ')}. Only \${era} and \${year} are supported. Template: "${template}"`,
        );
      }

      return result;
    }

    // Default formatting based on era position
    if (eraPos === 'prefix' && eraStr) {
      return `${eraStr} ${this.year}`;
    } else if (eraStr) {
      return `${this.year} ${eraStr}`;
    }
    return String(this.year);
  }

  /**
   * Format for millennium calendars (e.g., "999.M41")
   * The era shortName is expected to be like "M41" for "41st Millennium"
   */
  formatMillennium(): string {
    const prefix = this.config.format?.millenniumPrefix ?? 'M';
    const eraId = this.era ?? this.config.defaultEra;

    // The era ID represents the millennium number
    return `${this.year}.${prefix}${eraId}`;
  }

  toString(): string {
    return this.format();
  }

  toJSON(): GameDateTimeComponents {
    return {
      year: this.year,
      month: this.month,
      day: this.day,
      hour: this.hour,
      minute: this.minute,
      era: this.era,
    };
  }

  /** Convert date-time to absolute minute count (for arithmetic) */
  private _toAbsoluteMinutes(): number {
    const totalDays = (this.year - 1) * this._daysPerYear + this.dayOfYear - 1;
    const totalMinutes =
      totalDays * this._minutesPerDay + this.hour * this._minutesPerHour + this.minute;
    return totalMinutes;
  }

  /** Create a date-time from absolute minute count */
  private _fromAbsoluteMinutes(totalMinutes: number): GameDate {
    // Handle negative results
    if (totalMinutes < 0) {
      throw new Error('Cannot create date-time before day 1 of year 1 at 00:00');
    }

    // Extract time components
    const minuteOfDay = totalMinutes % this._minutesPerDay;
    const totalDays = Math.floor(totalMinutes / this._minutesPerDay) + 1; // +1 because day 1 is at minute 0

    const hour = Math.floor(minuteOfDay / this._minutesPerHour);
    const minute = minuteOfDay % this._minutesPerHour;

    // Calculate year from total days (year is directly derived from absolute position)
    const year = Math.floor((totalDays - 1) / this._daysPerYear) + 1;
    let remainingDays = totalDays - (year - 1) * this._daysPerYear;

    // Find month and day
    let month = 1;
    for (let i = 0; i < this.config.months.length; i++) {
      const daysInMonth = this.config.months[i].days;
      if (remainingDays <= daysInMonth) {
        month = i + 1;
        break;
      }
      remainingDays -= daysInMonth;
    }

    return new GameDate(this.config, {
      year,
      month,
      day: remainingDays,
      hour,
      minute,
      era: this.era,
    });
  }

  /**
   * Parse a date-time string into a GameDate.
   * Supports formats like:
   * - Standard: "15.03.1472", "15.03.1472 4A", "15.03.1472 4A 14:30", "15.03.1472 14:30"
   * - Year-only: "T.A. 2940", "T.A. 2940 14:30", "19 BBY", "19 BBY 14:30"
   * - Millennium: "999.M41", "999.M41 08:00"
   */
  static parse(config: CalendarConfig, dateStr: string): GameDate {
    const calendarType = config.calendarType ?? 'standard';
    const sep = config.format?.dateSeparator ?? '.';
    const timeSep = config.format?.timeSeparator ?? ':';
    const yearFirst = config.format?.yearFirst ?? false;

    // Split into parts by whitespace
    const parts = dateStr.trim().split(/\s+/);
    if (parts.length === 0) {
      throw new Error(`Invalid date format: "${dateStr}"`);
    }

    // Handle year-only calendars (e.g., "T.A. 2940" or "19 BBY")
    if (calendarType === 'year-only') {
      return GameDate._parseYearOnly(config, parts, timeSep);
    }

    // Handle millennium calendars (e.g., "999.M41")
    if (calendarType === 'millennium') {
      return GameDate._parseMillennium(config, parts, timeSep);
    }

    // Standard calendar parsing
    const eraNames = GameDate._buildEraNames(config);
    const { datePart, timePart, eraPart } = GameDate._classifyStandardParts(
      parts,
      eraNames,
      sep,
      timeSep,
    );

    if (!datePart) {
      throw new Error(`Invalid date format: "${dateStr}". Could not find date component.`);
    }

    // Parse date components
    const dateComponents = datePart.split(sep).map((n) => parseInt(n, 10));
    if (dateComponents.length !== 3 || dateComponents.some(isNaN)) {
      throw new Error(
        `Invalid date format: "${dateStr}". Expected format like "15${sep}03${sep}1472"`,
      );
    }

    let day: number, month: number, year: number;
    if (yearFirst) {
      [year, month, day] = dateComponents;
    } else {
      [day, month, year] = dateComponents;
    }

    // Parse time if present
    let hour = 0;
    let minute = 0;
    if (timePart) {
      const timeComponents = timePart.split(timeSep).map((n) => parseInt(n, 10));
      if (timeComponents.length >= 2 && !timeComponents.some(isNaN)) {
        [hour, minute] = timeComponents;
      }
    }

    // Parse era if present
    let era: number | null = config.defaultEra;
    if (eraPart && config.eras) {
      const foundEra = config.eras.find(
        (e) =>
          e.shortName?.toLowerCase() === eraPart.toLowerCase() ||
          e.name.toLowerCase() === eraPart.toLowerCase(),
      );
      if (foundEra) {
        era = foundEra.id;
      }
    }

    return new GameDate(config, { year, month, day, hour, minute, era });
  }

  /**
   * Build a set of known era names (lowercased) from the calendar config.
   */
  private static _buildEraNames(config: CalendarConfig): Set<string> {
    const eraNames = new Set<string>();
    if (config.eras) {
      for (const era of config.eras) {
        if (era.shortName) eraNames.add(era.shortName.toLowerCase());
        eraNames.add(era.name.toLowerCase());
      }
    }
    return eraNames;
  }

  /**
   * Classify whitespace-split parts of a standard date string into date, time, and era components.
   */
  private static _classifyStandardParts(
    parts: string[],
    eraNames: Set<string>,
    sep: string,
    timeSep: string,
  ): { datePart: string | undefined; timePart: string | undefined; eraPart: string | undefined } {
    let datePart: string | undefined;
    let timePart: string | undefined;
    let eraPart: string | undefined;

    for (const part of parts) {
      // Check for era first (some eras like "T.A." contain periods)
      if (eraNames.has(part.toLowerCase())) {
        eraPart = part;
      } else if (part.includes(timeSep) && /^\d{1,2}:\d{2}/.test(part)) {
        timePart = part;
      } else if (part.includes(sep)) {
        // Only treat as date if it looks like numbers separated by the separator
        const potentialDate = part.split(sep);
        if (potentialDate.length === 3 && potentialDate.every((p) => /^\d+$/.test(p))) {
          datePart = part;
        } else if (!eraPart) {
          // Might be an era with periods (e.g., "T.A.") not in our list
          eraPart = part;
        }
      } else {
        eraPart = part;
      }
    }

    return { datePart, timePart, eraPart };
  }

  /**
   * Try to parse a date string, returning null on failure instead of throwing.
   * Use this when date parsing is optional context, not critical path.
   */
  static tryParse(config: CalendarConfig, dateStr: string): GameDate | null {
    try {
      return GameDate.parse(config, dateStr);
    } catch {
      return null;
    }
  }

  /**
   * Parse year-only format (e.g., "T.A. 2940", "19 BBY", "T.A. 2940 14:30", "FY38")
   * Supports both separated (FY 38) and concatenated (FY38) era+year formats.
   */
  private static _parseYearOnly(
    config: CalendarConfig,
    parts: string[],
    timeSep: string,
  ): GameDate {
    let year: number | undefined;
    let era: number | null = config.defaultEra;
    let hour = 0;
    let minute = 0;

    for (const part of parts) {
      // Check if it's a time component
      if (part.includes(timeSep)) {
        const timeComponents = part.split(timeSep).map((n) => parseInt(n, 10));
        if (timeComponents.length >= 2 && !timeComponents.some(isNaN)) {
          [hour, minute] = timeComponents;
        }
        continue;
      }

      // Check if it's a pure number (the year)
      const numVal = parseInt(part, 10);
      if (!isNaN(numVal) && String(numVal) === part) {
        year = numVal;
        continue;
      }

      // Try to match an exact era (e.g., "FY", "T.A.", "BBY")
      if (config.eras) {
        const foundEra = config.eras.find(
          (e) =>
            e.shortName?.toLowerCase() === part.toLowerCase() ||
            e.name.toLowerCase() === part.toLowerCase(),
        );
        if (foundEra) {
          era = foundEra.id;
          continue;
        }

        // Try to match concatenated era+year (e.g., "FY38" where era is "FY" and year is "38")
        for (const e of config.eras) {
          if (e.shortName) {
            const shortNameLower = e.shortName.toLowerCase();
            const partLower = part.toLowerCase();
            if (partLower.startsWith(shortNameLower)) {
              const yearPart = part.slice(e.shortName.length);
              const yearNum = parseInt(yearPart, 10);
              if (!isNaN(yearNum) && String(yearNum) === yearPart) {
                era = e.id;
                year = yearNum;
                break;
              }
            }
          }
        }
      }
    }

    if (year === undefined) {
      throw new Error(`Invalid year-only date format: "${parts.join(' ')}". Could not find year.`);
    }

    // Year-only calendars use month=1, day=1 internally
    return new GameDate(config, { year, month: 1, day: 1, hour, minute, era });
  }

  /**
   * Parse millennium format (e.g., "999.M41", "999.M41 08:00")
   */
  private static _parseMillennium(
    config: CalendarConfig,
    parts: string[],
    timeSep: string,
  ): GameDate {
    const prefix = config.format?.millenniumPrefix ?? 'M';
    let year: number | undefined;
    let era: number | null = config.defaultEra;
    let hour = 0;
    let minute = 0;

    for (const part of parts) {
      // Check if it's a time component
      if (part.includes(timeSep)) {
        const timeComponents = part.split(timeSep).map((n) => parseInt(n, 10));
        if (timeComponents.length >= 2 && !timeComponents.some(isNaN)) {
          [hour, minute] = timeComponents;
        }
        continue;
      }

      // Check if it's a millennium format (e.g., "999.M41")
      const millenniumMatch = part.match(new RegExp(`^(\\d+)\\.${prefix}(\\d+)$`, 'i'));
      if (millenniumMatch) {
        year = parseInt(millenniumMatch[1], 10);
        const millenniumNum = parseInt(millenniumMatch[2], 10);
        // Find the era with this millennium number as its ID
        if (config.eras) {
          const foundEra = config.eras.find((e) => e.id === millenniumNum);
          if (foundEra) {
            era = foundEra.id;
          }
        }
        continue;
      }
    }

    if (year === undefined) {
      throw new Error(
        `Invalid millennium date format: "${parts.join(' ')}". Expected format like "999.${prefix}41"`,
      );
    }

    // Millennium calendars use month=1, day=1 internally
    return new GameDate(config, { year, month: 1, day: 1, hour, minute, era });
  }

  /** Create a GameDate for the first moment of a given year */
  static startOfYear(config: CalendarConfig, year: number, era?: number): GameDate {
    return new GameDate(config, {
      year,
      month: 1,
      day: 1,
      hour: 0,
      minute: 0,
      era: era ?? config.defaultEra,
    });
  }

  /** Create a GameDate for the last moment of a given year */
  static endOfYear(config: CalendarConfig, year: number, era?: number): GameDate {
    const lastMonth = config.months.length;
    const lastDay = config.months[lastMonth - 1].days;
    const hoursPerDay = config.time?.hoursPerDay ?? 24;
    const minutesPerHour = config.time?.minutesPerHour ?? 60;
    return new GameDate(config, {
      year,
      month: lastMonth,
      day: lastDay,
      hour: hoursPerDay - 1,
      minute: minutesPerHour - 1,
      era: era ?? config.defaultEra,
    });
  }

  /** Create a GameDate for the first moment of a given month */
  static startOfMonth(config: CalendarConfig, year: number, month: number, era?: number): GameDate {
    return new GameDate(config, {
      year,
      month,
      day: 1,
      hour: 0,
      minute: 0,
      era: era ?? config.defaultEra,
    });
  }

  /** Create a GameDate for the last moment of a given month */
  static endOfMonth(config: CalendarConfig, year: number, month: number, era?: number): GameDate {
    const lastDay = config.months[month - 1].days;
    const hoursPerDay = config.time?.hoursPerDay ?? 24;
    const minutesPerHour = config.time?.minutesPerHour ?? 60;
    return new GameDate(config, {
      year,
      month,
      day: lastDay,
      hour: hoursPerDay - 1,
      minute: minutesPerHour - 1,
      era: era ?? config.defaultEra,
    });
  }

  /** Create a GameDate for the start of a given day */
  static startOfDay(
    config: CalendarConfig,
    year: number,
    month: number,
    day: number,
    era?: number,
  ): GameDate {
    return new GameDate(config, {
      year,
      month,
      day,
      hour: 0,
      minute: 0,
      era: era ?? config.defaultEra,
    });
  }

  /** Create a GameDate for the end of a given day */
  static endOfDay(
    config: CalendarConfig,
    year: number,
    month: number,
    day: number,
    era?: number,
  ): GameDate {
    const hoursPerDay = config.time?.hoursPerDay ?? 24;
    const minutesPerHour = config.time?.minutesPerHour ?? 60;
    return new GameDate(config, {
      year,
      month,
      day,
      hour: hoursPerDay - 1,
      minute: minutesPerHour - 1,
      era: era ?? config.defaultEra,
    });
  }
}

/** Get total days in a calendar year */
export function getTotalDaysInYear(config: CalendarConfig): number {
  return config.months.reduce((sum, m) => sum + m.days, 0);
}

/** Get hours per day for a calendar */
export function getHoursPerDay(config: CalendarConfig): number {
  return config.time?.hoursPerDay ?? 24;
}

/** Get minutes per hour for a calendar */
export function getMinutesPerHour(config: CalendarConfig): number {
  return config.time?.minutesPerHour ?? 60;
}

/** Get month index (1-indexed) by name */
export function getMonthByName(config: CalendarConfig, name: string): number | undefined {
  const index = config.months.findIndex((m) => m.name.toLowerCase() === name.toLowerCase());
  return index >= 0 ? index + 1 : undefined;
}

/** Validate a calendar configuration */
export function validateCalendarConfig(config: CalendarConfig): string[] {
  const errors: string[] = [];

  if (!config.name || config.name.trim() === '') {
    errors.push('Calendar must have a name');
  }

  if (config.months.length === 0) {
    errors.push('Calendar must have at least one month');
  } else {
    config.months.forEach((month, index) => {
      if (!month.name || month.name.trim() === '') {
        errors.push(`Month ${index + 1} must have a name`);
      }
      if (typeof month.days !== 'number' || month.days < 1) {
        errors.push(`Month ${index + 1} (${month.name}) must have at least 1 day`);
      }
    });
  }

  if (config.time) {
    if (typeof config.time.hoursPerDay !== 'number' || config.time.hoursPerDay < 1) {
      errors.push('hoursPerDay must be a positive number');
    }
    if (config.time.minutesPerHour !== undefined) {
      if (typeof config.time.minutesPerHour !== 'number' || config.time.minutesPerHour < 1) {
        errors.push('minutesPerHour must be a positive number');
      }
    }
  }

  if (config.eras) {
    const eraIds = new Set<number>();
    config.eras.forEach((era) => {
      if (eraIds.has(era.id)) {
        errors.push(`Duplicate era ID: ${era.id}`);
      }
      eraIds.add(era.id);
      if (!era.name || era.name.trim() === '') {
        errors.push(`Era ${era.id} must have a name`);
      }
    });

    if (config.defaultEra !== null) {
      const validEra = config.eras.find((e) => e.id === config.defaultEra);
      if (!validEra) {
        errors.push(`Default era ${config.defaultEra} not found in eras list`);
      }
    }
  }

  return errors;
}
