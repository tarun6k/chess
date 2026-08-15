// GameController: one live game — rules, clocks, AI, challenges, autosave.

import { Game } from '../engine/game';
import { Position, START_FEN } from '../engine/position';
import {
  Move, Color, WHITE, BLACK, moveFrom, moveTo, movePromo, moveFlags, makeMove,
  moveToUci, typeOf, colorOf, QUEEN, KNIGHT, EMPTY, FLAG_EP, PIECE_CHARS,
} from '../engine/types';
import { ChessClock, TimeControl } from './clock';
import { state, persist, SavedGame, GameMode, ArchivedGame, recordMistakes, RecordedMistake } from './store';
import { requestAiMove, requestHint, requestAnalysis } from './aiClient';
import { planForGame, pickBookMove, AdaptationPlan, DifficultyMode } from '../ai/adaptation';
import { personaForSkill, skillToElo, eloToSkill } from '../ai/persona';
import { updateModelAfterGame, extractWeaknesses, WeaknessKey } from '../ai/playerModel';
import { refreshBadges, completeDaily, isDailyDone, dailyPuzzle } from './progression';
import { PUZZLES, Puzzle, DRILLS, Drill, CONSTRAINTS, ConstraintGame } from './puzzles';
import { sound, haptic } from './feedback';
import { toPGN } from '../engine/pgn';
import { AnalyzedMove } from '../ai/protocol';

export interface ChallengeContext {
  puzzle?: Puzzle;
  drill?: Drill;
  constraint?: ConstraintGame;
  isDaily?: boolean;
  /** personalized mistake-replay */
  mistake?: RecordedMistake;
}

export interface NewGameOptions {
  mode: GameMode;
  playerColor?: Color;            // for vs-AI modes
  difficulty?: DifficultyMode;
  timeControl?: TimeControl | null;
  challenge?: ChallengeContext;
  startFen?: string;
}

export type PuzzleState = 'solving' | 'wrong' | 'solved' | null;

export class GameController {
  game: Game = new Game();
  mode: GameMode = 'ai';
  playerColor: Color = WHITE;
  difficulty: DifficultyMode = 'match';
  clock: ChessClock | null = null;
  timeControl: TimeControl | null = null;
  timerOn = false;
  plan: AdaptationPlan | null = null;
  aiSkill = 8;
  aiElo = skillToElo(8);
  hintsLeft = 3;
  hintMove: Move | null = null;
  thinking = false;
  challenge: ChallengeContext | null = null;
  puzzleState: PuzzleState = null;
  puzzleMovesLeft = 0;            // plies the player has to mate (mate-in-N)
  gameOverHandled = false;
  postGame: { notes: string[]; offersReady: boolean } | null = null;
  analysis: AnalyzedMove[] | null = null;
  analysisPending = false;
  lastMoveAt = Date.now();
  private listeners = new Set<() => void>();
  private moveSeq = 0;            // guards stale async AI replies
  /** increments whenever a different game is loaded — UI uses it to reset local state */
  gameId = 0;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void { for (const fn of this.listeners) fn(); }

  // ── game setup ────────────────────────────────────────────────────────────

