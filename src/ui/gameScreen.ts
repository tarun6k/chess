// The game screen — a faithful implementation of "Chess Game.dc.html",
// extended minimally (in the same visual language) with: difficulty picker,
// draw/resign/hint actions, game-over sheet, puzzle banner, and post-game review.

import { el, clear, LABEL_STYLE, CARD_STYLE, segStyle, segWrap } from './dom';
import { BoardView, GLYPHS, WHITE_PIECE_STYLE, BLACK_PIECE_STYLE } from './boardView';
import { controller } from '../app/controller';
import { state, persist } from '../app/store';
import { formatClock, TIME_PRESETS, TimeControl } from '../app/clock';
import {
  Move, moveFrom, moveTo, movePromo, WHITE, BLACK, Color, typeOf, colorOf,
  QUEEN, ROOK, BISHOP, KNIGHT, EMPTY, makeMove, moveFlags, rankOf, sqName, PIECE_CHARS,
} from '../engine/types';
import { Position } from '../engine/position';
import { toSAN } from '../engine/san';
import { offerChallenges, dailyPuzzle, isDailyDone } from '../app/progression';
import { PUZZLES, DRILLS, CONSTRAINTS } from '../app/puzzles';
import { navigate } from './router';
import { toPGN } from '../engine/pgn';
import { Judgment } from '../ai/protocol';

const VS = '︎';

type PendingPromo = { from: number; to: number; moves: Move[] } | null;

const JUDGMENT_MARK: Record<Judgment, string> = {
  best: '★', good: '', inaccuracy: '?!', mistake: '?', blunder: '??',
};
const JUDGMENT_COLOR: Record<Judgment, string> = {
  best: 'var(--color-accent-700)', good: '', inaccuracy: 'var(--color-accent-600)',
  mistake: '#a3541f', blunder: '#8a2c1c',
};

export class GameScreen {
  root = el('div');
  private board: BoardView;
  private selected: number | null = null;
  private targets: Move[] = [];
  private pendingPromo: PendingPromo = null;
  private unsub: (() => void) | null = null;
  private reviewPly: number | null = null;   // null = live; number = review mode
  private showGameOver = false;
  private gameOverShownFor: string | null = null;
  private drawNote = '';
  private seenGameId = -1;

  constructor() {
    this.board = new BoardView({
      onSquareTap: sq => this.tapSquare(sq),
      onDrop: (from, to) => this.tryMove(from, to),
    });
  }

  mount(): void {
    this.unsub = controller.subscribe(() => {
      // surface the game-over sheet once per game
      if (controller.game.status === 'finished' && controller.gameOverHandled) {
        const key = controller.game.uciLine().join(' ');
        if (this.gameOverShownFor !== key && this.reviewPly === null) {
          this.gameOverShownFor = key;
          this.showGameOver = true;
        }
      }
      this.render();
    });
    this.render();
  }
  unmount(): void { this.unsub?.(); this.unsub = null; }

  // ── input ────────────────────────────────────────────────────────────────

  private tapSquare(sq: number): void {
    if (this.reviewPly !== null) return;
    if (!controller.humanTurn() || this.pendingPromo) return;
    const g = controller.game;
    const m = this.targets.find(x => moveTo(x) === sq);
    if (m !== undefined) { this.commitMove(m); return; }
    const p = g.pos.board[sq];
    if (p !== EMPTY && colorOf(p) === g.turn && sq !== this.selected) {
      this.selected = sq;
      this.targets = controller.legalTargetsFrom(sq).filter(x => controller.moveAllowedByConstraint(x));
      if (controller.legalTargetsFrom(sq).length > 0 && this.targets.length === 0) {
        this.drawNote = 'Challenge rule: your queen must not move.';
      }
    } else {
      this.selected = null;
      this.targets = [];
    }
    this.render();
  }

  private tryMove(from: number, to: number): void {
    if (this.reviewPly !== null || !controller.humanTurn() || this.pendingPromo) return;
    const moves = controller.legalTargetsFrom(from).filter(x => controller.moveAllowedByConstraint(x));
    const candidates = moves.filter(m => moveTo(m) === to);
    if (!candidates.length) { this.selected = null; this.targets = []; this.render(); return; }
    this.commitCandidates(candidates);
  }

