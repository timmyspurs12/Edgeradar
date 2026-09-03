import { beforeEach, describe, expect, it } from "vitest";
import {
  fixtureWindows, getFinishedFixtures, getLiveFixtures, getTopEdges,
  getUpcomingFixtures, queryFixtures, summarizeFixtures,
} from "@/lib/repository";
import type { AppData } from "@/lib/service";
import {
  NOW, makeAppData, makeFixture, makeLeague, makePrediction, makeTeam,
} from "./helpers";

/**
 * Fixture layout (all kickoffs UTC; Africa/Lagos = UTC+1, no DST):
 *
 *   finished-yesterday  2026-09-02T18:00Z  FINISHED   (previous WAT day)
 *   finished-today      2026-09-03T08:00Z  FINISHED   (today WAT)
 *   live-3h             2026-09-03T09:00Z  LIVE       (today WAT, 3h in play)
 *   late-today          2026-09-03T22:30Z  UPCOMING   (23:30 WAT — still today)
 *   after-midnight-wat  2026-09-03T23:30Z  UPCOMING   (00:30 WAT — tomorrow)
 *   in-3d               2026-09-05T18:00Z  UPCOMING
 *   in-7d-only          2026-09-08T18:00Z  UPCOMING
 *   tier2               2026-09-03T18:00Z  UPCOMING   (lg2, PUBLIC_COVERAGE_VERIFIED)
 *   naive-kickoff       "2026-09-04T18:00" UPCOMING   (no zone → read as UTC)
 *   orphan              2026-09-03T18:00Z  UPCOMING   (unknown team → dropped)
 */
let data: AppData;

beforeEach(() => {
  const leagues = [
    makeLeague({ id: "lg1", name: "Premier Test", country: "Nigeria", tier: 1, broadcastStatus: "BROADCAST_VERIFIED" }),
    makeLeague({ id: "lg2", name: "Second Test", country: "Ghana", tier: 2, broadcastStatus: "PUBLIC_COVERAGE_VERIFIED" }),
  ];
  const teams = [makeTeam("h1"), makeTeam("a1"), makeTeam("h2"), makeTeam("a2")];
  const fixtures = [
    makeFixture({ id: "finished-yesterday", kickoff: "2026-09-02T18:00:00.000Z", status: "FINISHED", result: { hg: 2, ag: 0, hg1: 1, ag1: 0, corners: 8, cards: 3 } }),
    makeFixture({ id: "finished-today", kickoff: "2026-09-03T08:00:00.000Z", status: "FINISHED", result: { hg: 1, ag: 1, hg1: 0, ag1: 0, corners: 9, cards: 2 } }),
    makeFixture({ id: "live-3h", kickoff: "2026-09-03T09:00:00.000Z", status: "LIVE" }),
    makeFixture({ id: "late-today", kickoff: "2026-09-03T22:30:00.000Z", status: "UPCOMING" }),
    makeFixture({ id: "after-midnight-wat", kickoff: "2026-09-03T23:30:00.000Z", status: "UPCOMING" }),
    makeFixture({ id: "in-3d", kickoff: "2026-09-05T18:00:00.000Z", status: "UPCOMING" }),
    makeFixture({ id: "in-7d-only", kickoff: "2026-09-08T18:00:00.000Z", status: "UPCOMING" }),
    makeFixture({ id: "tier2", leagueId: "lg2", kickoff: "2026-09-03T18:00:00.000Z", status: "UPCOMING" }),
    makeFixture({ id: "naive-kickoff", kickoff: "2026-09-04T18:00:00", status: "UPCOMING" }),
    makeFixture({ id: "orphan", homeId: "ghost", kickoff: "2026-09-03T18:00:00.000Z", status: "UPCOMING" }),
  ];
  const predictions = new Map([
    ["late-today", makePrediction("late-today", { matchConfidence: 91 })],
    ["in-3d", makePrediction("in-3d", { matchConfidence: 72 })],
    ["live-3h", makePrediction("live-3h", { matchConfidence: 88, lockedAt: "2026-09-03T09:00:00.000Z" })],
  ]);
  data = makeAppData({ leagues, teams, fixtures, predictions });
});

const ids = (rows: { fixture: { id: string } }[]) => rows.map((r) => r.fixture.id);