  newGame(opts: NewGameOptions): void {
    this.moveSeq++;
    this.gameId++;
    this.clock?.dispose();
    this.mode = opts.mode;
    this.playerColor = opts.playerColor ?? WHITE;
    this.difficulty = opts.difficulty ?? state.difficulty;
    this.challenge = opts.challenge ?? null;
    this.timeControl = opts.timeControl ?? null;
    this.timerOn = !!opts.timeControl;
    this.hintsLeft = this.isChallengeGame() ? 0 : 3;
    this.hintMove = null;
    this.thinking = false;
    this.puzzleState = null;
    this.gameOverHandled = false;
    this.postGame = null;
    this.analysis = null;
    this.lastMoveAt = Date.now();

    let fen = opts.startFen ?? START_FEN;
    if (this.challenge?.puzzle) {
      fen = this.challenge.puzzle.fen;
      this.playerColor = new Position(fen).turn;
      this.puzzleState = 'solving';
      const kind = this.challenge.puzzle.kind;
      this.puzzleMovesLeft = kind === 'mate1' ? 1 : kind === 'mate2' ? 2 : kind === 'mate3' ? 3 : 1;
    } else if (this.challenge?.mistake) {
      fen = this.challenge.mistake.fen;
      this.playerColor = new Position(fen).turn;
      this.puzzleState = 'solving';
      this.puzzleMovesLeft = 1;
    } else if (this.challenge?.drill) {
      fen = this.challenge.drill.fen;
      this.playerColor = this.challenge.drill.playerColor === 'w' ? WHITE : BLACK;
    } else if (this.challenge?.constraint?.fen) {
      fen = this.challenge.constraint.fen;
    }

    this.game = new Game(fen);

    // Adaptation plan for AI opponents
    if (this.isVsAi()) {
      this.plan = planForGame(state.model, this.difficulty, (this.playerColor ^ 1) as Color);
      this.aiSkill = this.plan.skill;
      this.aiElo = this.plan.aiElo;
      if (this.challenge?.drill || this.challenge?.puzzle || this.challenge?.mistake) {
        this.aiSkill = 20; // challenges: the AI defends/replies at full strength
      }
    } else {
      this.plan = null;
    }

    if (this.timeControl) {
      this.clock = new ChessClock(this.timeControl);
      this.wireClock();
    } else {
      this.clock = null;
    }

    this.save();
    this.emit();
    this.maybeTriggerAi();
  }

  resume(saved: SavedGame): boolean {
    try {
      this.moveSeq++;
      this.gameId++;
      this.clock?.dispose();
      this.game = new Game(saved.startFen);
      for (const uci of saved.uciMoves) {
        const m = this.uciToMove(uci);
        if (m === null) return false;
        this.game.play(m);
      }
      this.mode = saved.mode;
      this.playerColor = saved.playerColor === 'w' ? WHITE : BLACK;
      this.difficulty = saved.difficulty;
      this.timeControl = saved.timeControl;
      this.timerOn = saved.timerOn;
      this.hintsLeft = saved.hintsLeft;
      this.aiSkill = saved.aiSkill;
      this.aiElo = saved.aiElo;
      this.challenge = saved.challengeId ? this.challengeById(saved.challengeId) : null;
      this.puzzleState = this.challenge?.puzzle || this.challenge?.mistake ? 'solving' : null;
      this.plan = this.isVsAi() ? planForGame(state.model, this.difficulty, (this.playerColor ^ 1) as Color) : null;
      if (this.plan && saved.adaptationNotes.length) this.plan.notes = saved.adaptationNotes;
      this.thinking = false;
      this.gameOverHandled = false;
      this.postGame = null;
      this.analysis = null;
      if (saved.timeControl && saved.clockRemaining) {
        this.clock = new ChessClock(saved.timeControl);
        this.clock.remaining = [saved.clockRemaining[0], saved.clockRemaining[1]];
        this.wireClock();
        if (this.game.status === 'active' && this.game.history.length > 0) {
          this.clock.start(this.game.turn);
        }
      } else {
        this.clock = null;
      }
      this.lastMoveAt = Date.now();
      this.emit();
      this.maybeTriggerAi();
      return true;
    } catch {
      return false;
    }
  }

  private challengeById(id: string): ChallengeContext | null {
    const puzzle = PUZZLES.find(p => p.id === id);
    if (puzzle) return { puzzle };
    const drill = DRILLS.find(d => d.id === id);
    if (drill) return { drill };
    const constraint = CONSTRAINTS.find(c => c.id === id);
    if (constraint) return { constraint };
    return null;
  }