  private commitMove(m: Move): void {
    const from = moveFrom(m), to = moveTo(m);
    const all = this.targets.filter(x => moveFrom(x) === from && moveTo(x) === to);
    this.commitCandidates(all.length ? all : [m]);
  }

  private commitCandidates(candidates: Move[]): void {
    if (candidates.length > 1 && movePromo(candidates[0]) !== 0) {
      if (state.settings.autoQueen) {
        const q = candidates.find(m => movePromo(m) === QUEEN) ?? candidates[0];
        this.finishMove(q);
      } else {
        this.pendingPromo = { from: moveFrom(candidates[0]), to: moveTo(candidates[0]), moves: candidates };
        this.render();
      }
      return;
    }
    this.finishMove(candidates[0]);
  }

  private finishMove(m: Move): void {
    this.selected = null;
    this.targets = [];
    this.pendingPromo = null;
    this.drawNote = '';
    const g = controller.game;
    const san = g.status === 'active' ? this.previewSan(m) : '';
    if (controller.playMove(m)) {
      this.board.announce(san);
    }
  }

  private previewSan(m: Move): string {
    // spoken form for accessibility, e.g. "Knight f3, check"
    const pos = controller.game.pos;
    const t = typeOf(pos.board[moveFrom(m)]);
    const names = ['', 'Pawn', 'Knight', 'Bishop', 'Rook', 'Queen', 'King'];
    return `${names[t]} ${sqName(moveTo(m))}`;
  }

  // ── render ───────────────────────────────────────────────────────────────

  render(): void {
    // a different game was loaded (e.g. from Home) — drop stale local UI state
    if (controller.gameId !== this.seenGameId) {
      this.seenGameId = controller.gameId;
      this.resetLocal();
    }
    const g = controller.game;
    const reviewing = this.reviewPly !== null;
    const pos = reviewing ? g.positionAt(this.reviewPly!) : g.pos;
    const lastEntry = reviewing
      ? (this.reviewPly! > 0 ? g.history[this.reviewPly! - 1] : null)
      : (g.history.length ? g.history[g.history.length - 1] : null);

    const flipped = this.isFlipped();
    const checkSq = pos.inCheck() ? pos.kingSq[pos.turn] : null;

    this.board.render({
      pos,
      selected: reviewing ? null : this.selected,
      targets: reviewing ? [] : this.targets,
      lastMove: lastEntry ? { from: moveFrom(lastEntry.move), to: moveTo(lastEntry.move) } : null,
      checkSq,
      flipped,
      coordinates: state.settings.coordinates,
      hintMove: reviewing ? null : controller.hintMove,
      interactive: !reviewing && controller.humanTurn() && !this.pendingPromo && !this.showGameOver,
    });

    const root = this.root;
    clear(root);
    const parts: Array<HTMLElement | null> = [
      el('div', {
        style: '--sq: min(62px, calc((100vw - 60px) / 8)); min-height:100vh; font-family:var(--font-body); color:var(--color-text); display:flex; flex-direction:column; align-items:center; padding:clamp(20px,4vw,36px) 12px 96px',
      },
        this.header(pos, reviewing),
        el('div', {
          style: 'display:flex; gap:clamp(20px,4vw,40px); align-items:flex-start; flex-wrap:wrap; justify-content:center; margin-top:clamp(16px,3vw,28px); max-width:100%',
        },
          this.board.root,
          this.sidePanel(reviewing),
        ),
      ),
      this.pendingPromo ? this.promoDialog() : null,
      this.showGameOver && g.result ? this.gameOverDialog() : null,
      this.pvpDrawDialog(),
    ];
    for (const p of parts) if (p) root.append(p);
  }

  private isFlipped(): boolean {
    const s = state.settings.boardFlip;
    if (s === 'white') return false;
    if (s === 'black') return true;
    if (controller.mode === 'pvp') return controller.game.turn === BLACK;
    return controller.playerColor === BLACK;
  }

