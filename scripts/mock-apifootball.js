/**
 * Mock API-Football (api-sports.io v3) server for end-to-end testing.
 * Simulates FREE-plan behavior: current-season requests return a plan error,
 * old seasons return full data. Also serves /fixtures/statistics.
 * Run: node scripts/mock-apifootball.js  (port 4500)
 */
const http = require("http");
const url = require("url");

const LEAGUES = {
  39: ["Premier League", "England", 20], 140: ["La Liga", "Spain", 20],
  135: ["Serie A", "Italy", 20], 78: ["Bundesliga", "Germany", 18],
  61: ["Ligue 1", "France", 18], 2: ["UEFA Champions League", "World", 32],
  88: ["Eredivisie", "Netherlands", 18], 94: ["Primeira Liga", "Portugal", 18],
  203: ["Süper Lig", "Turkey", 20], 179: ["Premiership", "Scotland", 12],
  253: ["Major League Soccer", "USA", 20], 71: ["Serie A", "Brazil", 20],
  307: ["Pro League", "Saudi-Arabia", 18], 40: ["Championship", "England", 24],
};
const FREE_MAX_SEASON = 2023;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function season(leagueId, year) {
  const [name, country, n] = LEAGUES[leagueId];
  const r = rng(leagueId * 1000 + year);
  const teams = Array.from({ length: n }, (_, i) => ({ id: leagueId * 100 + i, name: `${name.slice(0, 3).toUpperCase()} FC ${i + 1}` }));
  const resp = [];
  let fid = leagueId * 1000000 + year * 100;
  const start = Date.UTC(year, 7, 10); // Aug 10 of that year
  const rounds = 2 * (n - 1) > 34 ? 34 : 2 * (n - 1);
  for (let round = 0; round < rounds; round++) {
    const order = [...teams].sort(() => r() - 0.5);
    for (let i = 0; i + 1 < n; i += 2) {
      const ko = start + round * 7.4 * 86400000 + (12 + Math.floor(r() * 8)) * 3600000;
      const finished = true; // whole old season complete
      const gh = Math.floor(r() * 5), ga = Math.floor(r() * 4);
      const noHT = r() < 0.1;
      resp.push({
        fixture: { id: fid++, date: new Date(ko).toISOString(), status: { short: r() < 0.015 ? "PST" : "FT" } },
        league: { id: leagueId, name, country, season: year },
        teams: { home: order[i], away: order[i + 1] },
        goals: { home: gh, away: ga },
        score: { halftime: noHT ? { home: null, away: null } : { home: Math.min(gh, Math.floor(r() * 3)), away: Math.min(ga, Math.floor(r() * 2)) } },
      });
    }
  }
  return resp;
}

const server = http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  res.setHeader("Content-Type", "application/json");
  const ok = (response, extra = {}) => res.end(JSON.stringify({ get: u.pathname, parameters: u.query, errors: [], results: response.length, response, ...extra }));
  const planErr = (msg) => res.end(JSON.stringify({ get: u.pathname, parameters: u.query, errors: { plan: msg }, results: 0, response: [] }));

  if (u.pathname === "/fixtures") {
    const lg = parseInt(u.query.league, 10), yr = parseInt(u.query.season, 10);
    if (!LEAGUES[lg]) return ok([]);
    if (yr > FREE_MAX_SEASON) return planErr(`Free plans do not have access to the ${yr} season. Your plan only allows seasons up to ${FREE_MAX_SEASON}.`);
    return ok(season(lg, yr));
  }
  if (u.pathname === "/fixtures/statistics") {
    const fid = parseInt(u.query.fixture, 10);
    const r = rng(fid);
    const mk = (tid) => ({
      team: { id: tid },
      statistics: [
        { type: "Corner Kicks", value: 2 + Math.floor(r() * 7) },
        { type: "Yellow Cards", value: Math.floor(r() * 4) },
        { type: "Red Cards", value: r() < 0.1 ? 1 : 0 },
      ],
    });
    return ok([mk(1), mk(2)]);
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ errors: { endpoint: "not found" } }));
});

server.listen(4500, () => console.log("mock api-football on :4500"));