  isVsAi(): boolean { return this.mode !== 'pvp'; }
  isChallengeGame(): boolean { return !!(this.challenge?.puzzle || this.challenge?.drill || this.challenge?.constraint || this.challenge?.mistake); }

  takebacksAllowed(): boolean {
    return state.settings.takebacks && !this.isChallengeGame() && !this.timerOn && this.game.history.length > 0;
  }

  // ── clocks ────────────────────────────────────────────────────────────────

  private wireClock(): void {
    if (!this.clock) return;
    this.clock.onTick = () => this.emit();
    this.clock.onLowTime = (c) => {
      if (c === this.playerColor || this.mode === 'pvp') { sound.lowTime(); void haptic.warning(); }
      this.emit();
    };
    this.clock.onFlag = (c) => {
      this.game.timeout(c);
      this.onGameEnd();
      this.emit();
    };
  }

  setTimerOn(on: boolean): void {
    // Only meaningful before the game starts or for display; a running timed
    // game cannot be un-timed (that would be cheating the challenge).
    if (this.game.history.length === 0) {
      this.timerOn = on;
      if (!on) { this.clock?.dispose(); this.clock = null; this.timeControl = null; }
      this.save();
    }
    this.emit();
  }

  // ── moves ─────────────────────────────────────────────────────────────────

  uciToMove(uci: string): Move | null {
    for (const m of this.game.pos.generateLegal()) if (moveToUci(m) === uci) return m;
    return null;
  }

  /** Is it the human's turn (for input gating)? */
  humanTurn(): boolean {
    if (this.game.status !== 'active') return false;
    if (this.mode === 'pvp') return true;
    return this.game.turn === this.playerColor;
  }

  legalTargetsFrom(sq: number): Move[] {
    return this.game.pos.legalMovesFrom(sq);
  }

  /** Constraint gating for the player's own rules (silent queen). */
  moveAllowedByConstraint(m: Move): boolean {
    if (this.challenge?.constraint?.kind === 'silent-queen' &&
        this.game.turn === this.playerColor &&
        typeOf(this.game.pos.board[moveFrom(m)]) === QUEEN) {
      return false;
    }
    return true;
  }

  /** Play a (already validated legal) move for whoever's turn it is. */
  playMove(m: Move): boolean {
    if (this.game.status !== 'active') return false;
    const mover = this.game.turn;
    const isCapture = this.game.pos.board[moveTo(m)] !== EMPTY || (moveFlags(m) & FLAG_EP) !== 0;
    const isEp = (moveFlags(m) & FLAG_EP) !== 0;
    const promo = movePromo(m);
    const castle = (moveFlags(m) & 12) !== 0;
    const thinkMs = Date.now() - this.lastMoveAt;

    const san = this.game.play(m, {
      thinkMs,
      clockMs: this.clock ? this.clock.remaining[mover] : undefined,
    });
    if (san === null) return false;
    this.moveSeq++;
    this.lastMoveAt = Date.now();
    this.hintMove = null;

    // feedback
    if (this.game.result?.kind === 'checkmate') { /* end sound below */ }
    else if (san.includes('+')) sound.check();
    else if (promo) sound.promote();
    else if (castle) sound.castle();
    else if (isCapture) sound.capture();
    else sound.move();
    if (isCapture) haptic.medium(); else haptic.light();

    // progression counters
    if (mover === this.playerColor || this.mode === 'pvp') {
      if (isEp) state.progress.counters.enPassants++;
      if (promo && promo !== QUEEN) state.progress.counters.underpromotions++;
    }

    // clock press
    const nowFinished = this.game.result !== null;
    if (this.clock && !nowFinished) {
      if (this.game.history.length === 1) this.clock.start(this.game.turn);
      else this.clock.press(mover);
    }

    // puzzle validation
    if (this.puzzleState === 'solving' && mover === this.playerColor) {
      this.validatePuzzleMove(m);
    }

    this.save();

    if (nowFinished) {
      this.clock?.pause();
      this.onGameEnd();
    } else {
      this.maybeTriggerAi();
    }
    this.emit();
    return true;
  }

