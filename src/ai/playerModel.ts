// The persistent model of the human player: style, rating, openings, weaknesses.
// Built up after every finished game from the move record + post-game analysis.

import { Game } from '../engine/game';
import { Position } from '../engine/position';
import {
  WHITE, BLACK, Color, QUEEN, PAWN, typeOf, colorOf, fileOf, rankOf,
  moveFrom, moveTo, EMPTY,
} from '../engine/types';
import { AnalyzedMove } from './protocol';
import { identifyOpening } from './openings';

export type StyleLabel = 'aggressive' | 'tactical' | 'positional' | 'defensive' | 'materialistic' | 'balanced';

export type WeaknessKey =
  | 'hanging-pieces'   // outright gave material away
  | 'missed-tactics'   // best move was a tactic (capture/check) but a quiet move was played
  | 'back-rank'        // blunders with the king still on the back rank behind pawns
  | 'endgame'          // errors once material is reduced
  | 'opening'          // errors in the first 8 moves
  | 'king-safety';     // castled late / never, got attacked

export interface OpeningStat { name: string; count: number; asWhite: number; wins: number; }

export interface StyleFeatures {
  games: number;
  avgCaptureRate: number;      // captures per move
  avgEarlyQueenPly: number;    // ply of first queen move (or 24 if late/never)
  avgCastlePly: number;        // ply the player castled (or 30 if never)
  avgChecksPerGame: number;
  avgPawnStorm: number;        // pawn advances beyond rank 4 per game
  avgTradeRate: number;        // recaptures per capture opportunity
  avgCpLoss: number;           // accuracy proxy from analysis
  avgThinkMs: number;
}

export interface PlayerModel {
  version: 1;
  rating: number;
  ratingHistory: Array<{ t: number; rating: number }>;
  wins: number; losses: number; draws: number;
  streak: number;              // >0 winning streak, <0 losing streak
  features: StyleFeatures;
  weaknesses: Record<WeaknessKey, number>;
  openings: OpeningStat[];
  /** last few games' adaptation summaries (for the insights screen) */
  lastAdaptation?: string[];
}

export function newPlayerModel(): PlayerModel {
  return {
    version: 1,
    rating: 800,
    ratingHistory: [],
    wins: 0, losses: 0, draws: 0,
    streak: 0,
    features: {
      games: 0, avgCaptureRate: 0, avgEarlyQueenPly: 24, avgCastlePly: 30,
      avgChecksPerGame: 0, avgPawnStorm: 0, avgTradeRate: 0, avgCpLoss: 0, avgThinkMs: 0,
    },
    weaknesses: {
      'hanging-pieces': 0, 'missed-tactics': 0, 'back-rank': 0,
      endgame: 0, opening: 0, 'king-safety': 0,
    },
    openings: [],
  };
}

/** Rolling average with recency weighting. */
function roll(prev: number, next: number, games: number): number {
  const w = Math.min(0.25, 1 / Math.max(1, games));
  return prev * (1 - w) + next * w;
}

export interface GameFacts {
  playerColor: Color;
  captureRate: number;
  earlyQueenPly: number;
  castlePly: number;
  checks: number;
  pawnStorm: number;
  tradeRate: number;
  avgThinkMs: number;
  openingName: string | null;
}

/** Extract per-game style features for the player's side. */
export function extractFacts(game: Game, playerColor: Color): GameFacts {
  const pos = new Position(game.startFen);
  let captures = 0, playerMoves = 0, checks = 0, pawnStorm = 0;
  let earlyQueenPly = 24, castlePly = 30;
  let recaptureChances = 0, recaptures = 0;
  let thinkTotal = 0, thinkCount = 0;
  let lastCaptureSq = -1;

  game.history.forEach((h, ply) => {
    const mover = pos.turn;
    const from = moveFrom(h.move), to = moveTo(h.move);
    const isCapture = h.captured !== EMPTY;
    if (mover === playerColor) {
      playerMoves++;
      if (isCapture) captures++;
      if (h.san.includes('+') || h.san.includes('#')) checks++;
      if (typeOf(pos.board[from]) === QUEEN && ply < 24 && earlyQueenPly === 24) earlyQueenPly = ply;
      if ((h.san === 'O-O' || h.san === 'O-O-O') && castlePly === 30) castlePly = ply;
      if (typeOf(pos.board[from]) === PAWN) {
        const rel = playerColor === WHITE ? rankOf(to) : 7 - rankOf(to);
        if (rel >= 4) pawnStorm++;
      }
      if (lastCaptureSq >= 0) {
        recaptureChances++;
        if (isCapture && to === lastCaptureSq) recaptures++;
      }
      if (h.thinkMs) { thinkTotal += h.thinkMs; thinkCount++; }
    }
    lastCaptureSq = isCapture && mover !== playerColor ? to : -1;
    pos.makeMove(h.move);
  });

  return {
    playerColor,
    captureRate: playerMoves ? captures / playerMoves : 0,
    earlyQueenPly,
    castlePly,
    checks,
    pawnStorm,
    tradeRate: recaptureChances ? recaptures / recaptureChances : 0,
    avgThinkMs: thinkCount ? thinkTotal / thinkCount : 0,
    openingName: identifyOpening(game.sanLine())?.name ?? null,
  };
}

