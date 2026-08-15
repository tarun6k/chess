// Central app state + persistence. Everything the app must remember lives
// here and is autosaved: settings, player model, progression, the in-flight
// game (crash-safe resume), and the finished-games archive (as PGN).

import { loadKey, saveKey, removeKey } from './storage';
import { PlayerModel, newPlayerModel } from '../ai/playerModel';
import { Progress, newProgress } from './progression';
import { DifficultyMode } from '../ai/adaptation';
import { TimeControl } from './clock';
import { AnalyzedMove } from '../ai/protocol';

export interface Settings {
  coordinates: boolean;
  autoQueen: boolean;
  takebacks: boolean;         // casual games only; forced off in ranked/challenges
  sounds: boolean;
  haptics: boolean;
  boardFlip: 'auto' | 'white' | 'black'; // auto = flip in pass-and-play
  animations: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  coordinates: true, autoQueen: false, takebacks: true,
  sounds: true, haptics: true, boardFlip: 'auto', animations: true,
};

export type GameMode = 'pvp' | 'ai' | 'puzzle' | 'drill' | 'constraint';

/** Serialized in-flight game — enough to resume exactly. */
export interface SavedGame {
  mode: GameMode;
  startFen: string;
  uciMoves: string[];
  thinkMs: number[];
  playerColor: 'w' | 'b';
  difficulty: DifficultyMode;
  timeControl: TimeControl | null;
  clockRemaining: [number, number] | null;
  timerOn: boolean;
  hintsLeft: number;
  challengeId: string | null;   // puzzle/drill/constraint id when applicable
  adaptationNotes: string[];
  aiSkill: number;
  aiElo: number;
  savedAt: number;
}

export interface ArchivedGame {
  pgn: string;
  mode: GameMode;
  playerColor: 'w' | 'b';
  result: string;          // message
  score: string;           // 1-0 etc.
  aiElo: number | null;
  date: number;
  analysis: AnalyzedMove[] | null;
  adaptationNotes: string[];
  startFen: string;
  uciMoves: string[];
}

/** A recorded player mistake → fuel for personalized challenges. */
export interface RecordedMistake {
  fen: string;             // position before the mistake
  playedUci: string;
  bestUci: string;
  cpLoss: number;
  date: number;
  playerColor: 'w' | 'b';
}

export interface AppState {
  settings: Settings;
  model: PlayerModel;
  progress: Progress;
  saved: SavedGame | null;
  archive: ArchivedGame[];
  mistakes: RecordedMistake[];
  difficulty: DifficultyMode;
}

const KEYS = {
  settings: 'chess.settings',
  model: 'chess.playerModel',
  progress: 'chess.progress',
  saved: 'chess.savedGame',
  archive: 'chess.archive',
  mistakes: 'chess.mistakes',
  difficulty: 'chess.difficulty',
};

export const state: AppState = {
  settings: { ...DEFAULT_SETTINGS },
  model: newPlayerModel(),
  progress: newProgress(),
  saved: null,
  archive: [],
  mistakes: [],
  difficulty: 'match',
};

export async function loadAll(): Promise<void> {
  const [settings, model, progress, saved, archive, mistakes, difficulty] = await Promise.all([
    loadKey<Settings>(KEYS.settings),
    loadKey<PlayerModel>(KEYS.model),
    loadKey<Progress>(KEYS.progress),
    loadKey<SavedGame>(KEYS.saved),
    loadKey<ArchivedGame[]>(KEYS.archive),
    loadKey<RecordedMistake[]>(KEYS.mistakes),
    loadKey<DifficultyMode>(KEYS.difficulty),
  ]);
  if (settings) state.settings = { ...DEFAULT_SETTINGS, ...settings };
  if (model) state.model = { ...newPlayerModel(), ...model };
  if (progress) state.progress = { ...newProgress(), ...progress, counters: { ...newProgress().counters, ...progress.counters } };
  state.saved = saved;
  state.archive = archive ?? [];
  state.mistakes = mistakes ?? [];
  if (difficulty) state.difficulty = difficulty;
}

export const persist = {
  settings: () => saveKey(KEYS.settings, state.settings),
  model: () => saveKey(KEYS.model, state.model),
  progress: () => saveKey(KEYS.progress, state.progress),
  saved: () => state.saved ? saveKey(KEYS.saved, state.saved) : removeKey(KEYS.saved),
  archive: () => saveKey(KEYS.archive, state.archive.slice(0, 100)),
  mistakes: () => saveKey(KEYS.mistakes, state.mistakes.slice(0, 60)),
  difficulty: () => saveKey(KEYS.difficulty, state.difficulty),
};

export function recordMistakes(list: RecordedMistake[]): void {
  state.mistakes = [...list, ...state.mistakes].slice(0, 60);
  void persist.mistakes();
}
