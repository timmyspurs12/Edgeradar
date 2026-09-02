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
  readonly id: "demo" | "football-data" | "api-football" | string;
  readonly name: string;
  readonly mode: "DEMO" | "LIVE";
  getSources(): Promise<DataSourceMeta[]>;
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
