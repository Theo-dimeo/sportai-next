// lib/predictor.ts — Moteur IA complet avec génération de toutes les catégories de paris
import type { Match, Prediction, BetOption, RiskLevel } from './types';

// ─── POISSON ──────────────────────────────────────────────────
function pp(lambda: number, k: number): number {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return Math.exp(-lambda) * Math.pow(lambda, k) / f;
}

interface PoissonMatrix {
  lH: number; lA: number;
  pH: number; pD: number; pA: number;
  pO25: number; pU25: number;
  pO15: number; pU15: number;
  pO35: number; pU35: number;
  pBTTS: number; pNoBTTS: number;
  pCleanHome: number; pCleanAway: number;
  pHalfTimeHome: number; pHalfTimeDraw: number; pHalfTimeAway: number;
  pExact: Record<string, number>;
  expectedGoals: number;
}

function buildMatrix(lH: number, lA: number): PoissonMatrix {
  let pH=0, pD=0, pA=0, pO25=0, pU25=0, pO15=0, pU15=0, pO35=0, pU35=0;
  let pBTTS=0, pNoBTTS=0, pCleanHome=0, pCleanAway=0;
  let pHH=0, pHD=0, pHA=0;
  const pExact: Record<string, number> = {};

  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const p = pp(lH, i) * pp(lA, j);
      const total = i + j;
      if (i > j) pH += p; else if (i === j) pD += p; else pA += p;
      if (total > 2.5) pO25 += p; else pU25 += p;
      if (total > 1.5) pO15 += p; else pU15 += p;
      if (total > 3.5) pO35 += p; else pU35 += p;
      if (i > 0 && j > 0) pBTTS += p; else pNoBTTS += p;
      if (j === 0) pCleanHome += p;
      if (i === 0) pCleanAway += p;
      // Demi-temps simplifié (moitié des lambdas)
      const pHT = pp(lH * 0.5, i) * pp(lA * 0.5, j);
      if (i > j) pHH += pHT; else if (i === j) pHD += pHT; else pHA += pHT;
      // Scores exacts populaires
      const key = `${i}-${j}`;
      if (i <= 4 && j <= 4) pExact[key] = (pExact[key] ?? 0) + p;
    }
  }
  const tHT = pHH + pHD + pHA;
  return {
    lH, lA, pH, pD, pA, pO25, pU25, pO15, pU15, pO35, pU35,
    pBTTS, pNoBTTS, pCleanHome, pCleanAway,
    pHalfTimeHome: pHH/tHT, pHalfTimeDraw: pHD/tHT, pHalfTimeAway: pHA/tHT,
    pExact,
    expectedGoals: lH + lA,
  };
}

// ─── COTE IMPLICITE ───────────────────────────────────────────
const MARGIN = 1.065;
function impliedOdd(prob: number): number {
  return parseFloat(Math.min(20, Math.max(1.05, MARGIN / Math.max(0.02, prob))).toFixed(2));
}
function pct(p: number) { return parseFloat((p * 100).toFixed(1)); }

// ─── CONFIANCE ────────────────────────────────────────────────
function confScore(prob: number, base: number = 0): number {
  // prob = probabilité brute 0–1, base = bonus/malus contextuel
  return Math.min(97, Math.max(20, Math.round(35 + prob * 55 + base)));
}

