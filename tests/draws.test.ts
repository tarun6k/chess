import { describe, it, expect } from 'vitest';
import { Game } from '../src/engine/game';
import { Position } from '../src/engine/position';
import { WHITE, BLACK } from '../src/engine/types';

describe('stalemate', () => {
  it('is detected and drawn', () => {
    const g = new Game('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(g.result?.kind).toBe('stalemate');
    expect(g.result?.score).toBe('1/2-1/2');
  });

  it('reached by a move', () => {
    const g = new Game('7k/5K2/8/6Q1/8/8/8/8 w - - 0 1');
    g.playSAN('Qg6'); // not check; black king h8 has no moves
    expect(g.result?.kind).toBe('stalemate');
  });
});

describe('repetition', () => {
  function shuffle(g: Game, times: number) {
    for (let i = 0; i < times; i++) {
      g.playSAN('Nf3'); g.playSAN('Nf6'); g.playSAN('Ng1'); g.playSAN('Ng8');
    }
  }

  it('threefold is claimable at 3 occurrences (not auto)', () => {
    const g = new Game();
    shuffle(g, 2); // start position now seen 3 times
    expect(g.result).toBeNull();
    expect(g.repetitionCount()).toBe(3);
    expect(g.claimableDraw()).toBe('threefold');
    expect(g.claimDraw()).toBe(true);
    expect(g.result?.kind).toBe('threefold');
  });

  it('fivefold is an automatic draw', () => {
    const g = new Game();
    shuffle(g, 4); // 5th occurrence of the start position
    expect(g.result?.kind).toBe('fivefold');
  });

  it('positions with different castling rights are not repetitions', () => {
    const g = new Game('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    // King shuffles kill castling rights, so "same-looking" positions differ.
    g.playSAN('Ke2'); g.playSAN('Ke7'); g.playSAN('Ke1'); g.playSAN('Ke8');
    expect(g.repetitionCount()).toBe(1);
  });
});

describe('fifty and seventy-five move rules', () => {
  it('fifty-move draw is claimable at halfmove 100', () => {
    const g = new Game('4k3/8/8/8/8/8/8/R3K3 w - - 99 80');
    expect(g.claimableDraw()).toBeNull();
    g.playSAN('Ra2');
    expect(g.claimableDraw()).toBe('fifty-move');
    expect(g.claimDraw()).toBe(true);
    expect(g.result?.kind).toBe('fifty-move');
  });

  it('seventy-five-move rule is automatic', () => {
    const g = new Game('4k3/8/8/8/8/8/8/R3K3 w - - 149 100');
    g.playSAN('Ra2');
    expect(g.result?.kind).toBe('seventy-five-move');
  });

  it('pawn move resets the clock', () => {
    const g = new Game('4k3/8/8/8/8/8/4P3/R3K3 w - - 99 80');
    g.playSAN('e3');
    expect(g.pos.halfmove).toBe(0);
    expect(g.claimableDraw()).toBeNull();
  });
});

describe('insufficient material', () => {
  const cases: Array<[string, string, boolean]> = [
    ['K vs K', '4k3/8/8/8/8/8/8/4K3 w - - 0 1', true],
    ['K+B vs K', '4k3/8/8/8/8/8/8/2B1K3 w - - 0 1', true],
    ['K+N vs K', '4k3/8/8/8/8/8/8/1N2K3 w - - 0 1', true],
    ['K+B vs K+B same color (both dark)', '4kb2/8/8/8/8/8/8/2B1K3 w - - 0 1', true],
    ['K+B vs K+B opposite colors', '4k1b1/8/8/8/8/8/8/2B1K3 w - - 0 1', false],
    ['K+N vs K+N', '4kn2/8/8/8/8/8/8/1N2K3 w - - 0 1', false],
    ['K+R vs K', '4k3/8/8/8/8/8/8/R3K3 w - - 0 1', false],
    ['K+P vs K', '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', false],
    ['K+NN vs K', '4k3/8/8/8/8/8/8/NN2K3 w - - 0 1', false],
  ];
  for (const [name, fen, drawn] of cases) {
    it(name + (drawn ? ' is a draw' : ' is not an automatic draw'), () => {
      const g = new Game(fen);
      if (drawn) expect(g.result?.kind).toBe('insufficient');
      else expect(g.result).toBeNull();
    });
  }

  it('capture into K+B vs K ends the game immediately', () => {
    const g = new Game('4k3/8/8/3r4/8/8/B7/4K3 w - - 0 1');
    expect(g.playSAN('Bxd5')).toBe('Bxd5');
    expect(g.result?.kind).toBe('insufficient');
  });
});

describe('dead position', () => {
  it('K+N vs K has no mating potential for either side', () => {
    const pos = new Position('4k3/8/8/8/8/8/8/1N2K3 w - - 0 1');
    expect(pos.isDeadPosition()).toBe(true);
  });
  it('K+N vs K+N is not dead (helpmates exist)', () => {
    const pos = new Position('4kn2/8/8/8/8/8/8/1N2K3 w - - 0 1');
    expect(pos.isDeadPosition()).toBe(false);
  });
});

describe('agreement, resignation, timeout', () => {
  it('draw offer / accept flow', () => {
    const g = new Game();
    g.playSAN('e4');
    g.offerDraw(WHITE);
    expect(g.drawOffer).toBe(WHITE);
    expect(g.acceptDraw()).toBe(true);
    expect(g.result?.kind).toBe('agreement');
  });

  it('making a move implicitly declines a pending offer', () => {
    const g = new Game();
    g.offerDraw(WHITE);
    g.playSAN('e4');
    expect(g.drawOffer).toBeNull();
    expect(g.result).toBeNull();
  });

  it('resignation ends the game', () => {
    const g = new Game();
    g.resign(WHITE);
    expect(g.result?.kind).toBe('resignation');
    expect(g.result?.winner).toBe(BLACK);
    expect(g.result?.score).toBe('0-1');
  });

  it('timeout: opponent with mating material wins', () => {
    const g = new Game('4k3/8/8/8/8/8/8/Q3K3 b - - 0 1');
    g.timeout(BLACK);
    expect(g.result?.kind).toBe('timeout');
    expect(g.result?.winner).toBe(WHITE);
  });

  it('timeout vs bare king is a draw', () => {
    const g = new Game('4k3/8/8/8/8/8/4P3/4K3 b - - 0 1');
    // Black (pawnless... black IS bare) flags White? White flags:
    g.timeout(WHITE);
    // Black has only a king → cannot mate → draw
    expect(g.result?.kind).toBe('timeout-draw');
    expect(g.result?.score).toBe('1/2-1/2');
  });

  it('timeout vs K+N when a helpmate exists is a loss (FIDE 6.9)', () => {
    // Black flags; White has K+N+P — mate is constructible, so White wins.
    const b = new Game('4k3/8/8/8/8/8/4P3/1N2K3 b - - 0 1');
    b.timeout(BLACK);
    expect(b.result?.kind).toBe('timeout');
    expect(b.result?.winner).toBe(WHITE);

    // K+N vs K+N: flag fall → opponent CAN helpmate → win on time, not a draw.
    const c = new Game('4kn2/8/8/8/8/8/8/1N2K3 b - - 0 1');
    c.timeout(BLACK);
    expect(c.result?.kind).toBe('timeout');
    expect(c.result?.winner).toBe(WHITE);
  });
});
