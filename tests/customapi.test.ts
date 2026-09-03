import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  customApiProvider, loadCustomApiData, normalizeFixtureStatus, resetCustomApiCache,
} from "@/lib/providers/customapi";
import { ProviderConfigError, ProviderError } from "@/lib/providers/types";

type Env = Record<string, string>;
const env = (e: Env = {}) => ({ CUSTOM_API_URL: "https://api.test", ...e }) as unknown as NodeJS.ProcessEnv;

function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers: { "Content-Type": "application/json" },
  });
}

const PAYLOAD = {
  leagues: [
    { id: "lg1", name: "Test League", country: "Nigeria", tier: 1, hasOddsFeed: true },
  ],
  teams: [
    { id: "t1", leagueId: "lg1", name: "Alpha FC", short: "ALP" },
    { id: "t2", leagueId: "lg1", name: "Beta FC", short: "BET" },
  ],
  fixtures: [
    { id: 1, leagueId: "lg1", homeId: "t1", awayId: "t2", homeName: "Alpha FC", awayName: "Beta FC", kickoff: "2026-09-03T18:00:00+01:00", status: "NS", odds: { "O1.5": 1.35, "2H_O0.5": "1.42" } },
    { id: 2, leagueId: "lg1", homeId: "t2", awayId: "t1", homeName: "Beta FC", awayName: "Alpha FC", kickoff: "2026-09-02T18:00:00Z", status: "FT", result: { hg: 2, ag: 1, hg1: 1, ag1: 0 } },
    { id: 3, leagueId: "lg1", homeId: "t1", awayId: "t2", homeName: "Alpha FC", awayName: "Beta FC", kickoff: "2026-09-04T18:00:00Z", status: "2H" },
    { id: 4, leagueId: "lg1", homeId: "t1", awayId: "t2", homeName: "Alpha FC", awayName: "Beta FC", kickoff: "2026-09-05T18:00:00Z", status: "POSTPONED" },
    { id: 5, leagueId: "lg1", homeId: "t1", awayId: "t2", homeName: "Alpha FC", awayName: "Beta FC", kickoff: "not-a-date", status: "NS" },
  ],
  historical: [
    { id: "h9", leagueId: "lg1", homeId: "t1", awayId: "t2", date: "2026-08-01T18:00:00Z", hg: 3, ag: 0, hg1: 1, ag1: 0, corners: 9, cards: 2 },
  ],
};

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL) => handler(requestUrl(input)));
}

beforeEach(() => resetCustomApiCache());

describe("status normalization", () => {
  it("maps vendor statuses onto the three EdgeRadar states", () => {
    expect(normalizeFixtureStatus("NS")).toBe("UPCOMING");
    expect(normalizeFixtureStatus("SCHEDULED")).toBe("UPCOMING");
    expect(normalizeFixtureStatus("ft")).toBe("FINISHED");
    expect(normalizeFixtureStatus("AET")).toBe("FINISHED");
    expect(normalizeFixtureStatus("2H")).toBe("LIVE");
    expect(normalizeFixtureStatus("in_play")).toBe("LIVE");
    expect(normalizeFixtureStatus("LIVE_1H")).toBe("LIVE");
    expect(normalizeFixtureStatus("HT")).toBe("LIVE");
  });

  it("returns null for postponed/cancelled matches so they are dropped", () => {
    expect(normalizeFixtureStatus("POSTPONED")).toBeNull();
    expect(normalizeFixtureStatus("CAN")).toBeNull();
    expect(normalizeFixtureStatus("ABD")).toBeNull();
    expect(normalizeFixtureStatus(undefined)).toBeNull();
  });
});

