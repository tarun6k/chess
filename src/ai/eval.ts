import { Position } from '../engine/position';
import {
  WHITE, BLACK, Color, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, EMPTY,
  colorOf, typeOf, fileOf, rankOf,
} from '../engine/types';

/** Centipawn piece values. */
export const PIECE_VALUE = [0, 100, 320, 330, 500, 900, 20000];

/**
 * Adaptation knobs — how the player model bends the AI's judgement.
 * All default to neutral; see src/ai/adaptation.ts for how they are set.
 */
export interface EvalParams {
  /** >0: value attacking play near the enemy king more (vs passive players). */
  aggression: number;
  /** >0: value space and advanced pawns more (squeeze passive players). */
  spaceWeight: number;
  /** >0: value own king safety more (punish aggressive players' attacks). */
  kingSafetyWeight: number;
  /** >0: bonus for keeping the center pawn-locked (frustrate tacticians). */
  closedPref: number;
  /** scale on mobility term. */
  mobilityWeight: number;
}

export const NEUTRAL_PARAMS: EvalParams = {
  aggression: 0, spaceWeight: 0, kingSafetyWeight: 0, closedPref: 0, mobilityWeight: 1,
};

// Piece-square tables (Michniewski's simplified eval), written rank-8 row first.
// White reads table[sq ^ 56], black reads table[sq].
const PST_PAWN = [
   0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
];
const PST_KNIGHT = [
 -50,-40,-30,-30,-30,-30,-40,-50,
 -40,-20,  0,  0,  0,  0,-20,-40,
 -30,  0, 10, 15, 15, 10,  0,-30,
 -30,  5, 15, 20, 20, 15,  5,-30,
 -30,  0, 15, 20, 20, 15,  0,-30,
 -30,  5, 10, 15, 15, 10,  5,-30,
 -40,-20,  0,  5,  5,  0,-20,-40,
 -50,-40,-30,-30,-30,-30,-40,-50,
];
const PST_BISHOP = [
 -20,-10,-10,-10,-10,-10,-10,-20,
 -10,  0,  0,  0,  0,  0,  0,-10,
 -10,  0,  5, 10, 10,  5,  0,-10,
 -10,  5,  5, 10, 10,  5,  5,-10,
 -10,  0, 10, 10, 10, 10,  0,-10,
 -10, 10, 10, 10, 10, 10, 10,-10,
 -10,  5,  0,  0,  0,  0,  5,-10,
 -20,-10,-10,-10,-10,-10,-10,-20,
];
const PST_ROOK = [
   0,  0,  0,  0,  0,  0,  0,  0,
   5, 10, 10, 10, 10, 10, 10,  5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
   0,  0,  0,  5,  5,  0,  0,  0,
];
const PST_QUEEN = [
 -20,-10,-10, -5, -5,-10,-10,-20,
 -10,  0,  0,  0,  0,  0,  0,-10,
 -10,  0,  5,  5,  5,  5,  0,-10,
  -5,  0,  5,  5,  5,  5,  0, -5,
   0,  0,  5,  5,  5,  5,  0, -5,
 -10,  5,  5,  5,  5,  5,  0,-10,
 -10,  0,  5,  0,  0,  0,  0,-10,
 -20,-10,-10, -5, -5,-10,-10,-20,
];
const PST_KING_MG = [
 -30,-40,-40,-50,-50,-40,-40,-30,
 -30,-40,-40,-50,-50,-40,-40,-30,
 -30,-40,-40,-50,-50,-40,-40,-30,
 -30,-40,-40,-50,-50,-40,-40,-30,
 -20,-30,-30,-40,-40,-30,-30,-20,
 -10,-20,-20,-20,-20,-20,-20,-10,
  20, 20,  0,  0,  0,  0, 20, 20,
  20, 30, 10,  0,  0, 10, 30, 20,
];
const PST_KING_EG = [
 -50,-40,-30,-20,-20,-30,-40,-50,
 -30,-20,-10,  0,  0,-10,-20,-30,
 -30,-10, 20, 30, 30, 20,-10,-30,
 -30,-10, 30, 40, 40, 30,-10,-30,
 -30,-10, 30, 40, 40, 30,-10,-30,
 -30,-10, 20, 30, 30, 20,-10,-30,
 -30,-30,  0,  0,  0,  0,-30,-30,
 -50,-30,-30,-30,-30,-30,-50,-50,
];
const PST: number[][] = [[], PST_PAWN, PST_KNIGHT, PST_BISHOP, PST_ROOK, PST_QUEEN, PST_KING_MG];

const KNIGHT_MOVES_D = [17, 15, 10, 6, -6, -10, -15, -17];
const KNIGHT_MOVES_F = [1, -1, 2, -2, 2, -2, 1, -1];

/**
 * Static evaluation in centipawns from WHITE's point of view.
 */