// ─── GÉNÉRATEUR DE PARIS ──────────────────────────────────────
function generateBets(match: Match, m: PoissonMatrix): BetOption[] {
  const H = match.homeTeam.name;
  const A = match.awayTeam.name;
  const bets: BetOption[] = [];
  let idx = 0;
  const id = (suffix: string) => `${match.id}_${suffix}_${idx++}`;

  // ════════════════════════════════════════════════
  // 🛡️ SAFE — Paris à haute probabilité (>62%)
  // ════════════════════════════════════════════════

  // 1X2 dominant
  const maxProb = Math.max(m.pH, m.pD, m.pA);
  const resultKey = m.pH === maxProb ? 'home' : m.pA === maxProb ? 'away' : 'draw';
  const resultLabel = resultKey === 'home' ? `Victoire ${H}` : resultKey === 'away' ? `Victoire ${A}` : 'Match nul';
  if (maxProb > 0.50) {
    bets.push({
      id: id('result'), matchId: match.id, category: 'safe', emoji: '🏆',
      label: resultLabel, shortLabel: resultKey === 'draw' ? 'Nul' : 'Victoire',
      description: `L'équipe favorite selon le modèle Poisson`,
      odds: impliedOdd(maxProb), prob: pct(maxProb),
      confidence: confScore(maxProb, maxProb > 0.65 ? 8 : 0),
      risk: maxProb > 0.68 ? 'low' : 'medium',
      tag: maxProb > 0.68 ? 'Favori clair' : 'Favori',
      reasoning: `${pct(maxProb)}% de probabilité selon le modèle Poisson. xG ${m.lH.toFixed(2)}–${m.lA.toFixed(2)}.`,
    });
  }

  // Double chance (ex : 1X)
  const dc1X = m.pH + m.pD;
  const dc1X2 = m.pH + m.pA;
  const dcX2 = m.pD + m.pA;
  const bestDC = Math.max(dc1X, dc1X2, dcX2);
  if (bestDC > 0.70) {
    const dcLabel = bestDC === dc1X ? `${H} ou Nul` : bestDC === dc1X2 ? `${H} ou ${A}` : `${A} ou Nul`;
    const dcShort = bestDC === dc1X ? '1X' : bestDC === dc1X2 ? '1X2' : 'X2';
    bets.push({
      id: id('dc'), matchId: match.id, category: 'safe', emoji: '🛡️',
      label: `Double Chance — ${dcLabel}`, shortLabel: dcShort,
      description: 'Couvre deux résultats possibles sur trois',
      odds: impliedOdd(bestDC), prob: pct(bestDC),
      confidence: confScore(bestDC, 5),
      risk: 'low', tag: 'Sécurisé',
      reasoning: `${pct(bestDC)}% de probabilité en couvrant 2 issues sur 3.`,
    });
  }

  // Under 3.5 buts si match fermé attendu
  if (m.pU35 > 0.62) {
    bets.push({
      id: id('u35'), matchId: match.id, category: 'safe', emoji: '🔒',
      label: 'Under 3.5 buts', shortLabel: 'U3.5',
      description: 'Match fermé, peu de buts attendus',
      odds: impliedOdd(m.pU35), prob: pct(m.pU35),
      confidence: confScore(m.pU35, 3),
      risk: 'low', tag: 'Match fermé',
      reasoning: `xG total de ${m.expectedGoals.toFixed(2)} buts attendus. ${pct(m.pU35)}% pour Under 3.5.`,
    });
  }

  // Over 1.5 — très probable si match offensif
  if (m.pO15 > 0.72) {
    bets.push({
      id: id('o15'), matchId: match.id, category: 'safe', emoji: '⚽',
      label: 'Over 1.5 buts', shortLabel: 'O1.5',
      description: 'Au moins 2 buts dans ce match',
      odds: impliedOdd(m.pO15), prob: pct(m.pO15),
      confidence: confScore(m.pO15, 6),
      risk: 'low', tag: 'Très probable',
      reasoning: `${pct(m.pO15)}% de chance d'avoir au moins 2 buts. xG total : ${m.expectedGoals.toFixed(2)}.`,
    });
  }

  // Clean sheet si défense très solide
  if (m.pCleanHome > 0.42 && m.pA < 0.30) {
    bets.push({
      id: id('cs_h'), matchId: match.id, category: 'safe', emoji: '🧤',
      label: `Clean Sheet ${H}`, shortLabel: 'CS Dom.',
      description: `${H} ne prend pas de but`,
      odds: impliedOdd(m.pCleanHome), prob: pct(m.pCleanHome),
      confidence: confScore(m.pCleanHome, 4),
      risk: m.pCleanHome > 0.50 ? 'low' : 'medium',
      tag: 'Défense solide',
      reasoning: `${pct(m.pCleanHome)}% de chance que ${H} garde sa cage inviolée (xG adv.: ${m.lA.toFixed(2)}).`,
    });
  }
  if (m.pCleanAway > 0.42 && m.pH < 0.30) {
    bets.push({
      id: id('cs_a'), matchId: match.id, category: 'safe', emoji: '🧤',
      label: `Clean Sheet ${A}`, shortLabel: 'CS Ext.',
      description: `${A} ne prend pas de but en déplacement`,
      odds: impliedOdd(m.pCleanAway), prob: pct(m.pCleanAway),
      confidence: confScore(m.pCleanAway, 2),
      risk: 'medium', tag: 'Défense ext.',
      reasoning: `${pct(m.pCleanAway)}% de chance que ${A} ne prenne pas de but.`,
    });
  }

  // ════════════════════════════════════════════════
  // 💎 VALUE — Cotes intéressantes vs probabilité
  // ════════════════════════════════════════════════

  // BTTS si les deux équipes sont offensives
  if (m.pBTTS > 0.48) {
    bets.push({
      id: id('btts'), matchId: match.id, category: 'value', emoji: '💥',
      label: 'BTTS — Les deux marquent', shortLabel: 'BTTS',
      description: 'Les deux équipes trouvent le chemin des filets',
      odds: impliedOdd(m.pBTTS), prob: pct(m.pBTTS),
      confidence: confScore(m.pBTTS, 2),
      risk: m.pBTTS > 0.62 ? 'low' : 'medium',
      tag: m.pBTTS > 0.62 ? 'Value solide' : 'Value',
      reasoning: `xG dom. ${m.lH.toFixed(2)} + xG ext. ${m.lA.toFixed(2)} → ${pct(m.pBTTS)}% pour BTTS.`,
    });
  }

  // Over 2.5 — paris classique
  if (m.pO25 > 0.45) {
    bets.push({
      id: id('o25'), matchId: match.id, category: 'value', emoji: '🔥',
      label: 'Over 2.5 buts', shortLabel: 'O2.5',
      description: 'Au moins 3 buts au total dans ce match',
      odds: impliedOdd(m.pO25), prob: pct(m.pO25),
      confidence: confScore(m.pO25, m.pO25 > 0.60 ? 4 : 0),
      risk: m.pO25 > 0.62 ? 'low' : 'medium',
      tag: m.pO25 > 0.62 ? 'Favori O2.5' : 'O2.5',
      reasoning: `${pct(m.pO25)}% pour Over 2.5. Attendus : ${m.expectedGoals.toFixed(2)} buts totaux.`,
    });
  }

  // Nul si match très équilibré
  if (m.pD > 0.32) {
    bets.push({
      id: id('draw'), matchId: match.id, category: 'value', emoji: '⚖️',
      label: 'Match nul', shortLabel: 'Nul',
      description: 'Match très équilibré, partage probable',
      odds: impliedOdd(m.pD), prob: pct(m.pD),
      confidence: confScore(m.pD, -2),
      risk: 'medium',
      tag: 'Équilibré',
      reasoning: `Forces quasi-identiques. ${pct(m.pD)}% de probabilité de nul.`,
    });
  }

  // Résultat & BTTS (1 ET BTTS)
  if (maxProb > 0.48 && m.pBTTS > 0.48) {
    const combo = maxProb * m.pBTTS;
    bets.push({
      id: id('res_btts'), matchId: match.id, category: 'value', emoji: '💎',
      label: `${resultLabel} & BTTS`, shortLabel: 'Résultat+BTTS',
      description: 'Victoire du favori avec les deux équipes qui marquent',
      odds: impliedOdd(combo * 0.92), // légère correction de corrélation
      prob: pct(combo * 0.92),
      confidence: confScore(combo * 0.92, 2),
      risk: 'medium',
      tag: 'Value combiné',
      reasoning: `${pct(maxProb)}% résultat × ${pct(m.pBTTS)}% BTTS. Corrélation partielle intégrée.`,
    });
  }

  // ════════════════════════════════════════════════
  // 🔗 COMBO — Combinaisons sur le même match
  // ════════════════════════════════════════════════

  // Victoire + Over 1.5
  if (maxProb > 0.50 && m.pO15 > 0.68) {
    const combo = maxProb * m.pO15 * 1.02; // corrélation positive
    bets.push({
      id: id('res_o15'), matchId: match.id, category: 'combo', emoji: '🔗',
      label: `${resultLabel} + Over 1.5`, shortLabel: 'Vic+O1.5',
      description: 'Le favori gagne avec au moins 2 buts au total',
      odds: impliedOdd(combo), prob: pct(combo),
      confidence: confScore(combo, 0),
      risk: 'medium',
      tag: 'Combo facile',
      reasoning: `Corrélation positive entre victoire et nombre de buts. ${pct(combo)}% combiné.`,
    });
  }

  // Victoire & Clean sheet
  if (maxProb > 0.50 && ((resultKey === 'home' && m.pCleanHome > 0.38) || (resultKey === 'away' && m.pCleanAway > 0.38))) {
    const cs = resultKey === 'home' ? m.pCleanHome : m.pCleanAway;
    const combo = maxProb * cs * 1.05;
    bets.push({
      id: id('res_cs'), matchId: match.id, category: 'combo', emoji: '🔒',
      label: `${resultLabel} & Clean Sheet`, shortLabel: 'Vic+CS',
      description: 'Victoire et porte inviolée — le combo parfait',
      odds: impliedOdd(combo), prob: pct(combo),
      confidence: confScore(combo, -3),
      risk: 'medium',
      tag: 'Combo propre',
      reasoning: `${pct(maxProb)}% victoire × ${pct(cs)}% clean sheet. Fort si défense dominante.`,
    });
  }

  // MI-TEMPS / RÉSULTAT (HT/FT)
  const htHome = m.pHalfTimeHome; const htDraw = m.pHalfTimeDraw;
  const htAway = m.pHalfTimeAway;
  // HT Draw / FT Victoire favori — classique
  if (maxProb > 0.55 && htDraw > 0.35) {
    const combo = htDraw * maxProb * 1.1;
    bets.push({
      id: id('htft'), matchId: match.id, category: 'combo', emoji: '🕐',
      label: `Nul mi-temps / ${resultLabel}`, shortLabel: 'HT-X / FT-Vic',
      description: 'Match serré en première mi-temps, le favori déroule en seconde',
      odds: impliedOdd(combo * 0.85), prob: pct(combo * 0.85),
      confidence: confScore(combo * 0.85, -5),
      risk: 'medium',
      tag: 'Mi-temps',
      reasoning: `${pct(htDraw)}% nul à la mi-temps × ${pct(maxProb)}% victoire finale.`,
    });
  }

  // BTTS + Over 2.5
  if (m.pBTTS > 0.45 && m.pO25 > 0.45) {
    const combo = m.pBTTS * 0.85; // corrélation forte, on réduit
    bets.push({
      id: id('btts_o25'), matchId: match.id, category: 'combo', emoji: '💥',
      label: 'BTTS & Over 2.5', shortLabel: 'BTTS+O2.5',
      description: 'Les deux marquent ET au moins 3 buts — match animé garanti',
      odds: impliedOdd(combo), prob: pct(combo),
      confidence: confScore(combo, 0),
      risk: 'medium',
      tag: 'Match animé',
      reasoning: `BTTS (${pct(m.pBTTS)}%) implique souvent O2.5. Corrélation forte intégrée.`,
    });
  }

  // ════════════════════════════════════════════════
  // 🎲 FUN — Paris audacieux et amusants
  // ════════════════════════════════════════════════

  // Over 3.5 si match très offensif
  if (m.expectedGoals > 2.5) {
    bets.push({
      id: id('o35'), matchId: match.id, category: 'fun', emoji: '🎯',
      label: 'Over 3.5 buts', shortLabel: 'O3.5',
      description: 'Match très offensif, 4+ buts attendus — fiesta !',
      odds: impliedOdd(m.pO35), prob: pct(m.pO35),
      confidence: confScore(m.pO35, -5),
      risk: m.pO35 > 0.40 ? 'medium' : 'high',
      tag: m.pO35 > 0.38 ? 'Fiesta 🔥' : 'Audacieux',
      reasoning: `xG total ${m.expectedGoals.toFixed(2)}. ${pct(m.pO35)}% pour 4+ buts.`,
    });
  }

  // Score exact le plus probable
  const sortedScores = Object.entries(m.pExact).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (sortedScores.length > 0) {
    const [topScore, topProb] = sortedScores[0];
    bets.push({
      id: id('exact'), matchId: match.id, category: 'fun', emoji: '🎯',
      label: `Score exact ${topScore}`, shortLabel: `Score ${topScore}`,
      description: 'Le score le plus probable selon le modèle',
      odds: impliedOdd(topProb * 0.9),
      prob: pct(topProb * 0.9),
      confidence: confScore(topProb, -10),
      risk: topProb > 0.18 ? 'medium' : 'high',
      tag: 'Score exact',
      reasoning: `Score le plus probable : ${topScore} (${pct(topProb)}%). Cote attractive.`,
    });
  }

  // Victoire avec handicap -1 si favori dominant
  if (maxProb > 0.65 && resultKey !== 'draw') {
    // P(gagner par 2+ buts) ≈ somme des scores appropriés
    let pHc = 0;
    Object.entries(m.pExact).forEach(([score, p]) => {
      const [h, a] = score.split('-').map(Number);
      if (resultKey === 'home' && h - a >= 2) pHc += p;
      if (resultKey === 'away' && a - h >= 2) pHc += p;
    });
    if (pHc > 0.22) {
      const winner = resultKey === 'home' ? H : A;
      bets.push({
        id: id('hc'), matchId: match.id, category: 'fun', emoji: '⚡',
        label: `${winner} -1 (Handicap)`, shortLabel: 'Handicap -1',
        description: `${winner} gagne avec au moins 2 buts d'écart`,
        odds: impliedOdd(pHc * 0.9),
        prob: pct(pHc * 0.9),
        confidence: confScore(pHc, -5),
        risk: pHc > 0.32 ? 'medium' : 'high',
        tag: 'Handicap',
        reasoning: `${pct(pHc)}% de victoire par ≥2 buts. Attractif si le favori est dominant.`,
      });
    }
  }

  // Nul mi-temps si match équilibré
  if (htDraw > 0.38 && m.pD > 0.25) {
    bets.push({
      id: id('ht_draw'), matchId: match.id, category: 'fun', emoji: '⏱️',
      label: 'Nul à la mi-temps', shortLabel: 'Nul HT',
      description: 'Première mi-temps équilibrée, les équipes s\'observent',
      odds: impliedOdd(htDraw * 0.88),
      prob: pct(htDraw * 0.88),
      confidence: confScore(htDraw * 0.88, -8),
      risk: 'high',
      tag: 'Mi-temps fun',
      reasoning: `${pct(htDraw)}% de probabilité de nul à la mi-temps selon le modèle.`,
    });
  }

  // Both score & Over 3.5 — le match qu'on rêve
  if (m.pBTTS > 0.50 && m.pO35 > 0.28) {
    const combo = m.pBTTS * m.pO35 * 1.3; // corrélation très forte
    bets.push({
      id: id('fiesta'), matchId: match.id, category: 'fun', emoji: '🎉',
      label: 'BTTS & Over 3.5 — La Fiesta', shortLabel: 'BTTS+O3.5',
      description: '4+ buts ET les deux marquent — soirée de gala garantie',
      odds: impliedOdd(combo * 0.75),
      prob: pct(combo * 0.75),
      confidence: confScore(combo * 0.75, -10),
      risk: 'high',
      tag: '🎉 Fiesta',
      reasoning: `Le combo ultime pour les matchs offensifs. Cote élevée mais fun.`,
    });
  }

  // Top scoreur (simulé) — si attaque dominante
  if (m.lH > 2.0 || m.lA > 2.0) {
    const attTeam = m.lH > m.lA ? H : A;
    bets.push({
      id: id('anytime'), matchId: match.id, category: 'fun', emoji: '⚡',
      label: `${attTeam} marque 2+ buts`, shortLabel: '2+ buts équipe',
      description: `L'équipe offensive du soir frappe fort`,
      odds: parseFloat((impliedOdd(Math.max(m.lH, m.lA) > 2.2 ? 0.35 : 0.22) * 0.9).toFixed(2)),
      prob: pct(Math.max(m.lH, m.lA) > 2.2 ? 0.35 : 0.22),
      confidence: Math.round(confScore(m.lH > m.lA ? m.pH : m.pA, 0) * 0.7),
      risk: 'high',
      tag: 'Attaque en feu',
      reasoning: `${attTeam} génère ${Math.max(m.lH, m.lA).toFixed(2)} xG. Probable si la forme confirme.`,
    });
  }

  // Trier : safe d'abord par confiance, puis valeur, combo, fun
  const order: Record<string, number> = { safe: 0, value: 1, combo: 2, fun: 3 };
  bets.sort((a, b) => order[a.category] - order[b.category] || b.confidence - a.confidence);

  return bets;
}

