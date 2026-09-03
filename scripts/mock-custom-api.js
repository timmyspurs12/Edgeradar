/**
 * Mock Custom Football API server for end-to-end testing of DATA_PROVIDER=custom.
 *
 * Serves the contract documented at the top of src/lib/providers/customapi.ts,
 * including the edge cases the normalizer has to survive:
 *   · offset and naive kickoff timestamps
 *   · vendor status vocabulary (NS / 1H / 2H / HT / FT / POSTPONED)
 *   · missing half-time splits, corners and cards (must stay null)
 *   · string-typed odds, and fixtures with no odds at all
 *   · one fixture with an unparseable kickoff (must be dropped, not guessed)
 *
 * Run:  node scripts/mock-custom-api.js            (port 4600)
 * Then: DATA_PROVIDER=custom CUSTOM_API_URL=http://127.0.0.1:4600 \
 *       CUSTOM_API_KEY=test-key npm run dev
 */
const http = require("http");

const PORT = Number(process.env.PORT || 4600);
const EXPECTED_KEY = process.env.CUSTOM_API_KEY || "";

const LEAGUE = {
  id: "npfl",
  name: "Nigeria Premier Football League",
  country: "Nigeria",
  tier: 1,
  broadcastStatus: "PUBLIC_COVERAGE_VERIFIED",
  broadcastEvidence: "Listed as publicly televised by the league; not independently verified by EdgeRadar.",
  officialSite: "https://example.test/npfl",
  hasCornerData: true,
  hasCardData: true,
  hasOddsFeed: true,
};

