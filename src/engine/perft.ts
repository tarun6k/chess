import { Position } from './position';
import { Color } from './types';

/** Perft node count with legality via make/unmake. */
export function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  const moves = pos.generatePseudo();
  const us = pos.turn;
  const them = (us ^ 1) as Color;
  let nodes = 0;
  for (const m of moves) {
    pos.makeMove(m);
    if (!pos.attacked(pos.kingSq[us], them)) {
      nodes += depth === 1 ? 1 : perft(pos, depth - 1);
    }
    pos.unmakeMove();
  }
  return nodes;
}
