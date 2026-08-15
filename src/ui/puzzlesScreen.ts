// Puzzles, drills, constraint games, and personalized mistake-replays.

import { el, clear, LABEL_STYLE, CARD_STYLE } from './dom';
import { state } from '../app/store';
import { controller } from '../app/controller';
import { navigate, Screen } from './router';
import { PUZZLES, DRILLS, CONSTRAINTS, Puzzle } from '../app/puzzles';
import { dailyPuzzle, isDailyDone } from '../app/progression';

export class PuzzlesScreen implements Screen {
  root = el('div');

  mount(): void { this.render(); }

  private startPuzzle(p: Puzzle, isDaily = false): void {
    controller.newGame({ mode: 'puzzle', challenge: { puzzle: p, isDaily } });
    navigate('play');
  }

  render(): void {
    clear(this.root);
    const container = el('div', {
      style: 'min-height:100vh; font-family:var(--font-body); color:var(--color-text); display:flex; flex-direction:column; align-items:center; padding:clamp(20px,4vw,36px) 12px 96px',
    });
    container.append(
      el('header', { style: 'text-align:center' },
        el('div', { style: 'font-family:var(--font-heading); font-weight:400; font-size:36px' }, 'Challenges'),
        el('div', { style: 'width:64px; height:1px; background:var(--color-divider); margin:10px auto' }),
        el('div', { style: 'font-size:13px; letter-spacing:0.14em; text-transform:uppercase; color:var(--color-neutral-600)' },
          `${state.progress.counters.puzzlesSolved} solved · ${state.progress.xp} XP`),
      ),
    );
    const col = el('div', { style: 'width:min(420px, calc(100vw - 24px)); display:flex; flex-direction:column; gap:20px; margin-top:clamp(16px,3vw,28px)' });

    // Daily
    const daily = dailyPuzzle();
    col.append(this.section('Daily challenge',
      this.puzzleCard(daily, isDailyDone(state.progress) ? 'Solved today ✓' : `+${daily.xp} XP · streak ${state.progress.dailyStreak}`, true)));

    // Personalized
    if (state.mistakes.length) {
      const cards = state.mistakes.slice(0, 5).map((mk, i) => {
        const when = new Date(mk.date);
        const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        return el('div', { class: 'card', style: 'cursor:pointer', onclick: () => {
          controller.newGame({ mode: 'puzzle', challenge: { mistake: mk } });
          navigate('play');
        } },
          el('div', { class: 'card-kicker' }, 'From your games'),
          el('div', { class: 'card-title', style: 'font-size:15px' }, `You missed this on ${days[when.getDay()]}`),
          el('div', { style: 'font-size:12.5px; opacity:0.8' },
            `You lost ${(mk.cpLoss / 100).toFixed(1)} pawns of advantage here — find the better move. Untimed · +15 XP`),
        );
      });
      col.append(this.section('Made for you', ...cards));
    }

    // Curated puzzles by tier
    for (const tier of [1, 2, 3] as const) {
      const list = PUZZLES.filter(p => p.tier === tier);
      if (!list.length) continue;
      const tierName = tier === 1 ? 'Warm-up' : tier === 2 ? 'Sharpen' : 'Master';
      col.append(this.section(`Puzzles · ${tierName}`, ...list.map(p =>
        this.puzzleCard(p, state.progress.solvedPuzzles.includes(p.id) ? 'Solved ✓' : `+${p.xp} XP`))));
    }

    // Endgame drills
    col.append(this.section('Endgame drills', ...DRILLS.map(d =>
      el('div', { class: 'card', style: 'cursor:pointer', onclick: () => {
        controller.newGame({ mode: 'drill', challenge: { drill: d } });
        navigate('play');
      } },
        el('div', { style: 'display:flex; justify-content:space-between; align-items:baseline' },
          el('div', { class: 'card-title', style: 'font-size:15px' }, d.title),
          el('span', { class: 'tag ' + (state.progress.completedDrills.includes(d.id) ? 'tag-accent' : 'tag-neutral') },
            state.progress.completedDrills.includes(d.id) ? 'Done ✓' : `Goal: ${d.goal}`),
        ),
        el('div', { style: 'font-size:12.5px; opacity:0.8' }, `${d.description} Untimed · +${d.xp} XP`),
      ))));

    // Constraint games
    col.append(this.section('Constraint games', ...CONSTRAINTS.map(c =>
      el('div', { class: 'card', style: 'cursor:pointer', onclick: () => {
        controller.newGame({ mode: 'constraint', challenge: { constraint: c } });
        navigate('play');
      } },
        el('div', { style: 'display:flex; justify-content:space-between; align-items:baseline' },
          el('div', { class: 'card-title', style: 'font-size:15px' }, c.title),
          el('span', { class: 'tag ' + (state.progress.completedConstraints.includes(c.id) ? 'tag-accent' : 'tag-outline') },
            state.progress.completedConstraints.includes(c.id) ? 'Done ✓' : 'vs AI'),
        ),
        el('div', { style: 'font-size:12.5px; opacity:0.8' }, `${c.description} Win condition declared up front · +${c.xp} XP`),
      ))));

    container.append(col);
    this.root.append(container);
  }

  private puzzleCard(p: Puzzle, status: string, isDaily = false): HTMLElement {
    const kindLabel = p.kind === 'mate1' ? 'Mate in 1' : p.kind === 'mate2' ? 'Mate in 2'
      : p.kind === 'mate3' ? 'Mate in 3' : p.kind === 'tactic' ? 'Win material' : 'Defense';
    return el('div', { class: 'card', style: 'cursor:pointer', onclick: () => this.startPuzzle(p, isDaily) },
      el('div', { style: 'display:flex; justify-content:space-between; align-items:baseline' },
        el('div', { class: 'card-title', style: 'font-size:15px' }, p.title),
        el('span', { class: 'tag tag-neutral' }, kindLabel),
      ),
      el('div', { style: 'font-size:12.5px; opacity:0.8' }, `${p.prompt} Untimed · ${status}`),
    );
  }

  private section(title: string, ...cards: HTMLElement[]): HTMLElement {
    return el('div', { style: 'display:flex; flex-direction:column; gap:10px' },
      el('div', { style: LABEL_STYLE }, title),
      ...cards,
    );
  }
}
