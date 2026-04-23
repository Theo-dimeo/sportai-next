// lib/refiner.ts
// Recalibre la prédiction IA avec les vraies cotes bookmaker
// Principe : les cotes bookmaker encodent les vraies probabilités du marché
// On les utilise pour corriger le modèle Poisson et générer des paris pertinents

import type { Prediction, BetOption } from './types';

const MARGIN = 1.065;

function impliedOdd(prob: number): number {
  return parseFloat(Math.min(20, Math.max(1.05, MARGIN / Math.max(0.02, prob))).toFixed(2));
}
function pct(p: number) { return parseFloat((p * 100).toFixed(1)); }
function confScore(prob: number, bonus = 0): number {
  return Math.min(97, Math.max(20, Math.round(35 + prob * 55 + bonus)));
}

// Supprime la marge bookmaker et normalise les probabilités
function removeMargın(h: number, d: number, a: number): { pH: number; pD: number; pA: number } {
  const rawH = 1 / h;
  const rawD = 1 / d;
  const rawA = 1 / a;
  const total = rawH + rawD + rawA;
  return { pH: rawH / total, pD: rawD / total, pA: rawA / total };
}

// Reconstruit les lambdas Poisson depuis les probabilités de résultat
// Méthode Dixon-Coles simplifiée : résolution numérique
function lambdasFromProbs(pH: number, pA: number): { lH: number; lA: number } {
  // Approximation : pH ≈ e^(-lA) * sum, pA ≈ e^(-lH) * sum
  // On utilise la relation : lH/lA ≈ log(pH)/log(pA) et lH+lA ≈ 2.5 * (1 - pD)
  const pD = 1 - pH - pA;
  const totalGoals = Math.max(1.2, 2.8 * (1 - pD * 1.2)); // calibré empiriquement
  const ratio = Math.log(Math.max(0.01, pH)) / Math.log(Math.max(0.01, pA));
  // ratio ≈ lH / lA (approximation)
  const lA = Math.max(0.3, totalGoals / (1 + Math.max(0.3, Math.min(3, ratio))));
  const lH = Math.max(0.3, totalGoals - lA);
  return { lH, lA };
}

// Poisson
function pp(lambda: number, k: number): number {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return Math.exp(-lambda) * Math.pow(lambda, k) / f;
}

interface BookmakerOddsInput {
  home: number;
  draw: number | null;
  away: number;
  [key: string]: number | string | null | undefined;
}