  private header(pos: Position, reviewing: boolean): HTMLElement {
    return el('header', { style: 'text-align:center' },
      el('div', { style: 'font-family:var(--font-heading); font-weight:400; font-size:44px; letter-spacing:0.02em; line-height:1.1' }, 'Chess'),
      el('div', { style: 'width:64px; height:1px; background:var(--color-divider); margin:10px auto' }),
      el('div', { style: "font-size:13px; letter-spacing:0.14em; text-transform:uppercase; color:var(--color-neutral-600); font-feature-settings:'tnum'" },
        this.statusLine(pos, reviewing)),
    );
  }

  private statusLine(pos: Position, reviewing: boolean): string {
    const g = controller.game;
    if (reviewing) {
      return `Review · move ${Math.ceil(this.reviewPly! / 2)} of ${Math.ceil(g.history.length / 2)}`;
    }
    if (controller.puzzleState === 'solved') return 'Solved! Well done.';
    if (controller.puzzleState === 'wrong') return 'Not quite — try again';
    if (g.result) return g.result.message;
    const check = g.inCheck() ? 'Check · ' : '';
    if (controller.thinking) return check + 'Computer is thinking…';
    return check + (g.turn === WHITE ? 'White' : 'Black') + ' to move';
  }

  // ── side panel ───────────────────────────────────────────────────────────

  private sidePanel(reviewing: boolean): HTMLElement {
    const panel = el('div', { style: 'width:min(300px, calc(100vw - 24px)); display:flex; flex-direction:column; gap:20px' });
    if (controller.isChallengeGame()) panel.append(this.challengeCard());
    if (reviewing) {
      panel.append(this.reviewCard());
    } else {
      panel.append(this.modeCard(), this.timerCard());
    }
    panel.append(this.capturedCard(), this.movesCard(reviewing));
    if (!reviewing) panel.append(this.buttonRows());
    else panel.append(this.reviewButtons());
    if (this.drawNote) {
      panel.append(el('div', { style: 'font-size:13px; font-style:italic; color:var(--color-neutral-500)' }, this.drawNote));
    }
    return panel;
  }

  private modeCard(): HTMLElement {
    const isPvp = controller.mode === 'pvp';
    const card = el('div', { style: CARD_STYLE },
      el('div', { style: 'display:flex; justify-content:space-between; align-items:center' },
        el('span', { style: LABEL_STYLE }, 'Mode'),
        segWrap(
          el('button', { style: segStyle(isPvp), onclick: () => this.switchMode('pvp') }, '2 players'),
          el('button', { style: segStyle(!isPvp), onclick: () => this.switchMode('ai') }, 'vs AI'),
        ),
      ),
    );
    if (!isPvp && !controller.isChallengeGame()) {
      card.append(
        el('div', { style: 'height:1px; background:var(--color-divider)' }),
        el('div', { style: 'display:flex; justify-content:space-between; align-items:center' },
          el('span', { style: LABEL_STYLE }, 'AI level'),
          segWrap(
            el('button', { style: segStyle(controller.difficulty === 'learn'), onclick: () => this.setDifficulty('learn') }, 'Learn'),
            el('button', { style: segStyle(controller.difficulty === 'match'), onclick: () => this.setDifficulty('match') }, 'Match'),
            el('button', { style: segStyle(controller.difficulty === 'challenge'), onclick: () => this.setDifficulty('challenge') }, 'Push me'),
          ),
        ),
        el('div', { style: 'font-size:12px; color:var(--color-neutral-500)' },
          `AI plays around ${controller.aiElo} — your rating ${state.model.rating}`),
      );
    }
    return card;
  }

  private switchMode(mode: 'pvp' | 'ai'): void {
    if (controller.mode === mode) return;
    this.resetLocal();
    controller.newGame({
      mode,
      playerColor: WHITE,
      timeControl: controller.timerOn ? (controller.timeControl ?? TIME_PRESETS[2]) : null,
    });
  }

  private setDifficulty(d: 'learn' | 'match' | 'challenge'): void {
    state.difficulty = d;
    void persist.difficulty();
    this.resetLocal();
    controller.newGame({
      mode: 'ai', playerColor: controller.playerColor, difficulty: d,
      timeControl: controller.timerOn ? controller.timeControl : null,
    });
  }

