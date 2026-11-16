/**
 * The RULES half of the BOARD example — tic-tac-toe, and the honest test of this interface.
 *
 * This app was loombot's until 2026-09-22. `loombot/game.ts` refereed it inside the daemon: a `move` frame
 * was applied, persisted and broadcast by the server that serves every app, so one game's rules were a
 * restriction on every app (`move` was a reserved event name) and the rules could not be read, tested or
 * changed by the agent that owned the app. The arithmetic below is that referee, ported unchanged; what is
 * new is that it lives beside its page, where any app's rules live.
 *
 * ## THE SPLIT, which is the whole reason a board is worth shipping as an example
 *
 *     is that square legal, and is it your turn      MECHANICAL. About a microsecond.
 *     place the stone, detect a win or a draw        MECHANICAL. A win is counting to three.
 *     the redraw, and the board as text             MECHANICAL. A reload must not cost a model call.
 *     WHICH SQUARE THE OPPONENT PLAYS               THE AGENT'S. There is no rule for it.
 *
 * **The decision is the opponent's move, and nothing else is.** A move is judgement: there is no
 * arithmetic that says "B2 is the move here", which is exactly what makes it worth a turn boundary — two
 * seconds before a stone appears reads as thinking. Whether a square is TAKEN is arithmetic, and two
 * seconds to be told "that square is taken" reads as broken. Every rule in this file sits on the side of
 * that line its cost puts it on.
 *
 * ## The two-event sequence, and the fact about `rules.ts` it comes from
 *
 * `event` returns EITHER a state change or `null` (a decision) — never both (`app_mcp.ts`: `null` means
 * the agent is asked, and nothing is applied). A board needs both in one gesture: the human's stone must
 * appear NOW, and only then is there a position to ask about. So the page sends two events, and this is a
 * property of the interface rather than a quirk of this app:
 *
 *     {event: "play", data: {square}}   MECHANICAL: validate, place, check for a win, redraw
 *     {event: "opponent"}               a DECISION: the position is committed, the agent is asked
 *
 * The alternative — `play` returning `null` and letting the agent's answer apply both moves — was
 * rejected, and it is the one mistake this file exists to prevent: the human's own stone would not appear
 * until a model answered, so a click would take two seconds to draw. The page pays one extra request — one
 * local round trip, and no transport to keep open — to avoid that.
 *
 * ## THE AGENT'S DOOR IS A TOOL, DECLARED HERE (2026-10-24)
 *
 * The opponent answers the `opponent` notification by calling `move` — a tool THIS FILE declares, and
 * `app_mcp.ts` registers beside `send`/`state`/`publish`. ONE rules module, two audiences: the page's
 * `play` and the agent's `move` go through the same `legal()` and `commit()` below, so there is exactly
 * one answer to "is that square playable" and no second copy that can drift.
 *
 * **AN ILLEGAL MOVE IS THE TOOL'S ERROR.** `run` answers `{ok: false, error}` with the reason `legal`
 * produced, and `app_mcp.ts` turns that into an MCP error RESULT — the agent reads it in the same call it
 * made, corrects itself and retries in the same turn. No frame, no push, no page involvement: a refusal
 * of the AGENT'S move is nobody's business but the agent's, and a frame written while no request is
 * being answered reaches nobody (loombot turns it into "this app changed", and the action's name is
 * delivered to no one — `app_mcp.ts`, the comment above `Handled`). This file used to answer an illegal
 * `move` with exactly such a frame and a brief that promised it would come back; the agent was told only
 * that its move had been sent. That lie is what the tool replaces.
 *
 * ## Gomoku is two numbers
 *
 * `size` and `win` are state, not constants: 3/3 is tic-tac-toe and 15/5 is gomoku, and NOTHING else
 * differs — the win check walks outward from the square just played, so it never cares how big the board
 * is. `tests/app_ttt_test.ts` plays both, which is what keeps that claim true.
 *
 * No import: a rules module is a plain Deno module with no dependency on loom, so it type-checks on its
 * own and this directory can be copied anywhere.
 */

/** `"X"` moves first, always — so the cells alone determine whose turn it is. */
type Mark = "X" | "O";

