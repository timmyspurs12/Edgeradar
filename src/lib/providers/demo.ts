import { Fixture, HistoricalMatch, League, Team } from "../types";
import { DataSourceMeta, FootballDataProvider } from "./types";

/**
 * DEMO DATA PROVIDER
 * ------------------
 * Fully synthetic, seeded, deterministic dataset. Every value produced here is
 * DEMO DATA and is labeled as such throughout the UI. Nothing in this file is
 * a real fixture, real statistic, real odd, or real broadcast fact.
 *
 * Replace with a live provider via DATA_PROVIDER env var + registry in index.ts.
 */

// ── seeded RNG ──────────────────────────────────────────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function poisson(rng: () => number, lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L);
  return k - 1;
}

// ── league catalogue (metadata is demo placeholder content) ────────────────
interface LeagueSeed {
  id: string; name: string; country: string; tier: 1 | 2 | 3;
  broadcast: "BROADCAST_VERIFIED" | "PUBLIC_COVERAGE_VERIFIED" | "LIMITED_DATA";
  evidence: string; site: string;
  goalsBase: number; cornerBase: number | null; cardBase: number | null;
  teams: string[]; rounds: number; odds: boolean;
}

const T = (n: string) => n;
const SEEDS: LeagueSeed[] = [
  {
    id: "epl", name: "Premier League", country: "England", tier: 1,
    broadcast: "BROADCAST_VERIFIED", evidence: "Sample evidence (demo): national + international TV rights", site: "premierleague.com",
    goalsBase: 2.85, cornerBase: 10.2, cardBase: 3.9, odds: true, rounds: 24,
    teams: ["Arsenal","Aston Villa","Bournemouth","Brentford","Brighton","Chelsea","Crystal Palace","Everton","Fulham","Liverpool","Manchester City","Manchester United","Newcastle","Nottingham Forest","Tottenham","West Ham","Wolves","Leeds United","Burnley","Sunderland"].map(T),
  },
  {
    id: "laliga", name: "La Liga", country: "Spain", tier: 1,
    broadcast: "BROADCAST_VERIFIED", evidence: "Sample evidence (demo): national + international TV rights", site: "laliga.com",
    goalsBase: 2.55, cornerBase: 9.6, cardBase: 4.8, odds: true, rounds: 24,
    teams: ["Real Madrid","Barcelona","Atlético Madrid","Athletic Club","Real Sociedad","Villarreal","Real Betis","Sevilla","Valencia","Girona","Osasuna","Celta Vigo","Rayo Vallecano","Mallorca","Getafe","Alavés","Espanyol","Levante","Elche","Real Oviedo"].map(T),
  },
  {
    id: "seriea", name: "Serie A", country: "Italy", tier: 1,
    broadcast: "BROADCAST_VERIFIED", evidence: "Sample evidence (demo): national + international TV rights", site: "legaseriea.it",
    goalsBase: 2.6, cornerBase: 9.9, cardBase: 4.5, odds: true, rounds: 24,
    teams: ["Inter","AC Milan","Juventus","Napoli","Roma","Lazio","Atalanta","Fiorentina","Bologna","Torino","Udinese","Genoa","Como","Cagliari","Parma","Lecce","Verona","Sassuolo","Pisa","Cremonese"].map(T),
  },
  {
    id: "bundesliga", name: "Bundesliga", country: "Germany", tier: 1,
    broadcast: "BROADCAST_VERIFIED", evidence: "Sample evidence (demo): national + international TV rights", site: "bundesliga.com",
    goalsBase: 3.15, cornerBase: 9.8, cardBase: 3.7, odds: true, rounds: 22,
    teams: ["Bayern Munich","Bayer Leverkusen","Borussia Dortmund","RB Leipzig","Eintracht Frankfurt","Stuttgart","Freiburg","Hoffenheim","Wolfsburg","Mainz","Borussia M'gladbach","Union Berlin","Werder Bremen","Augsburg","St. Pauli","Heidenheim","Köln","Hamburger SV"].map(T),
  },
  {
    id: "ligue1", name: "Ligue 1", country: "France", tier: 1,
    broadcast: "BROADCAST_VERIFIED", evidence: "Sample evidence (demo): national + international TV rights", site: "ligue1.com",
    goalsBase: 2.7, cornerBase: 9.4, cardBase: 4.1, odds: true, rounds: 22,
    teams: ["Paris Saint-Germain","Marseille","Monaco","Lille","Lyon","Nice","Lens","Rennes","Strasbourg","Toulouse","Nantes","Brest","Auxerre","Angers","Le Havre","Metz","Lorient","Paris FC"].map(T),
  },
  {
    id: "eredivisie", name: "Eredivisie", country: "Netherlands", tier: 2,
    broadcast: "BROADCAST_VERIFIED", evidence: "Sample evidence (demo): national TV rights", site: "eredivisie.nl",
    goalsBase: 3.2, cornerBase: 10.0, cardBase: 3.4, odds: false, rounds: 20,
    teams: ["PSV","Ajax","Feyenoord","AZ Alkmaar","Twente","Utrecht","Sparta Rotterdam","Go Ahead Eagles","NEC","Heerenveen","Fortuna Sittard","PEC Zwolle","Groningen","Heracles","Excelsior","Volendam","Telstar","NAC Breda"].map(T),
  },
  {
    id: "primeira", name: "Primeira Liga", country: "Portugal", tier: 2,
    broadcast: "PUBLIC_COVERAGE_VERIFIED", evidence: "Sample evidence (demo): strong public coverage", site: "ligaportugal.pt",
    goalsBase: 2.6, cornerBase: 9.7, cardBase: 4.6, odds: false, rounds: 20,
    teams: ["Sporting CP","Benfica","Porto","Braga","Vitória SC","Famalicão","Moreirense","Rio Ave","Casa Pia","Gil Vicente","Estoril","Arouca","Santa Clara","Nacional","Estrela","Tondela","Alverca","AVS"].map(T),
  },
  {
    id: "superlig", name: "Süper Lig", country: "Türkiye", tier: 2,
    broadcast: "PUBLIC_COVERAGE_VERIFIED", evidence: "Sample evidence (demo): strong public coverage", site: "tff.org",
    goalsBase: 2.9, cornerBase: 9.9, cardBase: 5.2, odds: false, rounds: 20,
    teams: ["Galatasaray","Fenerbahçe","Beşiktaş","Trabzonspor","Başakşehir","Samsunspor","Eyüpspor","Göztepe","Alanyaspor","Konyaspor","Rizespor","Antalyaspor","Kasımpaşa","Gaziantep FK","Kayserispor","Kocaelispor","Karagümrük","Gençlerbirliği"].map(T),
  },
  {
    id: "spfl", name: "Scottish Premiership", country: "Scotland", tier: 2,
    broadcast: "BROADCAST_VERIFIED", evidence: "Sample evidence (demo): national TV rights", site: "spfl.co.uk",
    goalsBase: 2.75, cornerBase: 9.5, cardBase: 3.8, odds: false, rounds: 22,
    teams: ["Celtic","Rangers","Hearts","Aberdeen","Hibernian","Dundee United","St Mirren","Kilmarnock","Motherwell","Dundee","Falkirk","Livingston"].map(T),
  },
  {
    id: "mls", name: "MLS", country: "United States", tier: 2,
    broadcast: "BROADCAST_VERIFIED", evidence: "Sample evidence (demo): global streaming rights", site: "mlssoccer.com",
    goalsBase: 3.0, cornerBase: 9.6, cardBase: 3.6, odds: false, rounds: 20,
    teams: ["Inter Miami","LAFC","LA Galaxy","Columbus Crew","Cincinnati","Orlando City","Charlotte FC","NYC FC","NY Red Bulls","Philadelphia Union","Seattle Sounders","Portland Timbers","Austin FC","Minnesota United","San Diego FC","Vancouver Whitecaps","Atlanta United","Toronto FC"].map(T),
  },
  {
    id: "brasileirao", name: "Brasileirão Série A", country: "Brazil", tier: 2,
    broadcast: "PUBLIC_COVERAGE_VERIFIED", evidence: "Sample evidence (demo): strong public coverage", site: "cbf.com.br",
    goalsBase: 2.45, cornerBase: 10.1, cardBase: 5.0, odds: false, rounds: 20,
    teams: ["Flamengo","Palmeiras","Botafogo","São Paulo","Corinthians","Cruzeiro","Internacional","Atlético Mineiro","Fluminense","Grêmio","Bahia","Fortaleza","Vasco da Gama","Santos","Red Bull Bragantino","Ceará","Vitória","Juventude","Sport Recife","Mirassol"].map(T),
  },
  {
    id: "saudipl", name: "Saudi Pro League", country: "Saudi Arabia", tier: 2,
    broadcast: "PUBLIC_COVERAGE_VERIFIED", evidence: "Sample evidence (demo): strong public coverage", site: "spl.com.sa",
    goalsBase: 2.95, cornerBase: null, cardBase: null, odds: false, rounds: 18,
    teams: ["Al Hilal","Al Nassr","Al Ittihad","Al Ahli","Al Qadsiah","Al Shabab","Al Taawoun","Al Ettifaq","Damac","Al Fateh","Al Riyadh","Al Khaleej","Al Fayha","Al Okhdood","Al Raed","Al Hazem","NEOM SC","Al Kholood"].map(T),
  },
  {
    id: "jleague", name: "J1 League", country: "Japan", tier: 2,
    broadcast: "PUBLIC_COVERAGE_VERIFIED", evidence: "Sample evidence (demo): strong public coverage", site: "jleague.co",
    goalsBase: 2.55, cornerBase: 9.3, cardBase: 3.2, odds: false, rounds: 18,
    teams: ["Vissel Kobe","Sanfrecce Hiroshima","Machida Zelvia","Kashima Antlers","Urawa Reds","Gamba Osaka","Cerezo Osaka","Kawasaki Frontale","Yokohama F. Marinos","FC Tokyo","Avispa Fukuoka","Nagoya Grampus","Shonan Bellmare","Kyoto Sanga","Tokyo Verdy","Albirex Niigata","Shimizu S-Pulse","Fagiano Okayama"].map(T),
  },
  {
    id: "ucl", name: "UEFA Champions League", country: "Europe", tier: 2,
    broadcast: "BROADCAST_VERIFIED", evidence: "Sample evidence (demo): global TV rights", site: "uefa.com",
    goalsBase: 3.05, cornerBase: 9.8, cardBase: 4.0, odds: true, rounds: 8,
    teams: ["Real Madrid CF","FC Barcelona","Manchester City FC","Liverpool FC","Arsenal FC","FC Bayern München","Borussia Dortmund BVB","Paris SG","Inter Milano","SSC Napoli","Atlético de Madrid","Bayer 04 Leverkusen","Sporting Clube","SL Benfica","AFC Ajax","Celtic FC","Galatasaray SK","Club Brugge","Olympiacos","FC Copenhagen"].map(T),
  },
  {
    id: "eliteserien", name: "Eliteserien", country: "Norway", tier: 3,
    broadcast: "LIMITED_DATA", evidence: "", site: "eliteserien.no",
    goalsBase: 3.0, cornerBase: null, cardBase: null, odds: false, rounds: 4, // deliberately thin sample → INSUFFICIENT DATA demo state
    teams: ["Bodø/Glimt","Molde","Rosenborg","Brann","Viking","Lillestrøm","Vålerenga","Tromsø","Sarpsborg 08","Strømsgodset","Kristiansund","HamKam"].map(T),
  },
];

