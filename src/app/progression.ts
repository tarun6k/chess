// XP, levels, badges, daily challenge and streaks.

import { PUZZLES, Puzzle, DRILLS, CONSTRAINTS } from './puzzles';
import { PlayerModel, topWeaknesses, WeaknessKey } from '../ai/playerModel';

export interface Progress {
  xp: number;
  badges: string[];               // earned badge ids
  solvedPuzzles: string[];        // puzzle ids
  completedDrills: string[];
  completedConstraints: string[];
  dailyStreak: number;
  lastDailyDate: string | null;   // YYYY-MM-DD of last completed daily
  counters: {
    gamesPlayed: number;
    gamesWon: number;
    castledGames: number;         // consecutive games with castling
    winsOnTime: number;
    puzzlesSolved: number;
    checkmates: number;
    enPassants: number;
    underpromotions: number;
    hintsUsed: number;
  };
}

export function newProgress(): Progress {
  return {
    xp: 0, badges: [], solvedPuzzles: [], completedDrills: [], completedConstraints: [],
    dailyStreak: 0, lastDailyDate: null,
    counters: {
      gamesPlayed: 0, gamesWon: 0, castledGames: 0, winsOnTime: 0,
      puzzlesSolved: 0, checkmates: 0, enPassants: 0, underpromotions: 0, hintsUsed: 0,
    },
  };
}

export function levelForXp(xp: number): { level: number; into: number; needed: number } {
  // level n needs 100 * n XP to advance (100, 200, 300 …)
  let level = 1, remaining = xp;
  while (remaining >= level * 100) { remaining -= level * 100; level++; }
  return { level, into: remaining, needed: level * 100 };
}

export interface Badge {
  id: string;
  title: string;
  description: string;
  earned: (p: Progress, m: PlayerModel) => boolean;
}

export const BADGES: Badge[] = [
  { id: 'first-win', title: 'First blood', description: 'Win your first game', earned: p => p.counters.gamesWon >= 1 },
  { id: 'first-mate', title: 'Checkmate!', description: 'Deliver your first checkmate', earned: p => p.counters.checkmates >= 1 },
  { id: 'castle-10', title: 'Safe as houses', description: 'Castle in 10 games in a row', earned: p => p.counters.castledGames >= 10 },
  { id: 'flag-win', title: 'Beat the clock', description: 'Win a game on time', earned: p => p.counters.winsOnTime >= 1 },
  { id: 'puzzle-10', title: 'Sharp eyes', description: 'Solve 10 puzzles', earned: p => p.counters.puzzlesSolved >= 10 },
  { id: 'puzzle-50', title: 'Tactician', description: 'Solve 50 puzzles', earned: p => p.counters.puzzlesSolved >= 50 },
  { id: 'en-passant', title: 'In passing', description: 'Capture en passant', earned: p => p.counters.enPassants >= 1 },
  { id: 'underpromo', title: 'Less is more', description: 'Underpromote a pawn', earned: p => p.counters.underpromotions >= 1 },
  { id: 'streak-3', title: 'On a roll', description: 'Three-day challenge streak', earned: p => p.dailyStreak >= 3 },
  { id: 'streak-7', title: 'Habit formed', description: 'Seven-day challenge streak', earned: p => p.dailyStreak >= 7 },
  { id: 'rating-1200', title: 'Club player', description: 'Reach a 1200 rating', earned: (_, m) => m.rating >= 1200 },
  { id: 'rating-1600', title: 'Strong player', description: 'Reach a 1600 rating', earned: (_, m) => m.rating >= 1600 },
  { id: 'giant-slayer', title: 'Giant slayer', description: 'Beat the AI set 200+ above your rating', earned: p => p.badges.includes('giant-slayer') },
  { id: 'games-25', title: 'Regular', description: 'Play 25 games', earned: p => p.counters.gamesPlayed >= 25 },
];

/** Recompute earned badges; returns newly earned ones. */
export function refreshBadges(p: Progress, m: PlayerModel): Badge[] {
  const fresh: Badge[] = [];
  for (const b of BADGES) {
    if (!p.badges.includes(b.id) && b.earned(p, m)) {
      p.badges.push(b.id);
      fresh.push(b);
    }
  }
  return fresh;
}

function dateKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Deterministic daily puzzle: seeded by the date. */
export function dailyPuzzle(date = new Date()): Puzzle {
  const key = dateKey(date);
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PUZZLES[h % PUZZLES.length];
}

export function completeDaily(p: Progress): void {
  const today = dateKey();
  if (p.lastDailyDate === today) return;
  const yesterday = dateKey(new Date(Date.now() - 86_400_000));
  p.dailyStreak = p.lastDailyDate === yesterday ? p.dailyStreak + 1 : 1;
  p.lastDailyDate = today;
}

export function isDailyDone(p: Progress): boolean {
  return p.lastDailyDate === dateKey();
}

export interface OfferedChallenge {
  id: string;
  kind: 'puzzle-set' | 'rematch-blitz' | 'drill' | 'constraint';
  title: string;
  detail: string;
  puzzleIds?: string[];
  drillId?: string;
  constraintId?: string;
  timed?: boolean;
  xp: number;
}

const WEAKNESS_PUZZLES: Record<WeaknessKey, string[]> = {
  'hanging-pieces': ['t-freequeen', 't-snipe', 'd-qsave'],
  'missed-tactics': ['t-fork', 't-pin', 't-promo'],
  'back-rank': ['m1-backrank', 'm1-deflect', 'm2-ladder'],
  endgame: [],
  opening: [],
  'king-safety': ['m1-backrank', 'm2-boxin', 'm2-qr'],
};

const WEAKNESS_LABEL: Record<WeaknessKey, string> = {
  'hanging-pieces': 'leaving pieces undefended',
  'missed-tactics': 'missing tactical shots',
  'back-rank': 'back-rank mates',
  endgame: 'endgame technique',
  opening: 'the opening phase',
  'king-safety': 'king safety',
};

/**
 * AI-offered challenges after a game — driven by the player model:
 * targeted puzzle sets for the top weakness, drills for endgame gaps,
 * and a spicy rematch offer.
 */
export function offerChallenges(model: PlayerModel, progress: Progress, lastGameWon: boolean | null): OfferedChallenge[] {
  const offers: OfferedChallenge[] = [];
  const weak = topWeaknesses(model, 2);

  for (const { key } of weak) {
    if (key === 'endgame') {
      const drill = DRILLS.find(d => !progress.completedDrills.includes(d.id)) ?? DRILLS[0];
      offers.push({
        id: 'offer-drill-' + drill.id, kind: 'drill',
        title: 'Endgame clinic',
        detail: `Your endgame technique has been costing you — try “${drill.title}”.`,
        drillId: drill.id, xp: drill.xp,
      });
    } else {
      const ids = (WEAKNESS_PUZZLES[key] ?? []).filter(id => PUZZLES.some(p => p.id === id));
      if (ids.length) {
        offers.push({
          id: 'offer-puzzles-' + key, kind: 'puzzle-set',
          title: 'Targeted training',
          detail: `You struggle with ${WEAKNESS_LABEL[key]} — try these ${ids.length} puzzles.`,
          puzzleIds: ids, xp: ids.length * 10,
        });
      }
    }
    if (offers.length >= 2) break;
  }

  if (lastGameWon !== null) {
    offers.push({
      id: 'offer-rematch', kind: 'rematch-blitz', timed: true,
      title: lastGameWon ? 'Prove it' : 'Redemption',
      detail: lastGameWon ? 'Rematch — but blitz (3+2) this time?' : 'Rematch? I\'ll ease off a notch. Blitz 3+2.',
      xp: 25,
    });
  }

  if (offers.length < 3) {
    const c = CONSTRAINTS.find(c => !progress.completedConstraints.includes(c.id));
    if (c) {
      offers.push({
        id: 'offer-' + c.id, kind: 'constraint', title: c.title,
        detail: c.description, constraintId: c.id, xp: c.xp,
      });
    }
  }
  return offers.slice(0, 3);
}