  private timerCard(): HTMLElement {
    const g = controller.game;
    const on = controller.timerOn;
    const card = el('div', { style: CARD_STYLE },
      el('div', { style: 'display:flex; justify-content:space-between; align-items:center' },
        el('span', { style: LABEL_STYLE }, 'Timer'),
        segWrap(
          el('button', { style: segStyle(on), onclick: () => this.setTimer(true) }, 'On'),
          el('button', { style: segStyle(!on), onclick: () => this.setTimer(false) }, 'Off'),
        ),
      ),
    );
    if (on) {
      if (g.history.length === 0) {
        // preset picker before the game starts (same visual language)
        const row = el('div', { style: 'display:flex; flex-wrap:wrap; gap:6px' });
        for (const tc of TIME_PRESETS) {
          const active = controller.timeControl?.name === tc.name;
          row.append(el('button', {
            class: 'tag ' + (active ? 'tag-accent' : 'tag-neutral'),
            style: 'cursor:pointer; border:none; min-height:28px',
            onclick: () => this.pickPreset(tc),
          }, tc.name));
        }
        card.append(el('div', { style: 'height:1px; background:var(--color-divider)' }), row);
      }
      const clocks = controller.clock;
      const running = !g.result && controller.timerOn;
      const clockStyle = (active: boolean, low: boolean) =>
        `font-feature-settings:'tnum'; font-size:22px;` +
        `color:${low ? '#8a2c1c' : active ? 'var(--color-accent-700)' : 'var(--color-text)'};` +
        `border-bottom:${active ? '2px solid var(--color-accent)' : '2px solid transparent'}; padding-bottom:2px`;
      const w = clocks ? clocks.remaining[WHITE] : (controller.timeControl?.baseMs ?? 0);
      const b = clocks ? clocks.remaining[BLACK] : (controller.timeControl?.baseMs ?? 0);
      card.append(
        el('div', { style: 'height:1px; background:var(--color-divider)' }),
        el('div', { style: 'display:flex; justify-content:space-between; align-items:baseline' },
          el('span', { style: LABEL_STYLE }, 'White'),
          el('span', { style: clockStyle(running && g.turn === WHITE, w < 20000 && w > 0) }, formatClock(w)),
        ),
        el('div', { style: 'height:1px; background:var(--color-divider)' }),
        el('div', { style: 'display:flex; justify-content:space-between; align-items:baseline' },
          el('span', { style: LABEL_STYLE }, 'Black'),
          el('span', { style: clockStyle(running && g.turn === BLACK, b < 20000 && b > 0) }, formatClock(b)),
        ),
      );
    } else {
      card.append(el('div', { style: 'font-size:13px; font-style:italic; color:var(--color-neutral-500)' },
        'Untimed game — take your time.'));
    }
    return card;
  }

  private setTimer(on: boolean): void {
    if (controller.game.history.length > 0 && controller.game.status === 'active') {
      // per the design, the toggle restarts with the new setting
      this.resetLocal();
      controller.newGame({
        mode: controller.mode, playerColor: controller.playerColor,
        timeControl: on ? (controller.timeControl ?? TIME_PRESETS[2]) : null,
      });
      return;
    }
    if (on && !controller.timeControl) {
      this.resetLocal();
      controller.newGame({ mode: controller.mode, playerColor: controller.playerColor, timeControl: TIME_PRESETS[2] });
    } else if (!on) {
      controller.setTimerOn(false);
    }
  }

  private pickPreset(tc: TimeControl): void {
    this.resetLocal();
    controller.newGame({ mode: controller.mode, playerColor: controller.playerColor, timeControl: tc });
  }

