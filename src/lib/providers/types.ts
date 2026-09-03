import {
  Fixture, HistoricalMatch, League, Team,
} from "../types";

/**
 * Provider abstraction layer.
 *
 * EdgeRadar never talks to a concrete data vendor directly. Every data need is
 * expressed as one of these interfaces, so a real provider (API-Football,
 * Sportmonks, StatsBomb, Opta, a bookmaker odds feed, …) can be dropped in via
 * environment configuration without touching the engine or the frontend.
 *
 * Set DATA_PROVIDER=demo (default) or implement + register a live provider.
 */

export interface LeaguesProvider {
  getLeagues(): Promise<League[]>;
  getTeams(leagueId?: string): Promise<Team[]>;
}

export interface FixturesProvider {
  /** Upcoming + recent fixtures. MUST include kickoff timestamps. */
  getFixtures(): Promise<Fixture[]>;
}

export interface StatisticsProvider {
  /** Completed historical matches with stat lines (goals by half, corners, cards). */
  getHistoricalMatches(): Promise<HistoricalMatch[]>;
}

export interface InjuryProvider {
  /** Return null when no reliable pre-match injury feed exists. Never fabricate. */
  getInjuryNote(fixtureId: string): Promise<string | null>;
}

export interface OddsProvider {
  /** Decimal odds for a market, or null when no legal odds feed is configured. */
  getOdds(fixtureId: string, marketCode: string): Promise<number | null>;
}

export interface BroadcastProvider {
  /** Evidence string backing a league's broadcast badge, or null if unverified. */
  getBroadcastEvidence(leagueId: string): Promise<string | null>;
}

export interface DataSourceMeta {
  id: string;
  name: string;
  kind: "fixtures" | "statistics" | "odds" | "injuries" | "broadcast";
  mode: "DEMO" | "LIVE";
  lastUpdated: string;
  status: "LIVE" | "RECENT" | "STALE";
  notes: string;
}

export interface FootballDataProvider
  extends LeaguesProvider, FixturesProvider, StatisticsProvider, InjuryProvider, OddsProvider, BroadcastProvider {
  /** Stable machine id — must match the DATA_PROVIDER value that selects it. */
  readonly id: ProviderId;
  readonly name: string;
  readonly mode: "DEMO" | "LIVE";
  getSources(): Promise<DataSourceMeta[]>;
}

/** Every provider EdgeRadar can be pointed at via `DATA_PROVIDER`. */
export type ProviderId =
  | "custom"
  | "api-football"
  | "football-data"
  | "openfootball"
  | "demo";

/**
 * A live provider failed. Surfaced verbatim to the error boundary — the app
 * never substitutes synthetic data for it.
 */
export class ProviderError extends Error {
  readonly providerId: string;
  readonly retryable: boolean;
  constructor(message: string, providerId: string, retryable = true) {
    super(message);
    this.name = "ProviderError";
    this.providerId = providerId;
    this.retryable = retryable;
  }
}

/**
 * The environment asks for a live provider that is not configured. Thrown at
 * provider-resolution time (before any fetch) so misconfiguration is obvious
 * in the deploy logs instead of showing up as an empty dashboard.
 */
export class ProviderConfigError extends ProviderError {
  readonly missing: string[];
  constructor(message: string, providerId: string, missing: string[] = []) {
    super(message, providerId, false);
    this.name = "ProviderConfigError";
    this.missing = missing;
  }
}

/** Thrown while a live provider is still warming its cache (rate-limited APIs).
 *  Pages catch this and render a progress screen instead of blocking the render. */
export class WarmingUpError extends Error {
  loaded: number;
  total: number;
  constructor(loaded: number, total: number) {
    super(`LIVE_WARMUP ${loaded}/${total}`);
    this.name = "WarmingUpError";
    this.loaded = loaded;
    this.total = total;
  }
}
