// app/api/status/route.ts — Diagnostic complet
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const footballKey = process.env.FOOTBALL_DATA_KEY ?? '';
  const oddsKey     = process.env.ODDS_API_KEY ?? '';
  const fbOk   = !!footballKey && footballKey !== 'your_football_data_token_here';
  const oddsOk = !!oddsKey     && oddsKey     !== 'your_odds_api_key_here';

  // ── Test football-data.org ────────────────────────────────
  let fbTest: { ok: boolean; matchCount?: number; error?: string } = { ok: false };
  if (fbOk) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const r = await fetch(
        `https://api.football-data.org/v4/matches?dateFrom=${today}&dateTo=${today}`,
        { headers: { 'X-Auth-Token': footballKey }, cache: 'no-store' }
      );
      if (r.ok) {
        const d = await r.json();
        fbTest = { ok: true, matchCount: d.matches?.length ?? 0 };
      } else {
        const err = await r.json().catch(() => ({}));
        fbTest = { ok: false, error: `HTTP ${r.status} — ${(err as {message?:string}).message ?? ''}` };
      }
    } catch (e) { fbTest = { ok: false, error: (e as Error).message }; }
  }

  // ── Test The Odds API ─────────────────────────────────────
  // On commence par /sports qui ne coûte PAS de crédits
  let oddsTest: {
    ok: boolean;
    provider?: string;
    availableSoccerLeagues?: string[];
    premierLeagueAvailable?: boolean;
    ligue1Available?: boolean;
    creditsRemaining?: string;
    error?: string;
  } = { ok: false };

  if (oddsOk) {
    try {
      const r = await fetch(
        `https://api.the-odds-api.com/v4/sports/?apiKey=${oddsKey}`,
        { cache: 'no-store' }
      );

      if (r.ok) {
        const sports = await r.json() as Array<{key:string; title:string; active:boolean; group:string}>;
        const soccerActive = sports
          .filter(s => s.group === 'Soccer' && s.active)
          .map(s => ({ key: s.key, title: s.title }));

        oddsTest = {
          ok: true,
          provider: 'the-odds-api.com ✓',
          availableSoccerLeagues: soccerActive.map(s => `${s.key} (${s.title})`),
          premierLeagueAvailable: soccerActive.some(s => s.key === 'soccer_epl'),
          ligue1Available: soccerActive.some(s => s.key === 'soccer_france_ligue1'),
          creditsRemaining: r.headers.get('x-requests-remaining') ?? 'n/a',
        };
      } else {
        const err = await r.json().catch(() => ({}));
        oddsTest = {
          ok: false,
          error: `HTTP ${r.status} — ${(err as {message?:string}).message ?? 'Clé invalide ?'}`,
        };
      }
    } catch (e) {
      oddsTest = { ok: false, error: (e as Error).message };
    }
  }

  const allGood = fbOk && fbTest.ok && oddsOk && oddsTest.ok;

  return NextResponse.json({
    ok: true,
    serverTime: new Date().toISOString(),
    footballData: {
      configured: fbOk,
      keyPreview: fbOk ? `${footballKey.slice(0,6)}…` : null,
      test: fbTest,
    },
    oddsApi: {
      configured: oddsOk,
      keyPreview: oddsOk ? `${oddsKey.slice(0,6)}…` : null,
      test: oddsTest,
    },
    summary: allGood
      ? '✅ Tout fonctionne — matchs et cotes actifs'
      : !fbOk
        ? '❌ FOOTBALL_DATA_KEY manquant → Vercel Settings → Environment Variables → Redeploy'
        : !fbTest.ok
          ? `❌ football-data.org répond mais erreur: ${fbTest.error}`
          : fbTest.matchCount === 0
            ? '⚠️ football-data OK mais 0 match aujourd\'hui (normal certains jours)'
            : !oddsOk
              ? '⚠️ ODDS_API_KEY manquant — cotes IA utilisées à la place'
              : !oddsTest.ok
                ? `❌ The Odds API erreur: ${oddsTest.error}`
                : '✅ Tout configuré',
  });
}
