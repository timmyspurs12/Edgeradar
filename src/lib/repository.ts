import { AppData } from "./service";
import { Fixture, FixtureStatus, League, MatchPrediction, Team } from "./types";
import {
  DayBounds, dayBoundsInTz, dayKeyInTz, displayTz, toUtcIso,
} from "./time";

/**
 * REPOSITORY — the single source of truth for every fixture query.
 *
 * Every page and API route (`/`, `/matches`, `/two-odds`, `/builder`,
 * `/api/fixtures`, `/api/two-odds`) reads fixtures through `queryFixtures`.
 * Nothing filters `data.fixtures` by hand anywhere else, so a change to the
 * timezone or status rules lands everywhere at once.
 *
 * GUARANTEES
 *  1. Kickoffs are normalized to UTC exactly once, here. `kickoffIso` is the
 *     canonical value; `kickoffTime` is its epoch-ms form. All comparisons use
 *     that one number line — never the raw provider string.
 *  2. "Today" and "Tomorrow" are *calendar days in the display timezone*
 *     (Africa/Lagos / WAT by default), expressed as a `[startUtc, endUtc)` UTC
 *     window. A 22:30 WAT kickoff is 21:30 UTC on the same WAT day, so it stays
 *     in "Today" — the classic bug where evening fixtures vanish is impossible.
 *  3. Status filtering is orthogonal to range filtering. `status` narrows by
 *     state; `range` narrows by time. In-play fixtures are never dropped by a
 *     range filter: every window that looks forward starts at the beginning of
 *     the current display-timezone day, so anything that kicked off today —
 *     LIVE or already FINISHED — is still inside it.
 *  4. Results are always sorted by kickoff ascending.
 */

export type FixtureRange = "today" | "tomorrow" | "3d" | "7d" | "all" | "finished";
export type StatusFilter = FixtureStatus | "ALL";

export interface FixtureFilterOptions {
  /** Time window. Default `"all"`. */
  range?: FixtureRange;
  /** Exact status filter. `undefined` or `"ALL"` = every status. */
  status?: StatusFilter;
  leagueId?: string;
  /** League tier (1–3). `0`/`undefined` = any. */
  tier?: number;
  /** Minimum headline match confidence, 0–100. `0` = no floor. */
  minConfidence?: number;
  /** `"verified"` keeps broadcast-verified leagues only. */
  cast?: "all" | "verified";
  searchQuery?: string;
  /** Only fixtures with a headline prediction. */
  withPrediction?: boolean;
  /** Display timezone for day boundaries. Default `DISPLAY_TZ` (Africa/Lagos). */
  timezone?: string;
  /** Injectable clock (epoch ms) — tests use this instead of faking globals. */
  now?: number;
}

export interface EnrichedFixture {
  fixture: Fixture;
  homeTeam: Team;
  awayTeam: Team;
  league: League;
  prediction: MatchPrediction | null;
  /** Kickoff normalized to UTC ISO-8601. */
  kickoffIso: string;
  /** Kickoff as epoch ms — the single comparable value. */
  kickoffTime: number;
  /** `YYYY-MM-DD` of the kickoff in the display timezone. */
  dayKey: string;
  /** Kickoff has passed; the pre-match snapshot is locked. */
  isLocked: boolean;
  /** Still a valid pre-match prediction (kickoff in the future). */
  isPreMatch: boolean;
}

/** "Today"/"Tomorrow" and the forward windows, in UTC, for a given clock. */
export function fixtureWindows(
  tz: string = displayTz(),
  now: number = Date.now(),
): {
  today: DayBounds;
  tomorrow: DayBounds;
  /** End of the display-timezone day 2 days out → the 3-calendar-day window. */
  threeDayEndUtc: number;
  /** End of the display-timezone day 6 days out → the 7-calendar-day window. */
  sevenDayEndUtc: number;
} {
  const today = dayBoundsInTz(0, tz, now);
  const tomorrow = dayBoundsInTz(1, tz, now);
  return {
    today,
    tomorrow,
    threeDayEndUtc: dayBoundsInTz(2, tz, now).endUtc,
    sevenDayEndUtc: dayBoundsInTz(6, tz, now).endUtc,
  };
}