  private capturedCard(): HTMLElement {
    const g = controller.game;
    const capsW = g.capturedBy(WHITE).map(t => GLYPHS[t] + VS).join(' ');
    const capsB = g.capturedBy(BLACK).map(t => GLYPHS[t] + VS).join(' ');
    const chip = (content: string, dark: boolean) => content
      ? el('span', {
          style: `font-size:30px; line-height:1.2; padding:4px 10px; border-radius:4px; display:inline-block;` +
            `background:linear-gradient(${dark ? 'rgba(40,24,8,0.35), rgba(40,24,8,0.40)' : 'rgba(247,233,206,0.78), rgba(241,224,190,0.78)'}), url('assets/wood.jpg') center / 240px auto;` +
            (dark ? WHITE_PIECE_STYLE : BLACK_PIECE_STYLE),
        }, content)
      : el('span', { style: 'color:var(--color-neutral-400)' }, '—');
    return el('div', { style: CARD_STYLE },
      el('div', { style: LABEL_STYLE }, 'Captured'),
      el('div', { style: 'display:flex; align-items:baseline; gap:12px; min-height:26px' },
        el('span', { style: 'font-size:12px; color:var(--color-neutral-500); width:64px; flex:none' }, 'by White'),
        chip(capsW, false),
      ),
      el('div', { style: 'display:flex; align-items:baseline; gap:12px; min-height:26px' },
        el('span', { style: 'font-size:12px; color:var(--color-neutral-500); width:64px; flex:none' }, 'by Black'),
        chip(capsB, true),
      ),
    );
  }

  private movesCard(reviewing: boolean): HTMLElement {
    const g = controller.game;
    const list = el('div', {
      style: "max-height:220px; overflow-y:auto; display:flex; flex-direction:column; gap:2px; font-feature-settings:'tnum'; font-size:14px",
    });
    const analysis = controller.analysis;
    const moveCell = (ply: number): HTMLElement => {
      const h = g.history[ply];
      if (!h) return el('span');
      const j = analysis?.[ply]?.judgment;
      const mark = j && JUDGMENT_MARK[j] ? el('span', { style: `color:${JUDGMENT_COLOR[j]}; margin-left:3px; font-size:12px` }, JUDGMENT_MARK[j]) : null;
      const current = reviewing && this.reviewPly === ply + 1;
      return el('span', {
        style: (current ? 'color:var(--color-accent-700); font-weight:600;' : '') + 'cursor:pointer',
        onclick: () => { this.reviewPly = ply + 1; this.render(); },
      }, h.san, mark ?? '');
    };
    const startPos = new Position(g.startFen);
    const blackFirst = startPos.turn === BLACK;
    const pairCount = Math.ceil((g.history.length + (blackFirst ? 1 : 0)) / 2);
    for (let i = 0; i < pairCount; i++) {
      const wPly = blackFirst ? i * 2 - 1 : i * 2;
      const bPly = wPly + 1;
      list.append(el('div', { style: 'display:grid; grid-template-columns:32px 1fr 1fr; gap:8px; padding:2px 0; border-bottom:1px solid var(--color-neutral-200)' },
        el('span', { style: 'color:var(--color-neutral-500)' }, `${startPos.fullmove + i}.`),
        wPly >= 0 ? moveCell(wPly) : el('span', {}, '…'),
        moveCell(bPly),
      ));
    }
    if (g.history.length === 0) {
      list.append(el('div', { style: 'color:var(--color-neutral-500); font-style:italic; font-size:13px' },
        'No moves yet — White opens.'));
    }
    const card = el('div', { style: CARD_STYLE.replace('gap:10px', 'gap:8px') },
      el('div', { style: LABEL_STYLE }, 'Moves'),
      list,
    );
    requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
    return card;
  }

  private buttonRows(): HTMLElement {
    const g = controller.game;
    const wrap = el('div', { style: 'display:flex; flex-direction:column; gap:10px' });
    wrap.append(el('div', { style: 'display:flex; gap:12px' },
      el('button', { class: 'btn btn-primary', style: 'min-height:44px', onclick: () => this.newGameSameSettings() }, 'New game'),
      el('button', {
        class: 'btn btn-secondary', style: 'min-height:44px',
        disabled: !controller.takebacksAllowed(),
        onclick: () => { this.resetLocal(); controller.undo(); },
      }, 'Undo'),
    ));
    if (g.status === 'active' && g.history.length > 0 && !controller.isChallengeGame()) {
      const hintAllowed = controller.hintsLeft > 0 && controller.humanTurn();
      wrap.append(el('div', { style: 'display:flex; gap:6px; flex-wrap:wrap' },
        el('button', { class: 'btn btn-ghost', style: 'min-height:44px', disabled: !hintAllowed, onclick: () => void controller.useHint() },
          `Hint (${controller.hintsLeft})`),
        el('button', { class: 'btn btn-ghost', style: 'min-height:44px', onclick: () => controller.offerDraw() },
          controller.game.claimableDraw() ? 'Claim draw' : 'Offer draw'),
        el('button', { class: 'btn btn-ghost', style: 'min-height:44px', onclick: () => controller.resign() }, 'Resign'),
      ));
    }
    if (controller.puzzleState === 'wrong') {
      wrap.append(el('button', { class: 'btn btn-primary btn-block', onclick: () => controller.retryPuzzle() }, 'Try again'));
    }
    if (g.status === 'finished' && !this.showGameOver) {
      wrap.append(el('button', {
        class: 'btn btn-secondary btn-block',
        onclick: () => { this.showGameOver = true; this.render(); },
      }, 'Game summary'));
    }
    return wrap;
  }

