import { describe, it, expect } from 'vitest';
import { Position } from '../src/engine/position';
import { Game } from '../src/engine/game';
import { WHITE, BLACK, moveToUci, sqName, moveFrom, moveTo } from '../src/engine/types';

function uciMoves(pos: Position): string[] {
  return pos.generateLegal().map(moveToUci).sort();
}

describe('piece movement', () => {
  it('pawn cannot capture straight ahead', () => {
    const pos = new Position('4k3/8/8/3p4/3P4/8/8/4K3 w - - 0 1');
    expect(uciMoves(pos).filter(m => m.startsWith('d4'))).toEqual([]);
  });

  it('pawn double push only from start rank and not through pieces', () => {
    const pos = new Position('4k3/8/8/8/8/4p3/4P3/4K3 w - - 0 1');
    expect(uciMoves(pos).filter(m => m.startsWith('e2'))).toEqual([]);
    const pos2 = new Position('4k3/8/8/8/4p3/8/4P3/4K3 w - - 0 1');
    expect(uciMoves(pos2).filter(m => m.startsWith('e2'))).toEqual(['e2e3']);
  });

  it('knight jumps over pieces', () => {
    const pos = new Position('4k3/8/8/8/8/1p6/1pp5/N3K3 w - - 0 1');
    // a1 knight is boxed in by pawns but jumps over them to capture on b3/c2
    expect(uciMoves(pos).filter(m => m.startsWith('a1'))).toEqual(['a1b3', 'a1c2']);
  });

  it('king cannot move to an attacked square', () => {
    const pos = new Position('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1');
    const moves = uciMoves(pos).filter(m => m.startsWith('e1'));
    expect(moves).not.toContain('e1d2');
    expect(moves).not.toContain('e1f2');
    expect(moves).toContain('e1d1');
  });

  it('pinned piece cannot expose the king', () => {
    // Bishop on e2 pinned by rook on e8 against king e1
    const pos = new Position('4r1k1/8/8/8/8/8/4B3/4K3 w - - 0 1');
    const bishopMoves = uciMoves(pos).filter(m => m.startsWith('e2'));
    expect(bishopMoves).toEqual([]);
  });
});

describe('castling', () => {
  const base = 'r3k2r/8/8/8/8/8/8/R3K2R';

  it('both sides can castle both ways when all conditions hold', () => {
    const pos = new Position(base + ' w KQkq - 0 1');
    const moves = uciMoves(pos);
    expect(moves).toContain('e1g1');
    expect(moves).toContain('e1c1');
  });

  it('cannot castle while in check', () => {
    const pos = new Position('r3k2r/8/8/8/8/8/4r3/R3K2R w KQkq - 0 1');
    const moves = uciMoves(pos);
    expect(moves).not.toContain('e1g1');
    expect(moves).not.toContain('e1c1');
  });

  it('cannot castle through an attacked square', () => {
    // Black rook on f8 covers f1
    const pos = new Position('5rk1/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    expect(uciMoves(pos)).not.toContain('e1g1');
    expect(uciMoves(pos)).toContain('e1c1');
  });

  it('cannot castle into check', () => {
    // Black rook covers g1
    const pos = new Position('4k1r1/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    expect(uciMoves(pos)).not.toContain('e1g1');
  });

  it('queenside b1 may be attacked (only king path matters)', () => {
    // Black rook covers b1 — castling long is still legal
    const pos = new Position('1r5k/8/8/8/8/8/8/R3K3 w Q - 0 1');
    expect(uciMoves(pos)).toContain('e1c1');
  });

  it('rights lost after king or rook moves', () => {
    const g = new Game(base + ' w KQkq - 0 1');
    g.playSAN('Ke2'); g.playSAN('Kd8'); g.playSAN('Ke1'); g.playSAN('Ke8');
    expect(uciMoves(g.pos)).not.toContain('e1g1');
    expect(uciMoves(g.pos)).not.toContain('e1c1');
  });

  it('rights lost when the rook is captured on its square', () => {
    const g = new Game('4k3/8/8/8/8/8/6b1/R3K2R b KQ - 0 1');
    g.playSAN('Bxh1');
    expect((g.pos.castling & 1)).toBe(0); // WK gone
    expect((g.pos.castling & 2)).toBe(2); // WQ remains
  });
});

describe('en passant', () => {
  it('is offered immediately after a double push and expires after one move', () => {
    const g = new Game('4k3/2p5/8/1P6/8/8/8/4K3 b - - 0 1');
    g.playSAN('c5');
    expect(uciMoves(g.pos)).toContain('b5c6');
    g.playSAN('Kd1'); // decline
    g.playSAN('Kd8');
    expect(uciMoves(g.pos)).not.toContain('b5c6');
  });

  it('ep capture removes the captured pawn', () => {
    const g = new Game('4k3/2p5/8/1P6/8/8/8/4K3 b - - 0 1');
    g.playSAN('c5');
    const san = g.playSAN('bxc6');
    expect(san).toBe('bxc6');
    expect(g.pos.toFen().split(' ')[0]).toBe('4k3/8/2P5/8/8/8/8/4K3'.split(' ')[0]);
  });

  it('ep capture that exposes the king is illegal', () => {
    // After exd3 e.p. BOTH pawns leave rank 4, exposing the a4 king to Qh4.
    const pos = new Position('8/8/8/8/k2Pp2Q/8/8/4K3 b - d3 0 1');
    expect(uciMoves(pos)).not.toContain('e4d3');
    // The same capture is legal when the queen is elsewhere.
    const pos2 = new Position('8/8/8/8/k2Pp3/8/8/4K2Q b - d3 0 1');
    expect(uciMoves(pos2)).toContain('e4d3');
  });
});

describe('promotion', () => {
  it('offers all four promotion pieces', () => {
    const pos = new Position('8/4P3/8/8/8/8/k7/4K3 w - - 0 1');
    const promos = uciMoves(pos).filter(m => m.startsWith('e7e8'));
    expect(promos.sort()).toEqual(['e7e8b', 'e7e8n', 'e7e8q', 'e7e8r']);
  });

  it('capture-promotion works and is notated correctly', () => {
    const g = new Game('3r3k/4P3/8/8/8/8/8/4K3 w - - 0 1');
    const san = g.playSAN('exd8=Q+');
    expect(san).toBe('exd8=Q+');
  });

  it('underpromotion to knight works and is not auto-queened', () => {
    const g = new Game('4k3/6P1/8/8/8/8/8/4K3 w - - 0 1');
    const san = g.playSAN('g8=N');
    expect(san).toBe('g8=N');
    expect(g.pos.toFen().split(' ')[0]).toBe('4k1N1/8/8/8/8/8/8/4K3');
  });
});

describe('check and mate', () => {
  it('scholars mate', () => {
    const g = new Game();
    for (const m of ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']) {
      expect(g.playSAN(m)).not.toBeNull();
    }
    expect(g.result?.kind).toBe('checkmate');
    expect(g.result?.winner).toBe(WHITE);
    expect(g.result?.score).toBe('1-0');
  });

  it('back rank mate', () => {
    const g = new Game('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1');
    expect(g.playSAN('Ra8#')).toBe('Ra8#');
    expect(g.result?.kind).toBe('checkmate');
  });

  it('only legal replies to check are block, capture, or king move', () => {
    // Qe7+ against bare king — king must move or interpose is impossible
    const pos = new Position('4k3/8/4Q3/8/8/8/8/4K3 b - - 0 1');
    // Wait: Qe6 gives check along the e-file; black king e8.
    const moves = uciMoves(pos);
    for (const m of moves) expect(m.startsWith('e8')).toBe(true);
  });
});