  // ── AI ────────────────────────────────────────────────────────────────────

  private historyKeys(): string[] {
    const keys = this.game.history.map(h => h.key);
    keys.unshift(new Position(this.game.startFen).hashKey());
    return keys;
  }

  maybeTriggerAi(): void {
    if (!this.isVsAi() || this.game.status !== 'active') return;
    if (this.game.turn === this.playerColor) return;
    const seq = this.moveSeq;
    this.thinking = true;
    this.emit();

    const persona = personaForSkill(this.aiSkill, 0);
    // Move-time cap: quick at low depth; scale with clock pressure if timed.
    let moveTimeMs = 900 + persona.maxDepth * 300;
    if (this.clock) {
      const mine = this.clock.remaining[this.game.turn];
      moveTimeMs = Math.min(moveTimeMs, Math.max(150, mine / 40));
    }

    const sans = this.game.sanLine();
    const bookUci = this.plan && !this.isChallengeGame() ? this.bookMoveUci(sans) : null;

    // Humanlike pacing: don't answer instantly
    const started = Date.now();
    requestAiMove({
      fen: this.game.pos.toFen(),
      historyKeys: this.historyKeys(),
      skill: this.challenge?.drill ? 20 : this.aiSkill,
      moveTimeMs,
      params: this.plan?.params,
      bookMove: bookUci ?? undefined,
    }).then(res => {
      if (seq !== this.moveSeq || this.game.status !== 'active') return;
      const delay = Math.max(0, 450 - (Date.now() - started));
      setTimeout(() => {
        if (seq !== this.moveSeq || this.game.status !== 'active') return;
        this.thinking = false;
        const m = this.uciToMove(res.uci);
        if (m !== null) this.playMove(m);
        else this.emit();
      }, delay);
    }).catch(() => {
      if (seq !== this.moveSeq) return;
      // Failsafe: play any legal move rather than stalling the game.
      this.thinking = false;
      const legal = this.game.legalMoves();
      if (legal.length) this.playMove(legal[0]);
    });
  }

  private bookMoveUci(sans: string[]): string | null {
    if (!this.plan || this.game.startFen !== START_FEN) return null;
    const bookSan = pickBookMove(sans, this.plan);
    if (!bookSan) return null;
    const g2 = new Game(this.game.startFen);
    for (const s of sans) g2.playSAN(s);
    const before = g2.history.length;
    if (g2.playSAN(bookSan) === null) return null;
    return moveToUci(g2.history[before].move);
  }

  // ── puzzle flow ───────────────────────────────────────────────────────────

  private validatePuzzleMove(m: Move): void {
    const p = this.challenge?.puzzle;
    const uci = moveToUci(m);

    if (this.challenge?.mistake) {
      if (uci === this.challenge.mistake.bestUci) this.puzzleSolved();
      else this.puzzleWrong();
      return;
    }
    if (!p) return;

    if (p.kind === 'tactic' || p.kind === 'defense') {
      if (uci === p.solution) this.puzzleSolved();
      else this.puzzleWrong();
      return;
    }

    // mate-in-N: any move keeping the forced mate within budget is correct.
    this.puzzleMovesLeft--;
    if (this.game.result?.kind === 'checkmate') { this.puzzleSolved(); return; }
    if (this.puzzleMovesLeft <= 0) { this.puzzleWrong(); return; }
    // ask the engine whether mate is still forced (opponent to move, getting mated)
    void requestHint(this.game.pos.toFen(), this.historyKeys()).then(res => {
      // score is from the OPPONENT's POV: a forced mate against them is a big negative
      if (res.score < -(90_000)) {
        // still winning — let the AI defend and continue
      } else {
        this.puzzleWrong();
        this.emit();
      }
    });
  }