  private newGameSameSettings(): void {
    this.resetLocal();
    if (controller.isChallengeGame()) { controller.retryPuzzle(); return; }
    controller.newGame({
      mode: controller.mode === 'pvp' ? 'pvp' : 'ai',
      playerColor: controller.playerColor,
      timeControl: controller.timerOn ? controller.timeControl : null,
    });
  }

  private resetLocal(): void {
    this.selected = null;
    this.targets = [];
    this.pendingPromo = null;
    this.reviewPly = null;
    this.showGameOver = false;
    this.gameOverShownFor = null;
    this.drawNote = '';
  }

  private challengeCard(): HTMLElement {
    const c = controller.challenge!;
    const title = c.puzzle?.title ?? c.drill?.title ?? c.constraint?.title ?? 'Find the best move';
    const detail = c.puzzle?.prompt ?? c.drill?.description ?? c.constraint?.description ??
      (c.mistake ? 'From one of your recent games — this time, find the move you missed.' : '');
    return el('div', { style: CARD_STYLE },
      el('div', { style: LABEL_STYLE }, c.isDaily ? 'Daily challenge' : 'Challenge'),
      el('div', { class: 'card-title' }, title),
      el('div', { style: 'font-size:13px; opacity:0.8' }, detail),
      controller.puzzleState === 'solved'
        ? el('span', { class: 'tag tag-accent' }, `Solved · +${c.puzzle?.xp ?? 15} XP`)
        : controller.puzzleState === 'wrong'
          ? el('span', { class: 'tag tag-outline' }, 'Not quite — try again')
          : null,
    );
  }

  // ── review mode ──────────────────────────────────────────────────────────

  private reviewCard(): HTMLElement {
    const g = controller.game;
    const ply = this.reviewPly!;
    const analysis = controller.analysis;
    const a = ply > 0 ? analysis?.[ply - 1] : null;

    // eval bar: white share from cp
    const cp = a ? a.evalAfter : 0;
    const share = 100 / (1 + Math.pow(10, -cp / 400)); // logistic → %
    const bar = el('div', { style: 'height:10px; border:1px solid var(--color-divider); border-radius:5px; overflow:hidden; display:flex' },
      el('div', { style: `width:${share}%; background:#f6e8cd; transition:width .3s` }),
      el('div', { style: `flex:1; background:#4a3018` }),
    );

    const card = el('div', { style: CARD_STYLE },
      el('div', { style: LABEL_STYLE }, 'Review'),
      bar,
      el('div', { style: "display:flex; justify-content:space-between; font-size:13px; font-feature-settings:'tnum'" },
        el('span', {}, a ? (cp >= 0 ? '+' : '') + (cp / 100).toFixed(1) : '0.0'),
        a ? el('span', { style: `color:${JUDGMENT_COLOR[a.judgment] || 'var(--color-neutral-600)'}` },
          a.judgment === 'best' ? 'Best move' : a.judgment === 'good' ? 'Good' : a.judgment) : el('span'),
      ),
    );
    if (a && (a.judgment === 'mistake' || a.judgment === 'blunder' || a.judgment === 'inaccuracy')) {
      const best = this.uciToSanAt(ply - 1, a.bestUci);
      if (best) card.append(el('div', { style: 'font-size:13px; opacity:0.85' }, `Best was ${best}`));
    }
    if (!analysis) {
      card.append(el('div', { style: 'font-size:12px; font-style:italic; color:var(--color-neutral-500)' },
        controller.analysisPending ? 'Analyzing game…' : 'No analysis available.'));
    }
    return card;
  }

