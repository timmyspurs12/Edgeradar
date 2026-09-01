/**
 * Mock football-data.org v4 server for end-to-end testing of the live pipeline.
 * Serves realistic payloads incl. edge cases: null halfTime scores, TBD teams,
 * POSTPONED matches, IN_PLAY matches. Run: node scripts/mock-fdo.js
 */
const http = require("http");

const COMPS = {
  PL: 20, PD: 20, SA: 20, BL1: 18, FL1: 18,
  CL: 36, DED: 18, PPL: 18, BSA: 20, ELC: 24,
};

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function genSeason(code, season) {
  const r = rng(code.split("").reduce((s, c) => s * 31 + c.charCodeAt(0), season));
  const n = COMPS[code];
  const teams = Array.from({ length: n }, (_, i) => ({
    id: 1000 * season % 97 * 1000 + i + (code.charCodeAt(0) * 100), // stable-ish per comp
    name: `${code} Club ${i + 1}`,
    shortName: `${code}${i + 1}`,
  }));
  const matches = [];
  let id = season * 100000 + code.charCodeAt(1) * 1000;
  const now = Date.now();
  const DAY = 86400000;
  const isPast = season < 2026;
  // rounds of pairings
  const rounds = isPast ? 2 * (n - 1) > 30 ? 30 : 2 * (n - 1) : 30;
  for (let round = 0; round < rounds; round++) {
    const order = [...teams].sort(() => r() - 0.5);
    // past season: all finished long ago; current: mix
    for (let i = 0; i + 1 < n; i += 2) {
      const daysOffset = isPast
        ? -400 + round * 7
        : -120 + round * 5.5; // current season spans past ~120d into future ~45d
      const ko = now + daysOffset * DAY + (12 + Math.floor(r() * 9)) * 3600000;
      let status;
      if (ko < now - 3 * 3600000) status = "FINISHED";
      else if (ko < now) status = r() < 0.5 ? "IN_PLAY" : "PAUSED";
      else status = r() < 0.5 ? "TIMED" : "SCHEDULED";
      if (!isPast && r() < 0.02) status = "POSTPONED";
      const finished = status === "FINISHED";
      const hg = finished ? Math.floor(r() * 5) : null;
      const ag = finished ? Math.floor(r() * 4) : null;
      // ~12% of finished matches lack a half-time split (real-world messiness)
      const noHT = r() < 0.12;
      const home = order[i], away = order[i + 1];
      // CL: some knockout matches have TBD teams
      const tbd = code === "CL" && !isPast && r() < 0.05 && !finished;
      matches.push({
        id: id++,
        utcDate: new Date(ko).toISOString(),
        status,
        homeTeam: tbd ? {} : home,
        awayTeam: tbd ? {} : away,
        score: {
          fullTime: { home: hg, away: ag },
          halfTime: finished && !noHT
            ? { home: Math.min(hg, Math.floor(r() * 3)), away: Math.min(ag, Math.floor(r() * 2)) }
            : { home: null, away: null },
        },
      });
    }
  }
  return { matches, resultSet: { first: `${season}-08-01`, last: `${season + 1}-05-30` } };
}

const server = http.createServer((req, res) => {
  const m = req.url.match(/\/competitions\/([A-Z0-9]+)\/matches(\?season=(\d+))?/);
  if (!m || !COMPS[m[1]]) {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ message: "not found" }));
  }
  const season = m[3] ? parseInt(m[3], 10) : 2026;
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(genSeason(m[1], season)));
});

server.listen(4400, () => console.log("mock fdo on :4400"));