// ─── PREDICT ──────────────────────────────────────────────────
export function predict(match: Match): Prediction {
  const lH = Math.max(0.3, (match.homeTeam.xG || 1.45) * 1.05);
  const lA = Math.max(0.3, (match.awayTeam.xG || 1.2) * 0.88);
  const m = buildMatrix(lH, lA);

  const total = m.pH + m.pD + m.pA;
  const probs = { home: m.pH/total, draw: m.pD/total, away: m.pA/total };
  const max = Math.max(probs.home, probs.draw, probs.away);
  const key = probs.home === max ? 'home' : probs.away === max ? 'away' : 'draw';
  const names = { home: `Victoire ${match.homeTeam.name}`, draw: 'Match nul', away: `Victoire ${match.awayTeam.name}` } as const;
  const conf = Math.min(92, Math.max(34, 45 + (max - 0.33) * 82));

  const bets = generateBets(match, m);

  return {
    prediction: names[key],
    predictionKey: key,
    confidence: parseFloat(conf.toFixed(1)),
    probabilities: {
      home: parseFloat((probs.home * 100).toFixed(1)),
      draw: parseFloat((probs.draw * 100).toFixed(1)),
      away: parseFloat((probs.away * 100).toFixed(1)),
    },
    odds: {
      home: parseFloat((MARGIN / probs.home).toFixed(2)),
      draw: parseFloat((MARGIN / probs.draw).toFixed(2)),
      away: parseFloat((MARGIN / probs.away).toFixed(2)),
    },
    xgHome: parseFloat(lH.toFixed(2)),
    xgAway: parseFloat(lA.toFixed(2)),
    bets,
    riskLevel: conf >= 70 ? 'low' : conf >= 55 ? 'medium' : 'high',
    reasoning: `Modèle Poisson — xG : ${lH.toFixed(2)} (dom.) vs ${lA.toFixed(2)} (ext.). Probabilités : Domicile ${(probs.home*100).toFixed(1)}% / Nul ${(probs.draw*100).toFixed(1)}% / Extérieur ${(probs.away*100).toFixed(1)}%. Over 2.5 : ${pct(m.pO25)}% — BTTS : ${pct(m.pBTTS)}%.`,
  };
}

// ─── KELLY ────────────────────────────────────────────────────
export function kellyStake(solde: number, conf: number, odd: number, risk: string): number | null {
  if (!solde || solde <= 0) return null;
  const p = conf / 100;
  const b = odd - 1;
  const k = Math.max(0, (b * p - (1 - p)) / b);
  const fractions: Record<string, number> = { low: 0.25, medium: 0.15, high: 0.08 };
  const frac = fractions[risk] ?? 0.1;
  const stake = Math.min(k * frac * solde, solde * 0.20);
  return Math.round(Math.max(1, stake) * 100) / 100;
}
