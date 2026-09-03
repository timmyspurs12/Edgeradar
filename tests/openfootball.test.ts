import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPENFOOTBALL_DEFAULT_BASE, OPENFOOTBALL_DEFAULT_LEAGUES, openFootballProvider,
  openfootballLeagues, openfootballSeasons, openfootballStatus, parseScore,
  resetOpenFootballCache, seasonKeyFor,
} from "@/lib/providers/openfootball";
import { ProviderError } from "@/lib/providers/types";

type Env = Record<string, string>;
const env = (e: Env = {}) => e as unknown as NodeJS.ProcessEnv;

const NOW = Date.parse("2026-09-03T12:00:00.000Z");

function daysFromNow(n: number): string {
  return new Date(NOW + n * 86400000).toISOString().slice(0, 10);
}

/** football.json shape, with dates anchored to NOW so the test never goes stale. */
function file() {
  return {
    name: "English Premier League 2026/27",
    matches: [
      { round: "Matchday 1", date: daysFromNow(-19), time: "20:00", team1: "Liverpool FC", team2: "AFC Bournemouth", score: "4-2", status: "FT" },
      { round: "Matchday 1", date: daysFromNow(-19), time: "15:00", team1: "Arsenal FC", team2: "Leeds United", score: { ht: "1-0", ft: "3-1" }, status: "FT" },
      { round: "Matchday 2", date: daysFromNow(2), time: "17:30", team1: "Chelsea FC", team2: "Everton FC", status: "NS" },
      { round: "Matchday 2", date: daysFromNow(3), team1: "Fulham FC", team2: "Newcastle United" }, // no time published
      { round: "Matchday 1", date: daysFromNow(-18), time: "14:00", team1: "Everton FC", team2: "Chelsea FC", status: "POSTP." },
    ],
  };
}

