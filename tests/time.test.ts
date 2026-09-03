import { describe, expect, it } from "vitest";
import {
  DEFAULT_DISPLAY_TZ, dayBoundsInTz, dayKeyInTz, displayTz, partsInTz,
  toUtcIso, toUtcMs, tzAbbreviation, tzOffsetMs, zonedTimeToUtcMs,
} from "@/lib/time";
import { NOW, WAT_DAY_END_UTC, WAT_DAY_START_UTC } from "./helpers";

describe("toUtcIso — kickoff normalization", () => {
  it("passes an explicit UTC timestamp through unchanged", () => {
    expect(toUtcIso("2026-09-03T18:00:00Z")).toBe("2026-09-03T18:00:00.000Z");
    expect(toUtcIso("2026-09-03T18:00:00.000Z")).toBe("2026-09-03T18:00:00.000Z");
  });

  it("converts an offset timestamp to UTC", () => {
    expect(toUtcIso("2026-09-03T18:00:00+01:00")).toBe("2026-09-03T17:00:00.000Z");
    expect(toUtcIso("2026-09-03T18:00:00-05:00")).toBe("2026-09-03T23:00:00.000Z");
    expect(toUtcIso("2026-09-03T18:00:00+0100")).toBe("2026-09-03T17:00:00.000Z");
  });

  it("reads a naive timestamp as UTC so the result never depends on the server zone", () => {
    expect(toUtcIso("2026-09-03T18:00:00")).toBe("2026-09-03T18:00:00.000Z");
    expect(toUtcIso("2026-09-03")).toBe("2026-09-03T00:00:00.000Z");
  });

  it("accepts epoch numbers and Date objects", () => {
    expect(toUtcIso(NOW)).toBe("2026-09-03T12:00:00.000Z");
    expect(toUtcIso(new Date(NOW))).toBe("2026-09-03T12:00:00.000Z");
    expect(toUtcMs("2026-09-03T12:00:00Z")).toBe(NOW);
  });

  it("throws on unparseable input instead of returning Invalid Date", () => {
    expect(() => toUtcIso("not a date")).toThrow(/cannot parse kickoff/);
    expect(() => toUtcIso("")).toThrow(/empty kickoff/);
    expect(() => toUtcIso(Number.NaN)).toThrow(/invalid timestamp/);
    expect(() => toUtcIso(new Date("nope"))).toThrow(/invalid Date/);
  });
});

describe("dayBoundsInTz — Africa/Lagos (WAT) day boundaries expressed in UTC", () => {
  it("resolves today's WAT day to a UTC+1 window", () => {
    const b = dayBoundsInTz(0, "Africa/Lagos", NOW);
    expect(b.dayKey).toBe("2026-09-03");
    expect(b.startUtc).toBe(WAT_DAY_START_UTC); // 2026-09-02T23:00:00Z
    expect(b.endUtc).toBe(WAT_DAY_END_UTC);     // 2026-09-03T23:00:00Z
    expect(b.endUtc - b.startUtc).toBe(86400000);
  });

  it("resolves tomorrow's WAT day", () => {
    const b = dayBoundsInTz(1, "Africa/Lagos", NOW);
    expect(b.dayKey).toBe("2026-09-04");
    expect(b.startUtc).toBe(WAT_DAY_END_UTC);
    expect(b.endUtc).toBe(Date.parse("2026-09-04T23:00:00.000Z"));
  });

  it("differs from a naive UTC day window (the bug this prevents)", () => {
    const utc = dayBoundsInTz(0, "UTC", NOW);
    expect(utc.startUtc).toBe(Date.parse("2026-09-03T00:00:00.000Z"));
    expect(utc.startUtc).not.toBe(dayBoundsInTz(0, "Africa/Lagos", NOW).startUtc);
  });

  it("handles a DST transition day (Europe/London, 2026-03-29 is 23h long)", () => {
    const instant = Date.parse("2026-03-29T12:00:00.000Z");
    const b = dayBoundsInTz(0, "Europe/London", instant);
    expect(b.dayKey).toBe("2026-03-29");
    expect(b.startUtc).toBe(Date.parse("2026-03-29T00:00:00.000Z")); // still GMT at midnight
    expect(b.endUtc).toBe(Date.parse("2026-03-29T23:00:00.000Z"));   // BST at next midnight
    expect(b.endUtc - b.startUtc).toBe(23 * 3600000);
  });

  it("handles the day after a DST transition (25h in the autumn fallback)", () => {
    const instant = Date.parse("2026-10-25T12:00:00.000Z"); // BST ends 2026-10-25
    const b = dayBoundsInTz(0, "Europe/London", instant);
    expect(b.dayKey).toBe("2026-10-25");
    expect(b.startUtc).toBe(Date.parse("2026-10-24T23:00:00.000Z")); // midnight is still BST
    expect(b.endUtc).toBe(Date.parse("2026-10-26T00:00:00.000Z"));   // next midnight is GMT
    expect(b.endUtc - b.startUtc).toBe(25 * 3600000);
  });

  it("steps dayOffset on the calendar, not by adding 24h of milliseconds", () => {
    // 2026-03-28T23:30Z is 23:30 GMT on Mar 28. Adding 24h of ms would land on
    // 2026-03-30 in London (00:30 BST) and skip Mar 29 entirely.
    const instant = Date.parse("2026-03-28T23:30:00.000Z");
    expect(dayBoundsInTz(0, "Europe/London", instant).dayKey).toBe("2026-03-28");
    expect(dayBoundsInTz(1, "Europe/London", instant).dayKey).toBe("2026-03-29");
    expect(dayBoundsInTz(2, "Europe/London", instant).dayKey).toBe("2026-03-30");
    expect(dayBoundsInTz(-1, "Europe/London", instant).dayKey).toBe("2026-03-27");
  });

  it("produces contiguous, non-overlapping consecutive days", () => {
    const tz = "Europe/London";
    const instant = Date.parse("2026-10-24T20:00:00.000Z");
    for (let i = 0; i < 6; i++) {
      expect(dayBoundsInTz(i, tz, instant).endUtc).toBe(dayBoundsInTz(i + 1, tz, instant).startUtc);
    }
  });

  it("keeps a 24h day for a zone with no DST", () => {
    const b = dayBoundsInTz(0, "Africa/Lagos", NOW);
    expect(b.endUtc - b.startUtc).toBe(86400000);
    expect(dayBoundsInTz(3, "Africa/Lagos", NOW).dayKey).toBe("2026-09-06");
  });
});

