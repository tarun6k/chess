/// <reference lib="webworker" />
// AI worker — all search runs here so the UI thread never blocks.

import { Position } from '../engine/position';
import { Search, MATE } from './search';
import { personaForSkill, chooseMove } from './persona';
import { NEUTRAL_PARAMS } from './eval';
import { moveToUci, WHITE, Move } from '../engine/types';
import {
  WorkerRequest, WorkerResponse, MoveRequest, HintRequest, AnalyzeRequest, Judgment,
} from './protocol';

const search = new Search();

function uciToMove(pos: Position, uci: string): Move | null {
  for (const m of pos.generateLegal()) if (moveToUci(m) === uci) return m;
  return null;
}

function handleMove(req: MoveRequest): WorkerResponse {
  const pos = new Position(req.fen);

  if (req.bookMove) {
    const bm = uciToMove(pos, req.bookMove);
    if (bm) {
      return { id: req.id, type: 'move', uci: req.bookMove, score: 0, depth: 0, nodes: 0, choiceIndex: 0, bestUci: req.bookMove };
    }
  }

  const persona = personaForSkill(req.skill, req.moveTimeMs);
  const result = search.search(pos, {
    maxDepth: persona.maxDepth,
    moveTimeMs: persona.moveTimeMs,
    params: req.params ?? NEUTRAL_PARAMS,
    historyKeys: req.historyKeys,
  });
  if (!result.best) return { id: req.id, type: 'error', message: 'no legal moves' };
  const idx = chooseMove(result.rootMoves, persona);
  const chosen = result.rootMoves[idx];
  return {
    id: req.id, type: 'move',
    uci: moveToUci(chosen.move),
    score: chosen.score,
    depth: result.depth,
    nodes: result.nodes,
    choiceIndex: idx,
    bestUci: moveToUci(result.rootMoves[0].move),
  };
}

function handleHint(req: HintRequest): WorkerResponse {
  const pos = new Position(req.fen);
  const result = search.search(pos, {
    maxDepth: 5, moveTimeMs: 1500, params: NEUTRAL_PARAMS, historyKeys: req.historyKeys,
  });
  if (!result.best) return { id: req.id, type: 'error', message: 'no legal moves' };
  return { id: req.id, type: 'hint', uci: moveToUci(result.best), score: result.score };
}

function judge(cpLoss: number, isBest: boolean): Judgment {
  if (isBest) return 'best';
  if (cpLoss >= 250) return 'blunder';
  if (cpLoss >= 120) return 'mistake';
  if (cpLoss >= 50) return 'inaccuracy';
  return 'good';
}

function handleAnalyze(req: AnalyzeRequest): WorkerResponse {
  const pos = new Position(req.startFen);
  const out = [];
  const keys: string[] = [pos.hashKey()];
  for (const uci of req.uciMoves) {
    const m = uciToMove(pos, uci);
    if (!m) return { id: req.id, type: 'error', message: 'illegal move in line: ' + uci };
    const white = pos.turn === WHITE;
    const before = search.search(pos, {
      maxDepth: 4, moveTimeMs: req.perMoveMs, historyKeys: keys,
    });
    const bestScoreMover = before.rootMoves.length ? before.rootMoves[0].score : 0;
    const played = before.rootMoves.find(r => r.move === m);
    // If the played move fell outside exact-window scoring, re-search it quickly.
    let playedScore = played ? played.score : bestScoreMover - 400;
    const cpLoss = Math.max(0, bestScoreMover - playedScore);
    const bestUci = before.rootMoves.length ? moveToUci(before.rootMoves[0].move) : uci;

    pos.makeMove(m);
    keys.push(pos.hashKey());
    out.push({
      uci,
      evalBefore: white ? bestScoreMover : -bestScoreMover,
      evalAfter: white ? playedScore : -playedScore,
      bestUci,
      judgment: judge(cpLoss, bestUci === uci),
      cpLoss,
    });
  }
  return { id: req.id, type: 'analyze', moves: out };
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  let res: WorkerResponse;
  try {
    if (req.type === 'move') res = handleMove(req);
    else if (req.type === 'hint') res = handleHint(req);
    else if (req.type === 'analyze') res = handleAnalyze(req);
    else res = { id: (req as any).id ?? -1, type: 'error', message: 'unknown request' };
  } catch (err) {
    res = { id: (req as any).id ?? -1, type: 'error', message: String(err) };
  }
  (self as any).postMessage(res);
};
