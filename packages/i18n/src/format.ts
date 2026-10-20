// SPDX-License-Identifier: Apache-2.0
/**
 * Intl formatters for the interface.
 *
 * Numbers use the decimal mark of the locale ("2.8" in en-US, "2,8" in pt-BR). Units of time come from
 * Intl, so no code joins a value and a unit word. The units of a domain (mg, mmHg) come from its content
 * packs, never from this module. For the values of a scene, give the content locale of the session, not the
 * interface locale, so that a display never mixes "2.8" and "2,8".
 *
 * The functions keep their Intl objects in a cache, because Intl constructors are slow.
 */

const cache = new Map<string, unknown>();

function cached<T>(kind: string, locale: string, options: object, make: () => T): T {
  const key = `${kind}\u0000${locale}\u0000${JSON.stringify(options)}`;
  let value = cache.get(key) as T | undefined;
  if (value === undefined) {
    value = make();
    cache.set(key, value);
  }
  return value;
}

/** Format a number with the conventions of the locale. */
export function formatNumber(value: number, locale: string, options: Intl.NumberFormatOptions = {}): string {
  return cached("number", locale, options, () => new Intl.NumberFormat(locale, options)).format(value);
}

/** Format a number with a fixed count of fraction digits ("2.8" in en-US, "2,8" in pt-BR). */
export function formatDecimal(value: number, locale: string, fractionDigits = 1): string {
  return formatNumber(value, locale, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
}

/** Format a ratio from 0 to 1 as a percent ("91%" in en-US, "91%" in pt-BR). */
export function formatPercent(ratio: number, locale: string, fractionDigits = 0): string {
  return formatNumber(ratio, locale, {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** Format a date (and time) in the locale. Give `timeZone` in the options for a time zone other than the local one. */
export function formatDate(
  value: Date | number,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  return cached("date", locale, options, () => new Intl.DateTimeFormat(locale, options)).format(value);
}

/** Format a list ("a, b, and c" in en-US, "a, b e c" in pt-BR). */
export function formatList(
  items: readonly string[],
  locale: string,
  type: Intl.ListFormatType = "conjunction",
  style: Intl.ListFormatStyle = "long",
): string {
  const options = { type, style };
  return cached("list", locale, options, () => new Intl.ListFormat(locale, options)).format(items);
}

const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600 * 1000],
  ["month", 30 * 24 * 3600 * 1000],
  ["week", 7 * 24 * 3600 * 1000],
  ["day", 24 * 3600 * 1000],
  ["hour", 3600 * 1000],
  ["minute", 60 * 1000],
  ["second", 1000],
];

/**
 * Format a moment relative to now ("3 days ago", "in 2 hours", "yesterday"; "há 3 dias", "amanhã").
 * The unit is the largest unit that the difference reaches.
 */
export function formatRelativeTime(
  target: Date | number,
  locale: string,
  now: Date | number = Date.now(),
  numeric: Intl.RelativeTimeFormatNumeric = "auto",
): string {
  const diff = Number(target) - Number(now);
  const [unit, size] = RELATIVE_UNITS.find(([, ms]) => Math.abs(diff) >= ms) ?? ["second", 1000];
  const options = { numeric };
  const format = cached("relative", locale, options, () => new Intl.RelativeTimeFormat(locale, options));
  return format.format(Math.round(diff / size), unit);
}

export type DurationStyle = "long" | "short" | "narrow";

export interface DurationOptions {
  /** "short" ("1 min, 5 sec"; "1 min e 5 seg") by default; "long" ("1 minute, 5 seconds") or "narrow" ("1m 5s"). */
  readonly style?: DurationStyle;
  /** Digits after the decimal mark of the seconds (0 by default; 1 gives "2.8 sec"). */
  readonly fractionDigits?: number;
}

interface DurationParts {
  hours?: number;
  minutes?: number;
  seconds?: number;
  milliseconds?: number;
}

interface DurationFormatter {
  format(duration: DurationParts): string;
}

type DurationFormatConstructor = new (locale: string, options: Record<string, unknown>) => DurationFormatter;

/** Intl.DurationFormat, where the browser has it (ES2025; not in the TypeScript library of the workspace). */
function durationFormat(): DurationFormatConstructor | undefined {
  return (Intl as unknown as { DurationFormat?: DurationFormatConstructor }).DurationFormat;
}

const UNIT_NAMES = { hours: "hour", minutes: "minute", seconds: "second" } as const;

/**
 * Format a duration in milliseconds with the unit words of the locale: "1 min, 5 sec", "2.8 sec"
 * (en-US); "1 min e 5 seg", "2,8 seg" (pt-BR). Zero units are left out; a zero duration shows seconds.
 * Without Intl.DurationFormat, the function joins Intl.NumberFormat units with Intl.ListFormat.
 */
export function formatDurationMs(ms: number, locale: string, options: DurationOptions = {}): string {
  const style = options.style ?? "short";
  const digits = Math.max(0, Math.min(3, Math.trunc(options.fractionDigits ?? 0)));
  const scale = 10 ** digits;
  const total = Math.round((Math.abs(ms) / 1000) * scale) / scale;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.round((total % 60) * scale) / scale;
  const parts: DurationParts = {};
  if (hours > 0) {
    parts.hours = hours;
  }
  if (minutes > 0) {
    parts.minutes = minutes;
  }
  if (seconds > 0 || (hours === 0 && minutes === 0)) {
    parts.seconds = Math.floor(seconds);
    if (digits > 0) {
      parts.milliseconds = Math.round((seconds - Math.floor(seconds)) * 1000);
    }
  }
  const sign = ms < 0 ? "-" : "";
  const DurationFormat = durationFormat();
  if (DurationFormat !== undefined) {
    const intlOptions: Record<string, unknown> = { style, secondsDisplay: "always" };
    if (digits > 0) {
      intlOptions.milliseconds = "numeric";
      intlOptions.fractionalDigits = digits;
    }
    if (parts.seconds === undefined) {
      intlOptions.secondsDisplay = "auto";
    }
    const format = cached("duration", locale, intlOptions, () => new DurationFormat(locale, intlOptions));
    return sign + format.format(parts);
  }
  const unitDisplay = style;
  const words = (Object.keys(UNIT_NAMES) as (keyof typeof UNIT_NAMES)[]).flatMap((key) => {
    const value = key === "seconds" ? (parts.seconds === undefined ? undefined : seconds) : parts[key];
    if (value === undefined) {
      return [];
    }
    const fraction = key === "seconds" ? digits : 0;
    return [
      formatNumber(value, locale, {
        style: "unit",
        unit: UNIT_NAMES[key],
        unitDisplay,
        minimumFractionDigits: fraction,
        maximumFractionDigits: fraction,
      }),
    ];
  });
  return sign + formatList(words, locale, "unit", style);
}

/**
 * Format a time in milliseconds as a clock: "m:ss" below one hour, "h:mm:ss" from one hour. The time is relative,
 * not a time of day. The digits are the same in every locale.
 */
export function formatClockMs(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${String(minutes)}:${seconds}`;
}
