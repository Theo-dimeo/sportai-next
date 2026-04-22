// app/api/odds/route.ts — Cotes réelles via The Odds API (the-odds-api.com)
import { NextRequest, NextResponse } from 'next/server';
import { COMPETITIONS } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = process.env.ODDS_API_KEY;
  if (!key || key === 'your_odds_api_key_here') {
    return NextResponse.json({ ok: false, reason: 'ODDS_API_KEY non configuré', odds: [] });
  }

  const { searchParams } = new URL(req.url);
  const compId = parseInt(searchParams.get('compId') ?? '0');
  const comp = COMPETITIONS[compId];

  if (!comp?.oddsKey) {
    return NextResponse.json({ ok: false, reason: `Compétition ${compId} non trouvée`, odds: [] });
  }

  try {
    // The Odds API — région EU, format décimal, marchés 1X2 + totaux + BTTS
    const params = new URLSearchParams({
      apiKey:      key,
      regions:     'eu',
      markets:     'h2h,totals,btts',
      oddsFormat:  'decimal',
    });

    const url = `https://api.the-odds-api.com/v4/sports/${comp.oddsKey}/odds/?${params}`;
    const res = await fetch(url, { cache: 'no-store' });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = (body as {message?:string}).message ?? `HTTP ${res.status}`;

      // Si la ligue n'est pas en saison, l'API renvoie 404 ou message d'erreur
      if (res.status === 404 || msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('unknown')) {
        return NextResponse.json({
          ok: false,
          reason: `${comp.name} hors saison ou indisponible sur The Odds API`,
          odds: [],
        });
      }
      return NextResponse.json({ ok: false, reason: msg, odds: [] });
    }

    const data = await res.json();
    const remaining = res.headers.get('x-requests-remaining');
    const used      = res.headers.get('x-requests-used');

    // Vérifier qu'on a bien des données
    if (!Array.isArray(data) || data.length === 0) {
      return NextResponse.json({
        ok: false,
        reason: `Aucun match disponible pour ${comp.name} (hors saison ou pas de matchs aujourd'hui)`,
        odds: [],
        remaining,
      });
    }

    return NextResponse.json({
      ok: true,
      odds: data,
      count: data.length,
      competition: comp.name,
      oddsKey: comp.oddsKey,
      remaining,
      used,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, reason: (e as Error).message, odds: [] });
  }
}
