import { Game } from './game';
import { START_FEN } from './position';

export interface PgnHeaders { [key: string]: string; }

/** Export a game as PGN with standard seven-tag-roster-ish headers. */
export function toPGN(game: Game, headers: PgnHeaders = {}): string {
  const h: PgnHeaders = {
    Event: 'Adaptive Chess',
    Site: 'Local',
    Date: headers.Date ?? '????.??.??',
    Round: '-',
    White: 'White',
    Black: 'Black',
    Result: game.result?.score ?? '*',
    ...headers,
  };
  if (game.startFen !== START_FEN) {
    h.SetUp = '1';
    h.FEN = game.startFen;
  }
  let out = '';
  for (const [k, v] of Object.entries(h)) out += `[${k} "${v}"]\n`;
  out += '\n';
  const sans = game.sanLine();
  const tokens: string[] = [];
  // A game starting from a FEN with Black to move numbers as "N... move".
  const startPos = game.positionAt(0);
  let moveNo = startPos.fullmove;
  let whiteToMove = startPos.turn === 0;
  for (let i = 0; i < sans.length; i++) {
    if (whiteToMove) tokens.push(moveNo + '.', sans[i]);
    else {
      if (i === 0) tokens.push(moveNo + '...', sans[i]);
      else tokens.push(sans[i]);
      moveNo++;
    }
    whiteToMove = !whiteToMove;
  }
  tokens.push(game.result?.score ?? '*');
  // Wrap at ~80 chars
  let line = '', body = '';
  for (const t of tokens) {
    if (line.length + t.length + 1 > 80) { body += line + '\n'; line = t; }
    else line = line ? line + ' ' + t : t;
  }
  body += line + '\n';
  return out + body;
}

/** Parse a single-game PGN. Returns the reconstructed Game and its headers. */
export function fromPGN(pgn: string): { game: Game; headers: PgnHeaders } {
  const headers: PgnHeaders = {};
  const headerRe = /^\s*\[(\w+)\s+"([^"]*)"\]\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(pgn))) headers[m[1]] = m[2];

  let body = pgn.replace(headerRe, ' ');
  body = body
    .replace(/\{[^}]*\}/g, ' ')          // comments
    .replace(/;[^\n]*/g, ' ')            // rest-of-line comments
    .replace(/\$\d+/g, ' ');             // NAGs
  // Strip nested variations
  let prev = '';
  while (prev !== body) { prev = body; body = body.replace(/\([^()]*\)/g, ' '); }

  const game = new Game(headers.FEN ?? START_FEN);
  const tokens = body.split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) break;
    if (/^\d+\.+$/.test(tok)) continue;
    const cleaned = tok.replace(/^\d+\.+/, ''); // "1.e4" style
    if (!cleaned) continue;
    const san = game.playSAN(cleaned);
    if (san === null) throw new Error('Illegal or unparseable PGN move: ' + tok);
  }
  return { game, headers };
}
