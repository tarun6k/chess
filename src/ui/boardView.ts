// The chessboard, rendered exactly per the design: wood plate, textured
// squares, glyph pieces with engraved outlines, dot/ring move targets.
// Adds (in the same language): drag & drop, check highlight, coordinates,
// board flipping, and TalkBack announcements.

import { el, clear } from './dom';
import { Position } from '../engine/position';
import {
  Move, moveFrom, moveTo, typeOf, colorOf, WHITE, BLACK, Color, EMPTY,
  fileOf, rankOf, KING,
} from '../engine/types';

export const GLYPHS: Record<number, string> = { 6: '♚', 5: '♛', 4: '♜', 3: '♝', 2: '♞', 1: '♟' };
const VS = '︎';
const TEX = "url('assets/wood.jpg')";
export const WHITE_PIECE_STYLE = 'color:#f6e8cd; text-shadow:0 1px 0 #8a6435, 0 -1px 0 #8a6435, 1px 0 0 #8a6435, -1px 0 0 #8a6435, 0 2px 3px rgba(60,38,10,0.35)';
export const BLACK_PIECE_STYLE = 'color:#4a3018; text-shadow:0 1px 0 rgba(244,230,205,0.85), 0 -1px 0 rgba(244,230,205,0.85), 1px 0 0 rgba(244,230,205,0.85), -1px 0 0 rgba(244,230,205,0.85), 0 2px 3px rgba(0,0,0,0.3)';

const PIECE_NAMES = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

export interface BoardCallbacks {
  onSquareTap: (sq: number) => void;
  onDrop: (from: number, to: number) => void;
}

export interface BoardState {
  pos: Position;
  selected: number | null;
  targets: Move[];
  lastMove: { from: number; to: number } | null;
  checkSq: number | null;
  flipped: boolean;
  coordinates: boolean;
  hintMove: Move | null;
  interactive: boolean;
}

/**
 * Square background exactly as in the design: the wood texture tiled across
 * the 8×8 grid with light/dark overlay per square. r/c are VISUAL row/col
 * (top-left = 0,0) so the texture stays continuous when the board flips.
 */
function sqBg(r: number, c: number, isLight: boolean): string {
  const ov = isLight
    ? 'rgba(247,233,206,0.80), rgba(241,224,190,0.80)'
    : 'rgba(214,174,123,0.28), rgba(46,28,10,0.18)';
  return `linear-gradient(${ov}), ${TEX} calc(${-c} * var(--sq)) calc(${-r} * var(--sq)) / calc(8 * var(--sq)) auto`;
}

export class BoardView {
  root: HTMLElement;
  grid: HTMLElement;
  live: HTMLElement;
  private cb: BoardCallbacks;
  private dragFrom = -1;
  private dragGhost: HTMLElement | null = null;
  private lastState: BoardState | null = null;

  constructor(cb: BoardCallbacks) {
    this.cb = cb;
    this.grid = el('div', {
      style: 'display:grid; grid-template-columns:repeat(8,var(--sq)); grid-template-rows:repeat(8,var(--sq)); border:1px solid rgba(60,40,16,0.5); touch-action:none; position:relative',
      role: 'grid', 'aria-label': 'Chessboard',
    });
    this.live = el('div', {
      'aria-live': 'polite', role: 'status',
      style: 'position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%)',
    });
    this.root = el('div', {
      style: "padding:min(16px, 2.5vw); background:linear-gradient(rgba(30,18,6,0.30),rgba(30,18,6,0.38)), url('assets/wood.jpg') center / 700px auto; border-radius:6px; box-shadow:var(--shadow-md)",
    }, this.grid, this.live);

    this.grid.addEventListener('pointerdown', this.onPointerDown);
    this.grid.addEventListener('pointermove', this.onPointerMove);
    this.grid.addEventListener('pointerup', this.onPointerUp);
    this.grid.addEventListener('pointercancel', () => this.endDrag());
  }

  announce(text: string): void {
    this.live.textContent = text;
  }

  /** visual index (0..63, top-left first) → board square */
  private vToSq(v: number, flipped: boolean): number {
    const r = Math.floor(v / 8), c = v % 8;
    return flipped ? r * 8 + (7 - c) : (7 - r) * 8 + c;
  }
  private sqToV(sq: number, flipped: boolean): number {
    const rank = rankOf(sq), file = fileOf(sq);
    return flipped ? rank * 8 + (7 - file) : (7 - rank) * 8 + file;
  }