/** Classify weaknesses from the analysis of the player's moves. */
export function extractWeaknesses(
  game: Game, playerColor: Color, analysis: AnalyzedMove[],
): Partial<Record<WeaknessKey, number>> {
  const out: Partial<Record<WeaknessKey, number>> = {};
  const bump = (k: WeaknessKey) => { out[k] = (out[k] ?? 0) + 1; };
  const pos = new Position(game.startFen);

  analysis.forEach((a, ply) => {
    const mover = pos.turn;
    const h = game.history[ply];
    if (!h) return;
    if (mover === playerColor && a.cpLoss >= 120) {
      // Where in the game?
      if (ply < 16) bump('opening');
      else {
        let nonPawnMaterial = 0;
        for (let sq = 0; sq < 64; sq++) {
          const p = pos.board[sq];
          if (p !== EMPTY && typeOf(p) !== PAWN && typeOf(p) !== 6) nonPawnMaterial++;
        }
        if (nonPawnMaterial <= 6) bump('endgame');
      }
      // What kind of mistake?
      const bestWasTactic = a.bestUci !== a.uci &&
        (isCaptureUci(pos, a.bestUci) || sanGivesCheck(pos, a.bestUci));
      if (bestWasTactic) bump('missed-tactics');
      if (a.cpLoss >= 250 && !isCaptureUci(pos, a.uci)) bump('hanging-pieces');
      // Back rank: king on home rank behind own pawns while blundering
      const k = pos.kingSq[playerColor];
      const home = playerColor === WHITE ? 0 : 7;
      if (a.cpLoss >= 250 && rankOf(k) === home) {
        const dir = playerColor === WHITE ? 8 : -8;
        const f = fileOf(k);
        let sealed = true;
        for (let df = -1; df <= 1; df++) {
          const ff = f + df;
          if (ff < 0 || ff > 7) continue;
          const s = k + dir + df;
          if (s < 0 || s > 63 || pos.board[s] === EMPTY) { sealed = false; break; }
        }
        if (sealed) bump('back-rank');
      }
    }
    pos.makeMove(game.history[ply].move);
  });

  // King safety: never castled and got mated/attacked
  const facts = extractFacts(game, playerColor);
  if (facts.castlePly >= 30 && game.result?.winner !== null && game.result?.winner !== playerColor) {
    out['king-safety'] = (out['king-safety'] ?? 0) + 1;
  }
  return out;
}

function isCaptureUci(pos: Position, uci: string): boolean {
  if (uci.length < 4) return false;
  const to = (uci.charCodeAt(2) - 97) + (uci.charCodeAt(3) - 49) * 8;
  return pos.board[to] !== EMPTY;
}
function sanGivesCheck(pos: Position, uci: string): boolean {
  // cheap proxy: does the best move capture near the king or is it a promotion?
  return uci.length === 5;
}

