// lib/types.ts

export interface Team {
  name: string;
  shortName: string;
  crest: string | null;
  xG: number;
  form: number[];
  avgGoals: number;
  avgConceded: number;
  attack: number;
  defense: number;
}

export interface Match {
  id: string;
  competition: string;
  competitionId: number;
  competitionCode: string;
  date: string;
  time: string;
  status: string;
  minute: number | null;
  homeTeam: Team;
  awayTeam: Team;
  score: { home: number | null; away: number | null };
  h2h: { homeWins: number; draws: number; awayWins: number };
  isLive: boolean;
  isDone: boolean;
}

export type BetCategory = 'safe' | 'value' | 'combo' | 'fun';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface BetOption {
  id: string;
  matchId: string;
  label: string;
  shortLabel: string;
  description: string;
  odds: number;
  prob: number;
  confidence: number;
  risk: RiskLevel;
  category: BetCategory;
  emoji: string;
  tag: string;
  reasoning: string;
}

export interface Prediction {
  prediction: string;
  predictionKey: 'home' | 'draw' | 'away';
  confidence: number;
  probabilities: { home: number; draw: number; away: number };
  odds: { home: number; draw: number; away: number };
  xgHome: number;
  xgAway: number;
  bets: BetOption[];
  riskLevel: RiskLevel;
  reasoning: string;
}

export interface BookmakerOdds {
  key: string;
  name: string;
  home: number;
  draw: number | null;
  away: number;
  // Totals (Over/Under) ex: Over_2.5, Under_2.5, Over_1.5 ...
  [total: string]: number | string | null;
}

export interface MatchOddsData {
  bkMap: Record<string, BookmakerOdds>;
  bestHome: number;
  bestDraw: number;
  bestAway: number;
  oddsApiHome?: string;
  oddsApiAway?: string;
  matchScore?: number;
  // Dynamic keys for best totals (best_Over_2.5, best_Under_2.5, etc.)
  [key: string]: number | string | null | undefined | Record<string, BookmakerOdds>;
}

export interface BetEntry {
  matchName: string;
  pred: string;
  odd: string;
  mise: number;
  gain: number;
  result: 'pending' | 'win' | 'loss';
  bookmaker: string;
  competition: string;
  date: string;
  category?: BetCategory;
}

// ─── COMPÉTITIONS ─────────────────────────────────────────────
// oddsKey = clé exacte de The Odds API (https://the-odds-api.com)
export const COMPETITIONS: Record<number, {
  name: string; code: string; flag: string; color: string; order: number; oddsKey: string;
}> = {
  // Europe - Clubs élite
  2001: { name: 'Champions League', code:'CL',  flag:'🏆',  color:'#001e62', order:0,  oddsKey:'soccer_uefa_champs_league'       },
  2021: { name: 'Premier League',   code:'PL',  flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿', color:'#7b0396', order:1,  oddsKey:'soccer_epl'                      }, // ← clé correcte
  2015: { name: 'Ligue 1',          code:'FL1', flag:'🇫🇷', color:'#00a3e0', order:2,  oddsKey:'soccer_france_ligue1'            },
  2014: { name: 'La Liga',          code:'PD',  flag:'🇪🇸', color:'#ee8707', order:3,  oddsKey:'soccer_spain_la_liga'            },
  2019: { name: 'Serie A',          code:'SA',  flag:'🇮🇹', color:'#024494', order:4,  oddsKey:'soccer_italy_serie_a'            },
  2002: { name: 'Bundesliga',       code:'BL1', flag:'🇩🇪', color:'#d20515', order:5,  oddsKey:'soccer_germany_bundesliga'       },
  2003: { name: 'Eredivisie',       code:'DED', flag:'🇳🇱', color:'#ff6600', order:6,  oddsKey:'soccer_netherlands_eredivisie'   },
  2017: { name: 'Primeira Liga',    code:'PPL', flag:'🇵🇹', color:'#006600', order:7,  oddsKey:'soccer_portugal_primeira_liga'   },
  // Europe - Autres
  2016: { name: 'Championship',     code:'ELC', flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿', color:'#3d1a78', order:8,  oddsKey:'soccer_england_championship'     },
  2018: { name: 'Euro',             code:'EC',  flag:'🇪🇺', color:'#003399', order:9,  oddsKey:'soccer_uefa_european_championship'},
  // Monde
  2000: { name: 'FIFA World Cup',   code:'WC',  flag:'🌍', color:'#c8a400', order:10, oddsKey:'soccer_fifa_world_cup'           },
  2013: { name: 'Brasileirão',      code:'BSA', flag:'🇧🇷', color:'#009c3b', order:11, oddsKey:'soccer_brazil_campeonato'        },
};

export const BOOKMAKERS = [
  { key:'winamax_fr',    name:'Winamax',       emoji:'🟡' },
  { key:'betclic_fr',    name:'Betclic',       emoji:'🔴' },
  { key:'unibet_fr',     name:'Unibet',        emoji:'⚫' },
  { key:'pmu_fr',        name:'PMU',           emoji:'🐴' },
  { key:'pinnacle',      name:'Pinnacle',      emoji:'🟣' },
  { key:'betfair_ex_eu', name:'Betfair',       emoji:'⚪' },
  { key:'williamhill',   name:'William Hill',  emoji:'🔵' },
  { key:'mybookieag',    name:'MyBookie',      emoji:'🟢' },
  { key:'marathonbet',   name:'Marathon Bet',  emoji:'🟠' },
  { key:'sport888',      name:'888sport',      emoji:'🔶' },
];