export interface Game {
  /** Row-major, `size * size` long. An empty square is `null`. */
  cells: (Mark | null)[];
  size: number;
  /** How many in a row wins: 3 for tic-tac-toe, 5 for gomoku. */
  win: number;
  /**
   * Who the human plays, and who the AGENT plays. X always moves first, so whoever holds X opens: the human
   * by default, the agent after a `new` with `{human: "O"}`.
   */
  human: Mark;
  agent: Mark;
  /** Set once the game has ended. `"draw"` when the board filled with no line. */
  over: Mark | "draw" | null;
  /**
   * The board as a grid, DERIVED — and it is here for one reason: a DECISION notification carries
   * `state` and nothing else, and a model reads
   *
   *       A B C
   *     1 . X .
   *
   * far better than `[null, "X", null, ...]`. Written in exactly ONE place (`commit`), so the copy cannot
   * drift from the cells it describes.
   */
  text: string;
  /** How many moves the agent has been asked for. The state file is then a record of the decisions. */
  asked: number;
}

type Rec = Record<string, unknown>;
interface Handled {
  state?: Game;
  actions?: { action: string; data?: Rec }[];
  /** End the app, and why (`app_mcp.ts`, `Handled.close`). */
  close?: string;
}

// ── the arithmetic: ported from the deleted `loombot/game.ts`, unchanged ────────────────────────────────

/** Whose turn it is, DERIVED from the cells rather than stored — one fewer thing to keep consistent. */
function turn(g: Game): Mark {
  let x = 0, o = 0;
  for (const c of g.cells) {
    if (c === "X") x++;
    else if (c === "O") o++;
  }
  return x <= o ? "X" : "O";
}

/**
 * A square as a player writes it — `"B2"`, `"a1"`, `"H8"` — to an index, or `null` if it is not one.
 *
 * Letters are COLUMNS and digits are ROWS, 1-based, because that is how every board game on paper is
 * written and a model produces it without being taught. Case-insensitive for the same reason.
 */
