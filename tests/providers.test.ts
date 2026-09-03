import { describe, expect, it } from "vitest";
import {
  PROVIDER_IDS, getProvider, isProviderConfigured, normalizeProviderName,
  providerStatus, resolveProvider,
} from "@/lib/providers";
import { ProviderConfigError } from "@/lib/providers/types";
import { customApiBaseUrl, customApiKey, assertCustomApiConfigured } from "@/lib/providers/customapi";

type Env = Record<string, string>;
const env = (e: Env = {}) => e as NodeJS.ProcessEnv;

describe("provider switching via DATA_PROVIDER", () => {
  const cases: [string, string][] = [
    ["custom", "custom"],
    ["api-football", "api-football"],
    ["football-data", "football-data"],
    ["openfootball", "openfootball"],
    ["demo", "demo"],
  ];

  it.each(cases)("DATA_PROVIDER=%s selects the %s provider", (value, expectedId) => {
    const e: Env = {
      DATA_PROVIDER: value,
      CUSTOM_API_URL: "https://example.test",
      APIFOOTBALL_KEY: "af-key",
      FOOTBALL_DATA_API_KEY: "fdo-key",
    };
    const resolved = resolveProvider(env(e));
    expect(resolved.id).toBe(expectedId);
    expect(resolved.explicit).toBe(true);
    expect(resolved.provider.id).toBe(expectedId);
    expect(getProvider(env(e)).id).toBe(expectedId);
  });

  it("reports the declared mode of each provider", () => {
    const e = env({ CUSTOM_API_URL: "https://example.test", APIFOOTBALL_KEY: "k", FOOTBALL_DATA_API_KEY: "k" });
    expect(resolveProvider({ ...e, DATA_PROVIDER: "demo" } as NodeJS.ProcessEnv).provider.mode).toBe("DEMO");
    expect(resolveProvider({ ...e, DATA_PROVIDER: "custom" } as NodeJS.ProcessEnv).provider.mode).toBe("LIVE");
    expect(resolveProvider({ ...e, DATA_PROVIDER: "openfootball" } as NodeJS.ProcessEnv).provider.mode).toBe("LIVE");
  });

  it("accepts common aliases and casings", () => {
    expect(normalizeProviderName("CustomAPI")).toBe("custom");
    expect(normalizeProviderName("football_data")).toBe("football-data");
    expect(normalizeProviderName("open-football")).toBe("openfootball");
    expect(normalizeProviderName("  DEMO  ")).toBe("demo");
    expect(normalizeProviderName("sportmonks")).toBeNull();
  });
});

describe("explicit configuration errors — never a silent downgrade", () => {
  it("throws when api-football is requested without APIFOOTBALL_KEY", () => {
    expect(() => getProvider(env({ DATA_PROVIDER: "api-football" }))).toThrow(ProviderConfigError);
    try {
      getProvider(env({ DATA_PROVIDER: "api-football" }));
    } catch (e) {
      const err = e as ProviderConfigError;
      expect(err.missing).toEqual(["APIFOOTBALL_KEY"]);
      expect(err.message).toMatch(/APIFOOTBALL_KEY/);
      expect(err.providerId).toBe("api-football");
      expect(err.retryable).toBe(false);
    }
  });

  it("throws when football-data is requested without FOOTBALL_DATA_API_KEY", () => {
    expect(() => getProvider(env({ DATA_PROVIDER: "football-data" }))).toThrow(/FOOTBALL_DATA_API_KEY/);
  });

  it("throws when custom is requested without an endpoint", () => {
    expect(() => getProvider(env({ DATA_PROVIDER: "custom" }))).toThrow(ProviderConfigError);
    expect(() => getProvider(env({ DATA_PROVIDER: "custom" }))).toThrow(/CUSTOM_API_URL/);
  });

  it("treats a blank API key as missing", () => {
    expect(() => getProvider(env({ DATA_PROVIDER: "api-football", APIFOOTBALL_KEY: "   " })))
      .toThrow(/APIFOOTBALL_KEY/);
  });

  it("does not require a key for openfootball or demo", () => {
    expect(() => getProvider(env({ DATA_PROVIDER: "openfootball" }))).not.toThrow();
    expect(() => getProvider(env({ DATA_PROVIDER: "demo" }))).not.toThrow();
  });

  it("throws a clear error for an unknown provider name", () => {
    expect(() => getProvider(env({ DATA_PROVIDER: "sportmonks" }))).toThrow(/not a registered provider/);
    try {
      getProvider(env({ DATA_PROVIDER: "sportmonks" }));
    } catch (e) {
      expect((e as ProviderConfigError).message).toMatch(/custom, api-football, football-data, openfootball, demo/);
    }
  });
});