  render(s: BoardState): void {
    this.lastState = s;
    clear(this.grid);
    this.grid.append(this.live);
    const b = s.pos.board;
    for (let v = 0; v < 64; v++) {
      const r = Math.floor(v / 8), c = v % 8;
      const sq = this.vToSq(v, s.flipped);
      const isLight = (rankOf(sq) + fileOf(sq)) % 2 === 1;
      const p = b[sq];
      const isSel = s.selected === sq;
      const isLast = s.lastMove !== null && (s.lastMove.from === sq || s.lastMove.to === sq);
      const isCheck = s.checkSq === sq;
      const isHint = s.hintMove !== null && (moveFrom(s.hintMove) === sq || moveTo(s.hintMove) === sq);
      const tgt = s.targets.find(m => moveTo(m) === sq);

      let shadow = 'none';
      if (isSel) shadow = 'inset 0 0 0 3px var(--color-accent, #b68235)';
      else if (isHint) shadow = 'inset 0 0 0 3px var(--color-accent-300, #facb8d)';
      else if (isCheck) shadow = 'inset 0 0 0 3px rgba(146,44,28,0.75)';
      else if (isLast) shadow = 'inset 0 0 0 3px rgba(182,130,53,0.45)';

      const canTouch = s.interactive && (tgt !== undefined || (p !== EMPTY && colorOf(p) === s.pos.turn));

      const square = el('div', {
        'data-sq': sq,
        role: 'gridcell',
        'aria-label': sqNameHuman(sq, p),
        style: `width:var(--sq); height:var(--sq); position:relative; display:flex; align-items:center; justify-content:center;` +
          `background:${sqBg(r, c, isLight)}; box-shadow:${shadow};` +
          `cursor:${canTouch ? 'pointer' : 'default'}; user-select:none; -webkit-user-select:none`,
      });

      // target dot / capture ring — per the design
      if (tgt !== undefined) {
        square.append(el('div', {
          style: p !== EMPTY
            ? 'position:absolute; inset:3px; border-radius:50%; border:3px solid rgba(112,78,36,0.55)'
            : 'position:absolute; width:calc(var(--sq) * 0.3); height:calc(var(--sq) * 0.3); border-radius:50%; background:rgba(112,78,36,0.45); left:50%; top:50%; transform:translate(-50%,-50%)',
        }));
      }

      if (p !== EMPTY) {
        const pieceStyle = colorOf(p) === WHITE ? WHITE_PIECE_STYLE : BLACK_PIECE_STYLE;
        square.append(el('span', {
          style: `font-size:calc(var(--sq) * 0.74); line-height:1; position:relative; z-index:1; ${pieceStyle};` +
            (this.dragFrom === sq ? 'opacity:0.25;' : ''),
          'aria-hidden': 'true',
        }, GLYPHS[typeOf(p)] + VS));
      }

      // coordinates (setting): file letters on bottom row, rank digits on left col
      if (s.coordinates) {
        const coordStyle = 'position:absolute; font-size:calc(var(--sq) * 0.18); font-family:var(--font-body); opacity:0.75; z-index:0;' +
          `color:${isLight ? '#7a5a30' : '#f0e2c4'};`;
        if (r === 7) {
          square.append(el('span', { style: coordStyle + 'right:3px; bottom:2px', 'aria-hidden': 'true' }, 'abcdefgh'[fileOf(sq)]));
        }
        if (c === 0) {
          square.append(el('span', { style: coordStyle + 'left:3px; top:2px', 'aria-hidden': 'true' }, String(rankOf(sq) + 1)));
        }
      }

      this.grid.append(square);
    }
  }

  // ── pointer handling: tap-tap AND drag-and-drop ───────────────────────────

  private squareAt(e: PointerEvent): number {
    const rect = this.grid.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * 8);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * 8);
    if (c < 0 || c > 7 || r < 0 || r > 7) return -1;
    return this.vToSq(r * 8 + c, this.lastState?.flipped ?? false);
  }

  private onPointerDown = (e: PointerEvent): void => {
    const s = this.lastState;
    if (!s || !s.interactive) return;
    const sq = this.squareAt(e);
    if (sq < 0) return;
    this.cb.onSquareTap(sq);
    const p = s.pos.board[sq];
    if (p !== EMPTY && colorOf(p) === s.pos.turn) {
      this.dragFrom = sq;
      this.grid.setPointerCapture(e.pointerId);
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.dragFrom < 0 || !this.lastState) return;
    if (!this.dragGhost) {
      const p = this.lastState.pos.board[this.dragFrom];
      if (p === EMPTY) return;
      const pieceStyle = colorOf(p) === WHITE ? WHITE_PIECE_STYLE : BLACK_PIECE_STYLE;
      this.dragGhost = el('span', {
        style: `position:fixed; z-index:100; pointer-events:none; font-size:calc(var(--sq) * 0.9); line-height:1; ${pieceStyle}; transform:translate(-50%,-60%)`,
      }, GLYPHS[typeOf(p)] + VS);
      document.body.append(this.dragGhost);
      // re-render to dim the origin piece
      this.render(this.lastState);
    }
    this.dragGhost.style.left = e.clientX + 'px';
    this.dragGhost.style.top = e.clientY + 'px';
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.dragFrom < 0) return;
    const from = this.dragFrom;
    const wasDragging = this.dragGhost !== null;
    const to = this.squareAt(e);
    this.endDrag();
    if (wasDragging && to >= 0 && to !== from) {
      this.cb.onDrop(from, to);
    }
  };

  private endDrag(): void {
    this.dragFrom = -1;
    if (this.dragGhost) { this.dragGhost.remove(); this.dragGhost = null; }
    if (this.lastState) this.render(this.lastState);
  }
}

function sqNameHuman(sq: number, piece: number): string {
  const name = 'abcdefgh'[fileOf(sq)] + String(rankOf(sq) + 1);
  if (piece === EMPTY) return name;
  return `${name}, ${colorOf(piece) === WHITE ? 'white' : 'black'} ${PIECE_NAMES[typeOf(piece)]}`;
}
