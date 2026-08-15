import { describe, it, expect } from 'vitest';
import { Position } from '../src/engine/position';
import { Search, MATE } from '../src/ai/search';
import { moveToUci } from '../src/engine/types';
import { personaForSkill, chooseMove } from '../src/ai/persona';

describe('search', () => {
  it('finds mate in 1', () => {
    const s = new Search();
    // Back-rank: Ra8#
    const pos = new Position('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1');
    const r = s.search(pos, { maxDepth: 3, moveTimeMs: 3000 });
    expect(moveToUci(r.best as number)).toBe('a1a8');
    expect(r.score).toBeGreaterThan(MATE - 1000);
  });

  it('finds mate in 2', () => {
    const s = new Search();
    // Classic: 1.Qh6+!? — use a simple KQ ladder position instead:
    // White: Kg1 Qg3 Rd1; Black: Kh8 ... simpler known M2:
    // "Anastasia-like" simple: R+Q vs bare king. Qf7 then mate is not forced in 1 line;
    // use ladder mate: rooks a7, b1, black king h8 → Rb8#? Rb1-b8 mate immediately (back rank empty).
    // For a true mate in 2: K+R+R vs K with king cut off.
    const pos = new Position('7k/R7/1R6/8/8/8/8/4K3 w - - 0 1');
    const r = s.search(pos, { maxDepth: 4, moveTimeMs: 5000 });
    // Rb8+ (or Ra8+ after Rb7...) — verify search sees forced mate
    expect(r.score).toBeGreaterThan(MATE - 1000);
  });

  it('does not hang the queen at decent skill', () => {
    const s = new Search();
    // Queen attacked by a pawn; must move or be lost for nothing.
    const pos = new Position('rnb1kbnr/pppp1ppp/8/4p3/4P1q1/5P2/PPPP2PP/RNBQKBNR b KQkq - 0 3');
    const r = s.search(pos, { maxDepth: 3, moveTimeMs: 3000 });
    const best = moveToUci(r.best as number);
    expect(best.startsWith('g4')).toBe(true); // queen moves away
  });

  it('takes a free rook', () => {
    const s = new Search();
    const pos = new Position('k7/8/8/3r4/4Q3/8/8/4K3 w - - 0 1');
    const r = s.search(pos, { maxDepth: 3, moveTimeMs: 3000 });
    expect(moveToUci(r.best as number)).toBe('e4d5');
  });

  it('root moves are sorted best-first with exact scores near the top', () => {
    const s = new Search();
    const pos = new Position('k7/8/8/3r4/4Q3/8/8/4K3 w - - 0 1');
    const r = s.search(pos, { maxDepth: 3, moveTimeMs: 3000 });
    for (let i = 1; i < r.rootMoves.length; i++) {
      expect(r.rootMoves[i - 1].score).toBeGreaterThanOrEqual(r.rootMoves[i].score);
    }
  });
});

describe('persona', () => {
  it('max skill always plays the best move', () => {
    const rootMoves = [
      { move: 1, score: 100 }, { move: 2, score: 80 }, { move: 3, score: -200 },
    ];
    const p = personaForSkill(20, 1000);
    let seed = 42;
    const rng = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 50; i++) expect(chooseMove(rootMoves, p, rng)).toBe(0);
  });

  it('low skill sometimes deviates but stays within the drop bound', () => {
    const rootMoves = [
      { move: 1, score: 100 }, { move: 2, score: 60 }, { move: 3, score: -900 },
    ];
    const p = personaForSkill(2, 1000);
    let seed = 7;
    const rng = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let deviations = 0;
    for (let i = 0; i < 200; i++) {
      const idx = chooseMove(rootMoves, p, rng);
      expect(idx).not.toBe(2); // -900 is beyond maxDropCp 320
      if (idx !== 0) deviations++;
    }
    expect(deviations).toBeGreaterThan(0);
  });

  it('never abandons a found mate', () => {
    const rootMoves = [
      { move: 1, score: MATE - 5 }, { move: 2, score: 50 },
    ];
    const p = personaForSkill(0, 1000);
    for (let i = 0; i < 50; i++) expect(chooseMove(rootMoves, p)).toBe(0);
  });
});