  private puzzleSolved(): void {
    this.puzzleState = 'solved';
    void haptic.success();
    sound.gameWin();
    const p = this.challenge?.puzzle;
    const id = p?.id ?? 'mistake-replay';
    if (p && !state.progress.solvedPuzzles.includes(p.id)) {
      state.progress.solvedPuzzles.push(p.id);
      state.progress.xp += p.xp;
    } else if (this.challenge?.mistake) {
      state.progress.xp += 15;
    }
    state.progress.counters.puzzlesSolved++;
    if (this.challenge?.isDaily) completeDaily(state.progress);
    refreshBadges(state.progress, state.model);
    void persist.progress();
    state.saved = null;
    void persist.saved();
    this.emit();
  }

  private puzzleWrong(): void {
    this.puzzleState = 'wrong';
    sound.error();
    void haptic.warning();
    this.emit();
  }

  retryPuzzle(): void {
    if (this.challenge?.puzzle) this.newGame({ mode: 'puzzle', challenge: this.challenge });
    else if (this.challenge?.mistake) this.newGame({ mode: 'puzzle', challenge: this.challenge });
  }

  // ── player actions ────────────────────────────────────────────────────────

  undo(): void {
    if (!this.takebacksAllowed()) return;
    this.moveSeq++;
    this.thinking = false;
    // vs AI: undo the AI's reply too, back to the player's turn
    const n = this.isVsAi() && this.game.turn === this.playerColor && this.game.history.length >= 2 ? 2 : 1;
    for (let i = 0; i < n; i++) this.game.undo();
    this.hintMove = null;
    this.save();
    this.emit();
    this.maybeTriggerAi();
  }

  resign(): void {
    if (this.game.status !== 'active') return;
    const resigner = this.mode === 'pvp' ? this.game.turn : this.playerColor;
    this.game.resign(resigner);
    this.clock?.pause();
    this.onGameEnd();
    this.emit();
  }

  offerDraw(): void {
    if (this.game.status !== 'active') return;
    const offerer = this.mode === 'pvp' ? this.game.turn : this.playerColor;
    // claimable draws happen immediately
    if (this.game.claimableDraw()) {
      this.game.claimDraw();
      this.clock?.pause();
      this.onGameEnd();
      this.emit();
      return;
    }
    this.game.offerDraw(offerer);
    if (this.isVsAi()) {
      // AI decides: accept when clearly worse or dead-drawn late game.
      const seq = this.moveSeq;
      void requestHint(this.game.pos.toFen(), this.historyKeys()).then(res => {
        if (seq !== this.moveSeq || this.game.status !== 'active') return;
        // res.score is from the side to move's POV
        const aiToMove = this.game.turn !== this.playerColor;
        const aiScore = aiToMove ? res.score : -res.score;
        const lateEven = this.game.history.length > 60 && Math.abs(aiScore) < 40;
        if (aiScore < -180 || lateEven) {
          this.game.acceptDraw();
          this.clock?.pause();
          this.onGameEnd();
        } else {
          this.game.declineDraw();
        }
        this.emit();
      });
    }
    this.emit();
  }

  acceptDraw(): void {  // pass-and-play: the other player accepts
    if (this.game.acceptDraw()) {
      this.clock?.pause();
      this.onGameEnd();
    }
    this.emit();
  }
  declineDraw(): void { this.game.declineDraw(); this.emit(); }

  async useHint(): Promise<void> {
    if (this.hintsLeft <= 0 || !this.humanTurn()) return;
    this.hintsLeft--;
    state.progress.counters.hintsUsed++;
    void persist.progress();
    const seq = this.moveSeq;
    const res = await requestHint(this.game.pos.toFen(), this.historyKeys());
    if (seq !== this.moveSeq) return;
    this.hintMove = this.uciToMove(res.uci);
    this.save();
    this.emit();
  }

  // ── endgame bookkeeping ───────────────────────────────────────────────────

