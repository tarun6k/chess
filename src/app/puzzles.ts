// Curated challenges. Every puzzle here was verified with the app's own
// search engine (see tests/puzzles.test.ts): mate-in-N puzzles have a forced
// mate in exactly N, tactics have a clear best move.

export type PuzzleKind = 'mate1' | 'mate2' | 'mate3' | 'tactic' | 'defense';

export interface Puzzle {
  id: string;
  kind: PuzzleKind;
  /** 1 = easy … 3 = hard */
  tier: 1 | 2 | 3;
  title: string;
  fen: string;
  /** engine-best first move, used for hints and "solution" display */
  solution: string;
  prompt: string;
  xp: number;
}

export const PUZZLES: Puzzle[] = [
  { id: 'm1-backrank', kind: 'mate1', tier: 1, title: 'Back-rank strike', fen: '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1', solution: 'a1a8', prompt: 'White mates in one.', xp: 10 },
  { id: 'm1-corner', kind: 'mate1', tier: 1, title: 'Cornered king', fen: 'k7/8/1K6/8/8/8/8/7R w - - 0 1', solution: 'h1h8', prompt: 'White mates in one.', xp: 10 },
  { id: 'm1-longdiag', kind: 'mate1', tier: 1, title: 'The long reach', fen: '7k/6pp/8/8/8/8/8/Q6K w - - 0 1', solution: 'a1a8', prompt: 'White mates in one.', xp: 10 },
  { id: 'm1-seventh', kind: 'mate1', tier: 1, title: 'Rooks on rampage', fen: '7k/R7/1R6/8/8/8/8/4K3 w - - 0 1', solution: 'b6b8', prompt: 'White mates in one.', xp: 10 },
  { id: 'm1-deflect', kind: 'mate1', tier: 2, title: 'Take with tempo', fen: '3r2k1/5ppp/8/8/8/8/5PPP/3QR1K1 w - - 0 1', solution: 'd1d8', prompt: 'White mates in one.', xp: 15 },
  { id: 'm2-ladder', kind: 'mate2', tier: 2, title: 'Ladder finish', fen: '7k/8/8/8/8/8/1R6/R3K3 w - - 0 1', solution: 'a1a7', prompt: 'White mates in two.', xp: 20 },
  { id: 'm2-boxin', kind: 'mate2', tier: 2, title: 'Boxed in', fen: '6k1/8/5K2/8/8/8/8/1Q6 w - - 0 1', solution: 'b1g6', prompt: 'White mates in two.', xp: 20 },
  { id: 'm2-qr', kind: 'mate2', tier: 2, title: 'Heavy pieces', fen: '3k4/8/8/8/8/8/Q6R/4K3 w - - 0 1', solution: 'a2f7', prompt: 'White mates in two.', xp: 20 },
  { id: 'm3-squeeze', kind: 'mate3', tier: 3, title: 'The slow squeeze', fen: '6k1/8/8/5K2/8/8/8/1Q6 w - - 0 1', solution: 'b1b7', prompt: 'White mates in three.', xp: 35 },
  { id: 't-freequeen', kind: 'tactic', tier: 1, title: 'Loose piece', fen: '1q5k/8/8/8/8/8/8/KR6 w - - 0 1', solution: 'b1b8', prompt: 'White wins material.', xp: 10 },
  { id: 't-snipe', kind: 'tactic', tier: 1, title: 'Long diagonal snipe', fen: 'r3k3/8/8/8/8/8/5PB1/4K3 w - - 0 1', solution: 'g2a8', prompt: 'White wins material.', xp: 10 },
  { id: 't-fork', kind: 'tactic', tier: 2, title: 'Family fork', fen: 'q3k3/8/8/3N4/8/8/6P1/4K3 w - - 0 1', solution: 'd5c7', prompt: 'White wins the queen.', xp: 20 },
  { id: 't-pin', kind: 'tactic', tier: 2, title: 'Pile on the pin', fen: '4k3/4r3/8/8/8/8/4R3/4K1B1 w - - 0 1', solution: 'g1e3', prompt: 'Exploit the pin to win material.', xp: 20 },
  { id: 't-promo', kind: 'tactic', tier: 2, title: 'Touchdown', fen: '4k3/P7/8/8/8/8/6p1/4K3 w - - 0 1', solution: 'a7a8q', prompt: 'Find the strongest continuation.', xp: 15 },
  { id: 'd-qsave', kind: 'defense', tier: 2, title: 'Save the queen', fen: 'rnb1kbnr/pppp1ppp/8/4p3/4P1q1/5P2/PPPP2PP/RNBQKBNR b KQkq - 0 3', solution: 'g4h4', prompt: 'Black to move — rescue the attacked queen.', xp: 15 },
];

export interface Drill {
  id: string;
  title: string;
  fen: string;
  /** side the player takes */
  playerColor: 'w' | 'b';
  goal: 'win' | 'draw';
  description: string;
  xp: number;
}

export const DRILLS: Drill[] = [
  {
    id: 'kp-vs-k', title: 'King & pawn vs king',
    fen: '8/8/8/4k3/8/8/4P3/4K3 w - - 0 1', playerColor: 'w', goal: 'win',
    description: 'Escort the pawn home. Use the opposition — king in front of the pawn.', xp: 30,
  },
  {
    id: 'opposition', title: 'The opposition',
    fen: '8/8/8/3k4/8/3K4/3P4/8 w - - 0 1', playerColor: 'w', goal: 'win',
    description: 'Win the pawn ending by taking the opposition at the right moment.', xp: 30,
  },
  {
    id: 'lucena', title: 'Rook ending: build the bridge',
    fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1', playerColor: 'w', goal: 'win',
    description: 'The Lucena position. Shelter your king from checks and promote.', xp: 45,
  },
  {
    id: 'defend-kp', title: 'Hold the draw',
    fen: '4k3/8/8/4P3/4K3/8/8/8 b - - 0 1', playerColor: 'b', goal: 'draw',
    description: 'Defend king vs king-and-pawn. Stay in front and keep the opposition.', xp: 30,
  },
];

export type ConstraintKind = 'silent-queen' | 'knight-mate' | 'rook-odds';

export interface ConstraintGame {
  id: string;
  kind: ConstraintKind;
  title: string;
  description: string;
  /** start position (standard unless odds) */
  fen?: string;
  xp: number;
}

export const CONSTRAINTS: ConstraintGame[] = [
  {
    id: 'c-silent-queen', kind: 'silent-queen', title: 'The silent queen',
    description: 'Beat the AI without ever moving your queen.', xp: 60,
  },
  {
    id: 'c-knight-mate', kind: 'knight-mate', title: 'Knight\'s honor',
    description: 'Beat the AI — the mating move must be made by a knight.', xp: 80,
  },
  {
    id: 'c-rook-odds', kind: 'rook-odds', title: 'Down a rook',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/1NBQKBNR w Kkq - 0 1',
    description: 'You start without your queenside rook. Survive 20 moves without being checkmated.', xp: 50,
  },
];
