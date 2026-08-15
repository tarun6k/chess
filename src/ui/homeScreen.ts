// Home: continue game, new game setup, daily challenge, stats snapshot.
// Extends the design's visual language (header + cards + segmented controls).

import { el, clear, LABEL_STYLE, CARD_STYLE, segStyle, segWrap } from './dom';
import { controller } from '../app/controller';
import { state, persist } from '../app/store';
import { navigate, Screen } from './router';
import { TIME_PRESETS, customTimeControl, TimeControl, formatClock } from '../app/clock';
import { WHITE, BLACK, Color } from '../engine/types';
import { dailyPuzzle, isDailyDone, levelForXp } from '../app/progression';
import { classifyStyle } from '../ai/playerModel';
import { DifficultyMode } from '../ai/adaptation';
import { fromPGN } from '../engine/pgn';

export class HomeScreen implements Screen {
  root = el('div');
  private mode: 'ai' | 'pvp' = 'ai';
  private color: Color = WHITE;
  private difficulty: DifficultyMode = state.difficulty;
  private timer: 'off' | number | 'custom' = 'off'; // preset index
  private customBase = 10;
  private customInc = 5;

  mount(): void { this.render(); }

  render(): void {
    clear(this.root);
    const container = el('div', {
      style: 'min-height:100vh; font-family:var(--font-body); color:var(--color-text); display:flex; flex-direction:column; align-items:center; padding:clamp(20px,4vw,36px) 12px 96px',
    });

    container.append(
      el('header', { style: 'text-align:center' },
        el('div', { style: 'font-family:var(--font-heading); font-weight:400; font-size:44px; letter-spacing:0.02em; line-height:1.1' }, 'Chess'),
        el('div', { style: 'width:64px; height:1px; background:var(--color-divider); margin:10px auto' }),
        el('div', { style: 'font-size:13px; letter-spacing:0.14em; text-transform:uppercase; color:var(--color-neutral-600)' },
          'An opponent that learns you'),
      ),
    );

    const col = el('div', { style: 'width:min(420px, calc(100vw - 24px)); display:flex; flex-direction:column; gap:20px; margin-top:clamp(16px,3vw,28px)' });

    // Continue
    if (state.saved && state.saved.uciMoves.length > 0) {
      const s = state.saved;
      col.append(el('div', { style: CARD_STYLE },
        el('div', { style: LABEL_STYLE }, 'Continue'),
        el('div', { class: 'card-title' },
          s.mode === 'pvp' ? 'Pass-and-play game' : `Game vs AI (${s.aiElo})`),
        el('div', { style: 'font-size:13px; opacity:0.8' },
          `${Math.ceil(s.uciMoves.length / 2)} move${s.uciMoves.length > 2 ? 's' : ''} played` +
          (s.timeControl && s.clockRemaining ? ` · ${formatClock(s.clockRemaining[0])} — ${formatClock(s.clockRemaining[1])}` : '')),
        el('button', {
          class: 'btn btn-primary', style: 'align-self:flex-start; min-height:44px',
          onclick: () => { if (controller.resume(state.saved!)) navigate('play'); },
        }, 'Resume'),
      ));
    }

    // New game
    const row = (label: string, control: HTMLElement) =>
      el('div', { style: 'display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap' },
        el('span', { style: LABEL_STYLE }, label), control);

    const newGame = el('div', { style: CARD_STYLE },
      el('div', { style: LABEL_STYLE }, 'New game'),
      row('Mode', segWrap(
        el('button', { style: segStyle(this.mode === 'ai'), onclick: () => { this.mode = 'ai'; this.render(); } }, 'vs AI'),
        el('button', { style: segStyle(this.mode === 'pvp'), onclick: () => { this.mode = 'pvp'; this.render(); } }, '2 players'),
      )),
    );
    if (this.mode === 'ai') {
      newGame.append(
        row('Your side', segWrap(
          el('button', { style: segStyle(this.color === WHITE), onclick: () => { this.color = WHITE; this.render(); } }, 'White'),
          el('button', { style: segStyle(this.color === BLACK), onclick: () => { this.color = BLACK; this.render(); } }, 'Black'),
        )),
        row('AI level', segWrap(
          el('button', { style: segStyle(this.difficulty === 'learn'), onclick: () => { this.difficulty = 'learn'; this.render(); } }, 'Learn'),
          el('button', { style: segStyle(this.difficulty === 'match'), onclick: () => { this.difficulty = 'match'; this.render(); } }, 'Match'),
          el('button', { style: segStyle(this.difficulty === 'challenge'), onclick: () => { this.difficulty = 'challenge'; this.render(); } }, 'Push me'),
        )),
      );
    }
    // time control
    const tcRow = el('div', { style: 'display:flex; flex-wrap:wrap; gap:6px' });
    const tcTag = (label: string, active: boolean, onclick: () => void) =>
      el('button', { class: 'tag ' + (active ? 'tag-accent' : 'tag-neutral'), style: 'cursor:pointer; border:none; min-height:28px', onclick }, label);
    tcRow.append(tcTag('Untimed', this.timer === 'off', () => { this.timer = 'off'; this.render(); }));
    TIME_PRESETS.forEach((tc, i) => tcRow.append(tcTag(tc.name, this.timer === i, () => { this.timer = i; this.render(); })));
    tcRow.append(tcTag('Custom', this.timer === 'custom', () => { this.timer = 'custom'; this.render(); }));
    newGame.append(row('Timer', el('span')), tcRow);
    if (this.timer === 'custom') {
      newGame.append(el('div', { style: 'display:flex; gap:10px; align-items:center' },
        el('label', { style: 'font-size:12px; color:var(--color-neutral-600); flex:1' }, 'Minutes',
          el('input', {
            class: 'input', type: 'number', min: 1, max: 120, value: this.customBase,
            onchange: (e: Event) => { this.customBase = Number((e.target as HTMLInputElement).value); },
          })),
        el('label', { style: 'font-size:12px; color:var(--color-neutral-600); flex:1' }, 'Increment (s)',
          el('input', {
            class: 'input', type: 'number', min: 0, max: 60, value: this.customInc,
            onchange: (e: Event) => { this.customInc = Number((e.target as HTMLInputElement).value); },
          })),
      ));
    }
    newGame.append(el('button', {
      class: 'btn btn-primary btn-block', style: 'min-height:44px',
      onclick: () => this.startGame(),
    }, 'Start game'));
    col.append(newGame);

    // Daily challenge
    const daily = dailyPuzzle();
    const done = isDailyDone(state.progress);
    col.append(el('div', { style: CARD_STYLE },
      el('div', { style: 'display:flex; justify-content:space-between; align-items:baseline' },
        el('span', { style: LABEL_STYLE }, 'Daily challenge'),
        el('span', { class: 'tag ' + (state.progress.dailyStreak > 0 ? 'tag-accent' : 'tag-neutral') },
          `${state.progress.dailyStreak} day streak`),
      ),
      el('div', { class: 'card-title' }, daily.title),
      el('div', { style: 'font-size:13px; opacity:0.8' }, daily.prompt + ` · +${daily.xp} XP`),
      done
        ? el('span', { class: 'tag tag-accent', style: 'align-self:flex-start' }, 'Solved today ✓')
        : el('button', {
            class: 'btn btn-primary', style: 'align-self:flex-start; min-height:44px',
            onclick: () => {
              controller.newGame({ mode: 'puzzle', challenge: { puzzle: daily, isDaily: true } });
              navigate('play');
            },
          }, done ? 'Replay' : 'Solve it'),
    ));

    // Stats snapshot
    const m = state.model;
    const lv = levelForXp(state.progress.xp);
    const style = classifyStyle(m.features);
    col.append(el('div', { style: CARD_STYLE, onclick: () => navigate('stats'), role: 'button' },
      el('div', { style: LABEL_STYLE }, 'Your progress'),
      el('div', { style: 'display:flex; justify-content:space-between; font-size:14px' },
        el('span', {}, `Rating ${m.rating}`),
        el('span', {}, `Level ${lv.level}`),
        el('span', {}, `${m.wins}W ${m.losses}L ${m.draws}D`),
      ),
      el('div', { style: 'font-size:13px; opacity:0.8' },
        m.features.games >= 2 ? `The AI reads your style as ${style.label}.` : 'Play a few games so the AI can learn your style.'),
    ));

    // PGN import
    col.append(el('div', { style: CARD_STYLE },
      el('div', { style: LABEL_STYLE }, 'Import game'),
      el('textarea', { class: 'input', id: 'pgn-import', placeholder: 'Paste PGN here…', style: 'min-height:60px' }),
      el('button', {
        class: 'btn btn-secondary', style: 'align-self:flex-start',
        onclick: () => this.importPgn(),
      }, 'Load PGN'),
      el('div', { id: 'pgn-import-note', style: 'font-size:12px; color:var(--color-neutral-500)' }),
    ));

    container.append(col);
    this.root.append(container);
  }