const TEAMS = [
  "Enyimba", "Rivers United", "Plateau United", "Remo Stars",
  "Bendel Insurance", "Kano Pillars", "Lobi Stars", "Nasarawa United",
  "Shooting Stars", "Wikki Tourists", "Heartland", "Gombe United",
];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function build() {
  const r = rng(20260903);
  const now = Date.now();
  const teams = TEAMS.map((name, i) => ({
    id: `t${i + 1}`,
    leagueId: LEAGUE.id,
    name,
    short: name.slice(0, 3).toUpperCase(),
  }));

  const fixtures = [];
  const historical = [];

  // One round per day for 9 days, centred on today, so the app always has a
  // mix of finished / live / upcoming matches to work with.
  for (let day = -4; day <= 4; day++) {
    const dayStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + day, 15, 0, 0);
    const shuffled = [...teams].sort(() => r() - 0.5);
    for (let m = 0; m < 6; m++) {
      const home = shuffled[m * 2];
      const away = shuffled[m * 2 + 1];
      const kickoffMs = dayStart + m * 30 * 60000;
      const id = `${day + 5}-${m}`;

      let status = "NS";
      let result;
      if (kickoffMs < now - 2 * 3600000) {
        status = "FT";
        const hg = Math.floor(r() * 4);
        const ag = Math.floor(r() * 3);
        result = {
          hg, ag,
          hg1: Math.floor(hg / 2), ag1: Math.floor(ag / 2),
          corners: 6 + Math.floor(r() * 8),
          cards: 1 + Math.floor(r() * 5),
        };
      } else if (kickoffMs < now) {
        status = m % 2 === 0 ? "1H" : "2H";
      }

      // Vary the kickoff format so UTC normalization is exercised.
      let kickoff;
      if (m % 3 === 0) kickoff = iso(kickoffMs);
      else if (m % 3 === 1) kickoff = iso(kickoffMs).replace("Z", "+00:00");
      else kickoff = iso(kickoffMs).replace("Z", "").slice(0, 19) + "+01:00";

      const fx = {
        id,
        leagueId: LEAGUE.id,
        leagueName: LEAGUE.name,
        country: LEAGUE.country,
        homeId: home.id,
        awayId: away.id,
        homeName: home.name,
        awayName: away.name,
        kickoff,
        status,
        result,
        lineupStatus: status === "NS" ? "NOT_ANNOUNCED" : "ANNOUNCED",
        injuryInfo: null,
      };

      // Odds only on upcoming matches, and only on some of them — the engine
      // must label the rest as model-derived rather than inventing a price.
      if (status === "NS" && m % 2 === 0) {
        fx.odds = {
          "O1.5": (1.15 + r() * 0.35).toFixed(2),
          "2H_O0.5": String((1.2 + r() * 0.4).toFixed(2)),
          "O2.5": (1.7 + r() * 0.6).toFixed(2),
        };
      }

      fixtures.push(fx);

      if (status === "FT" && result) {
        historical.push({
          id: `h-${id}`,
          leagueId: LEAGUE.id,
          homeId: home.id,
          awayId: away.id,
          date: iso(kickoffMs),
          hg: result.hg,
          ag: result.ag,
          hg1: result.hg1,
          ag1: result.ag1,
          corners: result.corners,
          cards: result.cards,
        });
      }
    }
  }

  // A postponed match (dropped) and a corrupt kickoff (dropped, never guessed).
  fixtures.push({
    id: "postponed-1", leagueId: LEAGUE.id, homeId: "t1", awayId: "t2",
    homeName: TEAMS[0], awayName: TEAMS[1],
    kickoff: iso(now + 86400000), status: "POSTPONED",
  });
  fixtures.push({
    id: "corrupt-1", leagueId: LEAGUE.id, homeId: "t3", awayId: "t4",
    homeName: TEAMS[2], awayName: TEAMS[3],
    kickoff: "not-a-timestamp", status: "NS",
  });

  // Two matches anchored to the current clock so the pipeline always has
  // in-play fixtures to handle: one 25 minutes in, one at half time.
  fixtures.push({
    id: "live-1h", leagueId: LEAGUE.id, homeId: "t5", awayId: "t6",
    homeName: TEAMS[4], awayName: TEAMS[5],
    kickoff: iso(now - 25 * 60000), status: "1H",
    result: { hg: 1, ag: 0 },
    lineupStatus: "ANNOUNCED", injuryInfo: null,
  });
  fixtures.push({
    id: "live-ht", leagueId: LEAGUE.id, homeId: "t7", awayId: "t8",
    homeName: TEAMS[6], awayName: TEAMS[7],
    kickoff: iso(now - 48 * 60000), status: "HT",
    result: { hg: 0, ag: 0, hg1: 0, ag1: 0 },
    lineupStatus: "ANNOUNCED", injuryInfo: null,
  });

  // Extra completed history so the engine clears its minimum sample size.
  for (let i = 0; i < 240; i++) {
    const home = teams[Math.floor(r() * teams.length)];
    const away = teams[Math.floor(r() * teams.length)];
    if (home.id === away.id) continue;
    const hg = Math.floor(r() * 4);
    const ag = Math.floor(r() * 3);
    historical.push({
      id: `hx-${i}`,
      leagueId: LEAGUE.id,
      homeId: home.id,
      awayId: away.id,
      date: iso(now - (30 + i) * 86400000),
      hg, ag,
      hg1: Math.floor(hg / 2), ag1: Math.floor(ag / 2),
      corners: 6 + Math.floor(r() * 8),
      cards: 1 + Math.floor(r() * 5),
    });
  }

  return { leagues: [LEAGUE], teams, fixtures, historical };
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);

  if (EXPECTED_KEY) {
    const auth = req.headers.authorization || "";
    const apiKey = req.headers["x-api-key"] || "";
    if (auth !== `Bearer ${EXPECTED_KEY}` && apiKey !== EXPECTED_KEY) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "missing or invalid API key" }));
    }
  }

  const send = (obj) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  if (u.pathname === "/data") return send(build());
  if (u.pathname === "/fixtures") return send({ fixtures: build().fixtures });
  if (u.pathname === "/health") return send({ ok: true, ts: new Date().toISOString() });

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: `no route ${u.pathname}` }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Mock Custom Football API on http://127.0.0.1:${PORT} (/data, /fixtures, /health)`);
});
