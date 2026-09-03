import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyKickoffLock, assertPreMatchIntegrity, buildAppData, getAppData, resetAppDataCache,
} from "@/lib/service";
import { ProviderConfigError, ProviderError } from "@/lib/providers/types";
import { NOW, fakeProvider, makeAppData, makeFixture, makePrediction } from "./helpers";

describe("applyKickoffLock — predictions lock exactly at kickoff", () => {
  const kickoff = "2026-09-03T15:00:00.000Z";

  function appData(kickoffAt: string) {
    const fixtures = [makeFixture({ id: "f1", kickoff: kickoffAt })];
    const predictions = new Map([["f1", makePrediction("f1", { generatedAt: "2026-09-03T07:00:00.000Z", lockedAt: null })]]);
    return makeAppData({ fixtures, predictions });
  }

  it("leaves a pre-match snapshot unlocked", () => {
    const data = applyKickoffLock(appData(kickoff), NOW); // 12:00Z, kickoff 15:00Z
    expect(data.predictions.get("f1")!.lockedAt).toBeNull();
    expect(data.fixtures[0].status).toBe("UPCOMING");
  });

  it("locks at kickoff, using the kickoff timestamp itself", () => {
    const data = applyKickoffLock(appData(kickoff), Date.parse(kickoff) + 1000);
    expect(data.predictions.get("f1")!.lockedAt).toBe(kickoff);
    expect(data.fixtures[0].status).toBe("LIVE");
  });

  it("marks the fixture FINISHED two hours after kickoff", () => {
    const data = applyKickoffLock(appData(kickoff), Date.parse(kickoff) + 3 * 3600000);
    expect(data.fixtures[0].status).toBe("FINISHED");
    expect(data.predictions.get("f1")!.lockedAt).toBe(kickoff);
  });

  it("unlocks again if the clock is moved back before kickoff", () => {
    const data = applyKickoffLock(appData(kickoff), Date.parse(kickoff) + 1000);
    expect(data.predictions.get("f1")!.lockedAt).toBe(kickoff);
    applyKickoffLock(data, NOW);
    expect(data.predictions.get("f1")!.lockedAt).toBeNull();
  });

  it("never overwrites a FINISHED status reported by the provider", () => {
    const fixtures = [makeFixture({
      id: "f1", kickoff: "2026-09-03T08:00:00.000Z", status: "FINISHED",
      result: { hg: 2, ag: 1, hg1: 1, ag1: 0, corners: 7, cards: 2 },
    })];
    const data = applyKickoffLock(makeAppData({ fixtures }), NOW);
    expect(data.fixtures[0].status).toBe("FINISHED");
  });
});

describe("assertPreMatchIntegrity — no in-play or post-match leakage", () => {
  const kickoff = "2026-09-03T15:00:00.000Z";
  const fixtures = [makeFixture({ id: "f1", kickoff })];

  it("accepts a snapshot generated before kickoff", () => {
    const predictions = new Map([["f1", makePrediction("f1", { generatedAt: "2026-09-03T07:00:00.000Z" })]]);
    expect(() => assertPreMatchIntegrity(fixtures, predictions)).not.toThrow();
  });

  it("throws when a snapshot is generated at or after kickoff", () => {
    for (const generatedAt of [kickoff, "2026-09-03T16:00:00.000Z"]) {
      const predictions = new Map([["f1", makePrediction("f1", { generatedAt })]]);
      expect(() => assertPreMatchIntegrity(fixtures, predictions), generatedAt)
        .toThrow(/Pre-match integrity violation/);
    }
  });
});

describe("buildAppData — strict live integrity, zero silent mocking", () => {
  it("passes the provider's mode and id straight through", async () => {
    const data = await buildAppData(fakeProvider({ id: "demo", mode: "DEMO" }));
    expect(data.mode).toBe("DEMO");
    expect(data.providerId).toBe("demo");
  });

  it("refuses to serve a DEMO-mode provider under a live provider id", async () => {
    await expect(buildAppData(fakeProvider({ id: "custom", mode: "DEMO" })))
      .rejects.toThrow(/reported mode DEMO/);
  });

  it("throws when a LIVE provider returns no fixtures instead of rendering an empty app", async () => {
    const provider = fakeProvider({ id: "custom", mode: "LIVE", getFixtures: async () => [] });
    await expect(buildAppData(provider)).rejects.toThrow(ProviderError);
    await expect(buildAppData(provider)).rejects.toThrow(/zero usable fixtures/);
  });

  it("propagates a live provider failure verbatim — no demo substitution", async () => {
    const boom = new ProviderError("upstream 503", "custom");
    const provider = fakeProvider({ id: "custom", mode: "LIVE", getFixtures: async () => { throw boom; } });
    await expect(buildAppData(provider)).rejects.toBe(boom);
  });

  it("propagates a network failure from any provider call", async () => {
    const provider = fakeProvider({ id: "football-data", mode: "LIVE", getHistoricalMatches: async () => { throw new TypeError("fetch failed"); } });
    await expect(buildAppData(provider)).rejects.toThrow(/fetch failed/);
  });

  it("normalizes provider kickoffs to UTC and drops unparseable ones", async () => {
    const provider = fakeProvider({
      id: "custom", mode: "LIVE",
      getFixtures: async () => [
        makeFixture({ id: "ok", kickoff: "2026-09-03T18:00:00+01:00" }),
        makeFixture({ id: "bad", kickoff: "nonsense" }),
      ],
    });
    const data = await buildAppData(provider);
    expect(data.fixtures.map((f) => f.id)).toEqual(["ok"]);
    expect(data.fixtures[0].kickoff).toBe("2026-09-03T17:00:00.000Z");
  });

  it("generates every prediction strictly before its kickoff", async () => {
    const provider = fakeProvider({
      id: "custom", mode: "LIVE",
      getFixtures: async () => [
        makeFixture({ id: "past", kickoff: "2026-09-03T08:00:00.000Z", status: "FINISHED", result: { hg: 1, ag: 0, hg1: 0, ag1: 0, corners: 5, cards: 1 } }),
        makeFixture({ id: "future", kickoff: "2026-09-04T18:00:00.000Z" }),
      ],
    });
    const data = await buildAppData(provider);
    for (const fx of data.fixtures) {
      const pred = data.predictions.get(fx.id)!;
      expect(Date.parse(pred.generatedAt)).toBeLessThan(Date.parse(fx.kickoff));
    }
  });
});

describe("getAppData — end-to-end through the registry", () => {
  beforeEach(() => resetAppDataCache());

  it("serves the demo dataset when DATA_PROVIDER=demo", async () => {
    vi.stubEnv("DATA_PROVIDER", "demo");
    const data = await getAppData();
    expect(data.mode).toBe("DEMO");
    expect(data.providerId).toBe("demo");
    expect(data.fixtures.length).toBeGreaterThan(0);
    expect(data.leagues.length).toBeGreaterThan(0);
    for (const fx of data.fixtures) {
      expect(fx.kickoff).toMatch(/Z$/); // normalized to UTC
    }
  });

  it("fails loudly — not silently — when a live provider is unconfigured", async () => {
    vi.stubEnv("DATA_PROVIDER", "api-football");
    vi.stubEnv("APIFOOTBALL_KEY", "");
    await expect(getAppData()).rejects.toThrow(ProviderConfigError);
  });

  it("caches the snapshot within the same hour", async () => {
    vi.stubEnv("DATA_PROVIDER", "demo");
    const first = await getAppData();
    const second = await getAppData();
    expect(second).toBe(first);
  });
});
