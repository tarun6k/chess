import { describe, it, expect } from 'vitest';
import { Position, START_FEN } from '../src/engine/position';
import { perft } from '../src/engine/perft';

// Standard perft reference positions (chessprogramming.org).
const CASES: Array<{ name: string; fen: string; counts: number[] }> = [
  {
    name: 'start position',
    fen: START_FEN,
    counts: [20, 400, 8902, 197281, 4865609],
  },
  {
    name: 'kiwipete',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    counts: [48, 2039, 97862, 4085603],
  },
  {
    name: 'position 3 (en passant pins)',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    counts: [14, 191, 2812, 43238, 674624],
  },
  {
    name: 'position 4 (promotions)',
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    counts: [6, 264, 9467, 422333],
  },
  {
    name: 'position 5',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    counts: [44, 1486, 62379, 2103487],
  },
  {
    name: 'position 6',
    fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1b1/2B1P1B1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    counts: [46, 2060, 88933, 3812850], // Stockfish-verified for this exact FEN
  },
];

describe('perft', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const pos = new Position(c.fen);
      for (let d = 1; d <= c.counts.length; d++) {
        expect(perft(pos, d), `${c.name} depth ${d}`).toBe(c.counts[d - 1]);
      }
    });
  }
});
