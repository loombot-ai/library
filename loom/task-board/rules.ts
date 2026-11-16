/**
 * The task board PAGE's RULES — the mechanical half of the app `board_mcp.ts` serves, and the reason a
 * page turn is never a turn of the agent's.
 *
 * ## The one rule this file exists for: a page READS through here
 *
 * `app_mcp.ts` hands every browser event to `event()` below, and NOTHING reaches the agent unless a rule
 * returns `null`; with no rules module at all every event is REFUSED. So a read that happened in the
 * page's own JavaScript — a second parser, a fetch of the board's files, an index built once and trusted
 * afterwards — would either leave the page dead or become a second implementation of the record format,
 * drifting from `tasks.ts` the first time the format moves. This file reads the board WITH `tasks.ts`:
 * one parser, one set of state folders, one `<id>-<slug>.md` suffix rule.
 *
 * `event()` IS SYNCHRONOUS, and that is not a style choice: `app_mcp.ts` calls it as
 * `rules.event(name, data, state)` with NO await, so a promise returned here would be neither a decision
 * nor an answer — the page would silently get nothing. That is why the reader is `readBoard` (sync) and
 * not `list`/`show` (async), and why `tasks.ts` exports one at all.
 *
 * ## Two directions, ONE fact: which task the page is showing
 *
 * The records themselves are read-only here: no event changes one, and `board/` is still their only
 * store. What travels as well is a SELECTION, because it is the one fact only the two ends have:
 *
 *     the agent   `workers.board.select({id})`            → the DECLARED tool (`tools` below): checked
 *                                                          against the board, folded here by `remember()`
 *     the human   a click on a row                        → the page sends `showing`, folded here
 *     a page that connects, reloads or refreshes          → `board` carries `showing` back to it
 *
 * THAT LAST LINE IS THE WHOLE POINT, and it was a bug before it was a design: an action reaches whoever
 * is connected at that instant and is NEVER REPLAYED. Four `select`s in one afternoon opened a task on
 * nobody's screen, because the panel happened to be showing another app at the time. STATE is what a late
 * page can be given; an action is not.
 *
 * ## The agent's door is the app's OWN tools (1aeb): `select` and `refresh` are declared, not sent
 *
 * An app IS an MCP server, and its verbs are its own tools: `tools` at the foot of this file declares
 * `select({id})` and `refresh()` as `AppTool[]`, and `app_mcp.ts` registers them beside the three GENERIC
 * tools every app_mcp surface carries (`send`, `state`, `publish` — the whole surface an app that
 * declares NO tools is left with). A tool's run goes through the same `readBoard`/`remember` a page's
 * `showing` event folds through — one rules module, two audiences — and its answer is the TOOL RESULT:
 * an id the board does not hold is `select`'s error, naming the ids the last read held, and NOTHING
 * moves — no fold, no frame, no parts broadcast, no notification; a board that cannot be re-read is
 * `refresh`'s error, and the pages keep the read they have. The generic `send` stays on the surface and
 * is not the board's door (`action()` below is what it finds): its answer is written before anyone asks
 * what the fold did, which is the two-audience lie an error result replaces (card t20261024-183002-8072,
 * audit 097b).
 *
 * ## A second page is a second READER, not a stale copy of the first
 *
 * A RULE'S FRAME IS AN ANSWER, AND AN ANSWER HAS ONE READER — `event()`'s own comment states the rule
 * once, so it is not restated here. What is worth having here is the DECISION behind `showing` answering
 * with no action: the human's own click is the one thing that must not move anyone (t20261009-193432-d5f1;
 * the argument in full is in README.md). The panel shows one app at a time, so a second page is a page
 * somebody opened ON PURPOSE elsewhere (another device); moving one of them mid-read is an interruption
 * with no way back, while NOT moving it costs a disagreement that heals — `showing` is what the app
 * REMEMBERS, not a census of what each page draws. So `event("showing")` folds the state and returns NO
 * actions at all, and the agent's `select`/`refresh` are the PUSH: their run adopts state, and every open
 * page reads again.
 *
 * ## Where the board is
 *
 * `--board <path>`, default `board/` under the CWD. It is the SERVER's argv: the rules run inside that
 * process, and app_mcp has no channel to hand a rule a flag. The CWD is the agent's workdir under
 * `startWorker.mcp`, which is where a repo's own board/ lives.
 */
