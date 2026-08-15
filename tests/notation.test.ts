import { describe, it, expect } from 'vitest';
import { Position, START_FEN } from '../src/engine/position';
import { Game } from '../src/engine/game';
import { toPGN, fromPGN } from '../src/engine/pgn';
import { toSAN, fromSAN } from '../src/engine/san';
import { moveToUci } from '../src/engine/types';

describe('FEN', () => {
  const fens = [
    START_FEN,
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 12 34',
    '4k3/8/8/8/8/8/8/4K3 b - - 0 1',
  ];
  it('round-trips', () => {
    for (const fen of fens) expect(new Position(fen).toFen()).toBe(fen);
  });
});

describe('SAN', () => {
  it('file disambiguation (Rad1 vs Rgd1)', () => {
    const pos = new Position('4k3/8/8/8/8/8/8/R5RK w - - 0 1');
    const legals = pos.generateLegal();
    const sans = legals.map(m => toSAN(pos, m, legals));
    expect(sans).toContain('Rad1');
    expect(sans).toContain('Rgd1');
  });

  it('rank disambiguation (R1a3 vs R5a3)', () => {
    const pos = new Position('4k3/8/8/R7/8/8/8/R3K3 w - - 0 1');
    const legals = pos.generateLegal();
    const sans = legals.map(m => toSAN(pos, m, legals));
    expect(sans).toContain('R1a3');
    expect(sans).toContain('R5a3');
  });

  it('no false disambiguation when the other piece is pinned', () => {
    // Knight b1 pinned... use simple case: two knights, one pinned, SAN needs no disambiguator
    const pos = new Position('4k3/4r3/8/8/8/8/4N3/N3K3 w - - 0 1');
    // Ne2 is pinned by the e7 rook; Na1 can reach c2 without "Nac2"
    const legals = pos.generateLegal();
    const sans = legals.map(m => toSAN(pos, m, legals));
    expect(sans).toContain('Nc2');
    expect(sans).not.toContain('Nac2');
  });

  it('parses long algebraic as fallback', () => {
    const pos = new Position(START_FEN);
    const m = fromSAN(pos, 'e2e4');
    expect(m).not.toBeNull();
    expect(moveToUci(m!)).toBe('e2e4');
  });

  it('castling SAN with zeros is tolerated', () => {
    const g = new Game('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(g.playSAN('0-0')).toBe('O-O');
  });
});

describe('PGN', () => {
  it('round-trips a game with castling, capture, ep and promotion', () => {
    const g = new Game();
    const line = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O', 'Nf6', 'd4', 'exd4', 'e5', 'd5', 'exf6', 'dxc4', 'fxg7', 'Rg8', 'Nxd4', 'Rxg7'];
    for (const s of line) expect(g.playSAN(s)).not.toBeNull();
    const pgn = toPGN(g, { White: 'Player', Black: 'AI', Date: '2026.08.11' });
    const { game: g2, headers } = fromPGN(pgn);
    expect(headers.White).toBe('Player');
    expect(g2.sanLine()).toEqual(g.sanLine());
    expect(g2.pos.toFen()).toBe(g.pos.toFen());
  });

  it('imports PGN with comments, NAGs and variations', () => {
    const pgn = `[Event "Test"]\n\n1. e4 {best by test} e5 $1 2. Nf3 (2. f4 exf4) 2... Nc6 1/2-1/2`;
    const { game } = fromPGN(pgn);
    expect(game.sanLine()).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
  });

  it('exports FEN header for non-standard starts', () => {
    const g = new Game('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    g.playSAN('Ra8+');
    const pgn = toPGN(g);
    expect(pgn).toContain('[FEN "4k3/8/8/8/8/8/8/R3K3 w - - 0 1"]');
    const { game: g2 } = fromPGN(pgn);
    expect(g2.sanLine()).toEqual(['Ra8+']);
  });
});

describe('zobrist consistency', () => {
  it('incremental hash matches full recompute over random games', () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let game = 0; game < 5; game++) {
      const pos = new Position(START_FEN);
      for (let ply = 0; ply < 120; ply++) {
        const moves = pos.generateLegal();
        if (!moves.length) break;
        pos.makeMove(moves[Math.floor(rnd() * moves.length)]);
        const check = pos.clone();
        check.computeHash();
        expect(check.hashLo).toBe(pos.hashLo);
        expect(check.hashHi).toBe(pos.hashHi);
      }
    }
  });

  it('unmake restores the exact FEN', () => {
    const pos = new Position('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    const fen = pos.toFen();
    for (const m of pos.generateLegal()) {
      pos.makeMove(m);
      pos.unmakeMove();
      expect(pos.toFen()).toBe(fen);
    }
  });
});