  private uciToSanAt(ply: number, uci: string): string | null {
    const pos = controller.game.positionAt(ply);
    for (const m of pos.generateLegal()) {
      const u = sqName(moveFrom(m)) + sqName(moveTo(m)) + (movePromo(m) ? PIECE_CHARS[movePromo(m)].toLowerCase() : '');
      if (u === uci) return toSAN(pos, m);
    }
    return null;
  }

  private reviewButtons(): HTMLElement {
    const g = controller.game;
    const step = (d: number) => {
      this.reviewPly = Math.max(0, Math.min(g.history.length, this.reviewPly! + d));
      this.render();
    };
    return el('div', { style: 'display:flex; flex-direction:column; gap:10px' },
      el('div', { style: 'display:flex; gap:8px' },
        el('button', { class: 'btn btn-secondary', style: 'flex:1; min-height:44px', onclick: () => step(-1e9) }, '⏮'),
        el('button', { class: 'btn btn-secondary', style: 'flex:1; min-height:44px', onclick: () => step(-1) }, '◀'),
        el('button', { class: 'btn btn-secondary', style: 'flex:1; min-height:44px', onclick: () => step(1) }, '▶'),
        el('button', { class: 'btn btn-secondary', style: 'flex:1; min-height:44px', onclick: () => step(1e9) }, '⏭'),
      ),
      el('button', { class: 'btn btn-primary btn-block', onclick: () => { this.reviewPly = null; this.showGameOver = false; this.render(); } },
        'Back to game'),
    );
  }

  // ── dialogs ──────────────────────────────────────────────────────────────

  private promoDialog(): HTMLElement {
    const promo = this.pendingPromo!;
    const g = controller.game;
    const color = g.turn;
    const pieceStyle = color === WHITE ? WHITE_PIECE_STYLE : BLACK_PIECE_STYLE;
    const choices = [QUEEN, ROOK, BISHOP, KNIGHT].map(t => {
      const m = promo.moves.find(x => movePromo(x) === t)!;
      return el('button', {
        style: 'width:64px; height:64px; display:flex; align-items:center; justify-content:center; background:#eeddbe; border:1px solid var(--color-accent); border-radius:4px; cursor:pointer',
        'aria-label': ['', '', 'knight', 'bishop', 'rook', 'queen'][t],
        onclick: () => this.finishMove(m),
      }, el('span', { style: `font-size:40px; line-height:1; ${pieceStyle}` }, GLYPHS[t] + VS));
    });
    return el('div', {
      class: 'dialog-backdrop',
      style: 'position:fixed; inset:0; display:flex; align-items:center; justify-content:center; z-index:50; background:rgba(32,31,29,0.4)',
    },
      el('div', {
        class: 'dialog',
        style: 'background:var(--color-bg); border:1px solid var(--color-divider); border-radius:var(--radius-md,4px); box-shadow:var(--shadow-lg); padding:28px 32px; display:flex; flex-direction:column; gap:16px; align-items:center',
      },
        el('div', { style: 'font-family:var(--font-heading); font-size:24px' }, 'Promote to'),
        el('div', { style: 'display:flex; gap:10px' }, ...choices),
      ),
    );
  }