export function queryFixtures(data: AppData, options: FixtureFilterOptions = {}): EnrichedFixture[] {
  const {
    range = "all",
    status,
    leagueId,
    tier = 0,
    minConfidence = 0,
    cast = "all",
    searchQuery = "",
    timezone = displayTz(),
    now = Date.now(),
    withPrediction = false,
  } = options;

  const { today, tomorrow, threeDayEndUtc, sevenDayEndUtc } = fixtureWindows(timezone, now);
  const q = searchQuery.toLowerCase().trim();

  const teamsById = new Map<string, Team>();
  for (const t of data.teams) teamsById.set(t.id, t);
  const leaguesById = new Map<string, League>();
  for (const l of data.leagues) leaguesById.set(l.id, l);

  const statusFilter: StatusFilter = status ?? "ALL";
  const out: EnrichedFixture[] = [];

  for (const fixture of data.fixtures) {
    // Referential integrity: a fixture pointing at an unknown team or league
    // cannot be rendered or reasoned about, so it is excluded rather than
    // crashing the page.
    const homeTeam = teamsById.get(fixture.homeId);
    const awayTeam = teamsById.get(fixture.awayId);
    const league = leaguesById.get(fixture.leagueId);
    if (!homeTeam || !awayTeam || !league) continue;

    let kickoffIso: string;
    try {
      kickoffIso = toUtcIso(fixture.kickoff);
    } catch {
      continue; // unparseable kickoff → excluded, never guessed
    }
    const kickoffTime = Date.parse(kickoffIso);

    // ── status filter (exact, predictable) ────────────────────────────────
    if (statusFilter !== "ALL" && fixture.status !== statusFilter) continue;

    // ── range filter (display-timezone calendar windows, in UTC) ──────────
    if (range === "finished") {
      if (fixture.status !== "FINISHED") continue;
    } else if (range === "today") {
      if (kickoffTime < today.startUtc || kickoffTime >= today.endUtc) continue;
    } else if (range === "tomorrow") {
      if (kickoffTime < tomorrow.startUtc || kickoffTime >= tomorrow.endUtc) continue;
    } else if (range === "3d") {
      // From the start of today: in-play and already-finished matches that
      // kicked off today stay visible instead of disappearing mid-match.
      if (kickoffTime < today.startUtc || kickoffTime >= threeDayEndUtc) continue;
    } else if (range === "7d") {
      if (kickoffTime < today.startUtc || kickoffTime >= sevenDayEndUtc) continue;
    }

    if (leagueId && fixture.leagueId !== leagueId) continue;
    if (tier && league.tier !== tier) continue;
    if (cast === "verified" && league.broadcastStatus !== "BROADCAST_VERIFIED") continue;

    const prediction = data.predictions.get(fixture.id) ?? null;
    if (minConfidence > 0 && (!prediction || prediction.matchConfidence < minConfidence)) continue;
    if (withPrediction && (!prediction || prediction.noStrongEdge)) continue;

    if (q) {
      const haystack =
        `${homeTeam.name} ${awayTeam.name} ${league.name} ${league.country}`.toLowerCase();
      if (!haystack.includes(q)) continue;
    }

    out.push({
      fixture, homeTeam, awayTeam, league, prediction,
      kickoffIso,
      kickoffTime,
      dayKey: dayKeyInTz(kickoffTime, timezone),
      isLocked: kickoffTime <= now,
      isPreMatch: kickoffTime > now,
    });
  }

  out.sort((a, b) => a.kickoffTime - b.kickoffTime);
  return out;
}

// ── named queries used by pages ────────────────────────────────────────────

export function getTodayFixtures(data: AppData, now = Date.now()): EnrichedFixture[] {
  return queryFixtures(data, { range: "today", now });
}

/** Everything that has not kicked off yet, soonest first. */
export function getUpcomingFixtures(
  data: AppData,
  options: Omit<FixtureFilterOptions, "status"> = {},
): EnrichedFixture[] {
  return queryFixtures(data, { ...options, status: "UPCOMING" });
}

/** Fixtures currently in play. */
export function getLiveFixtures(data: AppData, now = Date.now()): EnrichedFixture[] {
  return queryFixtures(data, { status: "LIVE", range: "today", now });
}

export function getFinishedFixtures(data: AppData): EnrichedFixture[] {
  return queryFixtures(data, { range: "finished" });
}

/**
 * Strongest pre-match edges over a forward horizon. Only fixtures that have
 * not kicked off are eligible — a locked snapshot is never re-ranked.
 */
export function getTopEdges(
  data: AppData,
  options: { horizonDays?: 1 | 3 | 7; limit?: number; leagueId?: string; tier?: number; now?: number } = {},
): EnrichedFixture[] {
  const { horizonDays = 3, limit = 10, leagueId, tier = 0, now = Date.now() } = options;
  const candidates = queryFixtures(data, {
    range: horizonDays <= 3 ? "3d" : "7d",
    status: "UPCOMING",
    leagueId,
    tier,
    withPrediction: true,
    now,
  });

  return candidates
    .filter((item) => item.prediction && item.prediction.headline && !item.prediction.noStrongEdge)
    .sort((a, b) => {
      const edge = (x: EnrichedFixture) => x.prediction?.headline?.edgeScore ?? 0;
      return edge(b) - edge(a) || (b.prediction?.matchConfidence ?? 0) - (a.prediction?.matchConfidence ?? 0);
    })
    .slice(0, limit);
}

/** Compact counts for dashboards and API responses. */
export function summarizeFixtures(data: AppData, now = Date.now()) {
  const today = queryFixtures(data, { range: "today", now });
  return {
    total: data.fixtures.length,
    today: today.length,
    upcoming: queryFixtures(data, { status: "UPCOMING", now }).length,
    live: queryFixtures(data, { status: "LIVE", now }).length,
    finished: queryFixtures(data, { range: "finished", now }).length,
    todayAnalyzed: today.filter((f) => (f.prediction?.markets.length ?? 0) > 0).length,
    todayNoEdge: today.filter((f) => !f.prediction || f.prediction.noStrongEdge).length,
    timezone: displayTz(),
  };
}
