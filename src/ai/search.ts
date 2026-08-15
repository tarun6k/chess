import { Position } from '../engine/position';
import { evaluate, EvalParams, NEUTRAL_PARAMS, PIECE_VALUE } from './eval';
import {
  Move, moveFrom, moveTo, moveFlags, movePromo, FLAG_EP,
  typeOf, WHITE, Color, EMPTY,
} from '../engine/types';

export const MATE = 100000;
const MATE_THRESHOLD = MATE - 1000;

// Transposition table: index by hashLo & mask, verify hashHi.
const TT_SIZE = 1 << 18;
const TT_MASK = TT_SIZE - 1;
const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;

interface TTEntry { hi: number; lo: number; depth: number; score: number; flag: number; move: Move; }

export interface SearchOptions {
  maxDepth: number;
  /** soft time cap in ms — search finishes the current depth then stops */
  moveTimeMs: number;
  params?: EvalParams;
  /** repetition keys of the game so far (for draw detection at the root path) */
  historyKeys?: string[];
}

export interface RootMove { move: Move; score: number; }

export interface SearchResult {
  best: Move | 0;
  score: number;             // cp from the searched side's POV
  depth: number;             // depth actually completed
  nodes: number;
  /** root moves with exact-ish scores, best first (for persona/blunder selection) */
  rootMoves: RootMove[];
  pv: Move[];
}

class TimeUp extends Error {}

export class Search {
  private tt: (TTEntry | undefined)[] = new Array(TT_SIZE);
  private killers: Move[][] = [];
  private history: Int32Array = new Int32Array(2 * 64 * 64);
  private nodes = 0;
  private deadline = 0;
  private params: EvalParams = NEUTRAL_PARAMS;
  private pathKeys = new Map<string, number>();

  clear(): void {
    this.tt = new Array(TT_SIZE);
    this.history.fill(0);
    this.killers = [];
  }

  /** Iterative-deepening search. Never throws; always returns the best completed result. */
  search(pos: Position, opts: SearchOptions): SearchResult {
    this.params = opts.params ?? NEUTRAL_PARAMS;
    this.nodes = 0;
    this.killers = Array.from({ length: 64 }, () => [0, 0]);
    this.deadline = Date.now() + Math.max(50, opts.moveTimeMs);
    this.pathKeys = new Map();
    for (const k of opts.historyKeys ?? []) {
      this.pathKeys.set(k, (this.pathKeys.get(k) ?? 0) + 1);
    }

    const legal = pos.generateLegal();
    if (legal.length === 0) {
      return { best: 0, score: pos.inCheck() ? -MATE : 0, depth: 0, nodes: 0, rootMoves: [], pv: [] };
    }

    let result: SearchResult = {
      best: legal[0], score: 0, depth: 0, nodes: 0,
      rootMoves: legal.map(m => ({ move: m, score: 0 })), pv: [legal[0]],
    };

    const softStop = Date.now() + opts.moveTimeMs * 0.6;
    for (let depth = 1; depth <= opts.maxDepth; depth++) {
      try {
        const rootMoves = this.searchRoot(pos, depth, result.rootMoves);
        result = {
          best: rootMoves[0].move,
          score: rootMoves[0].score,
          depth,
          nodes: this.nodes,
          rootMoves,
          pv: this.extractPV(pos, depth),
        };
      } catch (e) {
        if (e instanceof TimeUp) break;
        throw e;
      }
      if (Date.now() > softStop) break;
      if (result.score > MATE_THRESHOLD) break; // found a forced mate — play it
    }
    return result;
  }

  /**
   * Root search: every move gets a score. Moves within 250cp of the best get
   * exact scores (searched with a widened window) so the persona layer can
   * choose among realistic candidates.
   */
  private searchRoot(pos: Position, depth: number, prevOrder: RootMove[]): RootMove[] {
    const MARGIN = 250;
    let alpha = -Infinity;
    const scored: RootMove[] = [];
    const moves = prevOrder.length ? prevOrder.map(r => r.move) : pos.generateLegal();
    for (const m of moves) {
      pos.makeMove(m);
      this.notePath(pos, +1);
      let score: number;
      try {
        score = -this.alphaBeta(pos, depth - 1, -Infinity, -(alpha - MARGIN), 1);
      } finally {
        this.notePath(pos, -1);
        pos.unmakeMove();
      }
      scored.push({ move: m, score });
      if (score > alpha) alpha = score;
    }
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  private notePath(pos: Position, delta: number): void {
    const k = pos.hashKey();
    const n = (this.pathKeys.get(k) ?? 0) + delta;
    if (n <= 0) this.pathKeys.delete(k); else this.pathKeys.set(k, n);
  }

  private isRepetitionDraw(pos: Position): boolean {
    return (this.pathKeys.get(pos.hashKey()) ?? 0) >= 2 || pos.halfmove >= 100;
  }

  private alphaBeta(pos: Position, depth: number, alpha: number, beta: number, ply: number): number {
    if ((this.nodes++ & 2047) === 0 && Date.now() > this.deadline) throw new TimeUp();

    if (this.isRepetitionDraw(pos) || pos.isInsufficientMaterial()) return 0;

    const inCheck = pos.inCheck();
    if (inCheck) depth++; // check extension

    if (depth <= 0) return this.quiescence(pos, alpha, beta, ply);

    // TT probe
    const idx = pos.hashLo & TT_MASK;
    const entry = this.tt[idx];
    let ttMove: Move = 0;
    if (entry && entry.hi === pos.hashHi && entry.lo === pos.hashLo) {
      ttMove = entry.move;
      if (entry.depth >= depth) {
        const s = entry.score;
        if (entry.flag === TT_EXACT) return s;
        if (entry.flag === TT_LOWER && s >= beta) return s;
        if (entry.flag === TT_UPPER && s <= alpha) return s;
      }
    }

    const moves = pos.generatePseudo();
    this.orderMoves(pos, moves, ttMove, ply);

    let bestScore = -Infinity;
    let bestMove: Move = 0;
    let legalCount = 0;
    const alphaOrig = alpha;
    const us = pos.turn;
    const them = (us ^ 1) as Color;

    for (const m of moves) {
      pos.makeMove(m);
      if (pos.attacked(pos.kingSq[us], them)) { pos.unmakeMove(); continue; }
      legalCount++;
      this.notePath(pos, +1);
      let score: number;
      try {
        score = -this.alphaBeta(pos, depth - 1, -beta, -alpha, ply + 1);
      } finally {
        this.notePath(pos, -1);
        pos.unmakeMove();
      }
      if (score > bestScore) {
        bestScore = score;
        bestMove = m;
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) {
            // killer/history for quiet moves
            if (pos.board[moveTo(m)] === EMPTY && !(moveFlags(m) & FLAG_EP)) {
              const k = this.killers[ply] ?? (this.killers[ply] = [0, 0]);
              if (k[0] !== m) { k[1] = k[0]; k[0] = m; }
              this.history[(pos.turn * 64 + moveFrom(m)) * 64 + moveTo(m)] += depth * depth;
            }
            break;
          }
        }
      }
    }