function stubFetch(files: Record<string, unknown>, missing = true) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const key = url.replace(`${OPENFOOTBALL_DEFAULT_BASE}/`, "").replace(/https?:\/\/[^/]+\//, "");
    const body = files[key];
    if (body === undefined && missing) {
      return new Response("not found", { status: 404, statusText: "Not Found" });
    }
    return new Response(JSON.stringify(body ?? {}), { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

beforeEach(() => {
  resetOpenFootballCache();
  vi.stubGlobal("fetch", stubFetch({ "2026-27/en.1.json": file() }));
});

describe("parseScore", () => {
  it("parses a plain full-time score", () => {
    expect(parseScore("4-2")).toEqual({ hg: 4, ag: 2, hg1: null, ag1: null });
    expect(parseScore("0 : 0")).toEqual({ hg: 0, ag: 0, hg1: null, ag1: null });
  });

  it("parses an inline half-time score", () => {
    expect(parseScore("4-2 (1-0)")).toEqual({ hg: 4, ag: 2, hg1: 1, ag1: 0 });
  });

  it("parses the { ht, ft } object form", () => {
    expect(parseScore({ ht: "1-0", ft: "3-1" })).toEqual({ hg: 3, ag: 1, hg1: 1, ag1: 0 });
    expect(parseScore({ ft: "2-2" })).toEqual({ hg: 2, ag: 2, hg1: null, ag1: null });
  });

  it("returns null rather than inventing a score", () => {
    expect(parseScore(null)).toBeNull();
    expect(parseScore(undefined)).toBeNull();
    expect(parseScore("TBD")).toBeNull();
    expect(parseScore({})).toBeNull();
  });
});

describe("openfootballStatus", () => {
  it("trusts an explicit status", () => {
    expect(openfootballStatus("FT", false, NOW + 1000, NOW)).toBe("FINISHED");
    expect(openfootballStatus("AET", false, NOW, NOW)).toBe("FINISHED");
    expect(openfootballStatus("LIVE", false, NOW, NOW)).toBe("LIVE");
    expect(openfootballStatus("HT", false, NOW, NOW)).toBe("LIVE");
  });

  it("drops abandoned matches", () => {
    for (const s of ["POSTP.", "CAN.", "ABAND.", "SUSP.", "AWD.", "TBD"]) {
      expect(openfootballStatus(s, false, NOW, NOW), s).toBeNull();
    }
  });

  it("infers status from the score and the clock when no status is published", () => {
    expect(openfootballStatus(undefined, true, NOW, NOW)).toBe("FINISHED");   // has a score
    expect(openfootballStatus(undefined, false, NOW + 3600000, NOW)).toBe("UPCOMING");
    expect(openfootballStatus(undefined, false, NOW - 60000, NOW)).toBe("LIVE");       // just started
    expect(openfootballStatus("NS", false, NOW - 4 * 3600000, NOW)).toBe("FINISHED");  // long past, no score
  });
});

describe("season configuration", () => {
  it("derives the current season from the July boundary", () => {
    expect(seasonKeyFor(Date.parse("2026-09-03T00:00:00Z"))).toBe("2026-27");
    expect(seasonKeyFor(Date.parse("2026-03-15T00:00:00Z"))).toBe("2025-26");
    expect(seasonKeyFor(Date.parse("2026-07-01T00:00:00Z"))).toBe("2026-27");
    expect(seasonKeyFor(Date.parse("2026-06-30T00:00:00Z"))).toBe("2025-26");
  });

  it("defaults to the current and previous season", () => {
    expect(openfootballSeasons({ OPENFOOTBALL_SEASONS: "2024-25, 2023-24" } as unknown as NodeJS.ProcessEnv))
      .toEqual(["2024-25", "2023-24"]);
    const auto = openfootballSeasons(env({}));
    expect(auto).toHaveLength(2);
    expect(auto[0]).toMatch(/^\d{4}-\d{2}$/);
  });

  it("defaults to the five major leagues", () => {
    expect(openfootballLeagues(env({}))).toEqual(OPENFOOTBALL_DEFAULT_LEAGUES);
    expect(openfootballLeagues(env({ OPENFOOTBALL_LEAGUES: "en.1, nl.1" }))).toEqual(["en.1", "nl.1"]);
  });
});

describe("openFootballProvider", () => {
  it("is registered as a keyless LIVE provider", () => {
    expect(openFootballProvider.id).toBe("openfootball");
    expect(openFootballProvider.mode).toBe("LIVE");
  });

  it("maps a dataset file onto leagues, teams, fixtures and history", async () => {
    const fixtures = await openFootballProvider.getFixtures();
    // 5 matches minus the POSTPONED one.
    expect(fixtures).toHaveLength(4);
    expect((await openFootballProvider.getLeagues())).toHaveLength(1);
    expect((await openFootballProvider.getTeams()).length).toBeGreaterThan(0);
    expect((await openFootballProvider.getHistoricalMatches())).toHaveLength(2);
  });

  it("converts published times from OPENFOOTBALL_TZ to UTC", async () => {
    const date = daysFromNow(2);
    resetOpenFootballCache();
    vi.stubEnv("OPENFOOTBALL_SEASONS", "2026-27");
    vi.stubEnv("OPENFOOTBALL_LEAGUES", "en.1");
    const utc = await openFootballProvider.getFixtures();
    const asUtc = utc.find((f) => f.homeId.includes("chelsea"))!;
    expect(asUtc.kickoff).toBe(`${date}T17:30:00.000Z`);

    resetOpenFootballCache();
    vi.stubEnv("OPENFOOTBALL_TZ", "Europe/London"); // BST in September → UTC+1
    const bst = await openFootballProvider.getFixtures();
    const asLondon = bst.find((f) => f.homeId.includes("chelsea"))!;
    expect(asLondon.kickoff).toBe(`${date}T16:30:00.000Z`);
  });

  it("carries half-time scores through when published, null when not", async () => {
    const hist = await openFootballProvider.getHistoricalMatches();
    const withHt = hist.find((h) => h.hg === 3 && h.ag === 1)!;
    expect(withHt.hg1).toBe(1);
    expect(withHt.ag1).toBe(0);
    const withoutHt = hist.find((h) => h.hg === 4 && h.ag === 2)!;
    expect(withoutHt.hg1).toBeNull();
    expect(withoutHt.ag1).toBeNull();
    // The dataset has no corners or cards — never estimated.
    expect(hist.every((h) => h.corners === null && h.cards === null)).toBe(true);
  });

  it("counts matches published without a time and reports them on /sources", async () => {
    const sources = await openFootballProvider.getSources();
    const tzNote = sources.find((s) => s.id === "openfootball-tz")!;
    expect(tzNote.notes).toMatch(/no timezone/);
    expect(tzNote.notes).toMatch(/1 match\(es\) had no time/);
  });

  it("never fabricates odds or injuries", async () => {
    expect(await openFootballProvider.getOdds("any", "O1.5")).toBeNull();
    expect(await openFootballProvider.getInjuryNote("any")).toBeNull();
    const sources = await openFootballProvider.getSources();
    expect(sources.find((s) => s.id === "openfootball-odds")!.status).toBe("STALE");
  });

  it("throws a ProviderError when no dataset file is reachable", async () => {
    resetOpenFootballCache();
    vi.stubGlobal("fetch", stubFetch({})); // everything 404s
    await expect(openFootballProvider.getFixtures()).rejects.toThrow(ProviderError);
    await expect(openFootballProvider.getFixtures()).rejects.toThrow(/returned no datasets/);
  });

  it("survives a network failure without inventing data", async () => {
    resetOpenFootballCache();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(openFootballProvider.getFixtures()).rejects.toThrow(/returned no datasets/);
  });

  it("caches within the TTL", async () => {
    const fetcher = stubFetch({ "2026-27/en.1.json": file() });
    vi.stubGlobal("fetch", fetcher);
    resetOpenFootballCache();
    await openFootballProvider.getFixtures();
    const afterFirst = fetcher.mock.calls.length;
    await openFootballProvider.getFixtures();
    expect(fetcher.mock.calls.length).toBe(afterFirst);
  });
});