describe("queryFixtures — referential integrity", () => {
  it("drops fixtures that point at an unknown team", () => {
    expect(ids(queryFixtures(data, { now: NOW }))).not.toContain("orphan");
  });

  it("returns everything else, sorted by kickoff ascending", () => {
    const rows = queryFixtures(data, { now: NOW });
    expect(rows).toHaveLength(9);
    const times = rows.map((r) => r.kickoffTime);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe("queryFixtures — UTC normalization", () => {
  it("normalizes every kickoff to a canonical UTC ISO string", () => {
    const rows = queryFixtures(data, { now: NOW });
    for (const r of rows) {
      expect(r.kickoffIso).toMatch(/T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(Date.parse(r.kickoffIso)).toBe(r.kickoffTime);
    }
  });

  it("reads a naive kickoff as UTC rather than the server's local zone", () => {
    const row = queryFixtures(data, { now: NOW }).find((r) => r.fixture.id === "naive-kickoff")!;
    expect(row.kickoffIso).toBe("2026-09-04T18:00:00.000Z");
    expect(row.dayKey).toBe("2026-09-04"); // 19:00 WAT, same calendar day
  });
});

describe("queryFixtures — Today / Tomorrow in Africa/Lagos, expressed as UTC windows", () => {
  it("exposes the day windows it filters on", () => {
    const w = fixtureWindows("Africa/Lagos", NOW);
    expect(w.today.dayKey).toBe("2026-09-03");
    expect(w.today.startUtc).toBe(Date.parse("2026-09-02T23:00:00.000Z"));
    expect(w.tomorrow.dayKey).toBe("2026-09-04");
    expect(w.threeDayEndUtc).toBe(Date.parse("2026-09-05T23:00:00.000Z"));
    expect(w.sevenDayEndUtc).toBe(Date.parse("2026-09-09T23:00:00.000Z"));
  });

  it('keeps a 23:30 WAT kickoff in "today"', () => {
    expect(ids(queryFixtures(data, { range: "today", now: NOW }))).toContain("late-today");
  });

  it('moves a 00:30 WAT kickoff into "tomorrow", not "today"', () => {
    expect(ids(queryFixtures(data, { range: "today", now: NOW }))).not.toContain("after-midnight-wat");
    expect(ids(queryFixtures(data, { range: "tomorrow", now: NOW }))).toContain("after-midnight-wat");
    // A naive UTC-day filter would have put it in today — that is the bug.
    expect(ids(queryFixtures(data, { range: "today", timezone: "UTC", now: NOW }))).toContain("after-midnight-wat");
  });

  it("includes naive-kickoff in tomorrow", () => {
    expect(ids(queryFixtures(data, { range: "tomorrow", now: NOW }))).toContain("naive-kickoff");
  });

  it("honours an explicit timezone override", () => {
    // In UTC the WAT day boundary shifts, so late-today (22:30Z) and
    // after-midnight-wat (23:30Z) both fall on 2026-09-03.
    const todayUtc = ids(queryFixtures(data, { range: "today", timezone: "UTC", now: NOW }));
    expect(todayUtc).toContain("late-today");
    expect(todayUtc).toContain("after-midnight-wat");
  });
});

describe("queryFixtures — status handling", () => {
  it("returns every status when no filter is given", () => {
    const rows = queryFixtures(data, { range: "today", now: NOW });
    expect(new Set(rows.map((r) => r.fixture.status))).toEqual(new Set(["UPCOMING", "LIVE", "FINISHED"]));
  });

  it('filters exactly on UPCOMING / LIVE / FINISHED', () => {
    expect(queryFixtures(data, { status: "UPCOMING", now: NOW }).every((r) => r.fixture.status === "UPCOMING")).toBe(true);
    expect(ids(queryFixtures(data, { status: "LIVE", now: NOW }))).toEqual(["live-3h"]);
    expect(ids(queryFixtures(data, { status: "FINISHED", now: NOW }))).toEqual(["finished-yesterday", "finished-today"]);
  });

  it('treats "ALL" the same as no filter', () => {
    expect(queryFixtures(data, { status: "ALL", now: NOW })).toHaveLength(queryFixtures(data, { now: NOW }).length);
  });

  it("never drops an in-play fixture from a forward-looking range", () => {
    // live-3h kicked off 3 hours before the clock — the old 1-hour look-back
    // rule silently hid matches that were still being played.
    for (const range of ["today", "3d", "7d", "all"] as const) {
      expect(ids(queryFixtures(data, { range, status: "LIVE", now: NOW })), `range=${range}`).toContain("live-3h");
    }
  });

  it("keeps today's finished matches inside the today window", () => {
    expect(ids(queryFixtures(data, { range: "today", now: NOW }))).toContain("finished-today");
    expect(ids(queryFixtures(data, { range: "today", now: NOW }))).not.toContain("finished-yesterday");
  });

  it("excludes yesterday's finished matches from 3d/7d but exposes them via range=finished", () => {
    expect(ids(queryFixtures(data, { range: "3d", now: NOW }))).not.toContain("finished-yesterday");
    expect(ids(queryFixtures(data, { range: "7d", now: NOW }))).not.toContain("finished-yesterday");
    expect(ids(queryFixtures(data, { range: "finished", now: NOW }))).toContain("finished-yesterday");
  });

  it("combines status with range without one overriding the other", () => {
    // Sorted by kickoff: tier2 (18:00Z) precedes late-today (22:30Z).
    expect(ids(queryFixtures(data, { range: "today", status: "UPCOMING", now: NOW })))
      .toEqual(["tier2", "late-today"]);
  });
});

describe("queryFixtures — 3d / 7d windows", () => {
  it("3d covers today through the end of the WAT day 2 days out", () => {
    const list = ids(queryFixtures(data, { range: "3d", now: NOW }));
    expect(list).toContain("in-3d");
    expect(list).not.toContain("in-7d-only");
  });

  it("7d covers today through the end of the WAT day 6 days out", () => {
    const list = ids(queryFixtures(data, { range: "7d", now: NOW }));
    expect(list).toContain("in-3d");
    expect(list).toContain("in-7d-only");
  });
});

describe("queryFixtures — attribute filters", () => {
  it("filters by league", () => {
    expect(ids(queryFixtures(data, { leagueId: "lg2", now: NOW }))).toEqual(["tier2"]);
  });

  it("filters by tier", () => {
    expect(ids(queryFixtures(data, { tier: 2, now: NOW }))).toEqual(["tier2"]);
    expect(ids(queryFixtures(data, { tier: 1, now: NOW }))).not.toContain("tier2");
  });

  it("filters by broadcast verification", () => {
    expect(ids(queryFixtures(data, { cast: "verified", now: NOW }))).not.toContain("tier2");
  });

  it("filters by minimum match confidence", () => {
    const rows = queryFixtures(data, { minConfidence: 85, now: NOW });
    expect(ids(rows)).toEqual(["live-3h", "late-today"]);
  });

  it("searches team, league and country names case-insensitively", () => {
    expect(ids(queryFixtures(data, { searchQuery: "SECOND TEST", now: NOW }))).toEqual(["tier2"]);
    expect(ids(queryFixtures(data, { searchQuery: "ghana", now: NOW }))).toEqual(["tier2"]);
    expect(ids(queryFixtures(data, { searchQuery: "no-such-thing", now: NOW }))).toEqual([]);
  });

  it("can require a headline prediction", () => {
    expect(ids(queryFixtures(data, { withPrediction: true, now: NOW })))
      .toEqual(["live-3h", "late-today", "in-3d"]);
  });
});

describe("queryFixtures — lock state", () => {
  it("marks fixtures whose kickoff has passed as locked and not pre-match", () => {
    const rows = queryFixtures(data, { now: NOW });
    for (const r of rows) {
      expect(r.isLocked).toBe(r.kickoffTime <= NOW);
      expect(r.isPreMatch).toBe(r.kickoffTime > NOW);
      expect(r.isLocked).not.toBe(r.isPreMatch);
    }
  });
});

describe("named queries", () => {
  it("getLiveFixtures returns only in-play matches from today", () => {
    expect(ids(getLiveFixtures(data, NOW))).toEqual(["live-3h"]);
  });

  it("getUpcomingFixtures excludes live and finished", () => {
    const list = ids(getUpcomingFixtures(data, { now: NOW }));
    expect(list).not.toContain("live-3h");
    expect(list).not.toContain("finished-today");
    expect(list).toContain("late-today");
  });

  it("getFinishedFixtures returns both finished matches", () => {
    expect(ids(getFinishedFixtures(data))).toEqual(["finished-yesterday", "finished-today"]);
  });

  it("getTopEdges ranks pre-match edges and skips locked fixtures", () => {
    const rows = getTopEdges(data, { horizonDays: 3, limit: 10, now: NOW });
    // live-3h carries the second-highest confidence but has kicked off, so it
    // is excluded — a locked snapshot is never re-ranked.
    expect(ids(rows)).not.toContain("live-3h");
    expect(ids(rows)).toEqual(["late-today", "in-3d"]);
  });

  it("getTopEdges widens to the 7-day window on request", () => {
    const rows = getTopEdges(data, { horizonDays: 7, limit: 10, now: NOW });
    expect(ids(rows)).toContain("in-3d");
  });

  it("summarizeFixtures reports predictable counts", () => {
    const s = summarizeFixtures(data, NOW);
    expect(s.total).toBe(10);
    expect(s.today).toBe(4);       // finished-today, live-3h, late-today, tier2
    expect(s.live).toBe(1);
    expect(s.finished).toBe(2);
    expect(s.todayAnalyzed).toBe(2); // late-today + live-3h have predictions
    expect(s.todayNoEdge).toBe(2);
    expect(s.timezone).toBe("Africa/Lagos");
  });
});
