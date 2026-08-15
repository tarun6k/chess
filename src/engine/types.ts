// Core engine types and constants. Square 0 = a1, 7 = h1, 56 = a8, 63 = h8.

export const WHITE = 0;
export const BLACK = 1;
export type Color = 0 | 1;

// Piece types
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

// Signed piece codes on the board: positive = white, negative = black, 0 = empty.
export const EMPTY = 0;

export const PIECE_CHARS = ' PNBRQK';

export function colorOf(piece: number): Color {
  return piece > 0 ? WHITE : BLACK;
}
export function typeOf(piece: number): number {
  return piece < 0 ? -piece : piece;
}
export function makePiece(type: number, color: Color): number {
  return color === WHITE ? type : -type;
}

export function fileOf(sq: number): number { return sq & 7; }
export function rankOf(sq: number): number { return sq >> 3; }
export function square(file: number, rank: number): number { return rank * 8 + file; }
export function sqName(sq: number): string {
  return 'abcdefgh'[sq & 7] + String((sq >> 3) + 1);
}
export function parseSquare(name: string): number {
  return (name.charCodeAt(0) - 97) + (name.charCodeAt(1) - 49) * 8;
}

// Castling rights bitmask
export const CASTLE_WK = 1;
export const CASTLE_WQ = 2;
export const CASTLE_BK = 4;
export const CASTLE_BQ = 8;

// Move flags
export const FLAG_EP = 1;
export const FLAG_DOUBLE = 2;
export const FLAG_CASTLE_K = 4;
export const FLAG_CASTLE_Q = 8;

// Move packing: bits 0-5 from, 6-11 to, 12-15 flags, 16-18 promo type (0 or N/B/R/Q)
export type Move = number;

export function makeMove(from: number, to: number, flags = 0, promo = 0): Move {
  return from | (to << 6) | (flags << 12) | (promo << 16);
}
export function moveFrom(m: Move): number { return m & 63; }
export function moveTo(m: Move): number { return (m >> 6) & 63; }
export function moveFlags(m: Move): number { return (m >> 12) & 15; }
export function movePromo(m: Move): number { return (m >> 16) & 7; }

/** UCI-style long algebraic, e.g. e2e4, e7e8q */
export function moveToUci(m: Move): string {
  const promo = movePromo(m);
  return sqName(moveFrom(m)) + sqName(moveTo(m)) + (promo ? PIECE_CHARS[promo].toLowerCase() : '');
}

export const KNIGHT_DELTAS: ReadonlyArray<readonly [number, number]> = [
  // [delta, file delta]
  [17, 1], [15, -1], [10, 2], [6, -2], [-6, 2], [-10, -2], [-15, 1], [-17, -1],
];
export const KING_DELTAS: ReadonlyArray<readonly [number, number]> = [
  [8, 0], [-8, 0], [1, 1], [-1, -1], [9, 1], [7, -1], [-7, 1], [-9, -1],
];
export const BISHOP_DIRS: ReadonlyArray<readonly [number, number]> = [
  [9, 1], [7, -1], [-7, 1], [-9, -1],
];
export const ROOK_DIRS: ReadonlyArray<readonly [number, number]> = [
  [8, 0], [-8, 0], [1, 1], [-1, -1],
];
