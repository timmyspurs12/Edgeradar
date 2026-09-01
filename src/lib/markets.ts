import { MarketDef } from "./types";

// Obviousness: how "headline" the market is. Under-the-radar = high prob + low obviousness.
export const MARKETS: MarketDef[] = [
  // TOTAL GOALS
  { code: "O0.5",  label: "Over 0.5 Total Goals",  group: "TOTAL_GOALS", obviousness: 0.35 },
  { code: "O1.5",  label: "Over 1.5 Total Goals",  group: "TOTAL_GOALS", obviousness: 0.45 },
  { code: "O2.5",  label: "Over 2.5 Total Goals",  group: "TOTAL_GOALS", obviousness: 0.80 },
  { code: "U2.5",  label: "Under 2.5 Total Goals", group: "TOTAL_GOALS", obviousness: 0.70 },
  { code: "U3.5",  label: "Under 3.5 Total Goals", group: "TOTAL_GOALS", obviousness: 0.45 },
  { code: "U4.5",  label: "Under 4.5 Total Goals", group: "TOTAL_GOALS", obviousness: 0.30 },
  { code: "U5.5",  label: "Under 5.5 Total Goals", group: "TOTAL_GOALS", obviousness: 0.25 },
  // TEAM GOALS
  { code: "H_O0.5", label: "Home Team Over 0.5 Goals",  group: "TEAM_GOALS", obviousness: 0.40 },
  { code: "A_O0.5", label: "Away Team Over 0.5 Goals",  group: "TEAM_GOALS", obviousness: 0.40 },
  { code: "H_U2.5", label: "Home Team Under 2.5 Goals", group: "TEAM_GOALS", obviousness: 0.30 },
  { code: "A_U2.5", label: "Away Team Under 2.5 Goals", group: "TEAM_GOALS", obviousness: 0.30 },
  // FIRST HALF
  { code: "1H_O0.5", label: "1st Half Over 0.5 Goals",  group: "FIRST_HALF", obviousness: 0.35 },
  { code: "1H_U1.5", label: "1st Half Under 1.5 Goals", group: "FIRST_HALF", obviousness: 0.30 },
  { code: "1H_O1.5", label: "1st Half Over 1.5 Goals",  group: "FIRST_HALF", obviousness: 0.55 },
  // SECOND HALF
  { code: "2H_O0.5", label: "2nd Half Over 0.5 Goals",  group: "SECOND_HALF", obviousness: 0.25 },
  { code: "2H_O1.5", label: "2nd Half Over 1.5 Goals",  group: "SECOND_HALF", obviousness: 0.45 },
  { code: "2H_U2.5", label: "2nd Half Under 2.5 Goals", group: "SECOND_HALF", obviousness: 0.30 },
  // BTTS
  { code: "BTTS_Y", label: "Both Teams To Score — Yes", group: "BTTS", obviousness: 0.85 },
  { code: "BTTS_N", label: "Both Teams To Score — No",  group: "BTTS", obviousness: 0.60 },
  // CLEAN SHEETS
  { code: "H_CS",  label: "Home Clean Sheet",        group: "CLEAN_SHEET", obviousness: 0.50 },
  { code: "A_CS",  label: "Away Clean Sheet",        group: "CLEAN_SHEET", obviousness: 0.50 },
  { code: "E_CS",  label: "Either Team Clean Sheet", group: "CLEAN_SHEET", obviousness: 0.35 },
  // CORNERS
  { code: "C_O5.5",  label: "Over 5.5 Corners",   group: "CORNERS", obviousness: 0.30 },
  { code: "C_O6.5",  label: "Over 6.5 Corners",   group: "CORNERS", obviousness: 0.32 },
  { code: "C_O7.5",  label: "Over 7.5 Corners",   group: "CORNERS", obviousness: 0.35 },
  { code: "C_O8.5",  label: "Over 8.5 Corners",   group: "CORNERS", obviousness: 0.40 },
  { code: "C_U12.5", label: "Under 12.5 Corners", group: "CORNERS", obviousness: 0.28 },
  // CARDS
  { code: "K_O2.5", label: "Over 2.5 Cards",  group: "CARDS", obviousness: 0.32 },
  { code: "K_O3.5", label: "Over 3.5 Cards",  group: "CARDS", obviousness: 0.36 },
  { code: "K_O4.5", label: "Over 4.5 Cards",  group: "CARDS", obviousness: 0.45 },
  { code: "K_U6.5", label: "Under 6.5 Cards", group: "CARDS", obviousness: 0.30 },
  // MATCH RESULT (deliberately high obviousness — the engine is built to look past these)
  { code: "1", label: "Home Win", group: "MATCH_RESULT", obviousness: 1.00 },
  { code: "X", label: "Draw",     group: "MATCH_RESULT", obviousness: 0.95 },
  { code: "2", label: "Away Win", group: "MATCH_RESULT", obviousness: 1.00 },
  // PROTECTED RESULT
  { code: "1X", label: "Home or Draw (Double Chance)", group: "PROTECTED_RESULT", obviousness: 0.65 },
  { code: "X2", label: "Away or Draw (Double Chance)", group: "PROTECTED_RESULT", obviousness: 0.65 },
];

