// Settings: board & feedback preferences from the spec, in the design language.

import { el, clear, LABEL_STYLE, CARD_STYLE, segStyle, segWrap } from './dom';
import { state, persist, Settings } from '../app/store';
import { Screen } from './router';

export class SettingsScreen implements Screen {
  root = el('div');

  mount(): void { this.render(); }

  private set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    state.settings[key] = value;
    void persist.settings();
    this.render();
  }

  private toggleRow(label: string, hint: string, key: keyof Settings): HTMLElement {
    const on = state.settings[key] as boolean;
    return el('div', { style: 'display:flex; justify-content:space-between; align-items:center; gap:10px' },
      el('div', { style: 'flex:1' },
        el('div', { style: 'font-size:14px' }, label),
        hint ? el('div', { style: 'font-size:12px; color:var(--color-neutral-500)' }, hint) : null,
      ),
      segWrap(
        el('button', { style: segStyle(on), 'aria-pressed': String(on), onclick: () => this.set(key, true as never) }, 'On'),
        el('button', { style: segStyle(!on), onclick: () => this.set(key, false as never) }, 'Off'),
      ),
    );
  }

  render(): void {
    clear(this.root);
    const container = el('div', {
      style: 'min-height:100vh; font-family:var(--font-body); color:var(--color-text); display:flex; flex-direction:column; align-items:center; padding:clamp(20px,4vw,36px) 12px 96px',
    });
    container.append(
      el('header', { style: 'text-align:center' },
        el('div', { style: 'font-family:var(--font-heading); font-weight:400; font-size:36px' }, 'Settings'),
        el('div', { style: 'width:64px; height:1px; background:var(--color-divider); margin:10px auto' }),
      ),
    );
    const col = el('div', { style: 'width:min(420px, calc(100vw - 24px)); display:flex; flex-direction:column; gap:20px; margin-top:clamp(16px,3vw,28px)' });

    col.append(el('div', { style: CARD_STYLE },
      el('div', { style: LABEL_STYLE }, 'Board'),
      this.toggleRow('Coordinates', 'Show file and rank labels', 'coordinates'),
      el('div', { style: 'height:1px; background:var(--color-divider)' }),
      el('div', { style: 'display:flex; justify-content:space-between; align-items:center; gap:10px' },
        el('div', { style: 'flex:1' },
          el('div', { style: 'font-size:14px' }, 'Board orientation'),
          el('div', { style: 'font-size:12px; color:var(--color-neutral-500)' }, 'Auto flips for pass-and-play'),
        ),
        segWrap(
          el('button', { style: segStyle(state.settings.boardFlip === 'auto'), onclick: () => this.set('boardFlip', 'auto') }, 'Auto'),
          el('button', { style: segStyle(state.settings.boardFlip === 'white'), onclick: () => this.set('boardFlip', 'white') }, 'White'),
          el('button', { style: segStyle(state.settings.boardFlip === 'black'), onclick: () => this.set('boardFlip', 'black') }, 'Black'),
        ),
      ),
    ));

    col.append(el('div', { style: CARD_STYLE },
      el('div', { style: LABEL_STYLE }, 'Play'),
      this.toggleRow('Auto-queen', 'Skip the promotion picker, always promote to queen', 'autoQueen'),
      el('div', { style: 'height:1px; background:var(--color-divider)' }),
      this.toggleRow('Takebacks', 'Undo in casual untimed games (never in challenges)', 'takebacks'),
    ));

    col.append(el('div', { style: CARD_STYLE },
      el('div', { style: LABEL_STYLE }, 'Feedback'),
      this.toggleRow('Sounds', 'Move, capture, check and game-end sounds', 'sounds'),
      el('div', { style: 'height:1px; background:var(--color-divider)' }),
      this.toggleRow('Haptics', 'Vibration on moves and important moments', 'haptics'),
      el('div', { style: 'height:1px; background:var(--color-divider)' }),
      this.toggleRow('Animations', 'Subtle piece movement animation', 'animations'),
    ));

    col.append(el('div', { style: CARD_STYLE },
      el('div', { style: LABEL_STYLE }, 'About'),
      el('div', { style: 'font-size:13px; opacity:0.8' },
        'Adaptive Chess — fully offline. The AI models your style on-device; nothing ever leaves your phone.'),
    ));

    container.append(col);
    this.root.append(container);
  }
}
