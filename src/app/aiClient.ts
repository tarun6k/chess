// Main-thread client for the AI worker: promise-based request/response.

import {
  WorkerRequest, WorkerResponse, MoveResponse, HintResponse, AnalyzeResponse,
  MoveRequest, HintRequest, AnalyzeRequest,
} from '../ai/protocol';
import { EvalParams } from '../ai/eval';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../ai/worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.type === 'error') p.reject(new Error(e.data.message));
    else p.resolve(e.data);
  };
  worker.onerror = (e) => {
    for (const [, p] of pending) p.reject(new Error('AI worker error: ' + e.message));
    pending.clear();
  };
  return worker;
}

type AnyRequest = Omit<MoveRequest, 'id'> | Omit<HintRequest, 'id'> | Omit<AnalyzeRequest, 'id'>;

function request<T extends WorkerResponse>(req: AnyRequest): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (r: WorkerResponse) => void, reject });
    ensureWorker().postMessage({ ...req, id });
  });
}

export function requestAiMove(opts: {
  fen: string; historyKeys: string[]; skill: number; moveTimeMs: number;
  params?: EvalParams; bookMove?: string;
}): Promise<MoveResponse> {
  return request<MoveResponse>({ type: 'move', ...opts });
}

export function requestHint(fen: string, historyKeys: string[]): Promise<HintResponse> {
  return request<HintResponse>({ type: 'hint', fen, historyKeys });
}

export function requestAnalysis(startFen: string, uciMoves: string[], perMoveMs = 350): Promise<AnalyzeResponse> {
  return request<AnalyzeResponse>({ type: 'analyze', startFen, uciMoves, perMoveMs });
}
