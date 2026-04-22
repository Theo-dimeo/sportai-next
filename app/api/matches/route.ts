// app/api/matches/route.ts
// Récupère les matchs pour une date précise en heure de Paris
import { NextRequest, NextResponse } from 'next/server';
import { parseMatch } from '@/lib/parser';
import { predict } from '@/lib/predictor';
import { COMPETITIONS } from '@/lib/types';

export const revalidate = 30; // refresh toutes les 30s pour les matchs live

export async function GET(req: NextRequest) {
  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key || key === 'your_football_data_token_here') {
    return NextResponse.json({ ok: false, error: 'FOOTBALL_DATA_KEY manquant.' }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  // date au format YYYY-MM-DD (heure Paris, envoyée par le frontend)
  const requestedDate = searchParams.get('date');

  // On construit la plage UTC pour couvrir toute la journée Paris (UTC+1 ou UTC+2)
  // Paris = UTC+1 en hiver, UTC+2 en été
  // Une journée Paris commence au plus tôt à 22h UTC du jour J-1
  // et se termine au plus tard à 22h UTC du jour J
  // → on demande dateFrom=J-1, dateTo=J+1 (dateTo EXCLUSIF) puis on filtre côté serveur
  let targetDate: Date;
  if (requestedDate) {
    targetDate = new Date(requestedDate + 'T12:00:00Z'); // midi UTC = toujours le bon jour Paris
  } else {
    targetDate = new Date();
  }

  const prev = new Date(targetDate);
  prev.setUTCDate(targetDate.getUTCDate() - 1);
  const next = new Date(targetDate);
  next.setUTCDate(targetDate.getUTCDate() + 2); // dateTo EXCLUSIF

  const dateFrom = prev.toISOString().split('T')[0];
  const dateTo   = next.toISOString().split('T')[0];

  // Jour cible en heure Paris (YYYY-MM-DD)
  const parisDay = requestedDate ?? new Date().toLocaleDateString('fr-FR', {
    timeZone: 'Europe/Paris', year:'numeric', month:'2-digit', day:'2-digit'
  }).split('/').reverse().join('-');

  try {
    const url = `https://api.football-data.org/v4/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`;
    const res = await fetch(url, {
      headers: { 'X-Auth-Token': key },
      next: { revalidate: 30 },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return NextResponse.json(
        { ok: false, error: (err as { message?: string }).message ?? `HTTP ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json() as { matches: unknown[] };
    const allMatches = data.matches ?? [];

    // Filtrer : compétitions dispo ET jour Paris correct
    const availableCompIds = Object.keys(COMPETITIONS).map(Number);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filtered = (allMatches as any[]).filter(m => {
      if (!availableCompIds.includes(m.competition?.id)) return false;
      if (!m.utcDate) return false;
      // Convertir utcDate en jour Paris
      const matchDayParis = new Date(m.utcDate).toLocaleDateString('fr-FR', {
        timeZone: 'Europe/Paris', year:'numeric', month:'2-digit', day:'2-digit'
      }).split('/').reverse().join('-');
      return matchDayParis === parisDay;
    });

    const matches = filtered.map(parseMatch);

    // Prédictions IA — uniquement pour les matchs pas encore terminés
    const matchesWithPreds = matches.map(m => ({
      ...m,
      prediction: m.isDone ? null : predict(m),
    }));

    // Trier : en cours d'abord, puis à venir par heure, terminés en dernier
    matchesWithPreds.sort((a, b) => {
      const order = (m: typeof a) => m.isLive ? 0 : m.isDone ? 2 : 1;
      if (order(a) !== order(b)) return order(a) - order(b);
      return a.date.localeCompare(b.date);
    });

    return NextResponse.json({
      ok: true,
      count: matchesWithPreds.length,
      parisDay,
      serverTime: new Date().toISOString(),
      matches: matchesWithPreds,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
