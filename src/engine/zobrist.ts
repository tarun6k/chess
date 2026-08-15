// Zobrist hashing with two independent 32-bit keys (JS has no fast 64-bit ints).
// Collisions across BOTH 32-bit halves are astronomically unlikely for our uses
// (repetition tracking and the search transposition table).

// Deterministic PRNG (mulberry32) so hashes are stable across sessions/tests.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

const rand = mulberry32(0x9e3779b9);

// piece index: (type-1) + (color * 6) → 0..11, times 64 squares
export const ZOBRIST_PIECES_LO = new Uint32Array(12 * 64);
export const ZOBRIST_PIECES_HI = new Uint32Array(12 * 64);
export const ZOBRIST_CASTLE_LO = new Uint32Array(16);
export const ZOBRIST_CASTLE_HI = new Uint32Array(16);
export const ZOBRIST_EP_LO = new Uint32Array(8);
export const ZOBRIST_EP_HI = new Uint32Array(8);
export let ZOBRIST_SIDE_LO = 0;
export let ZOBRIST_SIDE_HI = 0;

for (let i = 0; i < 12 * 64; i++) { ZOBRIST_PIECES_LO[i] = rand(); ZOBRIST_PIECES_HI[i] = rand(); }
for (let i = 0; i < 16; i++) { ZOBRIST_CASTLE_LO[i] = rand(); ZOBRIST_CASTLE_HI[i] = rand(); }
for (let i = 0; i < 8; i++) { ZOBRIST_EP_LO[i] = rand(); ZOBRIST_EP_HI[i] = rand(); }
ZOBRIST_SIDE_LO = rand();
ZOBRIST_SIDE_HI = rand();

export function pieceZobristIndex(type: number, color: number, sq: number): number {
  return ((type - 1) + color * 6) * 64 + sq;
}
