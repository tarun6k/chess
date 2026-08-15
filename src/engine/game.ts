import { Position, START_FEN } from './position';
import { toSAN, fromSAN } from './san';
import {
  Move, Color, WHITE, BLACK, moveFrom, moveTo, moveFlags, movePromo,
  typeOf, colorOf, FLAG_EP, EMPTY, moveToUci,
} from './types';

/** Game lifecycle: setup → active → finished (result set) → review happens on top. */
export type GameStatus = 'active' | 'finished';

export type ResultKind =
  | 'checkmate' | 'stalemate' | 'resignation' | 'timeout' | 'timeout-draw'
  | 'agreement' | 'threefold' | 'fivefold' | 'fifty-move' | 'seventy-five-move'
  | 'insufficient' | 'dead-position' | 'aborted';

export interface GameResult {
  /** '1-0' | '0-1' | '1/2-1/2' | '*' */
  score: string;
  kind: ResultKind;
  winner: Color | null;
  message: string;
}

export interface HistoryEntry {
  move: Move;
  san: string;
  /** FEN after the move */
  fen: string;
  /** signed captured piece or 0 */
  captured: number;
  /** repetition key after the move */
  key: string;
  /** ms remaining on the mover's clock after the move (if clocks in use) */
  clockMs?: number;
  /** wall-clock time the mover spent on this move, ms */
  thinkMs?: number;
}

export class Game {
  pos: Position;
  history: HistoryEntry[] = [];
  startFen: string;
  result: GameResult | null = null;
  drawOffer: Color | null = null; // side that has an open draw offer
  private repetition = new Map<string, number>();

  constructor(fen: string = START_FEN) {
    this.startFen = fen;
    this.pos = new Position(fen);
    this.repetition.set(this.pos.hashKey(), 1);
    this.checkAutomaticEnd();
  }

  get status(): GameStatus { return this.result ? 'finished' : 'active'; }
  get turn(): Color { return this.pos.turn; }

  legalMoves(): Move[] {
    return this.result ? [] : this.pos.generateLegal();
  }

  inCheck(): boolean { return this.pos.inCheck(); }

  /** Number of times the current position has occurred. */
  repetitionCount(): number {
    return this.repetition.get(this.pos.hashKey()) ?? 1;
  }

  /** Can the side to move CLAIM a draw right now (threefold or 50-move)? */
  claimableDraw(): ResultKind | null {
    if (this.result) return null;
    if (this.repetitionCount() >= 3) return 'threefold';
    if (this.pos.halfmove >= 100) return 'fifty-move';
    return null;
  }

  /** Play a legal move. Returns the SAN, or null if illegal / game over. */
  play(move: Move, meta?: { clockMs?: number; thinkMs?: number }): string | null {
    if (this.result) return null;
    const legals = this.pos.generateLegal();
    if (!legals.includes(move)) return null;
    const san = toSAN(this.pos, move, legals);
    const captured = (moveFlags(move) & FLAG_EP)
      ? this.pos.board[moveTo(move) + (this.pos.turn === WHITE ? -8 : 8)]
      : this.pos.board[moveTo(move)];
    this.pos.makeMove(move);
    const key = this.pos.hashKey();
    this.repetition.set(key, (this.repetition.get(key) ?? 0) + 1);
    this.history.push({ move, san, fen: this.pos.toFen(), captured, key, ...meta });
    this.drawOffer = null; // making a move implicitly declines any pending offer
    this.checkAutomaticEnd();
    return san;
  }

  playSAN(san: string, meta?: { clockMs?: number; thinkMs?: number }): string | null {
    if (this.result) return null;
    const m = fromSAN(this.pos, san);
    return m === null ? null : this.play(m, meta);
  }