  private onGameEnd(): void {
    if (this.gameOverHandled || !this.game.result) return;
    this.gameOverHandled = true;
    const result = this.game.result;
    const playerWon = result.winner === this.playerColor;
    const drew = result.winner === null;

    // end feedback
    if (this.mode === 'pvp') sound.gameDraw();
    else if (playerWon) { sound.gameWin(); void haptic.success(); }
    else if (drew) sound.gameDraw();
    else { sound.gameLoss(); void haptic.warning(); }

    // Challenge outcomes
    if (this.challenge?.drill) {
      const d = this.challenge.drill;
      const ok = d.goal === 'win' ? playerWon : (playerWon || drew);
      if (ok && !state.progress.completedDrills.includes(d.id)) {
        state.progress.completedDrills.push(d.id);
        state.progress.xp += d.xp;
      }
    }
    if (this.challenge?.constraint) {
      const c = this.challenge.constraint;
      let ok = false;
      if (c.kind === 'silent-queen') ok = playerWon;
      else if (c.kind === 'knight-mate') {
        const last = this.game.history[this.game.history.length - 1];
        ok = playerWon && result.kind === 'checkmate' && !!last && last.san.startsWith('N');
      } else if (c.kind === 'rook-odds') {
        const survived = this.game.history.length >= 40;
        ok = survived && !(result.kind === 'checkmate' && result.winner !== this.playerColor);
      }
      if (ok && !state.progress.completedConstraints.includes(c.id)) {
        state.progress.completedConstraints.push(c.id);
        state.progress.xp += c.xp;
      }
    }

    // Stats + model for real games (not puzzles)
    if (!this.challenge?.puzzle && !this.challenge?.mistake) {
      state.progress.counters.gamesPlayed++;
      if (this.mode === 'pvp' || playerWon) {
        if (playerWon) state.progress.counters.gamesWon++;
      }
      if (playerWon && result.kind === 'checkmate') state.progress.counters.checkmates++;
      if (playerWon && result.kind === 'timeout') state.progress.counters.winsOnTime++;
      const castled = this.game.history.some((h, i) => {
        const moverIsPlayer = (i % 2 === 0) === (new Position(this.game.startFen).turn === this.playerColor);
        return moverIsPlayer && (h.san === 'O-O' || h.san === 'O-O-O');
      });
      state.progress.counters.castledGames = castled ? state.progress.counters.castledGames + 1 : 0;

      if (this.isVsAi() && this.mode === 'ai') {
        // rating + model update; giant-slayer badge check
        if (playerWon && this.aiElo >= state.model.rating + 200 && !state.progress.badges.includes('giant-slayer')) {
          state.progress.badges.push('giant-slayer');
        }
        updateModelAfterGame(state.model, this.game, this.playerColor, null, { vsAi: true, aiElo: this.aiElo });
        if (this.plan) {
          state.model.lastAdaptation = this.plan.notes;
          this.postGame = { notes: this.plan.notes, offersReady: true };
        }
        state.progress.xp += playerWon ? 40 : drew ? 20 : 10;
        void persist.model();
        // background analysis → weakness profiling + mistake recording
        this.runPostGameAnalysis();
      }
      refreshBadges(state.progress, state.model);
      void persist.progress();
      this.archiveGame();
    }

    state.saved = null;
    void persist.saved();
  }

