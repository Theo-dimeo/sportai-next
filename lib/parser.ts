// lib/parser.ts
import type { Match } from './types';
import { COMPETITIONS } from './types';

export function fmtTimeParis(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris'
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseMatch(m: any): Match {
  const compId = m.competition?.id as number;
  const meta = COMPETITIONS[compId];
  const hG = m.score?.fullTime?.home ?? null;
  const aG = m.score?.fullTime?.away ?? null;
  const isLive = ['IN_PLAY','PAUSED'].includes(m.status);
  const isDone = ['FINISHED','AWARDED'].includes(m.status);

  return {
    id: String(m.id),
    competition: meta?.name ?? m.competition?.name ?? 'Inconnu',
    competitionId: compId,
    competitionCode: meta?.code ?? m.competition?.code ?? '',
    date: m.utcDate ?? '',
    time: m.utcDate ? fmtTimeParis(m.utcDate) : '--:--',
    status: m.status,
    minute: m.minute ?? null,
    homeTeam: {
      name: m.homeTeam?.shortName ?? m.homeTeam?.name ?? '?',
      shortName: m.homeTeam?.shortName ?? m.homeTeam?.name ?? '?',
      crest: m.homeTeam?.crest ?? null,
      xG: 1.45, form: [], avgGoals: 1.5, avgConceded: 1.2, attack: 7, defense: 7,
    },
    awayTeam: {
      name: m.awayTeam?.shortName ?? m.awayTeam?.name ?? '?',
      shortName: m.awayTeam?.shortName ?? m.awayTeam?.name ?? '?',
      crest: m.awayTeam?.crest ?? null,
      xG: 1.2, form: [], avgGoals: 1.3, avgConceded: 1.3, attack: 6.5, defense: 6.5,
    },
    score: { home: hG, away: aG },
    h2h: { homeWins: 4, draws: 3, awayWins: 3 },
    isLive, isDone,
  };
}

// ─── TEAM NAME NORMALIZER ─────────────────────────────────────
// Gère les variantes courantes entre football-data et The Odds API
// Ex: "Man City" vs "Manchester City", "PSG" vs "Paris Saint-Germain"
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Score de similarité entre deux noms d'équipe (0 à 1)
function teamSimilarity(a: string, b: string): number {
  const na = norm(a);
  const nb = norm(b);

  // Correspondance exacte
  if (na === nb) return 1.0;

  // L'un contient l'autre
  if (na.includes(nb) || nb.includes(na)) return 0.9;

  // Première "word" identique (ex: "Manchester" dans "Manchester City" et "Manchester United")
  // — non suffisant seul, mais utile combiné

  // Tokenize et chercher les mots en commun
  const wordsA = new Set(na.split(' ').filter(w => w.length > 2));
  const wordsB = new Set(nb.split(' ').filter(w => w.length > 2));
  const intersection = [...wordsA].filter(w => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);
  if (union.size === 0) return 0;
  const jaccard = intersection.length / union.size;

  // Bonus si le premier token est identique (important pour "Real Madrid" vs "Real Betis")
  const firstA = na.split(' ')[0];
  const firstB = nb.split(' ')[0];
  const firstMatch = firstA === firstB && firstA.length > 3 ? 0.1 : 0;

  // Préfixe commun (min 4 chars)
  let prefixLen = 0;
  const minLen = Math.min(na.length, nb.length);
  while (prefixLen < minLen && na[prefixLen] === nb[prefixLen]) prefixLen++;
  const prefixScore = prefixLen >= 4 ? (prefixLen / Math.max(na.length, nb.length)) * 0.3 : 0;

  return Math.min(1, jaccard + firstMatch + prefixScore);
}

// Associer les cotes Odds API à un match par similarité de noms
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function matchOddsToMatch(match: Match, oddsGames: any[]) {
  if (!oddsGames?.length) return null;

  // Football-data utilise shortName (ex: "Man City"), fullName si pas de shortName
  const hSearch = match.homeTeam.name;
  const aSearch = match.awayTeam.name;

  // Trouver le meilleur match par score de similarité
  let bestGame = null;
  let bestScore = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const g of oddsGames as any[]) {
    const gh = g.home_team ?? '';
    const ga = g.away_team ?? '';

    // Calcule la similarité dans les deux sens (home→home + away→away)
    const simH = teamSimilarity(hSearch, gh);
    const simA = teamSimilarity(aSearch, ga);
    const score = simH + simA;

    // Aussi essayer home↔away inversé (rare mais ça arrive avec certains bookmakers)
    const simHinv = teamSimilarity(hSearch, ga);
    const simAinv = teamSimilarity(aSearch, gh);
    const scoreInv = simHinv + simAinv;

    const best = Math.max(score, scoreInv);
    if (best > bestScore) {
      bestScore = best;
      bestGame = g;
    }
  }

  // Seuil minimal : les deux équipes doivent avoir une similarité raisonnable
  if (!bestGame || bestScore < 0.9) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bkMap: Record<string, any> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (bestGame.bookmakers ?? []).forEach((bk: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h2h = bk.markets?.find((mk: any) => mk.key === 'h2h');
    if (!h2h) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: Record<string, number> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    h2h.outcomes?.forEach((o: any) => { out[o.name] = parseFloat(Number(o.price).toFixed(2)); });
    const homeOdd = out[bestGame.home_team];
    const awayOdd = out[bestGame.away_team];
    const drawOdd = out['Draw'] ?? null;
    if (homeOdd && awayOdd) {
      // Extraire totals (Over/Under 2.5, 1.5, 3.5)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const totals = bk.markets?.find((mk: any) => mk.key === 'totals');
      const totalsMap: Record<string, number> = {};
      if (totals) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        totals.outcomes?.forEach((o: any) => {
          const key = `${o.name}_${o.point}`; // ex: "Over_2.5", "Under_2.5"
          totalsMap[key] = parseFloat(Number(o.price).toFixed(2));
        });
      }
      // Extraire BTTS (Les deux équipes marquent)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bttsMarket = bk.markets?.find((mk: any) => mk.key === 'btts');
      const bttsMap: Record<string, number> = {};
      if (bttsMarket) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        bttsMarket.outcomes?.forEach((o: any) => {
          // "Yes" → btts_yes, "No" → btts_no
          bttsMap[`btts_${o.name.toLowerCase()}`] = parseFloat(Number(o.price).toFixed(2));
        });
      }
      bkMap[bk.key] = {
        key: bk.key, name: bk.title,
        home: homeOdd, draw: drawOdd, away: awayOdd,
        ...totalsMap,
        ...bttsMap,
      };
    }
  });

  const keys = Object.keys(bkMap);
  if (!keys.length) return null;

  // Agréger les meilleures cotes pour chaque marché
  const allTotalsKeys = new Set(keys.flatMap(k => Object.keys(bkMap[k]).filter(p => p.startsWith('Over_') || p.startsWith('Under_'))));
  const bestTotals: Record<string, number> = {};
  allTotalsKeys.forEach(tk => {
    const vals = keys.map(k => bkMap[k][tk]).filter(Boolean);
    if (vals.length) bestTotals[`best_${tk}`] = Math.max(...vals);
  });

  return {
    bkMap,
    bestHome: Math.max(...keys.map(k => bkMap[k].home ?? 0)),
    bestDraw: Math.max(...keys.map(k => bkMap[k].draw ?? 0)),
    bestAway: Math.max(...keys.map(k => bkMap[k].away ?? 0)),
    bestBttsYes: Math.max(...keys.map(k => bkMap[k].btts_yes ?? 0).filter(Boolean), 0) || null,
    bestBttsNo:  Math.max(...keys.map(k => bkMap[k].btts_no  ?? 0).filter(Boolean), 0) || null,
    ...bestTotals,
    // Garder les noms originaux de l'Odds API pour debug
    oddsApiHome: bestGame.home_team,
    oddsApiAway: bestGame.away_team,
    matchScore: bestScore,
  };
}
