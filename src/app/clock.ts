import { Color, WHITE, BLACK } from '../engine/types';

export interface TimeControl {
  name: string;
  /** base time in ms per player; asymmetric handicaps use baseMs overrides */
  baseMs: number;
  incrementMs: number;
  /** optional per-side override (AI handicap challenges) */
  whiteBaseMs?: number;
  blackBaseMs?: number;
}

export const TIME_PRESETS: TimeControl[] = [
  { name: 'Bullet 1+0', baseMs: 60_000, incrementMs: 0 },
  { name: 'Blitz 3+2', baseMs: 180_000, incrementMs: 2_000 },
  { name: 'Rapid 10+0', baseMs: 600_000, incrementMs: 0 },
  { name: 'Rapid 15+10', baseMs: 900_000, incrementMs: 10_000 },
  { name: 'Classical 30+0', baseMs: 1_800_000, incrementMs: 0 },
];

export function customTimeControl(baseMin: number, incSec: number): TimeControl {
  const b = Math.max(1, Math.min(120, Math.round(baseMin)));
  const i = Math.max(0, Math.min(60, Math.round(incSec)));
  return { name: `Custom ${b}+${i}`, baseMs: b * 60_000, incrementMs: i * 1000 };
}

/**
 * Fischer-increment chess clock. Wall-clock based (robust to throttled timers);
 * ticks a callback for display, fires once on flag fall and low-time warning.
 */
export class ChessClock {
  remaining: [number, number];
  increment: number;
  active: Color | null = null;
  private lastStamp = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lowWarned: [boolean, boolean] = [false, false];

  onTick: (() => void) | null = null;
  onFlag: ((color: Color) => void) | null = null;
  onLowTime: ((color: Color) => void) | null = null;

  constructor(tc: TimeControl) {
    this.remaining = [tc.whiteBaseMs ?? tc.baseMs, tc.blackBaseMs ?? tc.baseMs];
    this.increment = tc.incrementMs;
  }

  /** Start (or switch to) `color`'s clock; adds increment to the side that just moved. */
  press(mover: Color): void {
    this.syncElapsed();
    if (this.active === mover) {
      this.remaining[mover] += this.increment;
    }
    this.active = (mover ^ 1) as Color;
    this.ensureTimer();
  }

  start(color: Color): void {
    this.syncElapsed();
    this.active = color;
    this.ensureTimer();
  }

  pause(): void {
    this.syncElapsed();
    this.active = null;
    this.stopTimer();
  }

  stop(): void { this.pause(); }

  private ensureTimer(): void {
    this.lastStamp = Date.now();
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.syncElapsed();
      this.onTick?.();
    }, 100);
  }

  private stopTimer(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private syncElapsed(): void {
    const now = Date.now();
    if (this.active !== null) {
      const c = this.active;
      this.remaining[c] = Math.max(0, this.remaining[c] - (now - this.lastStamp));
      if (this.remaining[c] <= 20_000 && !this.lowWarned[c] && this.remaining[c] > 0) {
        this.lowWarned[c] = true;
        this.onLowTime?.(c);
      }
      if (this.remaining[c] === 0) {
        const flagged = c;
        this.active = null;
        this.stopTimer();
        this.onFlag?.(flagged);
      }
    }
    this.lastStamp = now;
  }

  dispose(): void { this.stopTimer(); }
}

export function formatClock(ms: number): string {
  const t = Math.ceil(ms / 1000);
  if (t >= 3600) {
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  if (ms < 20_000) {
    // tenths under 20s
    const whole = Math.floor(ms / 1000), tenth = Math.floor((ms % 1000) / 100);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${tenth}`;
  }
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