  private gameOverDialog(): HTMLElement {
    const g = controller.game;
    const r = g.result!;
    const playerWon = r.winner === controller.playerColor;
    const title = controller.mode === 'pvp'
      ? (r.winner === null ? 'Draw' : r.winner === WHITE ? 'White wins' : 'Black wins')
      : r.winner === null ? 'Draw' : playerWon ? 'You win' : 'AI wins';

    const notes = controller.postGame?.notes ?? [];
    const offers = controller.mode === 'ai' && !controller.isChallengeGame()
      ? offerChallenges(state.model, state.progress, r.winner === null ? null : playerWon)
      : [];

    const dialog = el('div', { class: 'dialog', style: 'max-height:85vh; overflow-y:auto' },
      el('div', { class: 'dialog-title', style: 'font-size:26px' }, title),
      el('div', { class: 'dialog-body' }, r.message),
    );

    if (notes.length) {
      dialog.append(
        el('div', { style: LABEL_STYLE + ';margin-top:6px' }, 'How I adapted'),
        el('div', { style: 'display:flex; flex-direction:column; gap:6px' },
          ...notes.map(n => el('div', { style: 'font-size:13px; opacity:0.85; border-left:2px solid var(--color-accent-300); padding-left:10px' }, n))),
      );
    }

    if (offers.length) {
      dialog.append(el('div', { style: LABEL_STYLE + ';margin-top:6px' }, 'Up for more?'));
      for (const o of offers) {
        dialog.append(el('div', { class: 'card', style: 'padding:10px 12px; cursor:pointer', onclick: () => this.acceptOffer(o.id, o) },
          el('div', { class: 'card-title', style: 'font-size:15px' }, o.title),
          el('div', { style: 'font-size:12.5px; opacity:0.8' }, o.detail),
        ));
      }
    }

    dialog.append(el('div', { class: 'dialog-actions', style: 'flex-wrap:wrap' },
      el('button', { class: 'btn btn-ghost', onclick: () => this.exportPgn() }, 'Export PGN'),
      controller.mode !== 'pvp' && g.history.length >= 4
        ? el('button', {
            class: 'btn btn-secondary',
            onclick: () => { this.showGameOver = false; this.reviewPly = g.history.length; this.render(); },
          }, 'Review')
        : null,
      el('button', { class: 'btn btn-primary', onclick: () => this.newGameSameSettings() }, 'New game'),
      el('button', { class: 'btn btn-ghost', onclick: () => { this.showGameOver = false; this.render(); } }, 'Close'),
    ));

    return el('div', { class: 'dialog-backdrop', style: 'z-index:60' }, dialog);
  }

  private acceptOffer(id: string, offer: ReturnType<typeof offerChallenges>[number]): void {
    this.resetLocal();
    if (offer.kind === 'rematch-blitz') {
      controller.newGame({ mode: 'ai', playerColor: controller.playerColor, timeControl: TIME_PRESETS[1] });
    } else if (offer.kind === 'drill' && offer.drillId) {
      const d = DRILLS.find(x => x.id === offer.drillId)!;
      controller.newGame({ mode: 'drill', challenge: { drill: d } });
    } else if (offer.kind === 'constraint' && offer.constraintId) {
      const c = CONSTRAINTS.find(x => x.id === offer.constraintId)!;
      controller.newGame({ mode: 'constraint', challenge: { constraint: c } });
    } else if (offer.kind === 'puzzle-set' && offer.puzzleIds?.length) {
      const p = PUZZLES.find(x => x.id === offer.puzzleIds![0])!;
      controller.newGame({ mode: 'puzzle', challenge: { puzzle: p } });
    }
  }

  private exportPgn(): void {
    const pgn = state.archive[0]?.pgn ?? toPGN(controller.game);
    void navigator.clipboard?.writeText(pgn).then(
      () => { this.drawNote = 'PGN copied to clipboard.'; this.render(); },
      () => { this.drawNote = pgn.slice(0, 60) + '…'; this.render(); },
    );
  }

  private pvpDrawDialog(): HTMLElement | null {
    const g = controller.game;
    if (controller.mode !== 'pvp' || g.drawOffer === null || g.status !== 'active') return null;
    const offerer = g.drawOffer === WHITE ? 'White' : 'Black';
    return el('div', { class: 'dialog-backdrop', style: 'z-index:55' },
      el('div', { class: 'dialog' },
        el('div', { class: 'dialog-title' }, 'Draw offer'),
        el('div', { class: 'dialog-body' }, `${offerer} offers a draw. Does ${g.drawOffer === WHITE ? 'Black' : 'White'} accept?`),
        el('div', { class: 'dialog-actions' },
          el('button', { class: 'btn btn-secondary', onclick: () => controller.declineDraw() }, 'Decline'),
          el('button', { class: 'btn btn-primary', onclick: () => controller.acceptDraw() }, 'Accept'),
        ),
      ),
    );
  }
}