  /** Undo the last ply. Returns true if something was undone. */
  undo(): boolean {
    const entry = this.history.pop();
    if (!entry) return false;
    const count = this.repetition.get(entry.key) ?? 1;
    if (count <= 1) this.repetition.delete(entry.key); else this.repetition.set(entry.key, count - 1);
    this.pos.unmakeMove();
    this.result = null;
    this.drawOffer = null;
    return true;
  }

  resign(color: Color): void {
    if (this.result) return;
    const winner = (color ^ 1) as Color;
    this.setResult(winner === WHITE ? '1-0' : '0-1', 'resignation', winner,
      (winner === WHITE ? 'White' : 'Black') + ' wins by resignation');
  }

  /** Flag fall for `color`. Draw if the opponent cannot possibly mate (FIDE 6.9). */
  timeout(color: Color): void {
    if (this.result) return;
    const opp = (color ^ 1) as Color;
    if (this.pos.hasMatingPotential(opp)) {
      this.setResult(opp === WHITE ? '1-0' : '0-1', 'timeout', opp,
        (opp === WHITE ? 'White' : 'Black') + ' wins on time');
    } else {
      this.setResult('1/2-1/2', 'timeout-draw', null,
        'Draw — flag fell but ' + (opp === WHITE ? 'White' : 'Black') + ' cannot checkmate');
    }
  }

  offerDraw(color: Color): void {
    if (!this.result) this.drawOffer = color;
  }

  declineDraw(): void { this.drawOffer = null; }

  acceptDraw(): boolean {
    if (this.result || this.drawOffer === null) return false;
    this.drawOffer = null;
    this.setResult('1/2-1/2', 'agreement', null, 'Draw by agreement');
    return true;
  }

  /** Claim threefold / fifty-move draw (only when actually claimable). */
  claimDraw(): boolean {
    const kind = this.claimableDraw();
    if (!kind) return false;
    this.setResult('1/2-1/2', kind, null,
      kind === 'threefold' ? 'Draw by threefold repetition' : 'Draw by the fifty-move rule');
    return true;
  }

  private setResult(score: string, kind: ResultKind, winner: Color | null, message: string): void {
    this.result = { score, kind, winner, message };
  }

  private checkAutomaticEnd(): void {
    if (this.result) return;
    const pos = this.pos;
    if (!pos.hasLegalMoves()) {
      if (pos.inCheck()) {
        const winner = (pos.turn ^ 1) as Color;
        this.setResult(winner === WHITE ? '1-0' : '0-1', 'checkmate', winner,
          (winner === WHITE ? 'White' : 'Black') + ' wins by checkmate');
      } else {
        this.setResult('1/2-1/2', 'stalemate', null, 'Draw by stalemate');
      }
      return;
    }
    if ((this.repetition.get(pos.hashKey()) ?? 0) >= 5) {
      this.setResult('1/2-1/2', 'fivefold', null, 'Draw by fivefold repetition');
      return;
    }
    if (pos.halfmove >= 150) {
      this.setResult('1/2-1/2', 'seventy-five-move', null, 'Draw by the seventy-five-move rule');
      return;
    }
    if (pos.isInsufficientMaterial()) {
      this.setResult('1/2-1/2', 'insufficient', null, 'Draw — insufficient material');
      return;
    }
    if (pos.isDeadPosition()) {
      this.setResult('1/2-1/2', 'dead-position', null, 'Draw — dead position');
    }
  }

  /** Position after ply `n` (0 = start) as a fresh Position — for review/analysis. */
  positionAt(ply: number): Position {
    const p = new Position(this.startFen);
    for (let i = 0; i < ply && i < this.history.length; i++) p.makeMove(this.history[i].move);
    return p;
  }

  sanLine(): string[] { return this.history.map(h => h.san); }
  uciLine(): string[] { return this.history.map(h => moveToUci(h.move)); }

  capturedBy(color: Color): number[] {
    return this.history
      .filter(h => h.captured !== EMPTY && colorOf(h.captured) !== color)
      .map(h => typeOf(h.captured));
  }
}
