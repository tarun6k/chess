import {
  WHITE, BLACK, Color, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, EMPTY,
  colorOf, typeOf, makePiece, fileOf, rankOf, square, sqName, parseSquare,
  CASTLE_WK, CASTLE_WQ, CASTLE_BK, CASTLE_BQ,
  FLAG_EP, FLAG_DOUBLE, FLAG_CASTLE_K, FLAG_CASTLE_Q,
  Move, makeMove, moveFrom, moveTo, moveFlags, movePromo, PIECE_CHARS,
  KNIGHT_DELTAS, KING_DELTAS, BISHOP_DIRS, ROOK_DIRS,
} from './types';
import {
  ZOBRIST_PIECES_LO, ZOBRIST_PIECES_HI, ZOBRIST_CASTLE_LO, ZOBRIST_CASTLE_HI,
  ZOBRIST_EP_LO, ZOBRIST_EP_HI, ZOBRIST_SIDE_LO, ZOBRIST_SIDE_HI, pieceZobristIndex,
} from './zobrist';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Which castling rights survive a piece moving from/to each square.
const CASTLE_MASK = new Uint8Array(64).fill(15);
CASTLE_MASK[0] = 15 & ~CASTLE_WQ;  // a1
CASTLE_MASK[7] = 15 & ~CASTLE_WK;  // h1
CASTLE_MASK[4] = 15 & ~(CASTLE_WK | CASTLE_WQ); // e1
CASTLE_MASK[56] = 15 & ~CASTLE_BQ; // a8
CASTLE_MASK[63] = 15 & ~CASTLE_BK; // h8
CASTLE_MASK[60] = 15 & ~(CASTLE_BK | CASTLE_BQ); // e8

interface Undo {
  move: Move;
  captured: number;      // signed piece (the EP-captured pawn for EP moves)
  castling: number;
  ep: number;
  halfmove: number;
  hashLo: number;
  hashHi: number;
}

export class Position {
  board = new Int8Array(64);
  turn: Color = WHITE;
  castling = 0;          // CASTLE_* bitmask
  ep = -1;               // en-passant target square (the skipped square), or -1
  halfmove = 0;          // plies since last pawn move or capture (for 50/75-move rules)
  fullmove = 1;
  kingSq: [number, number] = [4, 60];
  hashLo = 0;
  hashHi = 0;
  private undoStack: Undo[] = [];

  constructor(fen: string = START_FEN) {
    this.loadFen(fen);
  }

