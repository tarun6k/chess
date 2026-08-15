// Sounds (WebAudio-synthesized, no assets) and haptics.

import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';
import { state } from './store';

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (!state.settings.sounds) return null;
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

function tone(freq: number, dur: number, type: OscillatorType, gain = 0.12, when = 0): void {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  const t = ac.currentTime + when;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const sound = {
  move(): void { tone(320, 0.07, 'sine', 0.1); },
  capture(): void { tone(180, 0.09, 'triangle', 0.16); tone(120, 0.1, 'sine', 0.1, 0.02); },
  check(): void { tone(660, 0.1, 'sine', 0.12); tone(880, 0.12, 'sine', 0.1, 0.09); },
  castle(): void { tone(320, 0.06, 'sine', 0.1); tone(400, 0.06, 'sine', 0.1, 0.08); },
  promote(): void { tone(520, 0.08, 'sine', 0.1); tone(660, 0.08, 'sine', 0.1, 0.07); tone(780, 0.12, 'sine', 0.1, 0.14); },
  gameWin(): void { tone(392, 0.12, 'sine', 0.12); tone(494, 0.12, 'sine', 0.12, 0.12); tone(587, 0.22, 'sine', 0.12, 0.24); },
  gameLoss(): void { tone(330, 0.16, 'sine', 0.12); tone(262, 0.28, 'sine', 0.12, 0.16); },
  gameDraw(): void { tone(392, 0.14, 'sine', 0.1); tone(392, 0.18, 'sine', 0.08, 0.18); },
  lowTime(): void { tone(880, 0.06, 'square', 0.07); tone(880, 0.06, 'square', 0.07, 0.12); },
  error(): void { tone(160, 0.1, 'square', 0.06); },
};

const native = Capacitor.isNativePlatform();

async function impact(style: ImpactStyle): Promise<void> {
  if (!state.settings.haptics) return;
  try {
    if (native) await Haptics.impact({ style });
    else navigator.vibrate?.(style === ImpactStyle.Heavy ? 40 : style === ImpactStyle.Medium ? 24 : 12);
  } catch { /* no haptics available */ }
}

export const haptic = {
  light(): void { void impact(ImpactStyle.Light); },
  medium(): void { void impact(ImpactStyle.Medium); },
  heavy(): void { void impact(ImpactStyle.Heavy); },
  async success(): Promise<void> {
    if (!state.settings.haptics) return;
    try {
      if (native) await Haptics.notification({ type: NotificationType.Success });
      else navigator.vibrate?.([20, 40, 20]);
    } catch { /* ignore */ }
  },
  async warning(): Promise<void> {
    if (!state.settings.haptics) return;
    try {
      if (native) await Haptics.notification({ type: NotificationType.Warning });
      else navigator.vibrate?.([30, 30, 30]);
    } catch { /* ignore */ }
  },
};