    if (legalCount === 0) return inCheck ? -MATE + ply : 0;

    const flag = bestScore <= alphaOrig ? TT_UPPER : bestScore >= beta ? TT_LOWER : TT_EXACT;
    this.tt[idx] = { hi: pos.hashHi, lo: pos.hashLo, depth, score: bestScore, flag, move: bestMove };
    return bestScore;
  }

  private quiescence(pos: Position, alpha: number, beta: number, ply: number): number {
    if ((this.nodes++ & 2047) === 0 && Date.now() > this.deadline) throw new TimeUp();

    const side = pos.turn === WHITE ? 1 : -1;
    const stand = side * evaluate(pos, this.params);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (ply > 40) return stand;

    const moves = pos.generatePseudo();
    // captures and promotions only
    const tactical = moves.filter(m =>
      pos.board[moveTo(m)] !== EMPTY || (moveFlags(m) & FLAG_EP) || movePromo(m) >= 5);
    tactical.sort((a, b) => this.mvvLva(pos, b) - this.mvvLva(pos, a));

    const us = pos.turn;
    const them = (us ^ 1) as Color;
    let best = stand;
    for (const m of tactical) {
      // Delta pruning: skip hopeless captures
      const victim = pos.board[moveTo(m)];
      if (victim !== EMPTY && stand + PIECE_VALUE[typeOf(victim)] + 200 < alpha) continue;
      pos.makeMove(m);
      if (pos.attacked(pos.kingSq[us], them)) { pos.unmakeMove(); continue; }
      const score = -this.quiescence(pos, -beta, -alpha, ply + 1);
      pos.unmakeMove();
      if (score > best) {
        best = score;
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) break;
        }
      }
    }
    return best;
  }

  private mvvLva(pos: Position, m: Move): number {
    const victim = pos.board[moveTo(m)];
    const attacker = pos.board[moveFrom(m)];
    const v = victim === EMPTY ? ((moveFlags(m) & FLAG_EP) ? 100 : 0) : PIECE_VALUE[typeOf(victim)];
    return v * 10 - PIECE_VALUE[typeOf(attacker)] / 10 + movePromo(m) * 50;
  }

  private orderMoves(pos: Position, moves: Move[], ttMove: Move, ply: number): void {
    const killer = this.killers[ply] ?? [0, 0];
    const scores = moves.map(m => {
      if (m === ttMove) return 1e9;
      const victim = pos.board[moveTo(m)];
      if (victim !== EMPTY || (moveFlags(m) & FLAG_EP)) return 1e6 + this.mvvLva(pos, m);
      if (m === killer[0]) return 9e5;
      if (m === killer[1]) return 8e5;
      return this.history[(pos.turn * 64 + moveFrom(m)) * 64 + moveTo(m)];
    });
    // simple insertion sort by paired score (moves lists are short)
    for (let i = 1; i < moves.length; i++) {
      const m = moves[i], s = scores[i];
      let j = i - 1;
      while (j >= 0 && scores[j] < s) { moves[j + 1] = moves[j]; scores[j + 1] = scores[j]; j--; }
      moves[j + 1] = m; scores[j + 1] = s;
    }
  }

  private extractPV(pos: Position, maxLen: number): Move[] {
    const pv: Move[] = [];
    const made: number = 0;
    let count = 0;
    const seen = new Set<string>();
    while (count < maxLen) {
      const idx = pos.hashLo & TT_MASK;
      const entry = this.tt[idx];
      if (!entry || entry.hi !== pos.hashHi || entry.lo !== pos.hashLo || !entry.move) break;
      const legal = pos.generateLegal();
      if (!legal.includes(entry.move)) break;
      const key = pos.hashKey();
      if (seen.has(key)) break;
      seen.add(key);
      pv.push(entry.move);
      pos.makeMove(entry.move);
      count++;
    }
    for (let i = 0; i < count; i++) pos.unmakeMove();
    return pv;
  }
}