// ── deterministic dataset build ─────────────────────────────────────────────
const DAY = 86400000;

export interface DemoDataset {
  builtAt: string;
  leagues: League[];
  teams: Team[];
  historical: HistoricalMatch[];
  fixtures: Fixture[];
}

let cache: DemoDataset | null = null;
let cacheDay = "";

export function buildDemoDataset(): DemoDataset {
  const dayKey = new Date().toISOString().slice(0, 10);
  if (cache && cacheDay === dayKey) return cache;

  const rng = mulberry32(0xed6e0a1);
  const now = Date.now();
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const base = midnight.getTime();

  const leagues: League[] = [];
  const teams: Team[] = [];
  const historical: HistoricalMatch[] = [];
  const fixtures: Fixture[] = [];

  for (const seed of SEEDS) {
    const leagueTeams: Team[] = seed.teams.map((name, i) => ({
      id: `${seed.id}-t${i}`,
      leagueId: seed.id,
      name,
      short: name.split(" ").map((w) => w[0]).join("").slice(0, 3).toUpperCase(),
      attack: 0.72 + rng() * 0.66,   // latent generator strength only
      defense: 0.72 + rng() * 0.66,
    }));
    teams.push(...leagueTeams);

    // ── historical rounds (past ~170 days) ──
    const n = leagueTeams.length;
    for (let r = 0; r < seed.rounds; r++) {
      const order = [...leagueTeams].sort(() => rng() - 0.5);
      const daysAgo = 12 + Math.floor(((seed.rounds - r) / seed.rounds) * 160);
      for (let i = 0; i + 1 < n; i += 2) {
        const home = order[i], away = order[i + 1];
        const stat = simulate(rng, seed, home, away);
        historical.push({
          id: `${seed.id}-h${r}-${i}`,
          leagueId: seed.id,
          homeId: home.id, awayId: away.id,
          date: new Date(base - daysAgo * DAY - Math.floor(rng() * 3) * DAY).toISOString(),
          ...stat,
        });
      }
    }

    // ── finished fixtures (past 12 days) for track record ──
    for (let d = 12; d >= 1; d--) {
      if (rng() < 0.45) continue;
      const games = 1 + Math.floor(rng() * 2);
      const pool = [...leagueTeams].sort(() => rng() - 0.5);
      for (let g = 0; g < games && g * 2 + 1 < pool.length; g++) {
        const home = pool[g * 2], away = pool[g * 2 + 1];
        const ko = base - d * DAY + (13 + Math.floor(rng() * 8)) * 3600000;
        const stat = simulate(rng, seed, home, away);
        fixtures.push({
          id: `${seed.id}-f-past-${d}-${g}`,
          leagueId: seed.id, homeId: home.id, awayId: away.id,
          kickoff: new Date(ko).toISOString(),
          status: "FINISHED",
          result: stat,
          lineupStatus: "ANNOUNCED",
          injuryInfo: null,
        });
      }
    }

    // ── upcoming fixtures (today → +7 days) ──
    for (let d = 0; d <= 7; d++) {
      const density = seed.tier === 1 ? 0.75 : seed.tier === 2 ? 0.6 : 0.4;
      if (rng() > density) continue;
      const games = 1 + Math.floor(rng() * (seed.tier === 1 ? 3 : 2));
      const pool = [...leagueTeams].sort(() => rng() - 0.5);
      for (let g = 0; g < games && g * 2 + 1 < pool.length; g++) {
        const home = pool[g * 2], away = pool[g * 2 + 1];
        const hour = [13, 15, 17, 18, 19, 20, 21][Math.floor(rng() * 7)];
        const ko = base + d * DAY + hour * 3600000 + [0, 30, 45][Math.floor(rng() * 3)] * 60000;
        if (ko < now + 30 * 60000 && d === 0) continue; // keep today's fixtures genuinely upcoming
        fixtures.push({
          id: `${seed.id}-f-${d}-${g}`,
          leagueId: seed.id, homeId: home.id, awayId: away.id,
          kickoff: new Date(ko).toISOString(),
          status: "UPCOMING",
          lineupStatus: ko - now < 2 * 3600000 && rng() < 0.5 ? "ANNOUNCED" : "NOT_ANNOUNCED",
          injuryInfo: null, // no reliable demo injury feed → UI shows "Data unavailable"
        });
      }
    }

    // league baselines from generated history
    const hist = historical.filter((h) => h.leagueId === seed.id);
    const avgGoals = hist.length ? hist.reduce((s, h) => s + h.hg + h.ag, 0) / hist.length : 0;
    leagues.push({
      id: seed.id, name: seed.name, country: seed.country, tier: seed.tier,
      broadcastStatus: seed.broadcast,
      broadcastEvidence: seed.evidence,
      officialSite: seed.site,
      dataQuality: seed.rounds >= 20 ? "EXCELLENT" : seed.rounds >= 14 ? "GOOD" : seed.rounds >= 8 ? "FAIR" : "LIMITED",
      historicalMatchCount: hist.length,
      seasonStatus: seed.rounds >= 8 ? "In progress (demo season)" : "Early season (demo)",
      hasCornerData: seed.cornerBase !== null,
      hasCardData: seed.cardBase !== null,
      hasOddsFeed: seed.odds,
      avgGoals: Math.round(avgGoals * 100) / 100,
    });
  }

  cache = { builtAt: new Date(now).toISOString(), leagues, teams, historical, fixtures };
  cacheDay = dayKey;
  return cache;
}

