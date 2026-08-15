import { Position } from './position';
import {
  Move, moveFrom, moveTo, moveFlags, movePromo,
  FLAG_EP, FLAG_CASTLE_K, FLAG_CASTLE_Q,
  typeOf, fileOf, rankOf, sqName, PIECE_CHARS, PAWN, KING, Color,
} from './types';

/**
 * Standard algebraic notation for a legal move in `pos` (side to move).
 * Appends '+' / '#' by making the move and testing the reply position.
 */
export function toSAN(pos: Position, move: Move, legalMoves?: Move[]): string {
  const from = moveFrom(move), to = moveTo(move), flags = moveFlags(move), promo = movePromo(move);
  const piece = pos.board[from];
  const type = typeOf(piece);
  let san: string;

  if (flags & FLAG_CASTLE_K) san = 'O-O';
  else if (flags & FLAG_CASTLE_Q) san = 'O-O-O';
  else {
    const isCapture = pos.board[to] !== 0 || (flags & FLAG_EP) !== 0;
    if (type === PAWN) {
      san = (isCapture ? 'abcdefgh'[fileOf(from)] + 'x' : '') + sqName(to);
      if (promo) san += '=' + PIECE_CHARS[promo];
    } else {
      // Disambiguation among same-type pieces that can also reach `to`.
      const legals = legalMoves ?? pos.generateLegal();
      let sameFile = false, sameRank = false, others = false;
      for (const m of legals) {
        if (m === move) continue;
        const f = moveFrom(m);
        if (moveTo(m) !== to || f === from) continue;
        if (typeOf(pos.board[f]) !== type) continue;
        others = true;
        if (fileOf(f) === fileOf(from)) sameFile = true;
        if (rankOf(f) === rankOf(from)) sameRank = true;
      }
      let dis = '';
      if (others) {
        if (!sameFile) dis = 'abcdefgh'[fileOf(from)];
        else if (!sameRank) dis = String(rankOf(from) + 1);
        else dis = sqName(from);
      }
      san = PIECE_CHARS[type] + dis + (isCapture ? 'x' : '') + sqName(to);
    }
  }

  pos.makeMove(move);
  if (pos.inCheck()) san += pos.hasLegalMoves() ? '+' : '#';
  pos.unmakeMove();
  return san;
}

/** Strip decorations that do not affect move identity. */
export function normalizeSAN(san: string): string {
  return san.replace(/[+#!?]+$/g, '').replace(/^([RNBQK])([a-h1-8]?)x/, '$1$2x').trim();
}

/** Parse a SAN token against the legal moves of `pos`. Returns the move or null. */
export function fromSAN(pos: Position, san: string): Move | null {
  const target = normalizeSAN(san).replace(/0/g, 'O'); // tolerate 0-0
  const legals = pos.generateLegal();
  for (const m of legals) {
    if (normalizeSAN(toSAN(pos, m, legals)) === target) return m;
  }
  // Tolerate long algebraic (e2e4, e7e8q) as a fallback.
  const lam = /^([a-h][1-8])[-x]?([a-h][1-8])(?:=?([QRBNqrbn]))?$/.exec(target);
  if (lam) {
    for (const m of legals) {
      if (sqName(moveFrom(m)) === lam[1] && sqName(moveTo(m)) === lam[2]) {
        const promo = movePromo(m);
        const want = lam[3] ? PIECE_CHARS.indexOf(lam[3].toUpperCase()) : (promo ? 5 /* queen */ : 0);
        if (promo === want) return m;
      }
    }
  }
  return null;
}