describe("auto-detection when DATA_PROVIDER is unset", () => {
  it("prefers the Custom Football API when an endpoint is present", () => {
    const e = env({ CUSTOM_API_URL: "https://example.test", APIFOOTBALL_KEY: "k", FOOTBALL_DATA_API_KEY: "k" });
    const r = resolveProvider(e);
    expect(r.id).toBe("custom");
    expect(r.explicit).toBe(false);
  });

  it("falls back to api-football, then football-data", () => {
    expect(resolveProvider(env({ APIFOOTBALL_KEY: "k", FOOTBALL_DATA_API_KEY: "k" })).id).toBe("api-football");
    expect(resolveProvider(env({ FOOTBALL_DATA_API_KEY: "k" })).id).toBe("football-data");
  });

  it("does not auto-select openfootball unless explicitly enabled", () => {
    expect(resolveProvider(env({})).id).toBe("demo");
    expect(resolveProvider(env({ OPENFOOTBALL_ENABLED: "1" })).id).toBe("openfootball");
  });

  it("lands on demo with no credentials at all", () => {
    const r = resolveProvider(env({}));
    expect(r.id).toBe("demo");
    expect(r.provider.mode).toBe("DEMO");
  });

  it("reads CUSTOM_FOOTBALL_API_URL as an alternative to CUSTOM_API_URL", () => {
    expect(resolveProvider(env({ CUSTOM_FOOTBALL_API_URL: "https://alt.test" })).id).toBe("custom");
    expect(customApiBaseUrl(env({ CUSTOM_FOOTBALL_API_URL: "https://alt.test/" }))).toBe("https://alt.test");
  });
});

describe("isProviderConfigured / providerStatus", () => {
  it("reflects credential presence per provider", () => {
    expect(isProviderConfigured("demo", env({}))).toBe(true);
    expect(isProviderConfigured("openfootball", env({}))).toBe(true);
    expect(isProviderConfigured("api-football", env({}))).toBe(false);
    expect(isProviderConfigured("api-football", env({ APIFOOTBALL_KEY: "k" }))).toBe(true);
    expect(isProviderConfigured("football-data", env({ FOOTBALL_DATA_API_KEY: "k" }))).toBe(true);
    expect(isProviderConfigured("custom", env({ CUSTOM_API_KEY: "k" }))).toBe(false); // key alone is not enough
  });

  it("lists every provider with its missing keys and the active one", () => {
    const status = providerStatus(env({ DATA_PROVIDER: "football-data", FOOTBALL_DATA_API_KEY: "k" }));
    expect(status.map((s) => s.id)).toEqual([...PROVIDER_IDS]);
    expect(status.find((s) => s.id === "football-data")).toMatchObject({ active: true, configured: true, missing: [] });
    expect(status.find((s) => s.id === "api-football")?.missing).toEqual(["APIFOOTBALL_KEY"]);
    expect(status.filter((s) => s.active)).toHaveLength(1);
  });

  it("marks nothing active when the environment is misconfigured", () => {
    const status = providerStatus(env({ DATA_PROVIDER: "api-football" }));
    expect(status.every((s) => !s.active)).toBe(true);
  });
});

describe("custom provider configuration helpers", () => {
  it("reads the endpoint and key from the environment", () => {
    expect(customApiBaseUrl(env({ CUSTOM_API_URL: "https://a.test/api/" }))).toBe("https://a.test/api");
    expect(customApiKey(env({ CUSTOM_API_KEY: " secret " }))).toBe("secret");
    expect(customApiKey(env({}))).toBe("");
  });

  it("assertCustomApiConfigured throws a ProviderConfigError naming both variables", () => {
    expect(() => assertCustomApiConfigured(env({}))).toThrow(ProviderConfigError);
    try {
      assertCustomApiConfigured(env({}));
    } catch (e) {
      expect((e as ProviderConfigError).missing).toEqual(["CUSTOM_API_URL", "CUSTOM_FOOTBALL_API_URL"]);
    }
    expect(assertCustomApiConfigured(env({ CUSTOM_API_URL: "https://a.test" }))).toBe("https://a.test");
  });
});