export const marketByCode = new Map(MARKETS.map((m) => [m.code, m]));

// Deterministic outcome evaluator against a match stat line.
// Returns null when the underlying data is unavailable (halves/corners/cards).
export interface StatLine {
  hg: number; ag: number;
  hg1: number | null; ag1: number | null;
  corners: number | null; cards: number | null;
}

export function evalMarket(code: string, m: StatLine): boolean | null {
  const tg = m.hg + m.ag;
  const hasHalves = m.hg1 !== null && m.ag1 !== null;
  const fh = hasHalves ? (m.hg1 as number) + (m.ag1 as number) : null;
  const sh = fh === null ? null : tg - fh;
  switch (code) {
    case "O0.5": return tg > 0.5;
    case "O1.5": return tg > 1.5;
    case "O2.5": return tg > 2.5;
    case "U2.5": return tg < 2.5;
    case "U3.5": return tg < 3.5;
    case "U4.5": return tg < 4.5;
    case "U5.5": return tg < 5.5;
    case "H_O0.5": return m.hg > 0.5;
    case "A_O0.5": return m.ag > 0.5;
    case "H_U2.5": return m.hg < 2.5;
    case "A_U2.5": return m.ag < 2.5;
    case "1H_O0.5": return fh === null ? null : fh > 0.5;
    case "1H_U1.5": return fh === null ? null : fh < 1.5;
    case "1H_O1.5": return fh === null ? null : fh > 1.5;
    case "2H_O0.5": return sh === null ? null : sh > 0.5;
    case "2H_O1.5": return sh === null ? null : sh > 1.5;
    case "2H_U2.5": return sh === null ? null : sh < 2.5;
    case "BTTS_Y": return m.hg > 0 && m.ag > 0;
    case "BTTS_N": return !(m.hg > 0 && m.ag > 0);
    case "H_CS": return m.ag === 0;
    case "A_CS": return m.hg === 0;
    case "E_CS": return m.ag === 0 || m.hg === 0;
    case "C_O5.5": return m.corners === null ? null : m.corners > 5.5;
    case "C_O6.5": return m.corners === null ? null : m.corners > 6.5;
    case "C_O7.5": return m.corners === null ? null : m.corners > 7.5;
    case "C_O8.5": return m.corners === null ? null : m.corners > 8.5;
    case "C_U12.5": return m.corners === null ? null : m.corners < 12.5;
    case "K_O2.5": return m.cards === null ? null : m.cards > 2.5;
    case "K_O3.5": return m.cards === null ? null : m.cards > 3.5;
    case "K_O4.5": return m.cards === null ? null : m.cards > 4.5;
    case "K_U6.5": return m.cards === null ? null : m.cards < 6.5;
    case "1": return m.hg > m.ag;
    case "X": return m.hg === m.ag;
    case "2": return m.ag > m.hg;
    case "1X": return m.hg >= m.ag;
    case "X2": return m.ag >= m.hg;
    default: return null;
  }
}

// Correlation clusters — markets in the same cluster must never be treated as independent.
const CLUSTERS: string[][] = [
  ["O0.5", "O1.5", "O2.5", "U2.5", "U3.5", "U4.5", "U5.5", "2H_O0.5", "2H_O1.5", "2H_U2.5", "1H_O0.5", "1H_O1.5", "1H_U1.5", "BTTS_Y", "BTTS_N"],
  ["H_O0.5", "H_U2.5", "BTTS_Y", "A_CS", "E_CS", "1", "1X", "X"],
  ["A_O0.5", "A_U2.5", "BTTS_Y", "H_CS", "E_CS", "2", "X2", "X"],
  ["C_O5.5", "C_O6.5", "C_O7.5", "C_O8.5", "C_U12.5"],
  ["K_O2.5", "K_O3.5", "K_O4.5", "K_U6.5"],
];

export function areCorrelated(a: string, b: string): boolean {
  if (a === b) return true;
  return CLUSTERS.some((c) => c.includes(a) && c.includes(b));
}