  private startGame(): void {
    let tc: TimeControl | null = null;
    if (typeof this.timer === 'number') tc = TIME_PRESETS[this.timer];
    else if (this.timer === 'custom') tc = customTimeControl(this.customBase, this.customInc);
    state.difficulty = this.difficulty;
    void persist.difficulty();
    controller.newGame({
      mode: this.mode,
      playerColor: this.color,
      difficulty: this.difficulty,
      timeControl: tc,
    });
    navigate('play');
  }

  private importPgn(): void {
    const ta = this.root.querySelector('#pgn-import') as HTMLTextAreaElement;
    const note = this.root.querySelector('#pgn-import-note') as HTMLElement;
    try {
      const { game } = fromPGN(ta.value);
      state.archive.unshift({
        pgn: ta.value, mode: 'pvp', playerColor: 'w',
        result: game.result?.message ?? 'Imported game', score: game.result?.score ?? '*',
        aiElo: null, date: Date.now(), analysis: null, adaptationNotes: [],
        startFen: game.startFen, uciMoves: game.uciLine(),
      });
      void persist.archive();
      note.textContent = `Imported ${game.history.length} moves — see Insights → Recent games.`;
    } catch (e) {
      note.textContent = 'Could not read that PGN: ' + (e as Error).message;
    }
  }
}
