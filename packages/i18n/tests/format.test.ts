// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import {
  formatClockMs,
  formatDate,
  formatDecimal,
  formatDurationMs,
  formatList,
  formatNumber,
  formatPercent,
  formatRelativeTime,
} from "../src/format";

describe("numbers", () => {
  test("use the decimal comma in pt-BR", () => {
    expect(formatDecimal(2.8, "en-US")).toBe("2.8");
    expect(formatDecimal(2.8, "pt-BR")).toBe("2,8");
    expect(formatNumber(12345.6, "en-US")).toBe("12,345.6");
    expect(formatNumber(12345.6, "pt-BR")).toBe("12.345,6");
  });

  test("format percents and fixed fraction digits", () => {
    expect(formatPercent(0.91, "en-US")).toBe("91%");
    expect(formatPercent(0.915, "pt-BR", 1)).toBe("91,5%");
    expect(formatDecimal(3, "pt-BR", 2)).toBe("3,00");
  });
});

describe("dates, lists and relative time", () => {
  const now = Date.UTC(2026, 9, 2, 12, 0, 0);

  test("format a date in a time zone", () => {
    expect(formatDate(now, "en-US", { dateStyle: "medium", timeZone: "UTC" })).toBe("Oct 2, 2026");
    expect(formatDate(now, "pt-BR", { dateStyle: "medium", timeZone: "UTC" })).toBe("2 de out. de 2026");
  });

  test("join lists with the conjunction of the locale", () => {
    expect(formatList(["a", "b", "c"], "en-US")).toBe("a, b, and c");
    expect(formatList(["a", "b", "c"], "pt-BR")).toBe("a, b e c");
    expect(formatList(["a", "b"], "pt-BR", "disjunction")).toBe("a ou b");
  });

  test("choose the largest unit of a relative time", () => {
    expect(formatRelativeTime(now - 3 * 24 * 3600 * 1000, "en-US", now)).toBe("3 days ago");
    expect(formatRelativeTime(now - 24 * 3600 * 1000, "pt-BR", now)).toBe("ontem");
    expect(formatRelativeTime(now + 2 * 3600 * 1000, "en-US", now)).toBe("in 2 hours");
    expect(formatRelativeTime(now - 3 * 60 * 1000, "pt-BR", now)).toBe("há 3 minutos");
    expect(formatRelativeTime(now, "en-US", now)).toBe("now");
  });
});

// The unit words of a locale come from the CLDR data of the runtime, and the data differs between versions (pt-BR
// "seg" in older data, "s" in newer data). The pt-BR expectations therefore come from Intl of the runtime: the
// tests check the parts of the duration, the rounding and the decimal mark, not one CLDR version.
type DurationFormatter = new (locale: string, options: Record<string, unknown>) => { format(parts: object): string };

function intlDuration(locale: string, parts: object, options: Record<string, unknown>): string {
  const DurationFormat = (Intl as unknown as { DurationFormat?: DurationFormatter }).DurationFormat;
  if (DurationFormat === undefined) {
    throw new Error("this runtime has no Intl.DurationFormat");
  }
  return new DurationFormat(locale, options).format(parts);
}

function intlSeconds(value: number, locale: string, digits: number): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "second",
    unitDisplay: "short",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

describe("formatDurationMs", () => {
  test("uses the unit words of the locale", () => {
    expect(formatDurationMs(65_000, "en-US")).toBe("1 min, 5 sec");
    expect(formatDurationMs(65_000, "pt-BR")).toBe(
      intlDuration("pt-BR", { minutes: 1, seconds: 5 }, { style: "short", secondsDisplay: "always" }),
    );
    expect(formatDurationMs(65_000, "pt-BR")).toMatch(/^1 min e 5 s/);
    expect(formatDurationMs(65_000, "en-US", { style: "long" })).toBe("1 minute, 5 seconds");
    expect(formatDurationMs(3_720_000, "en-US", { style: "narrow" })).toBe("1h 2m");
  });

  test("shows fraction digits of seconds with the decimal mark of the locale", () => {
    expect(formatDurationMs(2_800, "en-US", { fractionDigits: 1 })).toBe("2.8 sec");
    expect(formatDurationMs(2_800, "pt-BR", { fractionDigits: 1 })).toBe(
      intlDuration(
        "pt-BR",
        { seconds: 2, milliseconds: 800 },
        { style: "short", secondsDisplay: "always", milliseconds: "numeric", fractionalDigits: 1 },
      ),
    );
    expect(formatDurationMs(2_800, "pt-BR", { fractionDigits: 1 })).toMatch(/^2,8 s/);
    expect(formatDurationMs(62_800, "pt-BR", { fractionDigits: 1, style: "narrow" })).toBe(
      intlDuration(
        "pt-BR",
        { minutes: 1, seconds: 2, milliseconds: 800 },
        { style: "narrow", secondsDisplay: "always", milliseconds: "numeric", fractionalDigits: 1 },
      ),
    );
    expect(formatDurationMs(62_800, "pt-BR", { fractionDigits: 1, style: "narrow" })).toMatch(/^1 ?min 2,8 ?s$/);
  });

  test("rounds to the shown precision and shows zero as seconds", () => {
    expect(formatDurationMs(59_960, "en-US", { fractionDigits: 1 })).toBe("1 min");
    expect(formatDurationMs(0, "en-US")).toBe("0 sec");
    expect(formatDurationMs(-4_000, "en-US")).toBe("-4 sec");
  });

  describe("without Intl.DurationFormat", () => {
    const intl = Intl as unknown as { DurationFormat?: unknown };
    const saved = intl.DurationFormat;
    afterEach(() => {
      intl.DurationFormat = saved;
    });

    test("joins number units with a unit list", () => {
      intl.DurationFormat = undefined;
      expect(formatDurationMs(65_000, "en-US")).toBe("1 min, 5 sec");
      expect(formatDurationMs(2_800, "pt-BR", { fractionDigits: 1 })).toBe(intlSeconds(2.8, "pt-BR", 1));
      expect(formatDurationMs(2_800, "pt-BR", { fractionDigits: 1 })).toMatch(/^2,8 s/);
      expect(formatDurationMs(3_720_000, "en-US", { style: "narrow" })).toBe("1h 2m");
    });
  });
});

describe("formatClockMs", () => {
  test("writes m:ss below one hour and h:mm:ss above", () => {
    expect(formatClockMs(0)).toBe("0:00");
    expect(formatClockMs(65_400)).toBe("1:05");
    expect(formatClockMs(3_725_000)).toBe("1:02:05");
    expect(formatClockMs(-5)).toBe("0:00");
  });
});