import { type Broken, readBoard } from "./tasks.ts";
import { markdownHtml } from "../file-viewer/render.ts";

type Rec = Record<string, unknown>;

/** `--flag value` off this process's argv: the same private convention `app_mcp.ts` uses. */
function flag(name: string): string | undefined {
  const i = Deno.args.indexOf("--" + name);
  return i >= 0 && i + 1 < Deno.args.length ? Deno.args[i + 1] : undefined;
}

const BOARD = flag("board") ?? "board";

/**
 * ONE READ OF THE LIST, as the page gets it: a ROW per record — never the record — and where and when it was
 * read.
 *
 * **THE BODY IS NOT IN HERE, AND THAT IS THIS FRAME'S WHOLE SHAPE** (card t20261024-052218-0bb3). Measured
 * on a 259-card board before the split: this frame was 1,977,123 bytes, and 1,854,085 of them — 93.8% — were
 * card text nobody had opened. Every re-read sent all of it, and a click did not ask for a row: the page drew
 * the detail from the frame it already had, so the list had to carry the corpus.
 *
 * Now a row is what a ROW draws (`rowOf`) and nothing else, and the other two things a page needs are
 * REQUESTS: one card is `cardFrame` (the page's `card` event), a search is `searchFrame` (its `search`
 * event). What travels on a re-read is a twentieth of the bytes, and the page never holds a corpus it did
 * not open.
 */
export interface Frame {
  board: string;
  at: string;
  /**
   * THE FILES THIS READ COULD NOT READ, one `{ path, state, reason }` each — and it is the reason the
   * page still draws the rows it HAS: until `readBoard` reported instead of throwing, one file with no
   * front matter block failed the whole board (t20260710-000000-0720). Sent with the rows so the page
   * says them, and never a substitute for them.
   */
  broken: Broken[];
  /** A ROW per record, in board order — see `rowOf`, and `cardFrame` for the card the row stands for. */
  records: unknown[];
  /**
   * WHICH TASK THE PAGE IS SHOWING, as this app remembers it — null for the list. It travels in the
   * SAME message as the records on purpose: a page that connects late has to find out what is showing,
   * and a second message for it would be a second thing to lose.
   */
  showing: string | null;
  /**
   * Set when the board could not be read AT ALL — a directory that is not one, a folder nothing may read.
   * ONE corrupt record is `broken` above and not this: it used to be, and one stray file then emptied a
   * page somebody was reading (t20260710-000000-0720).
   */
  error?: string;
}

/**
 * READ THE BOARD, and the whole of what this app does with it: every record, full, with where it came
 * from, when, and which task the page is showing. It is exported so a test can drive it against a
 * temporary board — the path otherwise arrives on argv, which a test process does not own.
 *
 * A board that could not be read comes back as an ERROR IN A FRAME, not as a throw: a throw in a rule is
 * answered by the server with a sentence about app code being broken, which tells the reader nothing.
 * And it is not a decision either — there is nobody to ask.
 *
 * ONE RECORD IS NOT THE BOARD (t20260710-000000-0720): a file that cannot be read is named in `broken`
 * beside the rows that DID read, because a page that emptied itself over one stray file was the worse
 * half of that failure. `error` is left for a read that produced nothing at all.
 */
