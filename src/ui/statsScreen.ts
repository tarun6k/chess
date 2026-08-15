// Insights: rating graph, W/L/D, style profile, weaknesses, openings, badges.

import { el, clear, LABEL_STYLE, CARD_STYLE } from './dom';
import { state } from '../app/store';
import { Screen } from './router';
import { classifyStyle, topWeaknesses } from '../ai/playerModel';
import { BADGES, levelForXp } from '../app/progression';
import { skillToElo } from '../ai/persona';

const WEAKNESS_LABEL: Record<string, string> = {
  'hanging-pieces': 'Leaving pieces undefended',
  'missed-tactics': 'Missing tactical shots',
  'back-rank': 'Back-rank vulnerability',
  endgame: 'Endgame technique',
  opening: 'Opening mistakes',
  'king-safety': 'King safety',
};

export class StatsScreen implements Screen {
  root = el('div');

  mount(): void { this.render(); }

  render(): void {
    clear(this.root);
    const m = state.model;
    const p = state.progress;
    const lv = levelForXp(p.xp);
    const style = classifyStyle(m.features);

    const container = el('div', {
      style: 'min-height:100vh; font-family:var(--font-body); color:var(--color-text); display:flex; flex-direction:column; align-items:center; padding:clamp(20px,4vw,36px) 12px 96px',
    });
    container.append(
      el('header', { style: 'text-align:center' },
        el('div', { style: 'font-family:var(--font-heading); font-weight:400; font-size:36px' }, 'Insights'),
        el('div', { style: 'width:64px; height:1px; background:var(--color-divider); margin:10px auto' }),
        el('div', { style: 'font-size:13px; letter-spacing:0.14em; text-transform:uppercase; color:var(--color-neutral-600)' },
          `Rating ${m.rating} · Level ${lv.level}`),
      ),
    );
    const col = el('div', { style: 'width:min(420px, calc(100vw - 24px)); display:flex; flex-direction:column; gap:20px; margin-top:clamp(16px,3vw,28px)' });

    // Rating graph
    col.append(el('div', { style: CARD_STYLE },
      el('div', { style: 'display:flex; justify-content:space-between; align-items:baseline' },
        el('span', { style: LABEL_STYLE }, 'Rating'),
        el('span', { style: "font-size:22px; font-feature-settings:'tnum'" }, String(m.rating)),
      ),
      this.ratingGraph(),
      el('div', { style: 'display:flex; justify-content:space-between; font-size:13px; color:var(--color-neutral-600)' },
        el('span', {}, `${m.wins} wins`), el('span', {}, `${m.losses} losses`), el('span', {}, `${m.draws} draws`),
        el('span', {}, m.streak > 0 ? `↑ ${m.streak} streak` : m.streak < 0 ? `↓ ${-m.streak} streak` : '—'),
      ),
    ));

    // XP / level
    col.append(el('div', { style: CARD_STYLE },
      el('div', { style: 'display:flex; justify-content:space-between; align-items:baseline' },
        el('span', { style: LABEL_STYLE }, `Level ${lv.level}`),
        el('span', { style: 'font-size:12px; color:var(--color-neutral-500)' }, `${lv.into} / ${lv.needed} XP`),
      ),
      el('div', { style: 'height:8px; border:1px solid var(--color-divider); border-radius:4px; overflow:hidden' },
        el('div', { style: `width:${Math.round(100 * lv.into / lv.needed)}%; height:100%; background:var(--color-accent-400)` })),
    ));

    // Style profile
    const featureRow = (label: string, value: string) =>
      el('div', { style: 'display:flex; justify-content:space-between; font-size:13.5px; padding:3px 0; border-bottom:1px solid var(--color-neutral-200)' },
        el('span', { style: 'color:var(--color-neutral-600)' }, label), el('span', {}, value));
    col.append(el('div', { style: CARD_STYLE },
      el('div', { style: LABEL_STYLE }, 'How the AI reads you'),
      el('div', { class: 'card-title', style: 'text-transform:capitalize' },
        m.features.games >= 2 ? `${style.label} player` : 'Still learning you…'),
      featureRow('Games analyzed', String(m.features.games)),
      featureRow('Capture rate', (m.features.avgCaptureRate * 100).toFixed(0) + '% of moves'),
      featureRow('Queen out by', m.features.avgEarlyQueenPly >= 23 ? 'late' : 'move ' + Math.round(m.features.avgEarlyQueenPly / 2 + 1)),
      featureRow('Castles by', m.features.avgCastlePly >= 29 ? 'rarely castles' : 'move ' + Math.round(m.features.avgCastlePly / 2 + 1)),
      featureRow('Accuracy', m.features.avgCpLoss ? `${m.features.avgCpLoss.toFixed(0)} cp lost/move` : '—'),
      m.lastAdaptation?.length
        ? el('div', { style: 'margin-top:6px; display:flex; flex-direction:column; gap:5px' },
            el('div', { style: LABEL_STYLE }, 'Last game adaptation'),
            ...m.lastAdaptation.map(n => el('div', { style: 'font-size:12.5px; opacity:0.85; border-left:2px solid var(--color-accent-300); padding-left:10px' }, n)))
        : null,
    ));

    // Weaknesses
    const weak = topWeaknesses(m, 6);
    col.append(el('div', { style: CARD_STYLE },
      el('div', { style: LABEL_STYLE }, 'Working on'),
      weak.length
        ? el('div', { style: 'display:flex; flex-direction:column; gap:6px' },
            ...weak.map(w => el('div', { style: 'display:flex; justify-content:space-between; font-size:13.5px' },
              el('span', {}, WEAKNESS_LABEL[w.key] ?? w.key),
              el('span', { class: 'tag tag-accent-2' }, `× ${w.count}`))))
        : el('div', { style: 'font-size:13px; font-style:italic; color:var(--color-neutral-500)' },
            'No recurring weaknesses spotted yet.'),
    ));

    // Openings
    col.append(el('div', { style: CARD_STYLE },
      el('div', { style: LABEL_STYLE }, 'Your openings'),
      m.openings.length
        ? el('table', { class: 'table' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Opening'), el('th', {}, 'Games'), el('th', {}, 'Wins'))),
            el('tbody', {}, ...m.openings.slice(0, 6).map(o =>
              el('tr', {}, el('td', {}, o.name), el('td', {}, String(o.count)), el('td', {}, String(o.wins))))),
          )
        : el('div', { style: 'font-size:13px; font-style:italic; color:var(--color-neutral-500)' },
            'Play book openings and they will show up here.'),
    ));

    // Badges
    col.append(el('div', { style: CARD_STYLE },
      el('div', { style: LABEL_STYLE }, `Badges · ${p.badges.length}/${BADGES.length}`),
      el('div', { style: 'display:flex; flex-wrap:wrap; gap:6px' },
        ...BADGES.map(b => el('span', {
          class: 'tag ' + (p.badges.includes(b.id) ? 'tag-accent' : 'tag-neutral'),
          style: p.badges.includes(b.id) ? '' : 'opacity:0.55',
          title: b.description,
        }, b.title))),
    ));

    // Recent games
    if (state.archive.length) {
      col.append(el('div', { style: CARD_STYLE },
        el('div', { style: LABEL_STYLE }, 'Recent games'),
        ...state.archive.slice(0, 8).map(a => el('div', {
          style: 'display:flex; justify-content:space-between; gap:8px; font-size:13px; padding:4px 0; border-bottom:1px solid var(--color-neutral-200)',
        },
          el('span', { style: 'flex:1' }, a.result),
          el('span', { style: 'color:var(--color-neutral-500); white-space:nowrap' }, new Date(a.date).toLocaleDateString()),
          el('button', {
            class: 'btn btn-ghost', style: 'padding:0 6px; font-size:12px',
            onclick: () => { void navigator.clipboard?.writeText(a.pgn); },
          }, 'PGN'),
        )),
      ));
    }

    container.append(col);
    this.root.append(container);
  }

  private ratingGraph(): HTMLElement {
    const hist = state.model.ratingHistory;
    const w = 360, h = 80;
    if (hist.length < 2) {
      return el('div', { style: 'font-size:13px; font-style:italic; color:var(--color-neutral-500)' },
        'Your rating graph appears after a few games vs the AI.');
    }
    const values = hist.map(x => x.rating);
    const min = Math.min(...values) - 20, max = Math.max(...values) + 20;
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * (w - 8) + 4;
      const y = h - 6 - ((v - min) / (max - min)) * (h - 12);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('style', 'width:100%; height:80px; display:block');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', pts);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', 'var(--color-accent)');
    line.setAttribute('stroke-width', '2');
    svg.append(line);
    return svg as unknown as HTMLElement;
  }
}