  loadFen(fen: string): void {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 4) throw new Error('Invalid FEN: ' + fen);
    this.board.fill(EMPTY);
    this.undoStack.length = 0;
    let sq = 56; // FEN starts at a8
    for (const ch of parts[0]) {
      if (ch === '/') { sq -= 16; continue; }
      if (ch >= '1' && ch <= '8') { sq += ch.charCodeAt(0) - 48; continue; }
      const type = PIECE_CHARS.indexOf(ch.toUpperCase());
      if (type <= 0) throw new Error('Invalid FEN piece: ' + ch);
      const color: Color = ch === ch.toUpperCase() ? WHITE : BLACK;
      this.board[sq] = makePiece(type, color);
      if (type === KING) this.kingSq[color] = sq;
      sq++;
    }
    this.turn = parts[1] === 'w' ? WHITE : BLACK;
    this.castling = 0;
    if (parts[2].includes('K')) this.castling |= CASTLE_WK;
    if (parts[2].includes('Q')) this.castling |= CASTLE_WQ;
    if (parts[2].includes('k')) this.castling |= CASTLE_BK;
    if (parts[2].includes('q')) this.castling |= CASTLE_BQ;
    this.ep = parts[3] === '-' ? -1 : parseSquare(parts[3]);
    this.halfmove = parts.length > 4 ? parseInt(parts[4], 10) || 0 : 0;
    this.fullmove = parts.length > 5 ? parseInt(parts[5], 10) || 1 : 1;
    this.computeHash();
  }

  toFen(): string {
    let out = '';
    for (let rank = 7; rank >= 0; rank--) {
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const p = this.board[square(file, rank)];
        if (p === EMPTY) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        const ch = PIECE_CHARS[typeOf(p)];
        out += p > 0 ? ch : ch.toLowerCase();
      }
      if (empty) out += empty;
      if (rank) out += '/';
    }
    let castle = '';
    if (this.castling & CASTLE_WK) castle += 'K';
    if (this.castling & CASTLE_WQ) castle += 'Q';
    if (this.castling & CASTLE_BK) castle += 'k';
    if (this.castling & CASTLE_BQ) castle += 'q';
    return [
      out,
      this.turn === WHITE ? 'w' : 'b',
      castle || '-',
      this.ep >= 0 ? sqName(this.ep) : '-',
      this.halfmove,
      this.fullmove,
    ].join(' ');
  }

  computeHash(): void {
    let lo = 0, hi = 0;
    for (let sq = 0; sq < 64; sq++) {
      const p = this.board[sq];
      if (p === EMPTY) continue;
      const idx = pieceZobristIndex(typeOf(p), colorOf(p), sq);
      lo ^= ZOBRIST_PIECES_LO[idx];
      hi ^= ZOBRIST_PIECES_HI[idx];
    }
    lo ^= ZOBRIST_CASTLE_LO[this.castling];
    hi ^= ZOBRIST_CASTLE_HI[this.castling];
    if (this.ep >= 0) { lo ^= ZOBRIST_EP_LO[fileOf(this.ep)]; hi ^= ZOBRIST_EP_HI[fileOf(this.ep)]; }
    if (this.turn === BLACK) { lo ^= ZOBRIST_SIDE_LO; hi ^= ZOBRIST_SIDE_HI; }
    this.hashLo = lo >>> 0;
    this.hashHi = hi >>> 0;
  }

  /** Repetition key: position identity per FIDE (placement + turn + castling + ep rights). */
  hashKey(): string {
    return this.hashLo.toString(36) + '.' + this.hashHi.toString(36);
  }

  /** Is `sq` attacked by any piece of color `by`? */
  attacked(sq: number, by: Color): boolean {
    const b = this.board;
    const file = fileOf(sq);
    // Pawns: a white pawn on sq-7/sq-9 attacks sq (and mirrored for black).
    if (by === WHITE) {
      if (file > 0 && sq >= 9 && b[sq - 9] === PAWN) return true;
      if (file < 7 && sq >= 7 && b[sq - 7] === PAWN) return true;
    } else {
      if (file > 0 && sq <= 56 && b[sq + 7] === -PAWN) return true;
      if (file < 7 && sq <= 54 && b[sq + 9] === -PAWN) return true;
    }
    // Knights
    const knight = makePiece(KNIGHT, by);
    for (const [d, fd] of KNIGHT_DELTAS) {
      const t = sq + d;
      if (t < 0 || t > 63) continue;
      if (fileOf(t) - file !== fd) continue;
      if (b[t] === knight) return true;
    }
    // King
    const king = makePiece(KING, by);
    for (const [d, fd] of KING_DELTAS) {
      const t = sq + d;
      if (t < 0 || t > 63) continue;
      if (fileOf(t) - file !== fd) continue;
      if (b[t] === king) return true;
    }
    // Sliders
    const bishop = makePiece(BISHOP, by), rook = makePiece(ROOK, by), queen = makePiece(QUEEN, by);
    for (const [d, fd] of BISHOP_DIRS) {
      let t = sq, prevFile = file;
      for (;;) {
        t += d;
        if (t < 0 || t > 63) break;
        const f = fileOf(t);
        if (f - prevFile !== fd) break;
        prevFile = f;
        const p = b[t];
        if (p !== EMPTY) { if (p === bishop || p === queen) return true; break; }
      }
    }
    for (const [d, fd] of ROOK_DIRS) {
      let t = sq, prevFile = file;
      for (;;) {
        t += d;
        if (t < 0 || t > 63) break;
        const f = fileOf(t);
        if (f - prevFile !== fd) break;
        prevFile = f;
        const p = b[t];
        if (p !== EMPTY) { if (p === rook || p === queen) return true; break; }
      }
    }
    return false;
  }

  inCheck(color: Color = this.turn): boolean {
    return this.attacked(this.kingSq[color], (color ^ 1) as Color);
  }

  /** Pseudo-legal moves for the side to move (castling pre-validated for attacks). */
  generatePseudo(out: Move[] = []): Move[] {
    const b = this.board;
    const us = this.turn;
    const them = (us ^ 1) as Color;
    const forward = us === WHITE ? 8 : -8;
    const startRank = us === WHITE ? 1 : 6;
    const promoRank = us === WHITE ? 7 : 0;

    for (let from = 0; from < 64; from++) {
      const p = b[from];
      if (p === EMPTY || colorOf(p) !== us) continue;
      const type = typeOf(p);
      const file = fileOf(from);

      if (type === PAWN) {
        const one = from + forward;
        if (one >= 0 && one <= 63 && b[one] === EMPTY) {
          if (rankOf(one) === promoRank) {
            out.push(makeMove(from, one, 0, QUEEN), makeMove(from, one, 0, ROOK),
                     makeMove(from, one, 0, BISHOP), makeMove(from, one, 0, KNIGHT));
          } else {
            out.push(makeMove(from, one));
            if (rankOf(from) === startRank) {
              const two = from + 2 * forward;
              if (b[two] === EMPTY) out.push(makeMove(from, two, FLAG_DOUBLE));
            }
          }
        }
        for (const df of [-1, 1]) {
          if (file + df < 0 || file + df > 7) continue;
          const to = from + forward + df;
          if (to < 0 || to > 63) continue;
          const target = b[to];
          if (target !== EMPTY && colorOf(target) === them) {
            if (rankOf(to) === promoRank) {
              out.push(makeMove(from, to, 0, QUEEN), makeMove(from, to, 0, ROOK),
                       makeMove(from, to, 0, BISHOP), makeMove(from, to, 0, KNIGHT));
            } else {
              out.push(makeMove(from, to));
            }
          } else if (to === this.ep) {
            out.push(makeMove(from, to, FLAG_EP));
          }
        }
      } else if (type === KNIGHT) {
        for (const [d, fd] of KNIGHT_DELTAS) {
          const to = from + d;
          if (to < 0 || to > 63) continue;
          if (fileOf(to) - file !== fd) continue;
          const target = b[to];
          if (target === EMPTY || colorOf(target) === them) out.push(makeMove(from, to));
        }
      } else if (type === KING) {
        for (const [d, fd] of KING_DELTAS) {
          const to = from + d;
          if (to < 0 || to > 63) continue;
          if (fileOf(to) - file !== fd) continue;
          const target = b[to];
          if (target === EMPTY || colorOf(target) === them) out.push(makeMove(from, to));
        }
        // Castling: rights valid, path empty, king not in/through check.
        if (us === WHITE && from === 4) {
          if ((this.castling & CASTLE_WK) && b[5] === EMPTY && b[6] === EMPTY && b[7] === ROOK &&
              !this.attacked(4, them) && !this.attacked(5, them) && !this.attacked(6, them)) {
            out.push(makeMove(4, 6, FLAG_CASTLE_K));
          }
          if ((this.castling & CASTLE_WQ) && b[3] === EMPTY && b[2] === EMPTY && b[1] === EMPTY && b[0] === ROOK &&
              !this.attacked(4, them) && !this.attacked(3, them) && !this.attacked(2, them)) {
            out.push(makeMove(4, 2, FLAG_CASTLE_Q));
          }
        } else if (us === BLACK && from === 60) {
          if ((this.castling & CASTLE_BK) && b[61] === EMPTY && b[62] === EMPTY && b[63] === -ROOK &&
              !this.attacked(60, them) && !this.attacked(61, them) && !this.attacked(62, them)) {
            out.push(makeMove(60, 62, FLAG_CASTLE_K));
          }
          if ((this.castling & CASTLE_BQ) && b[59] === EMPTY && b[58] === EMPTY && b[57] === EMPTY && b[56] === -ROOK &&
              !this.attacked(60, them) && !this.attacked(59, them) && !this.attacked(58, them)) {
            out.push(makeMove(60, 2 + 56, FLAG_CASTLE_Q));
          }
        }
      } else {
        const dirs = type === BISHOP ? BISHOP_DIRS : type === ROOK ? ROOK_DIRS : null;
        const dirSets = dirs ? [dirs] : [BISHOP_DIRS, ROOK_DIRS];
        for (const set of dirSets) {
          for (const [d, fd] of set) {
            let to = from, prevFile = file;
            for (;;) {
              to += d;
              if (to < 0 || to > 63) break;
              const f = fileOf(to);
              if (f - prevFile !== fd) break;
              prevFile = f;
              const target = b[to];
              if (target === EMPTY) { out.push(makeMove(from, to)); continue; }
              if (colorOf(target) === them) out.push(makeMove(from, to));
              break;
            }
          }
        }
      }
    }
    return out;
  }

  /** Fully legal moves for the side to move. */
  generateLegal(): Move[] {
    const pseudo = this.generatePseudo();
    const legal: Move[] = [];
    const us = this.turn;
    const them = (us ^ 1) as Color;
    for (const m of pseudo) {
      this.makeMove(m);
      if (!this.attacked(this.kingSq[us], them)) legal.push(m);
      this.unmakeMove();
    }
    return legal;
  }

  /** Legal moves originating from one square (for UI highlighting). */
  legalMovesFrom(from: number): Move[] {
    return this.generateLegal().filter(m => moveFrom(m) === from);
  }

  hasLegalMoves(): boolean {
    const pseudo = this.generatePseudo();
    const us = this.turn;
    const them = (us ^ 1) as Color;
    for (const m of pseudo) {
      this.makeMove(m);
      const ok = !this.attacked(this.kingSq[us], them);
      this.unmakeMove();
      if (ok) return true;
    }
    return false;
  }

  makeMove(m: Move): void {
    const b = this.board;
    const from = moveFrom(m), to = moveTo(m), flags = moveFlags(m), promo = movePromo(m);
    const piece = b[from];
    const us = this.turn;
    const them = (us ^ 1) as Color;
    const type = typeOf(piece);

    let captured = b[to];
    let capturedSq = to;
    if (flags & FLAG_EP) {
      capturedSq = to + (us === WHITE ? -8 : 8);
      captured = b[capturedSq];
    }

    this.undoStack.push({
      move: m, captured, castling: this.castling, ep: this.ep,
      halfmove: this.halfmove, hashLo: this.hashLo, hashHi: this.hashHi,
    });

    let lo = this.hashLo, hi = this.hashHi;

    // Remove captured piece
    if (captured !== EMPTY) {
      const ci = pieceZobristIndex(typeOf(captured), them, capturedSq);
      lo ^= ZOBRIST_PIECES_LO[ci]; hi ^= ZOBRIST_PIECES_HI[ci];
      b[capturedSq] = EMPTY;
    }

    // Move the piece (with promotion)
    const fromIdx = pieceZobristIndex(type, us, from);
    lo ^= ZOBRIST_PIECES_LO[fromIdx]; hi ^= ZOBRIST_PIECES_HI[fromIdx];
    const newType = promo || type;
    const toIdx = pieceZobristIndex(newType, us, to);
    lo ^= ZOBRIST_PIECES_LO[toIdx]; hi ^= ZOBRIST_PIECES_HI[toIdx];
    b[from] = EMPTY;
    b[to] = makePiece(newType, us);

    // Castling rook hop
    if (flags & FLAG_CASTLE_K) {
      const rFrom = us === WHITE ? 7 : 63, rTo = us === WHITE ? 5 : 61;
      const a = pieceZobristIndex(ROOK, us, rFrom), c = pieceZobristIndex(ROOK, us, rTo);
      lo ^= ZOBRIST_PIECES_LO[a] ^ ZOBRIST_PIECES_LO[c];
      hi ^= ZOBRIST_PIECES_HI[a] ^ ZOBRIST_PIECES_HI[c];
      b[rTo] = b[rFrom]; b[rFrom] = EMPTY;
    } else if (flags & FLAG_CASTLE_Q) {
      const rFrom = us === WHITE ? 0 : 56, rTo = us === WHITE ? 3 : 59;
      const a = pieceZobristIndex(ROOK, us, rFrom), c = pieceZobristIndex(ROOK, us, rTo);
      lo ^= ZOBRIST_PIECES_LO[a] ^ ZOBRIST_PIECES_LO[c];
      hi ^= ZOBRIST_PIECES_HI[a] ^ ZOBRIST_PIECES_HI[c];
      b[rTo] = b[rFrom]; b[rFrom] = EMPTY;
    }

    if (type === KING) this.kingSq[us] = to;

    // Castling rights
    lo ^= ZOBRIST_CASTLE_LO[this.castling]; hi ^= ZOBRIST_CASTLE_HI[this.castling];
    this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
    lo ^= ZOBRIST_CASTLE_LO[this.castling]; hi ^= ZOBRIST_CASTLE_HI[this.castling];

    // En passant target — only recorded when an enemy pawn stands ready to
    // capture, so repetition hashing matches FIDE position identity.
    if (this.ep >= 0) { lo ^= ZOBRIST_EP_LO[fileOf(this.ep)]; hi ^= ZOBRIST_EP_HI[fileOf(this.ep)]; }
    this.ep = -1;
    if (flags & FLAG_DOUBLE) {
      const enemyPawn = us === WHITE ? -PAWN : PAWN;
      const f = fileOf(to);
      if ((f > 0 && b[to - 1] === enemyPawn) || (f < 7 && b[to + 1] === enemyPawn)) {
        this.ep = (from + to) / 2;
      }
    }
    if (this.ep >= 0) { lo ^= ZOBRIST_EP_LO[fileOf(this.ep)]; hi ^= ZOBRIST_EP_HI[fileOf(this.ep)]; }

    // Clocks
    this.halfmove = (type === PAWN || captured !== EMPTY) ? 0 : this.halfmove + 1;
    if (us === BLACK) this.fullmove++;

    // Side to move
    this.turn = them;
    lo ^= ZOBRIST_SIDE_LO; hi ^= ZOBRIST_SIDE_HI;

    this.hashLo = lo >>> 0;
    this.hashHi = hi >>> 0;
  }

  unmakeMove(): void {
    const undo = this.undoStack.pop();
    if (!undo) throw new Error('unmakeMove with empty stack');
    const b = this.board;
    const m = undo.move;
    const from = moveFrom(m), to = moveTo(m), flags = moveFlags(m), promo = movePromo(m);
    const us = (this.turn ^ 1) as Color; // side that made the move

    // Un-move piece (undo promotion)
    const piece = b[to];
    b[from] = promo ? makePiece(PAWN, us) : piece;
    b[to] = EMPTY;

    // Restore captured piece
    if (undo.captured !== EMPTY) {
      const capturedSq = (flags & FLAG_EP) ? to + (us === WHITE ? -8 : 8) : to;
      b[capturedSq] = undo.captured;
    }

    // Undo castling rook hop
    if (flags & FLAG_CASTLE_K) {
      const rFrom = us === WHITE ? 7 : 63, rTo = us === WHITE ? 5 : 61;
      b[rFrom] = b[rTo]; b[rTo] = EMPTY;
    } else if (flags & FLAG_CASTLE_Q) {
      const rFrom = us === WHITE ? 0 : 56, rTo = us === WHITE ? 3 : 59;
      b[rFrom] = b[rTo]; b[rTo] = EMPTY;
    }

    if (typeOf(b[from]) === KING) this.kingSq[us] = from;

    this.turn = us;
    if (us === BLACK) this.fullmove--;
    this.castling = undo.castling;
    this.ep = undo.ep;
    this.halfmove = undo.halfmove;
    this.hashLo = undo.hashLo;
    this.hashHi = undo.hashHi;
  }

  /** Deep copy that does NOT share the undo stack. */
  clone(): Position {
    const p = new Position();
    p.board.set(this.board);
    p.turn = this.turn;
    p.castling = this.castling;
    p.ep = this.ep;
    p.halfmove = this.halfmove;
    p.fullmove = this.fullmove;
    p.kingSq = [this.kingSq[0], this.kingSq[1]];
    p.hashLo = this.hashLo;
    p.hashHi = this.hashHi;
    return p;
  }

  /** Material scan → list of signed pieces per color (excluding kings). */
  materialOf(color: Color): number[] {
    const out: number[] = [];
    for (let sq = 0; sq < 64; sq++) {
      const p = this.board[sq];
      if (p !== EMPTY && colorOf(p) === color && typeOf(p) !== KING) out.push(p);
    }
    return out;
  }

  /**
   * Can `color` possibly deliver checkmate by ANY sequence of legal moves
   * (helpmates included)? Used for the timeout rule and dead-position checks.
   */
  hasMatingPotential(color: Color): boolean {
    let knights = 0, bishopsLight = 0, bishopsDark = 0, heavy = 0, pawns = 0;
    let oppPieces = 0, oppKnights = 0, oppBishopsLight = 0, oppBishopsDark = 0;
    for (let sq = 0; sq < 64; sq++) {
      const p = this.board[sq];
      if (p === EMPTY) continue;
      const t = typeOf(p);
      if (t === KING) continue;
      const dark = ((sq >> 3) + (sq & 7)) % 2 === 0;
      if (colorOf(p) === color) {
        if (t === PAWN) pawns++;
        else if (t === KNIGHT) knights++;
        else if (t === BISHOP) { if (dark) bishopsDark++; else bishopsLight++; }
        else heavy++;
      } else {
        oppPieces++;
        if (t === KNIGHT) oppKnights++;
        else if (t === BISHOP) { if (dark) oppBishopsDark++; else oppBishopsLight++; }
      }
    }
    const bishops = bishopsLight + bishopsDark;
    if (pawns || heavy) return true;
    if (knights + bishops === 0) return false;              // bare king
    if (knights >= 2) return true;                          // K+NN: mate constructible
    if (knights + bishops >= 2) return true;                // B+B or B+N
    // Single minor piece:
    if (knights === 1) return oppPieces > 0;                // K+N mates only with a helping blocker
    // Single bishop: needs an opposing piece that isn't a same-colored bishop
    const oppOther = oppPieces - (bishopsLight ? oppBishopsLight : oppBishopsDark);
    return oppOther > 0;
  }

  /**
   * FIDE insufficient-material draw (neither side can ever checkmate):
   * K vs K, K+B vs K, K+N vs K, and any number of bishops all on one square
   * color across BOTH sides (covers K+B vs K+B same-colored bishops).
   */
  isInsufficientMaterial(): boolean {
    let knights = 0, bishopsLight = 0, bishopsDark = 0, other = 0;
    for (let sq = 0; sq < 64; sq++) {
      const p = this.board[sq];
      if (p === EMPTY) continue;
      const t = typeOf(p);
      if (t === KING) continue;
      if (t === KNIGHT) knights++;
      else if (t === BISHOP) {
        if (((sq >> 3) + (sq & 7)) % 2 === 0) bishopsDark++; else bishopsLight++;
      } else other++;
    }
    if (other > 0) return false;
    const bishops = bishopsLight + bishopsDark;
    if (knights === 0 && bishops === 0) return true;            // K vs K
    if (knights === 1 && bishops === 0) return true;            // K+N vs K
    if (knights === 0 && (bishopsLight === 0 || bishopsDark === 0)) return true; // bishops on one color only
    return false;
  }

  /** Dead position: no sequence of legal moves can produce mate for either side. */
  isDeadPosition(): boolean {
    return !this.hasMatingPotential(WHITE) && !this.hasMatingPotential(BLACK);
  }
}