describe("dayKeyInTz — which calendar day a kickoff belongs to", () => {
  it("puts a 23:30Z kickoff into the NEXT WAT day (00:30 WAT)", () => {
    expect(dayKeyInTz("2026-09-03T23:30:00Z", "Africa/Lagos")).toBe("2026-09-04");
    // ...while UTC would call it the same day. This is exactly why the
    // repository must group by the display timezone.
    expect(dayKeyInTz("2026-09-03T23:30:00Z", "UTC")).toBe("2026-09-03");
  });

  it("keeps a 22:30Z kickoff in the same WAT day (23:30 WAT)", () => {
    expect(dayKeyInTz("2026-09-03T22:30:00Z", "Africa/Lagos")).toBe("2026-09-03");
  });

  it("accepts epoch ms and Date inputs", () => {
    expect(dayKeyInTz(NOW, "Africa/Lagos")).toBe("2026-09-03");
    expect(dayKeyInTz(new Date(NOW), "Africa/Lagos")).toBe("2026-09-03");
  });
});

describe("zoned time conversion", () => {
  it("converts Lagos wall-clock midnight to 23:00Z the day before", () => {
    expect(zonedTimeToUtcMs(2026, 9, 3, 0, 0, 0, "Africa/Lagos")).toBe(WAT_DAY_START_UTC);
  });

  it("converts a London summer kickoff (BST) to UTC", () => {
    // 2026-08-15 20:00 London (BST, UTC+1) → 19:00Z
    expect(zonedTimeToUtcMs(2026, 8, 15, 20, 0, 0, "Europe/London"))
      .toBe(Date.parse("2026-08-15T19:00:00.000Z"));
  });

  it("computes the WAT offset as +1h", () => {
    expect(tzOffsetMs(NOW, "Africa/Lagos")).toBe(3600000);
    expect(tzOffsetMs(NOW, "UTC")).toBe(0);
  });

  it("exposes wall-clock parts in the requested zone", () => {
    // 2026-09-03T23:30:00Z is 2026-09-04 00:30 in Lagos.
    const p = partsInTz(Date.parse("2026-09-03T23:30:00.000Z"), "Africa/Lagos");
    expect(p).toMatchObject({ year: 2026, month: 9, day: 4, hour: 0, minute: 30 });
  });
});

describe("display timezone configuration", () => {
  it("defaults to Africa/Lagos", () => {
    expect(DEFAULT_DISPLAY_TZ).toBe("Africa/Lagos");
    expect(displayTz({} as NodeJS.ProcessEnv)).toBe("Africa/Lagos");
    expect(displayTz({ DISPLAY_TZ: "   " } as unknown as NodeJS.ProcessEnv)).toBe("Africa/Lagos");
  });

  it("honours DISPLAY_TZ", () => {
    expect(displayTz({ DISPLAY_TZ: "Europe/London" } as unknown as NodeJS.ProcessEnv)).toBe("Europe/London");
  });

  it("labels Africa/Lagos as WAT", () => {
    expect(tzAbbreviation("Africa/Lagos")).toBe("WAT");
  });
});
