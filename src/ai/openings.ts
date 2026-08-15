// Compact opening book: named SAN lines. Used for
//  - recognizing/naming what the player opens with,
//  - AI book moves in the first plies,
//  - anti-style preparation (see adaptation.ts).

export interface OpeningLine {
  name: string;
  san: string[];
  /** character of the line, used by adaptation */
  tags: Array<'open' | 'closed' | 'sharp' | 'solid' | 'space'>;
}

export const BOOK: OpeningLine[] = [
  { name: 'Italian Game', san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3'], tags: ['open', 'solid'] },
  { name: 'Ruy Lopez', san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O'], tags: ['open', 'solid'] },
  { name: 'Scotch Game', san: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4'], tags: ['open', 'sharp'] },
  { name: 'King\'s Gambit', san: ['e4', 'e5', 'f4', 'exf4', 'Nf3'], tags: ['open', 'sharp'] },
  { name: 'Sicilian Defence', san: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3'], tags: ['open', 'sharp'] },
  { name: 'Sicilian, Closed', san: ['e4', 'c5', 'Nc3', 'Nc6', 'g3', 'g6', 'Bg2', 'Bg7', 'd3'], tags: ['closed', 'solid'] },
  { name: 'French Defence', san: ['e4', 'e6', 'd4', 'd5', 'e5', 'c5', 'c3', 'Nc6', 'Nf3'], tags: ['closed', 'solid'] },
  { name: 'Caro-Kann Defence', san: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5'], tags: ['closed', 'solid'] },
  { name: 'Scandinavian Defence', san: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5', 'd4'], tags: ['open', 'solid'] },
  { name: 'Pirc Defence', san: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'Nf3', 'Bg7'], tags: ['closed', 'solid'] },
  { name: 'Queen\'s Gambit Declined', san: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3'], tags: ['closed', 'solid'] },
  { name: 'Queen\'s Gambit Accepted', san: ['d4', 'd5', 'c4', 'dxc4', 'Nf3', 'Nf6', 'e3', 'e6', 'Bxc4'], tags: ['open', 'solid'] },
  { name: 'Slav Defence', san: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4', 'a4'], tags: ['closed', 'solid'] },
  { name: 'King\'s Indian Defence', san: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O'], tags: ['closed', 'sharp', 'space'] },
  { name: 'Nimzo-Indian Defence', san: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4', 'e3', 'O-O'], tags: ['closed', 'solid'] },
  { name: 'Grünfeld Defence', san: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5', 'cxd5', 'Nxd5', 'e4'], tags: ['open', 'sharp'] },
  { name: 'London System', san: ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4', 'e6', 'e3', 'Bd6', 'Bg3'], tags: ['closed', 'solid'] },
  { name: 'English Opening', san: ['c4', 'e5', 'Nc3', 'Nf6', 'g3', 'd5', 'cxd5', 'Nxd5', 'Bg2'], tags: ['closed', 'space'] },
  { name: 'Réti Opening', san: ['Nf3', 'd5', 'c4', 'e6', 'g3', 'Nf6', 'Bg2'], tags: ['closed', 'solid'] },
  { name: 'Vienna Game', san: ['e4', 'e5', 'Nc3', 'Nf6', 'f4', 'd5', 'fxe5', 'Nxe4'], tags: ['open', 'sharp'] },
  { name: 'Four Knights Game', san: ['e4', 'e5', 'Nf3', 'Nc6', 'Nc3', 'Nf6', 'Bb5', 'Bb4'], tags: ['open', 'solid'] },
  { name: 'Queen\'s Pawn Game', san: ['d4', 'd5', 'Nf3', 'Nf6', 'e3', 'e6', 'Bd3'], tags: ['closed', 'solid'] },
];

/** Longest named line matching the game's SAN prefix. */
export function identifyOpening(sans: string[]): { name: string; plies: number } | null {
  let best: { name: string; plies: number } | null = null;
  for (const line of BOOK) {
    let n = 0;
    while (n < line.san.length && n < sans.length && line.san[n] === sans[n]) n++;
    if (n >= 2 && (!best || n > best.plies)) best = { name: line.name, plies: n };
  }
  return best;
}

/**
 * Book continuations for the current SAN prefix, optionally filtered by tags.
 * Returns candidate next SAN moves.
 */
export function bookContinuations(sans: string[], preferTags?: string[]): string[] {
  const exact: string[] = [];
  const preferred: string[] = [];
  for (const line of BOOK) {
    if (line.san.length <= sans.length) continue;
    let match = true;
    for (let i = 0; i < sans.length; i++) {
      if (line.san[i] !== sans[i]) { match = false; break; }
    }
    if (!match) continue;
    const next = line.san[sans.length];
    exact.push(next);
    if (preferTags && preferTags.some(t => (line.tags as string[]).includes(t))) preferred.push(next);
  }
  return preferred.length ? preferred : exact;
}
