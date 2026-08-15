import { RootMove, MATE } from './search';

/**
 * Skill → search budget and human-like error model.
 *
 * skill 0..20 maps roughly onto 600..2200 Elo. Two mechanisms produce
 * plausible (not random) mistakes:
 *  1. Gaussian evaluation noise before choosing among root moves — weaker
 *     "eyes": close alternatives become interchangeable.
 *  2. Occasional deliberate pick of a mildly worse candidate (bounded loss),
 *     which reads as a human inaccuracy, never a piece hung for nothing —
 *     EXCEPT at very low skill, where bounded real blunders are allowed.
 */
export interface Persona {
  skill: number;          // 0..20
  maxDepth: number;
  moveTimeMs: number;
  noiseCp: number;        // sigma of gaussian noise applied to root scores
  maxDropCp: number;      // never pick a move more than this below the best
  blunderRate: number;    // chance to consider the wider (worse) candidate set
}

export function personaForSkill(skill: number, moveTimeMs: number): Persona {
  const s = Math.max(0, Math.min(20, skill));
  return {
    skill: s,
    maxDepth: s <= 2 ? 2 : s <= 6 ? 3 : s <= 11 ? 4 : s <= 16 ? 5 : 8,
    moveTimeMs,
    noiseCp: Math.round((20 - s) * (20 - s) * 0.55),        // 0 @20 … 220 @0
    maxDropCp: s >= 15 ? 30 : s >= 10 ? 80 : s >= 5 ? 160 : 320,
    blunderRate: s >= 15 ? 0.02 : s >= 10 ? 0.06 : s >= 5 ? 0.12 : 0.22,
  };
}

/** Approximate Elo for a skill level (for display and rating updates). */
export function skillToElo(skill: number): number {
  return Math.round(600 + Math.max(0, Math.min(20, skill)) * 80);
}
export function eloToSkill(elo: number): number {
  return Math.max(0, Math.min(20, (elo - 600) / 80));
}

function gaussian(rng: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Choose the move to play from exact-scored root moves (best first).
 * Returns the chosen index into rootMoves.
 */
export function chooseMove(rootMoves: RootMove[], persona: Persona, rng: () => number = Math.random): number {
  if (rootMoves.length <= 1) return 0;
  const best = rootMoves[0].score;

  // Never throw away a found mate, and never walk into one if avoidable.
  if (best > MATE - 1000) return 0;

  const blunderWindow = rng() < persona.blunderRate;
  const drop = blunderWindow ? persona.maxDropCp : Math.min(persona.maxDropCp, 60);

  // Candidates: within `drop` cp of best, and not losing on the spot.
  const floor = best - drop;
  const candidates: number[] = [];
  for (let i = 0; i < rootMoves.length; i++) {
    const s = rootMoves[i].score;
    if (s < floor) break; // sorted
    if (s < -(MATE - 1000) + 2000 && best > -(MATE - 1000)) continue; // don't pick a forced loss
    candidates.push(i);
  }
  if (candidates.length === 0) return 0;

  // Perceived score = true score + noise; pick the max.
  let bestIdx = candidates[0];
  let bestPerceived = -Infinity;
  for (const i of candidates) {
    const perceived = rootMoves[i].score + gaussian(rng) * persona.noiseCp;
    if (perceived > bestPerceived) { bestPerceived = perceived; bestIdx = i; }
  }
  return bestIdx;
}
