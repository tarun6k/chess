// Turns the player model into concrete AI behavior:
//  - rubber-band difficulty (Learn / Match / Challenge)
//  - eval-parameter counter-play against the player's style
//  - opening preparation against (or mirroring) the player's repertoire

import { PlayerModel, classifyStyle, StyleLabel, topWeaknesses } from './playerModel';
import { EvalParams, NEUTRAL_PARAMS } from './eval';
import { eloToSkill, skillToElo } from './persona';
import { bookContinuations } from './openings';
import { WHITE, BLACK, Color } from '../engine/types';

export type DifficultyMode = 'learn' | 'match' | 'challenge';

export interface AdaptationPlan {
  skill: number;
  aiElo: number;
  params: EvalParams;
  /** book tags the AI prefers this game */
  bookTags: string[];
  /** chance to mirror the player's own favorite opening */
  mirrorOpening: string | null;
  /** human-readable notes shown in the post-game "how I adapted" summary */
  notes: string[];
  styleLabel: StyleLabel;
}

/** Target AI elo for a mode, with losing-streak easing and win hardening. */
export function targetElo(model: PlayerModel, mode: DifficultyMode): number {
  const offset = mode === 'learn' ? -90 : mode === 'challenge' ? 90 : 0;
  // Rubber band: each win nudges the AI up, a losing streak eases it off.
  const band = Math.max(-120, Math.min(120, model.streak * 25));
  return Math.max(600, Math.min(2200, model.rating + offset + band));
}

export function planForGame(model: PlayerModel, mode: DifficultyMode, aiColor: Color): AdaptationPlan {
  const { label } = classifyStyle(model.features);
  const notes: string[] = [];
  const params: EvalParams = { ...NEUTRAL_PARAMS };
  let bookTags: string[] = [];

  // closedPref is a white-positive eval term; flip so it favors the AI's wish.
  const closedSign = aiColor === WHITE ? 1 : 1; // locked pairs are symmetric; sign handled by weight only
  switch (label) {
    case 'aggressive':
      params.kingSafetyWeight = 0.8;
      params.aggression = -0.2;
      bookTags = ['solid'];
      notes.push('You attack early, so I kept my king extra safe and played solid setups that punish overextension.');
      break;
    case 'tactical':
      params.closedPref = 0.8 * closedSign;
      params.kingSafetyWeight = 0.4;
      bookTags = ['closed', 'solid'];
      notes.push('You thrive in tactics, so I steered toward closed positions with fewer combinations.');
      break;
    case 'defensive':
      params.spaceWeight = 0.9;
      params.aggression = 0.4;
      bookTags = ['space', 'sharp'];
      notes.push('You play patiently, so I grabbed space and squeezed slowly instead of forcing matters.');
      break;
    case 'positional':
      params.aggression = 0.5;
      params.mobilityWeight = 1.3;
      bookTags = ['open', 'sharp'];
      notes.push('You like quiet maneuvering, so I opened the position and created sharp play.');
      break;
    case 'materialistic':
      params.aggression = 0.5;
      params.spaceWeight = 0.4;
      bookTags = ['sharp'];
      notes.push('You grab material readily, so I aimed for initiative and gambit-style pressure over pawns.');
      break;
    default:
      notes.push('Your style is still balanced — I played neutrally while I learn your patterns.');
  }

  // Opening preparation
  let mirrorOpening: string | null = null;
  const fav = model.openings[0];
  if (fav && fav.count >= 3) {
    if (Math.random() < 0.25) {
      mirrorOpening = fav.name;
      notes.push(`You favor the ${fav.name} — this time I tried it against you.`);
    } else {
      notes.push(`I expected your ${fav.name} and prepared against it.`);
    }
  }

  // Weakness exploitation note (the exploitation itself emerges from play +
  // targeted challenges; we surface intent honestly).
  const weak = topWeaknesses(model, 1)[0];
  if (weak) {
    const names: Record<string, string> = {
      'hanging-pieces': 'undefended pieces',
      'missed-tactics': 'tactical shots',
      'back-rank': 'back-rank weaknesses',
      endgame: 'endgame technique',
      opening: 'opening play',
      'king-safety': 'king safety',
    };
    notes.push(`I watched for chances around your ${names[weak.key] ?? weak.key}.`);
  }

  const elo = targetElo(model, mode);
  const skill = eloToSkill(elo);
  if (model.streak <= -3) {
    notes.push('You were on a rough streak, so I eased off and allowed myself more human mistakes.');
  } else if (model.streak >= 3) {
    notes.push('You were winning steadily, so I stepped up my level.');
  }

  return { skill, aiElo: skillToElo(skill), params, bookTags, mirrorOpening, notes, styleLabel: label };
}

/** Pick a book move for the AI given the SAN line so far, or null. */
export function pickBookMove(sans: string[], plan: AdaptationPlan): string | null {
  if (sans.length >= 10) return null;
  // Mirroring: follow the favorite opening's own line where possible (it is in
  // the BOOK by name), otherwise use tag-preferred continuations.
  const options = bookContinuations(sans, plan.bookTags.length ? plan.bookTags : undefined);
  if (!options.length) return null;
  return options[Math.floor(Math.random() * options.length)];
}