function simulate(rng: () => number, seed: LeagueSeed, home: Team, away: Team) {
  const lh = (seed.goalsBase / 2) * home.attack * away.defense * 1.18;
  const la = (seed.goalsBase / 2) * away.attack * home.defense * 0.92;
  const hg = Math.min(6, poisson(rng, lh));
  const ag = Math.min(6, poisson(rng, la));
  let hg1 = 0, ag1 = 0;
  for (let i = 0; i < hg; i++) if (rng() < 0.44) hg1++;
  for (let i = 0; i < ag; i++) if (rng() < 0.44) ag1++;
  const corners = seed.cornerBase === null ? null : Math.max(2, poisson(rng, seed.cornerBase));
  const cards = seed.cardBase === null ? null : poisson(rng, seed.cardBase);
  return { hg, ag, hg1, ag1, corners, cards };
}

// ── provider implementation ────────────────────────────────────────────────
export const demoProvider: FootballDataProvider = {
  id: "demo",
  name: "Synthetic Demo Dataset (seeded)",
  mode: "DEMO",
  async getLeagues() { return buildDemoDataset().leagues; },
  async getTeams(leagueId?: string) {
    const t = buildDemoDataset().teams;
    return leagueId ? t.filter((x) => x.leagueId === leagueId) : t;
  },
  async getFixtures() { return buildDemoDataset().fixtures; },
  async getHistoricalMatches() { return buildDemoDataset().historical; },
  async getInjuryNote() { return null; }, // no demo injury feed — never fabricated
  async getOdds(fixtureId: string, marketCode: string) {
    // Synthetic demo odds, only for leagues flagged with a demo odds feed.
    const ds = buildDemoDataset();
    const fx = ds.fixtures.find((f) => f.id === fixtureId);
    if (!fx) return null;
    const lg = ds.leagues.find((l) => l.id === fx.leagueId);
    if (!lg?.hasOddsFeed) return null;
    // Deterministic pseudo-odds keyed on fixture+market (labeled DEMO in UI).
    let h = 0;
    for (const c of fixtureId + marketCode) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const r = mulberry32(h)();
    return Math.round((1.02 + r * 1.9) * 100) / 100;
  },
  async getBroadcastEvidence(leagueId: string) {
    const lg = buildDemoDataset().leagues.find((l) => l.id === leagueId);
    return lg && lg.broadcastStatus !== "LIMITED_DATA" ? lg.broadcastEvidence : null;
  },
  async getSources(): Promise<DataSourceMeta[]> {
    const built = buildDemoDataset().builtAt;
    const mk = (id: string, name: string, kind: DataSourceMeta["kind"], notes: string): DataSourceMeta => ({
      id, name, kind, mode: "DEMO", lastUpdated: built, status: "LIVE", notes,
    });
    return [
      mk("demo-fixtures", "Demo Fixtures Feed", "fixtures", "Synthetic seeded fixtures. Replace via FixturesProvider."),
      mk("demo-stats", "Demo Statistics Feed", "statistics", "Synthetic seeded match history. Replace via StatisticsProvider."),
      mk("demo-odds", "Demo Odds Feed", "odds", "Synthetic odds for Tier-1 demo leagues only. Replace via OddsProvider."),
      { id: "injuries", name: "Injury Feed", kind: "injuries", mode: "DEMO", lastUpdated: built, status: "STALE", notes: "Not configured. UI shows 'Data unavailable' — never fabricated." },
      mk("demo-broadcast", "Broadcast Metadata", "broadcast", "Sample broadcast evidence strings. Replace via BroadcastProvider."),
    ];
  },
};