export function boardFrame(dir: string, showing: string | null = null): Frame {
  const at = new Date().toISOString();
  try {
    // ROWS, not records: the body of a card is the `card` event's answer, and a list never needs one (see
    // `Frame` above). This is the only thing the list is drawn from.
    const read = readBoard(dir);
    return { board: dir, at, broken: read.broken, records: rowsOf(read.records), showing };
  } catch (e) {
    // A BOARD THAT CANNOT BE READ STILL SAYS WHAT IS SHOWING: the records are what failed, not the
    // selection, and a page handed no `showing` would go back to the list the human was just pointed
    // away from.
    return {
      board: dir,
      at,
      records: [],
      broken: [],
      showing,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * WHAT ONE ROW OF THE LIST IS, and it is exactly what a row DRAWS: the title and its tags, the state it is
 * grouped under, and the three facts on its meta line — its id, its owner and their worktree, and when it
 * last changed.
 *
 * NOTHING ELSE IS ON THE WIRE. No `why`, no `acceptance`, no rendered HTML, no `links`, no `source`, no
 * `notes`, no `path`, no `created`: every one of those is the card's DETAIL, which the page asks for when
 * somebody opens one (`cardFrame`). Empty fields are DROPPED rather than sent as `""`, so a board whose
 * records have no owner and no worktree pays for neither — and the page already draws a missing owner as
 * "unowned" and a missing worktree as nothing at all.
 */
export function rowOf(record: unknown): Rec {
  const rec = record as Rec;
  const row: Rec = {};
  for (const key of ["id", "title", "state", "tags", "owner", "worktree", "updated"]) {
    const value = rec[key];
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    row[key] = value;
  }
  return row;
}

/** A whole board as ROWS — what the list's frame carries, in one call. */
export function rowsOf(records: unknown[]): Rec[] {
  return records.map(rowOf);
}

/**
 * DOES THIS RECORD MATCH A QUERY — over its ID, its TITLE and its BODY (why + acceptance criteria).
 *
 * **IT LIVES HERE, IN THE SERVER, AND THAT IS THE POINT** (t20261024-052218-0bb3). The page holds rows, so
 * a page that matched could only match a title — and the filter over the BODY is the thing that is not free
 * in this change, so it moved to the side of the wire the body is on. The app reads the records (through
 * `tasks.ts`, one parser) and answers the query with the IDS that match; the page draws those rows. That is
 * smaller in both directions: the page sends a query and receives ids, instead of holding every card's text
 * so it can search what nobody opened.
 *
 * THE MEANING OF A SEARCH IS UNCHANGED, line for line, from the page's old `matches`: every word has to
 * appear, case does not matter, and a SUBSTRING of the id is enough — a person and an agent quote a card by
 * its short suffix ("97d6"). It is exported because the rules are where a search is defined now, and the
 * page's own harness drives this function rather than a second copy of it.
 */
export function matches(record: unknown, query: string): boolean {
  if (query === "") return true;
  const rec = record as Rec;
  const why = typeof rec.why === "string" ? rec.why : "";
  const acceptance = Array.isArray(rec.acceptance) ? rec.acceptance.join("\n") : "";
  const hay = [rec.id, rec.title, why, acceptance]
    .map((part) => (part === undefined || part === null ? "" : String(part)))
    .join("\n")
    .toLowerCase();
  return query.toLowerCase().split(/\s+/).filter((word) => word !== "").every((word) =>
    hay.includes(word)
  );
}

/** The ids `matches` picks, in board order — what a search answers with. */
export function idsOf(records: unknown[], query: string): string[] {
  return records
    .filter((record) => matches(record, query))
    .map((record) => String((record as Rec).id ?? ""));
}

/**
 * THE DETAIL'S OWN REQUEST: ONE card, whole — the record's own words BESIDE the HTML the shared renderer
 * made of them (see `rendered` below), which is what the page puts in one `innerHTML`.
 *
 * `record: null` is an ANSWER and not an error: the id is not on the board (it moved, it was dropped, the
 * address named a card nobody has), and the page says so in its note. `error` is the board failing to read
 * at all, which is a different thing and is said differently.
 */
export interface CardFrame {
  board: string;
  at: string;
  /** The id that was ASKED FOR, whatever came back — so a page can drop an answer it no longer wants. */
  id: string;
  /** The card, rendered, or null when the board does not hold that id. */
  record: unknown;
  error?: string;
}

/**
 * ONE CARD, read from disk at the moment somebody opens it — which is also what makes an open card FOLLOW
 * the file: a re-read of the list is followed by a re-read of the card the page is showing, so a record that
 * changed on disk shows its change in a detail that is already open.
 */
export function cardFrame(dir: string, id: string): CardFrame {
  const at = new Date().toISOString();
  try {
    const found = readBoard(dir).records.find((record) => (record as Rec).id === id);
    return { board: dir, at, id, record: found === undefined ? null : rendered(found) };
  } catch (e) {
    return { board: dir, at, id, record: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * THE SEARCH'S OWN REQUEST, and its answer is IDS rather than records: the page already HOLDS the rows, so
 * sending them again would be paying twice for bytes it has. A query of `""` is every id on the board.
 *
 * `q` travels back so a page that has typed on can drop an answer to a query it no longer has — three
 * keystrokes are three requests, and a fast one must not draw over a slow one's answer.
 */
export interface SearchFrame {
  board: string;
  at: string;
  /** The query this answer is FOR. */
  q: string;
  ids: string[];
  /** Set when the board could not be read — a failed read must not be drawn as "no record matches". */
  error?: string;
}

export function searchFrame(dir: string, q: string): SearchFrame {
  const at = new Date().toISOString();
  try {
    return { board: dir, at, q, ids: idsOf(readBoard(dir).records, q) };
  } catch (e) {
    return { board: dir, at, q, ids: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * ONE RECORD WITH ITS MARKDOWN RENDERED, BESIDE ITS OWN TEXT — a frame carries BOTH, never one instead
 * of the other.
 *
 * The card's detail page draws two markdown strings: `why` (the body under `## Why`) and one item per
 * top-level bullet under `## Acceptance criteria`. The record's own words go on the wire unchanged, and
 * these two fields are ADDED beside them:
 *
 *     why, acceptance            the record's own words, character for character. The APP searches these
 *                                (`matches` above, over the record it just read), and an agent reading a
 *                                frame wants what the file has.
 *     whyHtml, acceptanceHtml    the SAME strings, run through the shared renderer.
 *
 * WHY THE RENDERER IS NOT WRITTEN HERE, and not copied either: `../file-viewer/render.ts` is the file
 * viewer's rendering of a `.md` file, and it is ALREADY shared — its one dependency is the shared parser
 * (`../../markdown/parse.js`) — so an edit reaches the viewer's view mode and this page alike. A renderer
 * written here would be the second implementation of a format this board avoids everywhere else (see the
 * header above, and `tasks.ts`, on one parser and one record format).
 *
 * AND THE HTML IS SAFE TO PUT IN A PAGE, by construction rather than by trusting a record: the renderer
 * escapes every text node it emits and draws a link as an anchor carrying a `data-href` and NO href, so
 * nothing a record can contain arrives as markup and nothing it wrote is something to press. That is the
 * same argument the viewer's own page rests on.
 *
 * IT RUNS IN THE SERVER, for the reason the renderer's header gives: it runs in the server, and the page
 * is handed finished, escaped HTML to put in one `innerHTML`. The page reads no file and parses no
 * markdown.
 *
 * EXPORTED because it is the CARD's shape and the page's own harness answers a `card` request with a
 * record it holds in memory — the rig puts records through THIS function rather than inventing a card, so
 * a page that needed a field the frame does not carry fails there instead of in a browser.
 */
export function rendered(record: unknown): unknown {
  const rec = record as Record<string, unknown>;
  const why = typeof rec.why === "string" ? rec.why : "";
  const acceptance = Array.isArray(rec.acceptance)
    ? rec.acceptance.map((item) => String(item))
    : [];
  return {
    ...rec,
    whyHtml: why === "" ? "" : markdownHtml(why),
    acceptanceHtml: acceptance.map((item) => markdownHtml(item)),
  };
}

/**
 * WHAT THIS APP REMEMBERS, and it is ONE FACT: which task the page is showing.
 *
 * It is not a second copy of the board — that is the two-writers trap this app was written to avoid, and
 * it is why nothing here holds a record. A SELECTION is not a record: it is a fact only this app can
 * hold, because an action is never replayed to a page that was not connected when it was sent, and a page
 * that connects late, reloads, or is swapped back into the panel has no way to learn what the last one
 * was showing.
 *
 * `app_mcp.ts` persists whatever a rule returns as `state` into `$TMPDIR/<app>/channel-state.json`, so
 * this survives the app being restarted. The records never leave `board/`.
 */
export interface BoardState {
  /** The task id the page is showing, or null for the list. */
  showing: string | null;
}

export const initial: BoardState = { showing: null };

/**
 * **THIS APP'S PARTS, AND THE WHOLE OF THE ANSWER TO "DOES A STATUS CHANGE MOVE THE CARD?"**
 * (card t20261024-061052-2740).
 *
 *     list    the records — every task and its state. Written by the AGENT (`tasks.ts`), so the app
 *             learns of a write only when it is told: `workers.board.refresh()`, which moves this and
 *             nothing else.
 *     card    the brief of the task on screen.
 *     shown   WHICH task is on screen — the pointer, and it is ITS OWN PART. That is not a convention to
 *             remember: a status change moves `list`, `shown` is not in that number, so nothing about a
 *             status change can move a page off the card its reader is reading.
 *
 * A page keeps the map it drew and re-reads only for a part it is DRAWING whose number moved. So the
 * board page with a card open draws `card` and `shown` and not `list`: the agent moving a task from open
 * to done costs that reader nothing at all, and the card stays where it is.
 */
const LIST = "list";
const CARD = "card";
const SHOWN = "shown";

/** What a rule returns. Never `null` here: a DECISION would wake the agent, and nothing in this app is. */
interface Handled {
  state?: BoardState;
  /** Which parts of this app's state this result moved — see `LIST`/`CARD`/`SHOWN` above. */
  parts?: string[];
  /**
   * What the page is handed: an action name and its payload, which `app_mcp` passes on verbatim. The
   * payload is `unknown` rather than `Rec` because the board frame is a NAMED shape (`Frame`) and an
   * interface does not satisfy an index signature — the one place the two meet is here.
   */
  actions?: { action: string; data?: unknown }[];
  close?: string;
}

/**
 * THE MEMBERSHIP ANSWER, ON A READ — does this read hold the id. ONE function, because two audiences ask
 * it: the page's `showing` fold (through `onTheBoard` below) and the agent's `select` tool, which refuses
 * with the ids around the miss. A second copy of this line would be the second thing that can drift from
 * `remember`.
 */
export function holdsId(records: unknown[], id: string): boolean {
  return records.some((record) => (record as { id?: unknown }).id === id);
}

/**
 * IS THAT ID A TASK ON THE BOARD? The app remembers what it can point at, and an id that names nothing
 * would be remembered as a task nobody can see — the page would say "no task", and the next page to
 * connect would be pointed at it all over again.
 *
 * A board that cannot be READ is not a reason to forget a selection: the id is taken at its word, and the
 * next read is what says whether it is still there. (The `select` TOOL answers an unreadable board the
 * other way — its own error, checking nothing — because an agent can re-read and call again; a click
 * cannot.) (`readBoard` is a folder read — 6ms for this repo's 108 records — once per click or select,
 * beside a render that repaints the whole list.)
 */
function onTheBoard(id: unknown, dir: string): string | null {
  if (typeof id !== "string" || !id) return null;
  try {
    return holdsId(readBoard(dir).records, id) ? id : null;
  } catch {
    return id;
  }
}

/**
 * THE FOLD ITSELF: the state this app should hold now that it has been told about `id` — which is the ONE
 * place the two directions below meet (the agent's `select` and the page's `showing`).
 *
 * The board's path is a parameter so a test can drive it against a board of its own: `event()` and
 * `action()` pass the process's `--board`, which a test process does not own. A selection that has not
 * changed comes back as the SAME object, so a click on the task already open leaves the state it had.
 */
export function remember(id: unknown, state: BoardState, dir: string = BOARD): BoardState {
  const showing = onTheBoard(id, dir);
  return showing === state.showing ? state : { ...state, showing };
}

/**
 * The events this page sends, all of them MECHANICAL — and the one thing it does not send, which is a
 * decision. `ready` (a page has just connected), `reload` and `refresh` (the human asked) are ONE answer:
 * the LIST, read again, with what is showing beside it.
 *
 * `card` and `search` are the other two reads, and they are separate requests ON PURPOSE: the list's frame
 * carries rows, so the body of a card costs nothing until somebody opens that card, and a search costs one
 * query instead of a corpus (see `Frame`). Neither is ever asked with `send` — they are the page's
 * `fetch`es, answered by this rule from the board on disk.

 *
 * ## A FRAME FROM HERE IS AN ANSWER, AND AN ANSWER HAS ONE READER — WHICH IS WHY THERE IS NO FLIP
 *
 * THE RULE, SAID ONCE, because this comment used to offer a flip that does not exist. What a rule writes
 * back goes one of two ways, and the SUBSTRATE decides which, not the rule: a frame produced while a
 * page's request is being handled carries that request's `reply` id and reaches ONLY the page that asked
 * (`channel.ts` `toBrowsers`, `app_mcp.ts` `onFrame`), and a frame nothing is waiting for is a PUSH, which
 * loombot turns into "this app changed" and every open page reads again. Everything this function returns is
 * written inside `onFrame`, so NOTHING RETURNED HERE CAN MOVE ANOTHER PAGE — an action included. The push
 * is the agent's act: `workers.board.select({id})` and `workers.board.refresh()` are declared in `tools`
 * below, their run adopts state, and every open page reads again.
 *
 * `showing` is the human's own choice coming back — they opened a task, or went back to the list — and it
 * is why `state()` can be asked "which task is open in the page?" at any moment. It answers with NO
 * action, and THAT IS THE DECISION (t20261009-193432-d5f1, argued in README.md): a click is that reader's,
 * and moving a second tab — or another device — to the task this one clicked is an interruption with no
 * way back. Adding `actions` here would not even buy it: the frame would carry the clicking page's own
 * `reply`, so it would reach that page, which has already moved, and nobody else. So this branch names
 * the two parts that moved and returns no actions at all.
 */
export function event(name: string, data: Rec = {}, state: BoardState = initial): Handled {
  // **A READ, AND IT MOVES NOTHING.** `ready`, `reload` and `refresh` answer with the board a page draws
  // and state nothing, so ten of them leave every number where it was — the property the whole map rests
  // on (`building-a-loom-app/README.md`, rule 7). A version that grew here would make every page's own
  // read look out of date and the mechanism would cost a read per read.
  if (name === "ready" || name === "reload" || name === "refresh") {
    return { actions: [{ action: "board", data: boardFrame(BOARD, state.showing) }] };
  }
  // THE OTHER TWO READS, and each is a REQUEST rather than a field of the list's frame: one CARD, and a
  // SEARCH. Both are answered from this process, in about a millisecond, and neither is a decision — the
  // agent is not woken by somebody opening a card or typing in the box.
  if (name === "card") {
    return {
      actions: [{
        action: "card",
        data: cardFrame(BOARD, typeof data.id === "string" ? data.id : ""),
      }],
    };
  }
  if (name === "search") {
    return {
      actions: [{
        action: "search",
        data: searchFrame(BOARD, typeof data.q === "string" ? data.q : ""),
      }],
    };
  }
  if (name === "showing") {
    // A SELECTION: `shown` moved if the id is a different one, and `card` moved with it, because the
    // brief on screen is the brief of that id. Answered with NO action — a click is that reader's, and an
    // action here would move nobody else anyway: this frame carries the clicking page's `reply` and
    // reaches only the page that asked (the rule is stated in this function's comment above). A click on
    // the task already open is the same object back (`remember`) and moves nothing, which is why the empty
    // list is an answer rather than an omission.
    const next = remember(data.id, state);
    return { state: next, parts: next === state ? [] : [SHOWN, CARD] };
  }
  if (name === "close") {
    // THE HUMAN'S Close, drawn by the page. What it ENDS is this server's call, not the rules': with
    // `--durable` (this entry's default, card t20261025-061114-f6b7) the page detaches and the app
    // stays registered — the tab stays in the strip and the next open needs nobody. Without it the app
    // ends: the agent is told (`notifications/app/closed`, `by: "user"`), the tab leaves the strip and
    // the process exits. Either way the board is on disk, so nothing is lost.
    return { close: "the Close button" };
  }
  // AN UNKNOWN EVENT IS NOT A DECISION: waking a model for a typo in our own page teaches it to debug
  // our JavaScript one turn boundary at a time.
  return {
    actions: [{
      action: "error",
      data: {
        event: name,
        reason: 'unknown event "' + name +
          '"; this board answers ready, reload, refresh, card, search, showing and close, and it writes' +
          " no record",
      },
    }],
  };
}

/**
 * THE GENERIC SEND'S FOLD — what `workers.board.send({action, data})` finds. The agent's DOOR is the
 * declared `select`/`refresh` tools at the foot of this file, where an illegal call is the tool's error;
 * `send` is one of the three GENERIC tools every app_mcp surface carries, it stays, and it is not the
 * documented door (example-ttt's OPPONENT.md: it is NOT your door). The action itself has already gone to
 * every connected page when this runs; this is the half that makes a select STICK: the app remembers the
 * selection, so the page that connects five minutes later opens the same task instead of the list.
 * Claiming a task and moving it between states stay with the agent (`tasks.ts`), and no record is written
 * here.
 */
export function action(name: string, data: Rec = {}, state: BoardState = initial): Handled | void {
  // *** A DATA CHANGE IS NOT A CODE CHANGE, AND THIS IS WHERE THAT DISTINCTION IS PAID. ***
  // `workers.board.refresh()` is what an agent calls after it moves a record: the board's
  // BYTES did not change, only the records did, so the pages are handed the new read AS AN ACTION. The
  // version never moves, so no page reloads and no player credential is re-minted.
  //
  // WHY THIS EXISTS AT ALL (Xiaohu, 2026-10-20, with a screenshot): the documented call was
  // `workers.board.publish({})`, and `publish` RE-REGISTERS THE APP (`app_mcp.ts` `publishNow` -> `register`),
  // which bumps the version and makes every open panel reload its page. A reload mints a FRESH PLAYER
  // CREDENTIAL, so there is a window where the page is up and this app's socket is not connected yet - the
  // page asks for the board the moment it connects, nobody can answer, and THE BOARD IS EMPTY UNTIL THE HUMAN
  // PRESSES REFRESH. `publish` is still right when the app's BYTES change; it was never right for a record.
  if (name === "refresh") {
    // **THE AGENT SAYS THE RECORDS CHANGED, AND THAT MOVES `list` AND NOTHING ELSE.** This is the one
    // place the board learns of a write at all: the records live on disk and the AGENT writes them
    // (`tasks.ts`), so the app cannot see a status change — it is told one happened. `shown` is
    // deliberately NOT in this list, and that is the whole answer to "does a status change force a page
    // to switch what it shows": the pointer is its own part, so a page with a card open is not even sent
    // looking, and the card its reader is reading stays where it is (card t20261024-061052-2740).
    return {
      actions: [{ action: "board", data: boardFrame(BOARD, state.showing) }],
      parts: [LIST],
    };
  }
  if (name !== "select") return;
  const next = remember(data.id, state);
  // THE AGENT POINTING EVERY PAGE AT ONE TASK: the pointer moved, and the card with it. A `select` for
  // the task already open moves nothing (`remember` gives the same object back).
  return { state: next, parts: next === state ? [] : [SHOWN, CARD] };
}

// ── the agent's door: the app's OWN tools (1aeb; card t20261024-183002-8072, audit 097b) ─────────────

// The board failed the app-is-mcp principle in exactly the way it is written to fail it: `select` and
// `refresh` — the two verbs an agent actually has against the page — had NO declaration, so they rode the
// generic `send`, whose answer ("sent select to the app; rules.action folded it into state") is written
// before anyone asks what the fold did. An unknown id answered success while the fold silently nulled the
// selection and the reason was said only on the page; a fold that threw answered the same success. The
// references are example-ttt's `move` (the shape below is its shape, at 1aeb) and example's `verdict`.

/** A REFUSED CALL. The reason is the tool's MCP error text, and nothing else in the process moves. */
export interface ToolRefusal {
  ok: false;
  error: string;
}

/** A legal call: `handled` is adopted, persisted and broadcast by `app_mcp.ts`, then the call is answered. */
export interface ToolAnswer {
  ok: true;
  /** What the agent reads back: what is now showing, or what a re-read counted. */
  text?: string;
  /** The fold — the SAME `remember` a page's `showing` event takes, so the two audiences cannot drift. */
  handled?: Handled;
}

export type ToolOutcome = ToolAnswer | ToolRefusal;

export interface AppTool {
  name: string;
  description: string;
  /** JSON Schema, listed verbatim — this is how the agent learns what the tool takes. */
  inputSchema: Rec;
  /**
   * The third parameter is the BOARD DIR, defaulted to this process's `--board`: `app_mcp.ts` calls
   * `run(args, state)`, and a test drives the same run against a board of its own — the convention
   * `boardFrame`, `remember`, `event` and `action` already follow.
   */
  run(args: Rec, s: BoardState, dir?: string): ToolOutcome;
}

export const tools: AppTool[] = [
  {
    name: "select",
    description: [
      "Point every page of this board at one task, and the app REMEMBERS it — a page that connects later",
      "opens the same task instead of the list. The id is checked against the board on disk, through the",
      "same read a page's own click folds through; an id the board does not hold is THIS CALL'S error,",
      "naming the ids the last read held, and nothing moves — no fold, no frame, no page is told. Read the",
      "ids, pick again, call select once more in the same turn.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description:
            'The task id to open, exactly as a record carries it, e.g. "t20261024-183002-8072".',
        },
      },
      required: ["id"],
    },
    run(args, s, dir = BOARD) {
      if (typeof args.id !== "string" || !args.id) {
        return {
          ok: false,
          error: 'select takes the id of a task on this board: { "id": "<task id>" }',
        };
      }
      const id = args.id;
      // ONE READ, and it answers three things: membership, the ids a refusal names, and the title an
      // adoption quotes. It is the same `readBoard` the page reads through — no second copy of the
      // record format, and nothing cached that could disagree with the disk.
      let records: unknown[];
      try {
        records = readBoard(dir).records;
      } catch (e) {
        return {
          ok: false,
          error: "the board at " + dir + " could not be read, so no id can be checked: " +
            (e instanceof Error ? e.message : String(e)),
        };
      }
      if (!holdsId(records, id)) {
        const ids = records.map((r) => String((r as Rec).id ?? "")).filter((x) => x !== "");
        return {
          ok: false,
          error: "no task " + JSON.stringify(id) + " on the board — the ids the last read held (" +
            ids.length + "): " + (ids.length ? ids.join(", ") : "(none)"),
        };
      }
      // THE FOLD IS THE PAGE'S OWN: `remember` is what a click's `showing` event folds through, so the
      // two audiences cannot disagree about what is showing. A select of the task already showing comes
      // back as the same object and names no parts — the same answer a click on the open card gives.
      const next = remember(id, s, dir);
      const rec = records.find((r) => (r as Rec).id === id) as Rec;
      const title = typeof rec.title === "string" ? rec.title : "";
      return {
        ok: true,
        text: "showing " + id + (title ? " — " + title : "") +
          (next === s ? " (it was already showing)" : ""),
        handled: { state: next, parts: next === s ? [] : [SHOWN, CARD] },
      };
    },
  },
  {
    name: "refresh",
    description: [
      "Re-read the board from disk and hand every open page the fresh list — call this after you moved a",
      "record (claim, update, release, create): the records live on disk and the app learns of a write",
      "only when it is told. THIS IS NOT publish: publish re-registers the app, bumps the version and",
      "reloads every panel, which mints a fresh player credential and can leave a board EMPTY until the",
      "human presses refresh; refresh changes no version and reloads no page. A board that cannot be",
      "re-read is THIS CALL'S error, and the pages keep the read they have.",
    ].join(" "),
    inputSchema: { type: "object", properties: {} },
    run(_args, s, dir = BOARD) {
      const frame = boardFrame(dir, s.showing);
      // A READ THAT THREW IS THE TOOL'S ERROR, NOT A SUCCESSFUL PUSH OF AN ERROR FRAME: a page can be
      // HANDED an error frame and draws it, but an agent that called refresh must be told the re-read
      // failed — the old send-shaped door answered "sent refresh to the app" while the fold threw.
      if (frame.error) {
        return {
          ok: false,
          error: "the board could not be re-read, so no page was handed a new frame: " +
            frame.error,
        };
      }
      return {
        ok: true,
        text: String(frame.records.length) + " tasks on the board, read at " + frame.at +
          " — every page re-draws this; no version bump, no reload.",
        handled: { actions: [{ action: "board", data: frame }], parts: [LIST] },
      };
    },
  },
];
