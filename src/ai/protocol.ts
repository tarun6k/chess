import { EvalParams } from './eval';

/** Messages between the app and the AI worker. */

export interface MoveRequest {
  id: number;
  type: 'move';
  fen: string;
  historyKeys: string[];
  skill: number;
  moveTimeMs: number;
  params?: EvalParams;
  /** UCI move to force (opening book / prepared line), skipping search. */
  bookMove?: string;
}

export interface HintRequest {
  id: number;
  type: 'hint';
  fen: string;
  historyKeys: string[];
}

export interface AnalyzeRequest {
  id: number;
  type: 'analyze';
  startFen: string;
  uciMoves: string[];
  /** ms budget per position */
  perMoveMs: number;
}

export type WorkerRequest = MoveRequest | HintRequest | AnalyzeRequest;

export interface MoveResponse {
  id: number;
  type: 'move';
  uci: string;
  /** cp from the mover's POV */
  score: number;
  depth: number;
  nodes: number;
  /** index chosen among root candidates (0 = engine best) — for the adaptation summary */
  choiceIndex: number;
  bestUci: string;
}

export interface HintResponse {
  id: number;
  type: 'hint';
  uci: string;
  score: number;
}

export type Judgment = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export interface AnalyzedMove {
  uci: string;
  /** eval (white POV, cp) after the move was played */
  evalAfter: number;
  /** eval (white POV, cp) of the position before the move, i.e. best play */
  evalBefore: number;
  bestUci: string;
  judgment: Judgment;
  /** centipawn loss from the mover's perspective */
  cpLoss: number;
}

export interface AnalyzeResponse {
  id: number;
  type: 'analyze';
  moves: AnalyzedMove[];
}

export interface ErrorResponse { id: number; type: 'error'; message: string; }

export type WorkerResponse = MoveResponse | HintResponse | AnalyzeResponse | ErrorResponse;
