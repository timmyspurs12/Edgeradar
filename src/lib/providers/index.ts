import { FootballDataProvider, ProviderConfigError, ProviderId } from "./types";
import { demoProvider } from "./demo";
import { footballDataProvider } from "./footballdata";
import { apiFootballProvider } from "./apifootball";
import { customApiProvider, customApiBaseUrl } from "./customapi";
import { openFootballProvider } from "./openfootball";

/**
 * PROVIDER REGISTRY
 * -----------------
 * One and only one provider serves the app at a time. Demo and live data are
 * NEVER mixed, and a requested live provider that is missing its credentials
 * throws a `ProviderConfigError` instead of silently downgrading to synthetic
 * numbers.
 *
 *   DATA_PROVIDER=custom         → Custom Football API
 *                                  (CUSTOM_API_URL | CUSTOM_FOOTBALL_API_URL [+ CUSTOM_API_KEY])
 *   DATA_PROVIDER=api-football   → API-Football          (APIFOOTBALL_KEY)
 *   DATA_PROVIDER=football-data  → football-data.org     (FOOTBALL_DATA_API_KEY)
 *   DATA_PROVIDER=openfootball   → OpenFootball          (no key; OPENFOOTBALL_* optional)
 *   DATA_PROVIDER=demo           → Synthetic demo dataset (clearly labeled)
 *
 * Unset → auto-detect in this order, so dropping a key into the environment is
 * all it takes: custom → api-football → football-data → openfootball (only when
 * explicitly enabled via OPENFOOTBALL_ENABLED=1) → demo.
 */

export const PROVIDER_IDS: readonly ProviderId[] = [
  "custom", "api-football", "football-data", "openfootball", "demo",
] as const;

/** Aliases tolerated so a typo'd or differently-cased value still resolves. */
const ALIASES: Record<string, ProviderId> = {
  custom: "custom", customapi: "custom", "custom-api": "custom", custom_api: "custom",
  customfootballapi: "custom", "custom-football-api": "custom",
  "api-football": "api-football", apifootball: "api-football", api_football: "api-football",
  apisports: "api-football", "api-sports": "api-football",
  "football-data": "football-data", footballdata: "football-data", football_data: "football-data",
  fdo: "football-data", "football-data.org": "football-data",
  openfootball: "openfootball", "open-football": "openfootball", open_football: "openfootball",
  "football.json": "openfootball",
  demo: "demo", synthetic: "demo", mock: "demo",
};

/** Required environment variables per live provider. */
export const REQUIRED_ENV: Record<Exclude<ProviderId, "demo">, string[]> = {
  custom: ["CUSTOM_API_URL", "CUSTOM_FOOTBALL_API_URL"], // any one of these
  "api-football": ["APIFOOTBALL_KEY"],
  "football-data": ["FOOTBALL_DATA_API_KEY"],
  openfootball: [], // no credentials required
};

const PROVIDERS: Record<ProviderId, FootballDataProvider> = {
  custom: customApiProvider,
  "api-football": apiFootballProvider,
  "football-data": footballDataProvider,
  openfootball: openFootballProvider,
  demo: demoProvider,
};

export function normalizeProviderName(raw: string): ProviderId | null {
  return ALIASES[raw.trim().toLowerCase().replace(/\s+/g, "")] ?? null;
}

/** Is the given environment variable present and non-empty? */
function has(env: NodeJS.ProcessEnv, key: string): boolean {
  return Boolean((env[key] ?? "").trim());
}

/** Does this environment satisfy a live provider's credential requirements? */
export function isProviderConfigured(id: ProviderId, env: NodeJS.ProcessEnv = process.env): boolean {
  switch (id) {
    case "custom":
      return Boolean(customApiBaseUrl(env));
    case "api-football":
      return has(env, "APIFOOTBALL_KEY");
    case "football-data":
      return has(env, "FOOTBALL_DATA_API_KEY");
    case "openfootball":
      return true;
    case "demo":
      return true;
  }
}

function missingFor(id: ProviderId, env: NodeJS.ProcessEnv): string[] {
  if (id === "demo" || id === "openfootball") return [];
  return (REQUIRED_ENV[id] ?? []).filter((k) => !has(env, k));
}

export interface ResolvedProvider {
  id: ProviderId;
  provider: FootballDataProvider;
  /** True when DATA_PROVIDER named it; false when it was auto-detected. */
  explicit: boolean;
}

/**
 * Resolve which provider the environment asks for. Pure — no network, no
 * side effects — so it is unit-testable and safe to call during render.
 */
export function resolveProvider(env: NodeJS.ProcessEnv = process.env): ResolvedProvider {
  const raw = (env.DATA_PROVIDER ?? "").trim();

  if (!raw) {
    if (isProviderConfigured("custom", env)) return { id: "custom", provider: PROVIDERS.custom, explicit: false };
    if (isProviderConfigured("api-football", env)) return { id: "api-football", provider: PROVIDERS["api-football"], explicit: false };
    if (isProviderConfigured("football-data", env)) return { id: "football-data", provider: PROVIDERS["football-data"], explicit: false };
    if ((env.OPENFOOTBALL_ENABLED ?? "").trim() === "1") {
      return { id: "openfootball", provider: PROVIDERS.openfootball, explicit: false };
    }
    return { id: "demo", provider: PROVIDERS.demo, explicit: false };
  }

  const id = normalizeProviderName(raw);
  if (!id) {
    throw new ProviderConfigError(
      `DATA_PROVIDER="${raw}" is not a registered provider. Valid values: ${PROVIDER_IDS.join(", ")}.`,
      "demo",
    );
  }

  if (id !== "demo" && !isProviderConfigured(id, env)) {
    const missing = missingFor(id, env);
    throw new ProviderConfigError(
      id === "custom"
        ? `DATA_PROVIDER=${id} but no endpoint is configured. Set CUSTOM_API_URL (or CUSTOM_FOOTBALL_API_URL), plus CUSTOM_API_KEY if the API requires a secret.`
        : `DATA_PROVIDER=${id} but ${missing.join(" / ")} is missing from the environment. Set it (Vercel → Project → Settings → Environment Variables) or choose another provider: ${PROVIDER_IDS.join(", ")}.`,
      id,
      missing,
    );
  }

  return { id, provider: PROVIDERS[id], explicit: true };
}

/** The active provider. Throws `ProviderConfigError` on misconfiguration. */
export function getProvider(env: NodeJS.ProcessEnv = process.env): FootballDataProvider {
  return resolveProvider(env).provider;
}

/** Human-readable status of every provider, for the /sources page. */
export function providerStatus(env: NodeJS.ProcessEnv = process.env): {
  id: ProviderId;
  name: string;
  mode: FootballDataProvider["mode"];
  configured: boolean;
  missing: string[];
  active: boolean;
}[] {
  let activeId: ProviderId | null = null;
  try {
    activeId = resolveProvider(env).id;
  } catch {
    activeId = null; // misconfigured — nothing is active, which is the point
  }
  return PROVIDER_IDS.map((id) => ({
    id,
    name: PROVIDERS[id].name,
    mode: PROVIDERS[id].mode,
    configured: isProviderConfigured(id, env),
    missing: missingFor(id, env),
    active: id === activeId,
  }));
}
