// app/api/debug-match/route.ts — Trace exacte du matching équipes + cotes
import { NextRequest, NextResponse } from 'next/server';
import { COMPETITIONS } from '@/lib/types';
import { matchOddsToMatch } from '@/lib/parser';
import type { Match } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const oddsKey = process.env.ODDS_API_KEY;
  const fbKey   = process.env.FOOTBALL_DATA_KEY;
  const { searchParams } = new URL(req.url);
  const compId  = parseInt(searchParams.get('compId') ?? '2021');

  if (!oddsKey) return NextResponse.json({ error: 'ODDS_API_KEY manquant' });
  if (!fbKey)   return NextResponse.json({ error: 'FOOTBALL_DATA_KEY manquant' });

  const comp = COMPETITIONS[compId];
  if (!comp) return NextResponse.json({ error: `compId ${compId} inconnu`, available: Object.keys(COMPETITIONS) });

  // 1. Matchs football-data (fenêtre J-1 / J+1)
  const prev = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const next = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const fbRes  = await fetch(
    `https://api.football-data.org/v4/matches?dateFrom=${prev}&dateTo=${next}`,
    { headers: { 'X-Auth-Token': fbKey }, cache: 'no-store' }
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fbData = await fbRes.json() as { matches: any[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fbMatches = (fbData.matches ?? []).filter((m: any) => m.competition?.id === compId);

  // 2. Cotes Odds API avec les 3 marchés
  const oddsRes = await fetch(
    `https://api.the-odds-api.com/v4/sports/${comp.oddsKey}/odds/?apiKey=${oddsKey}&regions=eu&markets=h2h,totals&oddsFormat=decimal`,
    { cache: 'no-store' }
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oddsData: any[] = oddsRes.ok ? await oddsRes.json() : [];

  // 3. Matching et trace
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = fbMatches.slice(0, 10).map((m: any) => {
    const fakeMatch: Match = {
      id: String(m.id),
      competition: comp.name,
      competitionId: compId,
      competitionCode: comp.code ?? '',
      date: m.utcDate,
      time: '',
      status: m.status,
      minute: null,
      homeTeam: {
        name: m.homeTeam?.shortName ?? m.homeTeam?.name ?? '?',
        shortName: m.homeTeam?.shortName ?? m.homeTeam?.name ?? '?',
        crest: null, xG: 1.45, form: [], avgGoals: 1.5, avgConceded: 1.2, attack: 7, defense: 7,
      },
      awayTeam: {
        name: m.awayTeam?.shortName ?? m.awayTeam?.name ?? '?',
        shortName: m.awayTeam?.shortName ?? m.awayTeam?.name ?? '?',
        crest: null, xG: 1.2, form: [], avgGoals: 1.3, avgConceded: 1.3, attack: 6.5, defense: 6.5,
      },
      score: { home: null, away: null },
      h2h: { homeWins: 4, draws: 3, awayWins: 3 },
      isLive: false,
      isDone: ['FINISHED', 'AWARDED'].includes(m.status),
    };

    const matched = matchOddsToMatch(fakeMatch, oddsData);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstBk = matched ? Object.values(matched.bkMap)[0] as any : null;

    return {
      fbHome:         fakeMatch.homeTeam.name,
      fbAway:         fakeMatch.awayTeam.name,
      status:         m.status,
      matched:        !!matched,
      matchScore:     matched?.matchScore ?? null,
      oddsApiHome:    matched?.oddsApiHome ?? null,
      oddsApiAway:    matched?.oddsApiAway ?? null,
      bookmakerCount: matched ? Object.keys(matched.bkMap).length : 0,
      bookmakers:     matched ? Object.keys(matched.bkMap) : [],
      sampleOdds:     firstBk ? {
        bk:       firstBk.key,
        home:     firstBk.home,
        draw:     firstBk.draw,
        away:     firstBk.away,
        btts_yes: firstBk['btts_yes'] ?? null,
        over_25:  firstBk['Over_2.5'] ?? null,
        under_25: firstBk['Under_2.5'] ?? null,
      } : null,
      bestOdds: matched ? {
        bestHome:    matched.bestHome,
        bestDraw:    matched.bestDraw,
        bestAway:    matched.bestAway,
        
        bestOver25:  (matched as Record<string,unknown>)['best_Over_2.5'],
      } : null,
    };
  });

  // Détail des marchés et points disponibles sur le premier match
  const firstGame = oddsData[0];
  const firstBk   = firstGame?.bookmakers?.[0];
  const marketsDetail = firstBk?.markets?.map((mk: {key:string;outcomes:Array<{name:string;point?:number;price:number}>}) => ({
    key: mk.key,
    outcomes: mk.outcomes?.map(o => `${o.name}${o.point!=null?'_'+o.point:''} → ${o.price}`),
  })) ?? [];

  const summary = {
    ok: true,
    competition: comp.name,
    fbMatchCount:    fbMatches.length,
    oddsApiCount:    oddsData.length,
    marketsReceived: firstBk?.markets?.map((mk: {key:string}) => mk.key) ?? [],
    marketsDetail,   // ← détail complet avec tous les points disponibles
    creditsLeft:     oddsRes.headers?.get('x-requests-remaining'),
    matchedCount:    results.filter(r => r.matched).length,
    results,
    oddsApiTeams:    oddsData.map((g: {home_team:string;away_team:string}) => `${g.home_team} vs ${g.away_team}`),
  };

  return NextResponse.json(summary);
}
