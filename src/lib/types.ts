// ─── EdgeRadar core domain types ────────────────────────────────────────────

export type LeagueTier = 1 | 2 | 3;

export type BroadcastStatus =
  | "BROADCAST_VERIFIED"
  | "PUBLIC_COVERAGE_VERIFIED"
  | "LIMITED_DATA";

export type DataQuality = "EXCELLENT" | "GOOD" | "FAIR" | "LIMITED";

export type FixtureStatus = "UPCOMING" | "LIVE" | "FINISHED";

export type ConfidenceTier =
  | "EXTREME"        // 90–100
  | "VERY_HIGH"      // 85–89
  | "HIGH"           // 80–84
  | "MODERATE_HIGH"  // 75–79
  | "MODERATE"       // 70–74
  | "LOW";           // <70 — never prominently recommended

export type MarketGroup =
  | "TOTAL_GOALS"
  | "TEAM_GOALS"
  | "FIRST_HALF"
  | "SECOND_HALF"
  | "BTTS"
  | "CLEAN_SHEET"
  | "CORNERS"
  | "CARDS"
  | "MATCH_RESULT"
  | "PROTECTED_RESULT";

export interface League {
  id: string;
  name: string;
  country: string;
  tier: LeagueTier;
  broadcastStatus: BroadcastStatus;
  broadcastEvidence: string; // e.g. named broadcasters — demo strings clearly labeled
  officialSite: string;
  dataQuality: DataQuality;
  historicalMatchCount: number;
  seasonStatus: string;
  hasCornerData: boolean;
  hasCardData: boolean;
  hasOddsFeed: boolean;
  avgGoals: number; // league baselines computed from historical matches
}

export interface Team {
  id: string;
  leagueId: string;
  name: string;
  short: string;
  attack: number;   // latent strength used ONLY by the demo data generator
  defense: number;
}

export interface HistoricalMatch {
  id: string;
  leagueId: string;
  homeId: string;
  awayId: string;
  date: string; // ISO
  hg: number;   // home goals FT
  ag: number;
  hg1: number | null;  // home goals 1H — null when the source has no HT split (never fabricated)
  ag1: number | null;
  corners: number | null;
  cards: number | null;
}

export interface Fixture {
  id: string;
  leagueId: string;
  homeId: string;
  awayId: string;
  kickoff: string; // ISO
  status: FixtureStatus;
  // populated only when FINISHED (never used for pre-match prediction)
  result?: { hg: number; ag: number; hg1: number | null; ag1: number | null; corners: number | null; cards: number | null };
  lineupStatus: "NOT_ANNOUNCED" | "ANNOUNCED";
  injuryInfo: string | null; // null → "Data unavailable"
}

export interface MarketDef {
  code: string;          // e.g. "O0.5", "H_O0.5", "1H_O0.5"
  label: string;
  group: MarketGroup;
  obviousness: number;   // 0–1, higher = more obvious (match result etc.)
}

export interface ComponentBreakdown {
  season: number | null;
  last10: number | null;
  last5: number | null;
  homeAway: number | null;
  opponent: number | null;
  league: number | null;
}

export interface MarketPrediction {
  market: MarketDef;
  probability: number;        // 0–100, shrunk & blended
  rawProbability: number;     // pre-shrinkage blend
  confidenceTier: ConfidenceTier;
  edgeScore: number;          // 0–100
  sampleSize: number;
  recentHits: number;         // hits in last 10 combined-team matches
  recentTotal: number;
  seasonHits: number;
  seasonTotal: number;
  leagueRate: number;         // 0–100
  dataStrength: "STRONG" | "MODERATE" | "WEAK";
  components: ComponentBreakdown;
  explanation: string[];      // measurable evidence bullets
  flags: string[];            // "LOW_SAMPLE", "TOP_EDGE", ...
  odds: number | null;        // demo odds if available
  valueEdge: number | null;   // model prob − implied prob (pct points), if odds
}

export interface MatchPrediction {
  fixtureId: string;
  generatedAt: string;       // pre-match timestamp
  lockedAt: string | null;   // set at kickoff
  modelVersion: string;
  dataStatus: "LIVE" | "RECENT" | "STALE";
  dataUpdatedAt: string;
  confidencePenalty: number; // pct points removed due to stale data
  markets: MarketPrediction[];
  safest: MarketPrediction[];
  underTheRadar: MarketPrediction[];
  value: MarketPrediction[];
  avoid: { market: MarketDef; probability: number; reason: string }[];
  top3: MarketPrediction[];
  headline: MarketPrediction | null; // best edge overall
  noStrongEdge: boolean;
  matchConfidence: number; // headline confidence
}

export interface TeamForm {
  teamId: string;
  window: "LAST5" | "LAST10" | "SEASON" | "HOME" | "AWAY";
  played: number;
  scored: number;
  conceded: number;
  over15: number;
  btts: number;
  sh_o05: number;  // 2H over 0.5 count
  fh_o05: number;
  cleanSheets: number;
  avgCorners: number | null;
  avgCards: number | null;
}

export interface LeagueRadarStats {
  leagueId: string;
  upcoming: number;
  avgGoals: number;
  o05: number; o15: number; o25: number;
  btts: number;
  fh_o05: number; sh_o05: number;
  avgCorners: number | null;
  avgCards: number | null;
  homeScoringRate: number;
  awayScoringRate: number;
  hotMarkets: { market: string; rate: number }[];
}

export interface ResolvedPrediction {
  fixtureId: string;
  leagueId: string;
  marketCode: string;
  marketLabel: string;
  group: MarketGroup;
  probability: number;
  edgeScore: number;
  confidenceTier: ConfidenceTier;
  generatedAt: string;
  kickoff: string;
  outcome: "WIN" | "LOSS";
  odds: number | null;
}