  private runPostGameAnalysis(): void {
    if (this.analysisPending || this.game.history.length < 4) return;
    this.analysisPending = true;
    const startFen = this.game.startFen;
    const uciMoves = this.game.uciLine();
    const gameRef = this.game;
    const playerColor = this.playerColor;
    requestAnalysis(startFen, uciMoves, 250).then(res => {
      this.analysisPending = false;
      this.analysis = res.moves;
      // fold weaknesses + accuracy into the model (the game itself was already
      // tallied in onGameEnd — here we only add what analysis reveals)
      const weak = extractWeaknesses(gameRef, playerColor, res.moves);
      for (const [k, v] of Object.entries(weak)) {
        state.model.weaknesses[k as WeaknessKey] += v as number;
      }
      const startTurn = new Position(startFen).turn;
      const playerMoves = res.moves.filter((_, ply) => ((ply % 2 === 0 ? startTurn : startTurn ^ 1) === playerColor));
      if (playerMoves.length) {
        const cpLoss = playerMoves.reduce((s, a) => s + a.cpLoss, 0) / playerMoves.length;
        const f = state.model.features;
        f.avgCpLoss = f.avgCpLoss ? f.avgCpLoss * 0.8 + cpLoss * 0.2 : cpLoss;
      }
      void persist.model();
      // record big mistakes for personalized challenges
      const mistakes: RecordedMistake[] = [];
      const pos = new Position(startFen);
      res.moves.forEach((a, ply) => {
        if (pos.turn === playerColor && a.cpLoss >= 200 && a.bestUci !== a.uci) {
          mistakes.push({
            fen: pos.toFen(), playedUci: a.uci, bestUci: a.bestUci,
            cpLoss: a.cpLoss, date: Date.now(), playerColor: playerColor === WHITE ? 'w' : 'b',
          });
        }
        const m = gameRef.history[ply];
        if (m) pos.makeMove(m.move);
      });
      if (mistakes.length) recordMistakes(mistakes.slice(0, 5));
      // attach analysis to the newest archive entry
      if (state.archive[0] && state.archive[0].uciMoves.join(' ') === uciMoves.join(' ')) {
        state.archive[0].analysis = res.moves;
        void persist.archive();
      }
      this.emit();
    }).catch(() => { this.analysisPending = false; });
  }

  private archiveGame(): void {
    const now = new Date();
    const entry: ArchivedGame = {
      pgn: toPGN(this.game, {
        White: this.mode === 'pvp' ? 'White' : this.playerColor === WHITE ? 'You' : `AI (${this.aiElo})`,
        Black: this.mode === 'pvp' ? 'Black' : this.playerColor === BLACK ? 'You' : `AI (${this.aiElo})`,
        Date: `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`,
      }),
      mode: this.mode,
      playerColor: this.playerColor === WHITE ? 'w' : 'b',
      result: this.game.result?.message ?? '',
      score: this.game.result?.score ?? '*',
      aiElo: this.isVsAi() ? this.aiElo : null,
      date: Date.now(),
      analysis: null,
      adaptationNotes: this.plan?.notes ?? [],
      startFen: this.game.startFen,
      uciMoves: this.game.uciLine(),
    };
    state.archive.unshift(entry);
    if (state.archive.length > 100) state.archive.length = 100;
    void persist.archive();
  }

  // ── persistence ───────────────────────────────────────────────────────────

  save(): void {
    if (this.game.status === 'finished' || this.puzzleState === 'solved') {
      state.saved = null;
    } else {
      state.saved = {
        mode: this.mode,
        startFen: this.game.startFen,
        uciMoves: this.game.uciLine(),
        thinkMs: this.game.history.map(h => h.thinkMs ?? 0),
        playerColor: this.playerColor === WHITE ? 'w' : 'b',
        difficulty: this.difficulty,
        timeControl: this.timeControl,
        clockRemaining: this.clock ? [this.clock.remaining[0], this.clock.remaining[1]] : null,
        timerOn: this.timerOn,
        hintsLeft: this.hintsLeft,
        challengeId: this.challenge?.puzzle?.id ?? this.challenge?.drill?.id ?? this.challenge?.constraint?.id ?? null,
        adaptationNotes: this.plan?.notes ?? [],
        aiSkill: this.aiSkill,
        aiElo: this.aiElo,
        savedAt: Date.now(),
      };
    }
    void persist.saved();
  }
}

export const controller = new GameController();
