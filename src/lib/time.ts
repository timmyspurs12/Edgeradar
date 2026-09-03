/**
 * TIME — the single authority on kickoff timestamps and day boundaries.
 *
 * Every kickoff in EdgeRadar is stored and compared in **UTC**. Calendar
 * concepts the user cares about ("today", "tomorrow") are defined by the
 * display timezone — Africa/Lagos (WAT) by default — and then *converted back
 * to UTC instants* so that all filtering happens on one comparable number line.
 *
 * Why this file exists: mixing "the server's local day", "the browser's day"
 * and "the raw kickoff string" is how fixture lists silently lose evening
 * matches and show yesterday's games as today's. Nothing else in the codebase
 * is allowed to do date arithmetic on kickoffs.
 *
 * All functions are pure and take an injectable clock so they are testable
 * without freezing global time.
 */

export const DEFAULT_DISPLAY_TZ = "Africa/Lagos";

/** Display timezone for all kickoff rendering and day grouping. */
export function displayTz(env: NodeJS.ProcessEnv = process.env): string {
  return (env.DISPLAY_TZ || DEFAULT_DISPLAY_TZ).trim() || DEFAULT_DISPLAY_TZ;
}

const HAS_EXPLICIT_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Normalize any kickoff value to a canonical UTC ISO-8601 string.
 *
 * - `2026-09-03T17:00:00Z`      → unchanged
 * - `2026-09-03T17:00:00+01:00` → `2026-09-03T16:00:00.000Z`
 * - `2026-09-03T17:00:00`       → treated as UTC → `2026-09-03T17:00:00.000Z`
 *   (a naive timestamp has no defined zone; interpreting it as UTC is the only
 *   deterministic choice — it does not depend on the server's local timezone)
 * - `1756918800000` / Date      → UTC ISO
 *
 * Throws on an unparseable value rather than returning Invalid Date, which
 * would otherwise poison every downstream comparison.
 */
export function toUtcIso(input: string | number | Date): string {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) throw new Error("toUtcIso: invalid Date");
    return input.toISOString();
  }
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new Error("toUtcIso: invalid timestamp");
    return new Date(input).toISOString();
  }

  const raw = String(input).trim();
  if (!raw) throw new Error("toUtcIso: empty kickoff");

  const normalized = HAS_EXPLICIT_OFFSET.test(raw) ? raw : `${raw}Z`;
  const ms = Date.parse(normalized);
  if (Number.isNaN(ms)) {
    throw new Error(`toUtcIso: cannot parse kickoff "${input}"`);
  }
  return new Date(ms).toISOString();
}

/** Kickoff as a UTC epoch-millisecond value. */
export function toUtcMs(input: string | number | Date): number {
  return Date.parse(toUtcIso(input));
}

/** Wall-clock parts of an instant as seen in `tz`. */
export function partsInTz(instant: number | Date, tz: string): {
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
} {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const out: Record<string, number> = {};
  for (const p of dtf.formatToParts(new Date(instant))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year, month: out.month, day: out.day,
    // Intl reports midnight as "24" under hour12:false on some runtimes.
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute, second: out.second,
  };
}

/** Milliseconds to add to a UTC instant to get `tz` wall-clock time. */
export function tzOffsetMs(instant: number | Date, tz: string): number {
  const t = typeof instant === "number" ? instant : instant.getTime();
  const p = partsInTz(t, tz);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - Math.floor(t / 1000) * 1000;
}

/**
 * Convert a wall-clock time in `tz` to a UTC epoch-ms instant.
 * Two-pass so DST transitions resolve to the correct side of the offset change.
 */
export function zonedTimeToUtcMs(
  year: number, month: number, day: number,
  hour = 0, minute = 0, second = 0,
  tz: string = DEFAULT_DISPLAY_TZ,
): number {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstGuess = naiveUtc - tzOffsetMs(naiveUtc, tz);
  const correction = tzOffsetMs(firstGuess, tz) - tzOffsetMs(naiveUtc, tz);
  return firstGuess - correction;
}

export interface DayBounds {
  /** YYYY-MM-DD as seen in `tz`. */
  dayKey: string;
  /** UTC instant of 00:00:00 in `tz` on that day (inclusive). */
  startUtc: number;
  /** UTC instant of 00:00:00 in `tz` on the following day (exclusive). */
  endUtc: number;
}

/**
 * UTC boundaries of the calendar day in `tz` that contains `now`, shifted by
 * `dayOffset` days. `dayOffset: 0` = today, `1` = tomorrow.
 *
 * This is what makes "Today" mean *today in Lagos*, not today on the Vercel
 * container (UTC) — a 22:30 WAT kickoff is 21:30 UTC and belongs to the same
 * WAT day.
 */
export function dayBoundsInTz(
  dayOffset = 0,
  tz: string = DEFAULT_DISPLAY_TZ,
  now: number | Date = Date.now(),
): DayBounds {
  const baseMs = typeof now === "number" ? now : now.getTime();

  // Work out the calendar day in `tz`, then step by `dayOffset` days on the
  // CALENDAR. Adding 24h of milliseconds instead would be wrong twice a year:
  // a spring-forward day is 23h long (so +24h overshoots into the day after
  // tomorrow) and an autumn fallback day is 25h long (so +24h never reaches
  // midnight at all).
  const base = partsInTz(baseMs, tz);
  const target = new Date(Date.UTC(base.year, base.month - 1, base.day + dayOffset));
  const y = target.getUTCFullYear();
  const m = target.getUTCMonth() + 1;
  const d = target.getUTCDate();

  const startUtc = zonedTimeToUtcMs(y, m, d, 0, 0, 0, tz);

  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const endUtc = zonedTimeToUtcMs(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, 0, tz);

  return {
    dayKey: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    startUtc,
    endUtc,
  };
}

/** `YYYY-MM-DD` of an instant as seen in `tz`. */
export function dayKeyInTz(input: string | number | Date, tz: string = DEFAULT_DISPLAY_TZ): string {
  const ms = typeof input === "number"
    ? input
    : input instanceof Date
      ? input.getTime()
      : toUtcMs(input);
  const p = partsInTz(ms, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Human label for a timezone, e.g. `Africa/Lagos` → `WAT`. */
export function tzAbbreviation(tz: string = DEFAULT_DISPLAY_TZ, now: number | Date = Date.now()): string {
  if (tz === "Africa/Lagos") return "WAT";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "short" })
      .formatToParts(new Date(now));
    return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
  } catch {
    return tz;
  }
}
