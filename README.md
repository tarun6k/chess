# Adaptive Chess

An offline Android chess app with an AI opponent that **models the player and adapts** —
built on the "Classical" design system from the companion Claude Design project
(`Chess Game.dc.html` is implemented 1:1 as the game screen; the other screens extend
its visual language minimally).

## Quick start

```bash
npm install
npm run dev            # web dev server
npm test               # full engine test suite (includes perft(5) = 4,865,609)
npm run android        # build web → sync → assemble debug APK
```

The debug APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`.
Building needs a JDK 21 (`JAVA_HOME=/opt/homebrew/opt/openjdk@21` on this machine)
and the Android SDK (`ANDROID_HOME=~/Library/Android/sdk`, platform 35).

## Architecture

Three strictly separated layers — the rules engine and AI know nothing about the DOM,
so they run identically in the UI thread, the Web Worker, and Vitest:

```
src/engine/    deterministic rules engine (zero dependencies)
  types.ts       board/move encodings (packed 32-bit moves)
  position.ts    make/unmake, legal movegen, FEN, Zobrist hashing, material logic
  game.ts        game lifecycle: SAN history, every draw rule, results
  san.ts, pgn.ts notation + PGN import/export
  perft.ts       verification node counts

src/ai/        the opponent
  eval.ts        material + PSTs + pawn structure + king safety + mobility,
                 with adaptation knobs (EvalParams)
  search.ts      iterative-deepening alpha-beta, quiescence, transposition
                 table, killers/history, repetition-aware
  persona.ts     skill → depth/noise/blunder model (human-like errors)
  playerModel.ts persistent player model: style features, weaknesses, openings, Elo
  adaptation.ts  player model → eval params, opening prep, difficulty band
  openings.ts    compact named opening book
  worker.ts      Web Worker entry — search never blocks the UI

src/app/       application services
  controller.ts  one live game: clocks, AI turns, challenges, autosave
  clock.ts       Fischer clocks, presets, handicaps, flag/low-time events
  puzzles.ts     engine-verified puzzles, endgame drills, constraint games
  progression.ts XP, levels, badges, daily challenge + streaks
  store.ts       app state + crash-safe persistence (Preferences + localStorage)

src/ui/        screens (vanilla TS, design-system CSS from public/styles.css)
```

**Rules coverage**: castling with all legality conditions, en passant (incl. the
pin edge case), underpromotion, stalemate, threefold (claim) / fivefold (auto),
fifty (claim) / seventy-five (auto) move rules, insufficient material, dead
position, resignation, draw offers, and the FIDE 6.9 timeout rule (flag fall is
a draw when the opponent cannot possibly mate). Move generation is perft-verified
against six reference positions (`tests/perft.test.ts`); every shipped puzzle is
verified by the engine itself (`tests/puzzles.test.ts`).

## How adaptation works

After every finished AI game:

1. **Facts** are extracted from the move record (capture rate, early-queen ply,
   castling ply, pawn storms, checks, trade rate, think time) and folded into
   rolling style features (`playerModel.ts`).
2. A **background analysis** pass (same engine, in the worker) grades each of the
   player's moves; mistakes are classified into weaknesses — hanging pieces,
   missed tactics, back-rank, endgame, opening, king safety — and big mistakes
   are saved verbatim as **personalized puzzles** ("find the move you missed").
3. Before the next game, `planForGame()` turns the model into behavior:
   - *aggressive players* → the AI weights its own king safety up and plays solid book lines;
   - *tactical players* → closed-center preference (locked-pawn eval bonus), closed openings;
   - *passive players* → space-grab weighting and sharp lines;
   - *materialistic players* → initiative over pawns.
   It also prepares against the player's most-frequent opening — and ~25% of the
   time mirrors it back at them.
4. Everything the AI did differently is shown honestly in the post-game
   **"How I adapted"** panel and on the Insights screen.

## Tuning AI difficulty

Rubber-band Elo, in `adaptation.ts` / `persona.ts`:

- The player has a persistent Elo (K=48 first 10 games, then 24), updated after
  each AI game against the AI's effective Elo.
- Mode offsets: **Learn** = player−90, **Match** = player, **Push me** = player+90,
  plus a streak band of ±25 Elo per consecutive win/loss (capped ±120) — win and
  the AI firms up, slump and it eases off.
- Target Elo maps to skill 0–20 (`eloToSkill`), which sets: search depth (2–8),
  Gaussian evaluation noise (0–220 cp), a bounded-loss candidate window, and the
  blunder rate. Mistakes are *plausible*: the persona only picks among moves the
  search actually scored, never abandons a found mate, and never hangs a piece
  outside its loss bound. Tune the depth/noise tables in `personaForSkill()` and
  the offsets in `targetElo()`.

## Design fidelity

`public/styles.css` is the Classical design system verbatim (fonts bundled
locally for offline); the game screen reproduces the design file's exact markup
and inline styles — wood plate, textured squares, engraved glyph pieces, dot/ring
targets, segmented controls, promotion dialog. Extensions (difficulty picker,
draw/resign/hint, game-over sheet, review mode, Home/Puzzles/Insights/Settings)
reuse only tokens and components from that system.
