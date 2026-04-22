// app/api/debug-odds/route.ts
// Page de diagnostic complète — visite /api/debug-odds sur ton site Vercel
import { NextRequest, NextResponse } from 'next/server';
import { COMPETITIONS } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = process.env.ODDS_API_KEY;
  const { searchParams } = new URL(req.url);
  const compId = parseInt(searchParams.get('compId') ?? '0');

  if (!key || key === 'your_odds_api_key_here') {
    return NextResponse.json({ error: 'ODDS_API_KEY non configuré dans les variables Vercel' });
  }

  // Sans compId : lister tous les sports actifs disponibles avec la clé
  if (!compId) {
    const r = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${key}`, { cache:'no-store' });
    if (!r.ok) {
      return NextResponse.json({ error: `HTTP ${r.status}`, raw: await r.text() });
    }
    const sports = await r.json() as Array<{key:string;title:string;active:boolean;group:string}>;
    const soccer = sports.filter(s => s.group === 'Soccer');
    const ourKeys = Object.values(COMPETITIONS).map(c => c.oddsKey);

    return NextResponse.json({
      message: 'Liste des sports football actifs sur The Odds API avec votre clé',
      total: sports.length,
      soccer: soccer.length,
      soccerActive: soccer.filter(s => s.active).map(s => ({
        key: s.key,
        title: s.title,
        inOurApp: ourKeys.includes(s.key),
      })),
      ourCompetitions: Object.entries(COMPETITIONS).map(([id, c]) => ({
        id: Number(id),
        name: c.name,
        oddsKey: c.oddsKey,
        isActiveOnApi: soccer.find(s => s.key === c.oddsKey)?.active ?? false,
      })),
      credits: r.headers.get('x-requests-remaining'),
    });
  }

  // Avec compId : tester une compétition spécifique
  const comp = COMPETITIONS[compId];
  if (!comp) {
    return NextResponse.json({ error: `compId ${compId} inconnu`, available: Object.keys(COMPETITIONS) });
  }

  const url = `https://api.the-odds-api.com/v4/sports/${comp.oddsKey}/odds/?apiKey=${key}&regions=eu&markets=h2h&oddsFormat=decimal`;
  const r = await fetch(url, { cache: 'no-store' });

  if (!r.ok) {
    return NextResponse.json({
      error: `HTTP ${r.status}`,
      competition: comp.name,
      oddsKey: comp.oddsKey,
      raw: await r.text(),
    });
  }

  const data = await r.json() as Array<{
    home_team: string;
    away_team: string;
    commence_time: string;
    bookmakers?: Array<{key:string;title:string}>;
  }>;

  return NextResponse.json({
    ok: true,
    competition: comp.name,
    oddsKey: comp.oddsKey,
    gamesFound: data.length,
    credits: r.headers.get('x-requests-remaining'),
    games: data.slice(0, 5).map(g => ({
      home: g.home_team,
      away: g.away_team,
      time: g.commence_time,
      bookmakers: (g.bookmakers ?? []).map(b => b.key),
    })),
  });
}