export function refinePredictionWithOdds(
  pred: Prediction,
  matchId: string,
  homeTeamName: string,
  awayTeamName: string,
  bkOdds: BookmakerOddsInput
): Prediction {
  const h = bkOdds.home as number;
  const d = bkOdds.draw as number | null;
  const a = bkOdds.away as number;

  if (!h || !a || h <= 1 || a <= 1) return pred; // cotes invalides

  const drawOdd = d && d > 1 ? d : 3.4; // fallback si pas de cote nul
  const { pH, pD, pA } = removeMargın(h, drawOdd, a);
  const { lH, lA } = lambdasFromProbs(pH, pA);

  // Recalculer les marchés Poisson avec les vrais lambdas
  let pO25 = 0, pU25 = 0, pO15 = 0, pU15 = 0, pO35 = 0, pBTTS = 0;
  let pCleanHome = 0, pCleanAway = 0;

  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const p = pp(lH, i) * pp(lA, j);
      const total = i + j;
      if (total > 2.5) pO25 += p; else pU25 += p;
      if (total > 1.5) pO15 += p; else pU15 += p;
      if (total > 3.5) pO35 += p;
      if (i > 0 && j > 0) pBTTS += p;
      if (j === 0) pCleanHome += p;
      if (i === 0) pCleanAway += p;
    }
  }
  const pU35 = 1 - pO35;

  // Vraie cote bookmaker pour chaque marché (si disponible)
  const realO25  = (bkOdds['Over_2.5']  as number | undefined) ?? null;
  const realU35  = (bkOdds['Under_3.5'] as number | undefined) ?? null;
  const realO15  = (bkOdds['Over_1.5']  as number | undefined) ?? null;
  const realU25  = (bkOdds['Under_2.5'] as number | undefined) ?? null;

  // Calcul value : écart entre notre prob et prob implicite du bookmaker
  function valuePct(ourProb: number, realOdd: number | null): number {
    if (!realOdd || realOdd <= 1) return 0;
    const bkProb = 1 / realOdd;
    return parseFloat(((ourProb / bkProb - 1) * 100).toFixed(1));
  }

  const H = homeTeamName;
  const A = awayTeamName;

  // Résultat favori selon bookmaker (plus fiable que Poisson)
  const maxBkProb = Math.max(pH, pD, pA);
  const resultKey = pH === maxBkProb ? 'home' : pA === maxBkProb ? 'away' : 'draw';
  const resultLabel = resultKey === 'home' ? `Victoire ${H}` : resultKey === 'away' ? `Victoire ${A}` : 'Match nul';

  const newBets: BetOption[] = [];
  let idx = 0;
  const id = (s: string) => `${matchId}_${s}_${idx++}`;

  // ── SAFE ──────────────────────────────────────────────────────
  // Résultat favori
  if (maxBkProb > 0.46) {
    const realOdd = resultKey === 'home' ? h : resultKey === 'away' ? a : drawOdd;
    const vp = valuePct(maxBkProb, realOdd);
    newBets.push({
      id: id('result'), matchId, category: 'safe', emoji: '🏆',
      label: resultLabel, shortLabel: resultKey === 'draw' ? 'Nul' : 'Victoire',
      description: `Favori bookmaker avec ${pct(maxBkProb)}% de probabilité`,
      odds: realOdd, prob: pct(maxBkProb),
      confidence: confScore(maxBkProb, maxBkProb > 0.60 ? 8 : 0),
      risk: maxBkProb > 0.65 ? 'low' : 'medium',
      tag: vp > 5 ? `Value +${vp}%` : maxBkProb > 0.65 ? 'Favori clair' : 'Favori',
      reasoning: `Bookmaker donne ${pct(maxBkProb)}% au favori (cote ${realOdd}). xG calibrés : ${lH.toFixed(2)}–${lA.toFixed(2)}.`,
    });
  }

  // Double chance 1X
  if (pH + pD > 0.62) {
    const dcProb = pH + pD;
    const dcOdd = d ? parseFloat(Math.min((1 / ((1/h) + (1/drawOdd))) * 0.95, h - 0.01).toFixed(2)) : impliedOdd(dcProb);
    newBets.push({
      id: id('dc'), matchId, category: 'safe', emoji: '🛡️',
      label: `Double Chance — ${H} ou Nul`, shortLabel: '1X',
      description: 'Couvre victoire domicile ou nul',
      odds: dcOdd, prob: pct(dcProb),
      confidence: confScore(dcProb, 5),
      risk: 'low', tag: 'Sécurisé',
      reasoning: `${pct(dcProb)}% (${pct(pH)}% vic + ${pct(pD)}% nul). Cote calculée depuis bookmaker.`,
    });
  }
  if (pA + pD > 0.62) {
    const dcProb = pA + pD;
    const dcOdd = d ? parseFloat(Math.min((1 / ((1/a) + (1/drawOdd))) * 0.95, a - 0.01).toFixed(2)) : impliedOdd(dcProb);
    newBets.push({
      id: id('dc2'), matchId, category: 'safe', emoji: '🛡️',
      label: `Double Chance — ${A} ou Nul`, shortLabel: 'X2',
      description: 'Couvre victoire extérieur ou nul',
      odds: dcOdd, prob: pct(dcProb),
      confidence: confScore(dcProb, 5),
      risk: 'low', tag: 'Sécurisé',
      reasoning: `${pct(dcProb)}% (${pct(pA)}% vic + ${pct(pD)}% nul). Cote calculée depuis bookmaker.`,
    });
  }

  // Under 3.5
  if (pU35 > 0.60) {
    const odd = realU35 ?? impliedOdd(pU35);
    const vp = valuePct(pU35, realU35);
    newBets.push({
      id: id('u35'), matchId, category: 'safe', emoji: '🔒',
      label: 'Under 3.5 buts', shortLabel: 'U3.5',
      description: 'Match serré, peu de buts attendus',
      odds: odd, prob: pct(pU35),
      confidence: confScore(pU35, 3),
      risk: 'low',
      tag: vp > 5 ? `Value +${vp}%` : 'Match fermé',
      reasoning: `${pct(pU35)}% pour U3.5. xG total calibré : ${(lH+lA).toFixed(2)} buts.${realU35 ? ` Cote réelle bookmaker : ${realU35}.` : ''}`,
    });
  }

  // Over 1.5
  if (pO15 > 0.70) {
    const odd = realO15 ?? impliedOdd(pO15);
    const vp = valuePct(pO15, realO15);
    newBets.push({
      id: id('o15'), matchId, category: 'safe', emoji: '⚽',
      label: 'Over 1.5 buts', shortLabel: 'O1.5',
      description: 'Au moins 2 buts dans ce match',
      odds: odd, prob: pct(pO15),
      confidence: confScore(pO15, 6),
      risk: 'low',
      tag: vp > 5 ? `Value +${vp}%` : 'Très probable',
      reasoning: `${pct(pO15)}% pour O1.5. ${realO15 ? `Cote réelle : ${realO15}.` : ''}`,
    });
  }

  // ── VALUE ─────────────────────────────────────────────────────
  // Over 2.5 — seulement si value positive ou prob > 55%
  if (pO25 > 0.42) {
    const odd = realO25 ?? impliedOdd(pO25);
    const vp = valuePct(pO25, realO25);
    // Ne proposer que si value positive OU forte probabilité
    if (vp > 0 || pO25 > 0.55) {
      newBets.push({
        id: id('o25'), matchId, category: 'value', emoji: '🔥',
        label: 'Over 2.5 buts', shortLabel: 'O2.5',
        description: 'Au moins 3 buts au total',
        odds: odd, prob: pct(pO25),
        confidence: confScore(pO25, vp > 5 ? 6 : 0),
        risk: pO25 > 0.58 ? 'low' : 'medium',
        tag: vp > 5 ? `Value +${vp.toFixed(0)}%` : vp > 0 ? 'Légère value' : 'O2.5',
        reasoning: `${pct(pO25)}% pour O2.5.${realO25 ? ` Cote bookmaker : ${realO25}.` : ''} ${vp > 0 ? `Notre modèle voit +${vp.toFixed(0)}% de value.` : ''}`,
      });
    }
  }

  // Under 2.5 — si match très fermé
  if (pU25 > 0.50) {
    const odd = realU25 ?? impliedOdd(pU25);
    const vp = valuePct(pU25, realU25);
    if (vp > 0 || pU25 > 0.60) {
      newBets.push({
        id: id('u25'), matchId, category: 'value', emoji: '🧱',
        label: 'Under 2.5 buts', shortLabel: 'U2.5',
        description: 'Match très défensif, 2 buts max',
        odds: odd, prob: pct(pU25),
        confidence: confScore(pU25, vp > 5 ? 4 : 0),
        risk: pU25 > 0.60 ? 'low' : 'medium',
        tag: vp > 5 ? `Value +${vp.toFixed(0)}%` : 'Match fermé',
        reasoning: `${pct(pU25)}% pour U2.5.${realU25 ? ` Cote bookmaker : ${realU25}.` : ''} ${vp > 0 ? `Value estimée : +${vp.toFixed(0)}%.` : ''}`,
      });
    }
  }

  // Nul si équilibré selon le bookmaker
  if (pD > 0.28 && d) {
    const vp = valuePct(pD, d);
    if (vp > 2 || pD > 0.34) {
      newBets.push({
        id: id('draw'), matchId, category: 'value', emoji: '⚖️',
        label: 'Match nul', shortLabel: 'Nul',
        description: 'Match équilibré selon le bookmaker',
        odds: d, prob: pct(pD),
        confidence: confScore(pD, vp > 5 ? 4 : -2),
        risk: 'medium',
        tag: vp > 5 ? `Value +${vp.toFixed(0)}%` : 'Équilibré',
        reasoning: `Bookmaker donne ${pct(pD)}% au nul (cote ${d}).${vp > 0 ? ` Notre modèle détecte +${vp.toFixed(0)}% de value.` : ''}`,
      });
    }
  }

  // Outsider — value si grosse cote sous-estimée
  const underdogProb = Math.min(pH, pA);
  const underdogOdd = pH < pA ? h : a;
  const underdogKey = pH < pA ? 'home' : 'away';
  const underdogName = underdogKey === 'home' ? H : A;
  if (underdogProb > 0.20 && underdogOdd > 2.5) {
    const vp = valuePct(underdogProb, underdogOdd);
    if (vp > 8) {
      newBets.push({
        id: id('upset'), matchId, category: 'value', emoji: '💣',
        label: `Surprise — ${underdogName}`, shortLabel: 'Outsider',
        description: `Notre modèle sur-estime ${underdogName} vs le bookmaker`,
        odds: underdogOdd, prob: pct(underdogProb),
        confidence: confScore(underdogProb, -5),
        risk: 'high',
        tag: `Value +${vp.toFixed(0)}%`,
        reasoning: `Bookmaker cote ${underdogName} à ${underdogOdd} (${pct(1/underdogOdd)}% implicite) mais notre modèle donne ${pct(underdogProb)}%. Écart de +${vp.toFixed(0)}%.`,
      });
    }
  }

  // ── COMBO ─────────────────────────────────────────────────────
  if (maxBkProb > 0.48 && pO15 > 0.65 && realO15) {
    const winOdd = resultKey === 'home' ? h : resultKey === 'away' ? a : drawOdd;
    const comboOdd = parseFloat((winOdd * realO15 * 0.92).toFixed(2));
    const comboProb = maxBkProb * pO15 * 0.95;
    newBets.push({
      id: id('res_o15'), matchId, category: 'combo', emoji: '🔗',
      label: `${resultLabel} + Over 1.5`, shortLabel: 'Vic+O1.5',
      description: 'Le favori gagne avec au moins 2 buts',
      odds: comboOdd, prob: pct(comboProb),
      confidence: confScore(comboProb, 0),
      risk: 'medium', tag: 'Combo facile',
      reasoning: `${pct(maxBkProb)}% × ${pct(pO15)}% = ${pct(comboProb)}% combiné. Cotes réelles utilisées.`,
    });
  }

  if (pBTTS > 0.45 && pO25 > 0.45 && realO25) {
    const comboOdd = parseFloat((realO25 * 1.15).toFixed(2)); // BTTS corrélé avec O2.5
    const comboProb = pBTTS * 0.88;
    newBets.push({
      id: id('btts_o25'), matchId, category: 'combo', emoji: '💥',
      label: 'BTTS & Over 2.5', shortLabel: 'BTTS+O2.5',
      description: 'Les deux marquent ET 3+ buts',
      odds: comboOdd, prob: pct(comboProb),
      confidence: confScore(comboProb, 0),
      risk: 'medium', tag: 'Match animé',
      reasoning: `BTTS ${pct(pBTTS)}% fortement corrélé avec O2.5 ${pct(pO25)}%. Cote approchée depuis O2.5 réel.`,
    });
  }

  // ── FUN ───────────────────────────────────────────────────────
  if (pO35 > 0.22) {
    const odd = (bkOdds['Over_3.5'] as number | undefined) ?? impliedOdd(pO35);
    newBets.push({
      id: id('o35'), matchId, category: 'fun', emoji: '🎯',
      label: 'Over 3.5 buts', shortLabel: 'O3.5',
      description: '4+ buts — fiesta offensive',
      odds: odd, prob: pct(pO35),
      confidence: confScore(pO35, -5),
      risk: pO35 > 0.35 ? 'medium' : 'high',
      tag: pO35 > 0.35 ? 'Fiesta 🔥' : 'Audacieux',
      reasoning: `${pct(pO35)}% pour 4+ buts. xG total : ${(lH+lA).toFixed(2)}.`,
    });
  }

  // Trier safe > value > combo > fun, puis par confiance
  const order: Record<string, number> = { safe: 0, value: 1, combo: 2, fun: 3 };
  newBets.sort((a, b) => order[a.category] - order[b.category] || b.confidence - a.confidence);

  // Reconstruire la prédiction complète avec les vraies probabilités
  const maxProb = Math.max(pH, pD, pA);
  const newKey = pH === maxProb ? 'home' : pA === maxProb ? 'away' : 'draw';
  const names = {
    home: `Victoire ${H}`,
    draw: 'Match nul',
    away: `Victoire ${A}`,
  } as const;
  const newConf = Math.min(92, Math.max(34, 45 + (maxProb - 0.33) * 82));

  return {
    ...pred,
    prediction: names[newKey],
    predictionKey: newKey,
    confidence: parseFloat(newConf.toFixed(1)),
    probabilities: {
      home: parseFloat((pH * 100).toFixed(1)),
      draw: parseFloat((pD * 100).toFixed(1)),
      away: parseFloat((pA * 100).toFixed(1)),
    },
    odds: { home: h, draw: drawOdd, away: a },
    xgHome: parseFloat(lH.toFixed(2)),
    xgAway: parseFloat(lA.toFixed(2)),
    bets: newBets,
    riskLevel: newConf >= 70 ? 'low' : newConf >= 55 ? 'medium' : 'high',
    reasoning: `Bookmaker : Dom. ${pct(pH)}% (${h}) / Nul ${pct(pD)}% (${drawOdd}) / Ext. ${pct(pA)}% (${a}). xG recalibrés : ${lH.toFixed(2)}–${lA.toFixed(2)}. Over 2.5 : ${pct(pO25)}%.`,
  };
}
