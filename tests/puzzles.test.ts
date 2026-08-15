import { describe, it, expect } from 'vitest';
import { Position } from '../src/engine/position';
import { Search, MATE } from '../src/ai/search';
import { moveToUci } from '../src/engine/types';
import { PUZZLES } from '../src/app/puzzles';
import { DRILLS, CONSTRAINTS } from '../src/app/puzzles';

// Every shipped puzzle must be engine-verified: mates are forced in exactly N,
// and the stored solution move is (one of) the best moves.

describe('puzzle validity', () => {
  for (const p of PUZZLES) {
    it(`${p.id} (${p.kind})`, () => {
      const pos = new Position(p.fen);
      const s = new Search();
      const r = s.search(pos, { maxDepth: 8, moveTimeMs: 8000 });
      const best = r.rootMoves[0];

      if (p.kind.startsWith('mate')) {
        const n = parseInt(p.kind.slice(4), 10);
        expect(best.score, 'must be a forced mate').toBeGreaterThan(MATE - 1000);
        expect(MATE - best.score, 'mate distance in plies').toBe(2 * n - 1);
        // the stored solution must also force mate at the same distance
        const sol = r.rootMoves.find(m => moveToUci(m.move) === p.solution);
        expect(sol, 'solution move exists').toBeTruthy();
        expect(sol!.score).toBe(best.score);
      } else {
        const sol = r.rootMoves.find(m => moveToUci(m.move) === p.solution);
        expect(sol, 'solution move exists').toBeTruthy();
        expect(best.score - sol!.score, 'solution within 30cp of best').toBeLessThanOrEqual(30);
        if (p.kind === 'tactic') expect(sol!.score, 'tactic clearly favorable').toBeGreaterThan(100);
        else expect(sol!.score, 'defense survives').toBeGreaterThan(-60);
      }
    });
  }

  it('drill and constraint FENs load', () => {
    for (const d of DRILLS) expect(() => new Position(d.fen)).not.toThrow();
    for (const c of CONSTRAINTS) if (c.fen) expect(() => new Position(c.fen)).not.toThrow();
  });
});