export function evaluate(pos: Position, params: EvalParams = NEUTRAL_PARAMS): number {
  const b = pos.board;
  let mg = 0;
  let score = 0;

  // Pass 1: gather pawn files, material, phase
  let phaseMaterial = 0; // non-pawn material of both sides
  const pawnFiles: [number[], number[]] = [[0,0,0,0,0,0,0,0], [0,0,0,0,0,0,0,0]];
  let bishops: [number, number] = [0, 0];
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq];
    if (p === EMPTY) continue;
    const t = typeOf(p);
    if (t === PAWN) pawnFiles[p > 0 ? 0 : 1][fileOf(sq)]++;
    else if (t !== KING) phaseMaterial += PIECE_VALUE[t];
    if (t === BISHOP) bishops[p > 0 ? 0 : 1]++;
  }
  // phase: 1 = full middlegame, 0 = bare endgame  (max non-pawn material = 2*(2*320+2*330+2*500+900) = 6200)
  const phase = Math.min(1, phaseMaterial / 6200);

  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq];
    if (p === EMPTY) continue;
    const t = typeOf(p);
    const white = p > 0;
    const us = white ? 0 : 1;
    const sign = white ? 1 : -1;
    const relSq = white ? (sq ^ 56) : sq;
    let v = PIECE_VALUE[t];

    if (t === KING) {
      v += PST_KING_MG[relSq] * phase + PST_KING_EG[relSq] * (1 - phase);
      // Pawn shield in the middlegame
      if (phase > 0.4) {
        const f = fileOf(sq);
        let shield = 0;
        for (let df = -1; df <= 1; df++) {
          const ff = f + df;
          if (ff < 0 || ff > 7) continue;
          const s1 = sq + (white ? 8 : -8) + df;
          const s2 = sq + (white ? 16 : -16) + df;
          if (s1 >= 0 && s1 < 64 && b[s1] === (white ? PAWN : -PAWN)) shield += 12;
          else if (s2 >= 0 && s2 < 64 && b[s2] === (white ? PAWN : -PAWN)) shield += 6;
        }
        v += shield * phase * (1 + params.kingSafetyWeight);
      }
    } else {
      v += PST[t][relSq];
    }

    if (t === PAWN) {
      const f = fileOf(sq);
      const r = rankOf(sq);
      const relRank = white ? r : 7 - r;
      // doubled
      if (pawnFiles[us][f] > 1) v -= 12;
      // isolated
      const leftOk = f > 0 && pawnFiles[us][f - 1] > 0;
      const rightOk = f < 7 && pawnFiles[us][f + 1] > 0;
      if (!leftOk && !rightOk) v -= 15;
      // passed: no enemy pawns ahead on this or adjacent files
      let passed = true;
      const them = us ^ 1;
      for (let df = -1; df <= 1 && passed; df++) {
        const ff = f + df;
        if (ff < 0 || ff > 7) continue;
        if (pawnFiles[them][ff] > 0) {
          // check actual squares ahead
          for (let rr = white ? r + 1 : r - 1; rr >= 0 && rr < 8; rr += white ? 1 : -1) {
            if (b[rr * 8 + ff] === (white ? -PAWN : PAWN)) { passed = false; break; }
          }
        }
      }
      if (passed) v += [0, 10, 15, 25, 40, 65, 100, 0][relRank] * (1.4 - 0.4 * phase);
      // space: pawns advanced past the middle
      if (relRank >= 4) v += params.spaceWeight * 6 * (relRank - 3);
    }

    if (t === ROOK) {
      const f = fileOf(sq);
      if (pawnFiles[us][f] === 0) v += pawnFiles[us ^ 1][f] === 0 ? 18 : 9; // open / semi-open
      // closed-position preference: rooks matter less, so a "closedPref" AI
      // slightly discounts its opponent-facing open lines — handled globally below.
    }

    // Mobility for minors + rooks (pseudo-mobility, cheap)
    if (params.mobilityWeight !== 0 && (t === KNIGHT || t === BISHOP || t === ROOK)) {
      let mob = 0;
      const file = fileOf(sq);
      if (t === KNIGHT) {
        for (let i = 0; i < 8; i++) {
          const to = sq + KNIGHT_MOVES_D[i];
          if (to < 0 || to > 63) continue;
          if (fileOf(to) - file !== KNIGHT_MOVES_F[i]) continue;
          const q = b[to];
          if (q === EMPTY || (q > 0) !== white) mob++;
        }
      } else {
        const dirs = t === BISHOP ? [9, 7, -7, -9] : [8, -8, 1, -1];
        const fds = t === BISHOP ? [1, -1, 1, -1] : [0, 0, 1, -1];
        for (let d = 0; d < dirs.length; d++) {
          let to = sq, prevF = file;
          for (;;) {
            to += dirs[d];
            if (to < 0 || to > 63) break;
            const f2 = fileOf(to);
            if (f2 - prevF !== fds[d]) break;
            prevF = f2;
            const q = b[to];
            if (q === EMPTY) { mob++; continue; }
            if ((q > 0) !== white) mob++;
            break;
          }
        }
      }
      v += mob * 2 * params.mobilityWeight;
    }

    // Aggression: pieces near the enemy king are worth a bit more
    if (params.aggression !== 0 && t !== KING && t !== PAWN) {
      const ek = pos.kingSq[white ? BLACK : WHITE];
      const dist = Math.max(Math.abs(fileOf(sq) - fileOf(ek)), Math.abs(rankOf(sq) - rankOf(ek)));
      if (dist <= 3) v += params.aggression * (4 - dist) * 6;
    }

    score += sign * v;
    mg += 0;
  }

  // Bishop pair
  if (bishops[0] >= 2) score += 30;
  if (bishops[1] >= 2) score -= 30;

  // Closed-center preference: count locked central pawn pairs (pawn faces enemy pawn).
  if (params.closedPref !== 0) {
    let locked = 0;
    for (let f = 2; f <= 5; f++) {
      for (let r = 2; r <= 5; r++) {
        const sq = r * 8 + f;
        if (b[sq] === PAWN && b[sq + 8] === -PAWN) locked++;
      }
    }
    // Symmetric bonus scaled toward the side that wants it closed; applied
    // as a white-positive term times the side preference set by the caller.
    score += params.closedPref * locked * 8;
  }

  return Math.round(score);
}