/** Style classification from accumulated features. */
export function classifyStyle(f: StyleFeatures): { label: StyleLabel; scores: Record<string, number> } {
  const aggression =
    (f.avgCaptureRate > 0.18 ? 1 : 0) + (f.avgEarlyQueenPly < 10 ? 1 : 0) +
    (f.avgChecksPerGame > 3 ? 1 : 0) + (f.avgPawnStorm > 5 ? 1 : 0);
  const tactical = (f.avgCaptureRate > 0.22 ? 2 : f.avgCaptureRate > 0.16 ? 1 : 0) + (f.avgChecksPerGame > 4 ? 1 : 0);
  const positional = (f.avgCastlePly < 14 ? 1 : 0) + (f.avgCaptureRate < 0.14 ? 1 : 0) + (f.avgPawnStorm < 3 ? 1 : 0);
  const defensive = (f.avgEarlyQueenPly > 16 ? 1 : 0) + (f.avgChecksPerGame < 2 ? 1 : 0) + (f.avgCaptureRate < 0.12 ? 1 : 0);
  const materialistic = (f.avgTradeRate > 0.6 ? 2 : f.avgTradeRate > 0.45 ? 1 : 0) + (f.avgCaptureRate > 0.2 ? 1 : 0);

  const scores = { aggressive: aggression, tactical, positional, defensive, materialistic };
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topName, topScore] = entries[0];
  const label: StyleLabel = topScore >= 2 && f.games >= 2 ? topName as StyleLabel : 'balanced';
  return { label, scores };
}

/** Elo update after a game vs the AI. */
export function updateRating(model: PlayerModel, aiElo: number, score: 0 | 0.5 | 1): void {
  const expected = 1 / (1 + Math.pow(10, (aiElo - model.rating) / 400));
  const k = model.features.games < 10 ? 48 : 24;
  model.rating = Math.round(Math.max(200, model.rating + k * (score - expected)));
  model.ratingHistory.push({ t: Date.now(), rating: model.rating });
  if (model.ratingHistory.length > 200) model.ratingHistory.shift();
}

/** Merge one finished game (vs AI or not) into the model. */
export function updateModelAfterGame(
  model: PlayerModel,
  game: Game,
  playerColor: Color,
  analysis: AnalyzedMove[] | null,
  opts: { vsAi: boolean; aiElo?: number },
): GameFacts {
  const facts = extractFacts(game, playerColor);
  const f = model.features;
  f.games++;
  f.avgCaptureRate = roll(f.avgCaptureRate, facts.captureRate, f.games);
  f.avgEarlyQueenPly = roll(f.avgEarlyQueenPly, facts.earlyQueenPly, f.games);
  f.avgCastlePly = roll(f.avgCastlePly, facts.castlePly, f.games);
  f.avgChecksPerGame = roll(f.avgChecksPerGame, facts.checks, f.games);
  f.avgPawnStorm = roll(f.avgPawnStorm, facts.pawnStorm, f.games);
  f.avgTradeRate = roll(f.avgTradeRate, facts.tradeRate, f.games);
  if (facts.avgThinkMs) f.avgThinkMs = roll(f.avgThinkMs || facts.avgThinkMs, facts.avgThinkMs, f.games);

  if (analysis) {
    const playerMoves = analysis.filter((_, ply) => {
      const startTurn = new Position(game.startFen).turn;
      return (ply % 2 === 0 ? startTurn : startTurn ^ 1) === playerColor;
    });
    if (playerMoves.length) {
      const cpLoss = playerMoves.reduce((s, a) => s + a.cpLoss, 0) / playerMoves.length;
      f.avgCpLoss = roll(f.avgCpLoss || cpLoss, cpLoss, f.games);
    }
    const weak = extractWeaknesses(game, playerColor, analysis);
    for (const [k, v] of Object.entries(weak)) {
      model.weaknesses[k as WeaknessKey] += v as number;
    }
  }

  if (facts.openingName) {
    let stat = model.openings.find(o => o.name === facts.openingName);
    if (!stat) { stat = { name: facts.openingName, count: 0, asWhite: 0, wins: 0 }; model.openings.push(stat); }
    stat.count++;
    if (playerColor === WHITE) stat.asWhite++;
    if (game.result?.winner === playerColor) stat.wins++;
    model.openings.sort((a, b) => b.count - a.count);
    if (model.openings.length > 12) model.openings.length = 12;
  }

  const won = game.result?.winner === playerColor;
  const drew = game.result?.winner === null || game.result?.winner === undefined;
  if (won) { model.wins++; model.streak = Math.max(1, model.streak + 1); }
  else if (drew) { model.draws++; model.streak = 0; }
  else { model.losses++; model.streak = Math.min(-1, model.streak - 1); }

  if (opts.vsAi && opts.aiElo) {
    updateRating(model, opts.aiElo, won ? 1 : drew ? 0.5 : 0);
  }
  return facts;
}

/** Top weaknesses sorted by count (for insights + challenge generation). */
export function topWeaknesses(model: PlayerModel, n = 3): Array<{ key: WeaknessKey; count: number }> {
  return (Object.entries(model.weaknesses) as Array<[WeaknessKey, number]>)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}