function parseSquare(g: Game, s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = /^([A-Za-z])(\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  const col = m[1].toUpperCase().charCodeAt(0) - 65;
  const row = Number(m[2]) - 1;
  if (col < 0 || col >= g.size || row < 0 || row >= g.size) return null;
  return row * g.size + col;
}

/** The inverse, so a move is reported back in the language it was given in. */
function nameSquare(g: Game, i: number): string {
  return String.fromCharCode(65 + (i % g.size)) + String(Math.floor(i / g.size) + 1);
}

/**
 * The longest line through `i` in one direction pair, counting `i` itself.
 *
 * Walks OUTWARD from the move rather than scanning the board, which is why the same code serves a 15x15
 * gomoku board: a full scan would be 900 comparisons per move to answer a question that needs at most
 * `2 * win`.
 */
function runLength(g: Game, i: number, dc: number, dr: number): number {
  const who = g.cells[i];
  if (!who) return 0;
  let n = 1;
  for (const sign of [1, -1]) {
    let c = (i % g.size) + dc * sign;
    let r = Math.floor(i / g.size) + dr * sign;
    while (c >= 0 && c < g.size && r >= 0 && r < g.size && g.cells[r * g.size + c] === who) {
      n++;
      c += dc * sign;
      r += dr * sign;
    }
  }
  return n;
}

/** Did the move at `i` complete a line? Checked only through the square just played. */
function wonAt(g: Game, i: number): boolean {
  return [[1, 0], [0, 1], [1, 1], [1, -1]].some(([dc, dr]) => runLength(g, i, dc, dr) >= g.win);
}

/**
 * The grid a model is given. Column letters on top and row numbers down the side, so the names in the
 * picture are the names it must answer with. Empty is a dot rather than a space: a run of spaces is
 * ambiguous in a proportional font and invisible in a diff.
 */
function render(g: Game): string {
  const head = "  " +
    Array.from({ length: g.size }, (_, c) => String.fromCharCode(65 + c)).join(" ");
  const rows: string[] = [];
  for (let r = 0; r < g.size; r++) {
    const row = g.cells.slice(r * g.size, (r + 1) * g.size).map((c) => c ?? ".");
    rows.push(String(r + 1).padStart(2) + " " + row.join(" "));
  }
  return [head, ...rows].join("\n");
}

// ── state ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A fresh position.
 *
 * Exported for two reasons: GOMOKU IS THEN ONE LINE (`export const initial = newGame(15, 5)`), and a test
 * can build a bigger board without a cast — which is what keeps the claim above from being a comment
 * nobody checks.
 */
export function newGame(size = 3, win = 3, human: Mark = "X"): Game {
  const g: Game = {
    cells: new Array(size * size).fill(null),
    size,
    win,
    human,
    agent: human === "X" ? "O" : "X",
    over: null,
    text: "",
    asked: 0,
  };
  return { ...g, text: render(g) };
}

export const initial: Game = newGame();

/** The full picture, which is also the redraw: one action a page can render from nothing. */
function shown(g: Game): { action: string; data: Rec } {
  return { action: "state", data: { ...g, turn: turn(g) } };
}

/**
 * A refusal: the reason, and the WHOLE state with it.
 *
 * The state goes along so a page that had a click refused has no excuse to draw anything of its own — it
 * redraws from what the rules hold, which is the only copy of the position.
 */
function refuse(g: Game, reason: string, extra: Rec = {}): Handled {
  return { actions: [{ action: "refused", data: { reason, ...shown(g).data, ...extra } }] };
}

/**
 * Place a stone and settle the game — the ONE place `text` is written, and the only writer of `over`.
 *
 * Returns a NEW state; nothing here mutates what it was given, so a refused move cannot half-apply.
 */
function commit(g: Game, i: number, who: Mark): Game {
  const cells = g.cells.slice();
  cells[i] = who;
  const next: Game = { ...g, cells };
  next.text = render(next);
  if (wonAt(next, i)) next.over = who;
  else if (cells.every((c) => c !== null)) next.over = "draw";
  return next;
}

/**
 * Validate one proposed move against the position. MECHANICAL, and shared by BOTH proposers: the human's
 * click (`play`) and the agent's call (`move`, the tool below) go through this same function, because a
 * model is trusted for the judgement and never for the legality.
 */
function legal(g: Game, square: unknown, who: Mark): { i: number } | { reason: string } {
  if (g.over) {
    const how = g.over === "draw" ? "ended in a draw" : "already won by " + g.over;
    return { reason: "the game is over: " + how };
  }
  const expected = turn(g);
  if (who !== expected) return { reason: expected + " moves next, not " + who };
  const i = parseSquare(g, square);
  if (i === null) {
    const last = nameSquare(g, g.size * g.size - 1);
    return { reason: JSON.stringify(square) + " is not a square on this board — A1 to " + last };
  }
  if (g.cells[i]) return { reason: nameSquare(g, i) + " is taken, by " + g.cells[i] };
  return { i };
}

// ── the two halves of the interface ──────────────────────────────────────────────────────────────────

export function event(name: string, data: Rec, g: Game): Handled | null {
  switch (name) {
    // A page that just connected, or reconnected. Answered from memory — this is why a reload is free.
    case "hello":
      return { actions: [shown(g)] };

    case "play": {
      const v = legal(g, data.square, g.human);
      // REFUSED HERE, with a reason, and the agent never learns it happened: there is nothing to decide
      // about a taken square. This is the line that keeps an illegal move feeling instant.
      if ("reason" in v) return refuse(g, v.reason, { square: data.square ?? null });
      const after = commit(g, v.i, g.human);
      return { state: after, actions: [shown(after)] };
    }

    // THE DECISION, and the only one this app has.
    //
    // The mechanical guards come FIRST, because a question the rules can answer must never cost a turn
    // boundary: the agent is asked only when it is genuinely its move in a live game. A page that asked
    // twice, or asked after the game ended, is refused here for free.
    //
    // Then `null`, which is the whole of how an app says "this one needs judgement". The server turns it
    // into ONE notification carrying `data` and the state — including `text`, the grid — and the agent
    // answers through the tool this file declares: workers.<app>.move({square: "B2"}). An illegal square
    // is that call's ERROR, with the reason and nothing else; the notification's text says so, because
    // this is where a player learns what an answer costs.
    case "opponent": {
      if (g.over) return refuse(g, "the game is over");
      if (turn(g) !== g.agent) {
        return refuse(
          g,
          "the opponent is only asked when it is its move — " + turn(g) + " moves next",
        );
      }
      return null;
    }

    // A new game is arithmetic too: nobody need approve an empty board. The SIZE is kept, so a gomoku app
    // stays a gomoku app across a reset.
    // `{human: "O"}` hands the agent X, so the AGENT opens: the page sees it is not the human's turn and
    // asks the opponent, exactly as after any human move. Anything else keeps the human on X.
    case "new": {
      const after = newGame(g.size, g.win, data?.human === "O" ? "O" : "X");
      return { state: after, actions: [shown(after)] };
    }

    // THE QUIT BUTTON, and it is one line: `close` ends the app with no server code — the agent is told
    // (`notifications/app/closed`, by "user"), the tab leaves the strip, the process exits. No state
    // change and no confirmation: the position is already on disk, so quitting loses nothing a restart
    // does not bring back. THE EXAMPLE IS DELIBERATELY NOT DURABLE (card t20261025-061114-f6b7): the
    // tab IS the app — a game is a session toy, so the Quit ends it, where the durable board's Close
    // would only detach the page.
    case "quit":
      return { close: "the Quit button" };
    default:
      // An unknown event is NOT a decision. Waking a model for a typo in your own page would teach it to
      // debug your JavaScript by hand, one turn boundary at a time.
      return { actions: [{ action: "error", data: { reason: "unknown event: " + name } }] };
  }
}

/**
 * THE AGENT'S MOVE, as the app's own tool — the door the `opponent` notification points at.
 *
 * This replaces an `action("move")` export, and the reason is the shape of the two audiences. A page's
 * `play` is a REQUEST: its refusal is the answer to a click that is waiting, so it can carry the whole
 * state and be drawn at once. The agent's move WAS a frame pushed while nobody's request was open, so its
 * `illegal` action reached no one — the agent's tool result said only "sent". A TOOL has a result, and
 * the result goes back to the caller that is waiting for it, which is why the refusal now lives here.
 *
 * **The move is VALIDATED here, and that is not distrust of the model — it is the same `legal` the
 * human's click goes through.** An illegal call answers `{ok: false, error}` and nothing else happens:
 * `app_mcp.ts` returns it as the tool's MCP error and touches nothing — no state, no persist, no frame,
 * no notification. The agent reads the reason, picks again and calls `move` once more, in the same turn.
 *
 * A legal call commits exactly as `play` does, with `asked` counting the decision, and hands back the
 * `Handled` the page needs: the new state, then the redraw. Those actions are PUSHES (no request is
 * open), so what a page actually receives is the "this app changed" they cause and the re-read it answers
 * with — the page draws only from an answer, and this file hands it nothing it could draw from directly.
 */
export interface ToolAnswer {
  ok: true;
  /** What the agent reads back: the square played and the board it produced. */
  text?: string;
  /** Adopted, persisted and broadcast by `app_mcp.ts` — the new position and the redraw. */
  handled?: Handled;
}
/** A REFUSED CALL. The reason is the tool's MCP error text, and nothing else in the process moves. */
export interface ToolRefusal {
  ok: false;
  error: string;
}
export type ToolOutcome = ToolAnswer | ToolRefusal;

export interface AppTool {
  name: string;
  description: string;
  /** JSON Schema, listed verbatim — this is how the agent learns what `move` takes. */
  inputSchema: Rec;
  run(args: Rec, g: Game): ToolOutcome;
}

// The agent's whole vocabulary is ONE tool. That is the ceiling to aim for, not a limitation of this
// app: everything else it might have said is something the rules above already decide, and anything it
// needs to KNOW arrives as state (`text` is the board) rather than as a second verb.
export const tools: AppTool[] = [
  {
    name: "move",
    description: [
      "Play one square for the opponent. A square is a column letter and a 1-based row: A1 is top-left.",
      "The move goes through the same legality check as the person's own click, and an illegal one is",
      "REFUSED BY THIS TOOL — the call fails with the reason (a taken square, a square off the board,",
      "not your turn, a finished game) and the position is unchanged. Read the reason, pick again, call",
      "move once more in the same turn: no frame follows and the page is told nothing.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        square: { type: "string", description: 'The square to play, e.g. "B2".' },
      },
      required: ["square"],
    },
    run(args, g) {
      const v = legal(g, args.square, g.agent);
      if ("reason" in v) return { ok: false, error: v.reason };
      // `asked` counts the DECISION, as it always did: a legal answer is the one that lands.
      const after = commit({ ...g, asked: g.asked + 1 }, v.i, g.agent);
      const square = nameSquare(after, v.i);
      let text = "played " + square + "\n" + after.text;
      if (after.over) {
        text += "\n" +
          (after.over === "draw"
            ? "the game is a draw"
            : "the game is over: " + after.over + " wins");
      }
      return {
        ok: true,
        text,
        handled: {
          state: after,
          actions: [{ action: "played", data: { square } }, shown(after)],
        },
      };
    },
  },
];