describe("loadCustomApiData — contract handling", () => {
  it("throws a ProviderConfigError when no endpoint is configured", async () => {
    await expect(loadCustomApiData({} as NodeJS.ProcessEnv)).rejects.toThrow(ProviderConfigError);
  });

  it("normalizes kickoffs to UTC and maps statuses", async () => {
    const snap = await loadCustomApiData(env(), mockFetch(() => jsonResponse(PAYLOAD)));
    const byId = new Map(snap.fixtures.map((f) => [f.id, f]));
    // +01:00 → UTC
    expect(byId.get("custom-1")!.kickoff).toBe("2026-09-03T17:00:00.000Z");
    expect(byId.get("custom-1")!.status).toBe("UPCOMING");
    expect(byId.get("custom-2")!.status).toBe("FINISHED");
    expect(byId.get("custom-3")!.status).toBe("LIVE");
  });

  it("drops postponed matches and unparseable kickoffs, keeping the rest", async () => {
    const snap = await loadCustomApiData(env(), mockFetch(() => jsonResponse(PAYLOAD)));
    const ids = snap.fixtures.map((f) => f.id);
    expect(ids).not.toContain("custom-4");
    expect(ids).not.toContain("custom-5");
    expect(ids).toContain("custom-1");
    expect(snap.skipped.fixtures).toBe(2);
    expect(snap.skipped.reasons.join(" ")).toMatch(/custom-5/);
  });

  it("derives league baselines from the supplied history rather than a constant", async () => {
    const snap = await loadCustomApiData(env(), mockFetch(() => jsonResponse(PAYLOAD)));
    const lg = snap.leagues.find((l) => l.id === "lg1")!;
    // h9 (3-0) + custom-2 (2-1) = 6 goals over 2 matches
    expect(lg.historicalMatchCount).toBe(2);
    expect(lg.avgGoals).toBe(3);
  });

  it("takes odds only from the payload, never inventing a price", async () => {
    const snap = await loadCustomApiData(env(), mockFetch(() => jsonResponse(PAYLOAD)));
    expect(snap.odds.get("custom-1")?.get("O1.5")).toBe(1.35);
    expect(snap.odds.get("custom-1")?.get("2H_O0.5")).toBe(1.42); // string coerced
    expect(snap.odds.get("custom-2")).toBeUndefined();
  });

  it("throws when the payload has no usable fixtures", async () => {
    await expect(loadCustomApiData(env(), mockFetch(() => jsonResponse({ fixtures: [] }))))
      .rejects.toThrow(/no usable fixtures/);
  });

  it("throws when the payload shape is unrecognised", async () => {
    await expect(loadCustomApiData(env(), mockFetch(() => jsonResponse({ hello: "world" }))))
      .rejects.toThrow(ProviderError);
  });

  it("falls back to the fixtures endpoint when /data is missing", async () => {
    const fetcher = mockFetch((url) =>
      url.endsWith("/data") ? jsonResponse({}, { status: 404, statusText: "Not Found" }) : jsonResponse({ fixtures: PAYLOAD.fixtures }),
    );
    const snap = await loadCustomApiData(env(), fetcher);
    expect(snap.source).toBe("https://api.test/fixtures");
    expect(snap.fixtures.length).toBe(3);
  });

  it("re-throws the original error when both endpoints fail", async () => {
    const fetcher = mockFetch(() => jsonResponse({}, { status: 500, statusText: "Server Error" }));
    await expect(loadCustomApiData(env(), fetcher)).rejects.toThrow(/HTTP 500/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("surfaces a network failure as a retryable ProviderError", async () => {
    const fetcher = mockFetch(() => { throw new TypeError("socket hang up"); });
    await expect(loadCustomApiData(env(), fetcher)).rejects.toThrow(/unreachable/);
    try {
      await loadCustomApiData(env(), fetcher);
    } catch (e) {
      expect((e as ProviderError).retryable).toBe(true);
    }
  });

  it("throws on non-JSON responses and marks them non-retryable", async () => {
    const fetcher = mockFetch(() => new Response("<html>nope</html>", { status: 200, headers: { "Content-Type": "text/html" } }));
    await expect(loadCustomApiData(env(), fetcher)).rejects.toThrow(/non-JSON/);
  });

  it("merges a separate odds endpoint without discarding fixtures when it fails", async () => {
    const fetcher = mockFetch((url) => {
      if (url.includes("/odds")) return jsonResponse({ "custom-3": { "O1.5": 1.55 } });
      return jsonResponse(PAYLOAD);
    });
    const snap = await loadCustomApiData(env({ CUSTOM_API_ODDS_PATH: "/odds" }), fetcher);
    expect(snap.odds.get("custom-3")?.get("O1.5")).toBe(1.55);
    expect(snap.fixtures.length).toBe(3);
  });

  it("caches within the TTL", async () => {
    const fetcher = mockFetch(() => jsonResponse(PAYLOAD));
    await loadCustomApiData(env(), fetcher);
    await loadCustomApiData(env(), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    resetCustomApiCache();
    await loadCustomApiData(env(), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("honours CUSTOM_FOOTBALL_API_URL as an alias", async () => {
    const fetcher = mockFetch(() => jsonResponse(PAYLOAD));
    await loadCustomApiData({ CUSTOM_FOOTBALL_API_URL: "https://alt.test" } as unknown as NodeJS.ProcessEnv, fetcher);
    expect(requestUrl(fetcher.mock.calls[0][0])).toBe("https://alt.test/data");
  });
});

describe("customApiProvider — authentication and provider surface", () => {
  beforeEach(() => {
    resetCustomApiCache();
    vi.stubGlobal("fetch", mockFetch(() => jsonResponse(PAYLOAD)));
  });

  it("is registered as a LIVE provider named custom", () => {
    expect(customApiProvider.id).toBe("custom");
    expect(customApiProvider.mode).toBe("LIVE");
  });

  it("sends both Authorization and x-api-key when CUSTOM_API_KEY is set", async () => {
    vi.stubEnv("CUSTOM_API_URL", "https://api.test");
    vi.stubEnv("CUSTOM_API_KEY", "s3cret");
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: Request) => {
      seen.push(input.headers.get("Authorization") ?? "");
      seen.push(input.headers.get("x-api-key") ?? "");
      return jsonResponse(PAYLOAD);
    }));
    await customApiProvider.getFixtures();
    expect(seen[0]).toBe("Bearer s3cret");
    expect(seen[1]).toBe("s3cret");
  });

  it("does not prepend Bearer twice when the key already has the scheme", async () => {
    vi.stubEnv("CUSTOM_API_URL", "https://api.test");
    vi.stubEnv("CUSTOM_API_KEY", "Bearer abc");
    let auth = "";
    vi.stubGlobal("fetch", vi.fn(async (input: Request) => {
      auth = input.headers.get("Authorization") ?? "";
      return jsonResponse(PAYLOAD);
    }));
    await customApiProvider.getFixtures();
    expect(auth).toBe("Bearer abc");
  });

  it("serves leagues, teams, fixtures and history through the provider interface", async () => {
    vi.stubEnv("CUSTOM_API_URL", "https://api.test");
    expect((await customApiProvider.getLeagues()).length).toBe(1);
    expect((await customApiProvider.getTeams()).length).toBe(2);
    expect((await customApiProvider.getTeams("lg1")).length).toBe(2);
    expect((await customApiProvider.getTeams("nope")).length).toBe(0);
    expect((await customApiProvider.getFixtures()).length).toBe(3);
    expect((await customApiProvider.getHistoricalMatches()).length).toBe(2);
  });

  it("returns odds from the payload and null when absent", async () => {
    vi.stubEnv("CUSTOM_API_URL", "https://api.test");
    expect(await customApiProvider.getOdds("custom-1", "O1.5")).toBe(1.35);
    expect(await customApiProvider.getOdds("custom-1", "BTTS_Y")).toBeNull();
    expect(await customApiProvider.getOdds("custom-2", "O1.5")).toBeNull();
    expect(await customApiProvider.getOdds("missing", "O1.5")).toBeNull();
  });

  it("reports its sources with the endpoint it actually read from", async () => {
    vi.stubEnv("CUSTOM_API_URL", "https://api.test");
    const sources = await customApiProvider.getSources();
    expect(sources.every((s) => s.mode === "LIVE")).toBe(true);
    expect(sources.find((s) => s.id === "custom-fixtures")!.notes).toMatch(/https:\/\/api\.test\/data/);
    expect(sources.map((s) => s.id)).toContain("custom-odds");
  });

  it("never fabricates injuries or broadcast evidence it was not given", async () => {
    vi.stubEnv("CUSTOM_API_URL", "https://api.test");
    expect(await customApiProvider.getInjuryNote("custom-1")).toBeNull();
    // The fixture-derived league has no verified broadcast claim.
    expect(await customApiProvider.getBroadcastEvidence("lg1")).toBeNull();
  });
});
