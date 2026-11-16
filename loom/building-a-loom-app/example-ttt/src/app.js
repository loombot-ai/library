// The BROWSER half of the board example. Its comments are the point: this file is what an agent copies
// when it is asked to build an app, so what it says about the split matters as much as what it does.
//
// THE SPLIT, from the page's side:
//
//   * every click ASKS the app one question and nothing else — the page never decides anything it renders;
//   * a click the rules can answer comes back in a few milliseconds: a placed stone, or a "refused" with a
//     reason (taken square, out of turn, finished game);
//   * the ONE thing that needs judgement — which square the opponent plays — comes back when the agent has
//     answered, which is seconds, because a model answers at a turn boundary. So the page says "thinking…"
//     instead of pretending otherwise.
//
// TWO REQUESTS PER HUMAN MOVE, and the reason is in rules.ts: a rule returns either a state change or a
// decision, never both. So `play` commits the stone mechanically (instant, always) and `opponent` is the
// separate question the agent is woken for. The page pays one more request on a carriage that is already
// warm to keep the human's own stone off the model's clock; the alternative — one event doing both — is
// the one mistake the example exists to prevent.
//
// What this file must NOT do: decide legality itself. Not because it could not — a taken square is obvious
// — but because there would then be two copies of the rule, and the day they disagree the page draws a
// board the channel refuses. One owner per rule, and the owner is rules.ts, because it is also the thing
// whose state the channel server persists (channel-state.json).
//
// ── THE APP IS FETCH-FIRST, AND THIS IS THE WHOLE OF THE PAGE'S HALF OF THE CONTRACT ─────────────────
// (README.md, "An app is FETCH-FIRST and has no socket". Nothing below opens a socket, and that is the
// point rather than a detail: a publisher serves an app through a service worker at the edge, whose scope
// covers this page's whole directory — HTML, CSS, `app.js` and DATA are one mechanism there. An app that
// opens no socket cannot have a socket that does not arrive.)
//
//   * ONE QUESTION IS ONE `POST` to `__event`, under this document's own directory, and the answer is the
//     frame a socket used to carry: `{action, data}`. The switch at the bottom of this file is the old
//     `onmessage`, by action name.
//   * THE ADDRESS IS RELATIVE — no host, no port, no session id, no app name, no device. This page is at
//     `/a/<session>/app/<name>/` on the machine and at `/d/<device>/a/<session>/app/<name>/` at the edge,
//     so the relative URL is the same one in both. `__event` is RESERVED: `registered.ts` refuses it as a
//     file name, so an app shipping a file of that name cannot shadow its own data path.
//   * WHEN TO RE-READ IS THE PAGE'S TO SAY, because nothing can be pushed at a page with no socket. The
//     panel holds the session socket, so it is what learns this app has something to say: it posts ONE
//     message into this frame, and the line loombot splices into every app page turns it into a
//     `loom/app-changed` DOCUMENT EVENT. No data, no id, no app name, no protocol — one read answers it,
//     and the state is what carries the change.
//   * AND WHAT THE PAGE SAYS WHEN IT CANNOT REACH THE APP IS PART OF THE CONTRACT. A request can fail, and
//     a page may not be SILENT about it: this page's board is EMPTY until a state arrives, so a page that
//     never reached its app and a board with nothing on it would look exactly alike. That is not a
//     hypothetical — the task board measured it on a phone (2026-10-21) and got "the app still does not
//     display". So "the channel" below is a state with words on the page and a retry of its own.

/** THE ONE ADDRESS THIS PAGE ASKS, relative to its own document: the app's own data path. */
const ENDPOINT = "__event";

const el = (id) => document.getElementById(id);
/**
 * ONE REQUEST, ONE ANSWER — the page's whole way of talking to its app.
 *
 * IT THROWS A SENTENCE AND NEVER A BARE NETWORK ERROR, because everything it can fail with ends up in
 * front of a person: "Failed to fetch" is what a console says, and `#channel` owes a reader the reason in
 * words. A 503 is not a dead app either — loombot answers it when nothing could answer the event (no app
 * server is connected), and the sentence it carries is passed through rather than replaced by this page's
 * guess.
 *
 * AND THE ERROR KEEPS THE STATUS, because a 404 is a DIFFERENT FACT from a 503: loombot has no such app any
 * more, so that is the app being OVER rather than a channel that will come back. `unreachable` below is
 * where the two are told apart.
 */
async function ask(event, data = {}) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, data }),
    });
  } catch (e) {
    throw new Error((e && e.message) || "the app did not answer");
  }
  if (!res.ok) {
    let why = "";
    try {
      const said = await res.json();
      why = said && said.reason ? String(said.reason) : "";
    } catch { /* a refusal with no body is still a refusal */ }
    const err = new Error(why || ("the app answered " + res.status));
    // THE NUMBER IS PART OF THE FACT and not spare detail: it is the whole difference between "not
    // answering, and it retries" and "this app is over", and a page that dropped it would have nothing
    // to tell the two apart by.
    err.status = res.status;
    throw err;
  }
  try {
    return await res.json();
  } catch {
    throw new Error("the app's answer was not a frame");
  }
}

/**
 * EVERY VERB THIS PAGE HAS goes through the same call, and `send` is its fire-and-forget half: a click
 * reports a fact and does not wait for the answer, because its caller is an event handler and a handler
 * that awaited would have to explain itself to nobody. What it does do is hand the answer to the same
 * switch a read's answer goes to — one path, whether the page asked or a click asked.
 */
const send = (event, data = {}) => {
  void ask(event, data).then(answered, unreachable);
  return true;
};

// ── the page's own bookkeeping ────────────────────────────────────────────────────────────────────────
/**
 * How many times in a row the agent has answered and the position is STILL its move.
 *
 * Re-asking is the PAGE's business, not a game rule: the rules cannot pick a square, so there is nothing
 * mechanical to fall back on, and an unbounded retry loop would spend a turn boundary per attempt for as
 * long as a confused model kept it up. Two silent retries, then the page stops and says so — which is
 * honest about who is stuck.
 *
 * Since 2026-10-24 a REFUSED move cannot bring it here: the agent answers through its own `move` tool,
 * whose error goes back to the agent alone — no state changes, so no re-read follows and nothing below
 * sees the refusal at all. What this counts is the one shape that can still mean it: a rule that accepted
 * an answer without advancing the turn, which is a rules bug rather than a bad move.
 */
let rejected = 0;
const RETRIES = 2;
/**
 * The state's own `asked` count at the moment this page put the question, or -1 for "never asked".
 *
 * `rules.ts` counts a DECISION in `asked` when it LANDS (the `move` tool commits it), and a move that
 * lands ADVANCES THE TURN — so "the agent answered and it is still the agent's turn" is the shape above.
 * An illegal call never moves the count at all: it is the tool's error, the agent's to correct in its
 * own turn, and this page is not told it happened.
 */
let askedFrom = -1;
/** Whether a question is out and the agent has not answered it yet. */
let askPending = false;
/**
 * Whether this page has stopped asking — the guard above ran out. A REFUSED move cannot reach it (the
 * tool's error goes to the agent alone); only an answer accepted without the turn moving can.
 */
let gaveUp = false;

// ── the last read, kept across a reload ───────────────────────────────────────────────────────────────
//
// **THE PAGE CONTRACT, RULE 8** (README.md; `task-board/src/app.js` has the long copy of this). This page is
// reloaded by something that is not a person finishing with it — the panel reloads an open frame when the
// app's version moves, and a restart of the MCP re-registers — and a page whose only copy of the position
// was a variable came back as an EMPTY GRID, which is exactly what a game nobody has started looks like. So
// the last position is kept, and painted before the first ask:
//
//   * ONE KEY PER APP AND SESSION, from the ADDRESS — `/a/<session>/app/<name>/` is the machine and
//     `/d/<device>/a/<session>/app/<name>/` is the edge, so two sessions never share a board;
//   * WRITTEN BY A SUCCESSFUL READ AND NEVER OTHERWISE, and drawn back only after the same shape check a
//     frame would have to pass, so a corrupt value is no position rather than a board of `undefined`.
//
// AND THE PAINT ASKS NOTHING: `draw` alone, never `fold` — a painted position is a picture of what the
// rules held, and whether it is somebody's move is the APP's fact that the next read settles. This app's
// frames carry no `at`, so "the newer read" is simply the read that succeeded last.
const MINE = /\/a\/([^/]+)\/app\/([^/]+)/.exec(location.pathname);
const KEEP = MINE ? "app:" + MINE[1] + ":" + MINE[2] + ":read" : null;

/** Whether this is a position this page can draw — the one shape check, used keeping and reading back. */
function whole(s) {
  return !!s && typeof s === "object" && Array.isArray(s.cells) &&
    typeof s.size === "number" && s.cells.length === s.size * s.size &&
    (s.human === "X" || s.human === "O");
}

function keep(s) {
  if (KEEP === null || !whole(s)) return;
  try {
    localStorage.setItem(KEEP, JSON.stringify({ v: 1, state: s }));
  } catch { /* a full or refusing store is not this page's fault: the screen is unaffected */ }
}

/**
 * THE LAST POSITION, drawn before anybody answers.
 *
 * AND NOTHING IS SAID ABOUT IT (owner, 2026-11-07: `ttt那个app也很啰嗦`): the sentence that used to stand
 * here - "showing the last position this page read - asking the app for a newer one" - was the red line a
 * player saw on a healthy board. A picture of an old position is not a failure and does not get a
 * paragraph; the read below replaces it in the frame it arrives.
 */
function paintLastRead() {
  if (KEEP === null) return;
  let kept = null;
  try {
    kept = JSON.parse(localStorage.getItem(KEEP) || "null");
  } catch {
    return; // a corrupt value is no position
  }
  if (!kept || kept.v !== 1 || !whole(kept.state)) return;
  draw(kept.state);
}

// ── draw ─────────────────────────────────────────────────────────────────────────────────────────────
// One renderer, fed ONLY by the state the rules send. A click draws nothing: the board on screen is always
// the board the rules hold, which is what makes an illegal position impossible to render. The agent's
// side cannot dirty it either since 2026-10-24: its `move` is a TOOL, refused inside the call, and a
// refused call never reaches this page or the channel at all.
function draw(s) {
  const board = el("board");
  // ONE NUMBER, and the CSS owns the geometry: the board is --n equal columns, each cell is square by
  // `aspect-ratio`, and how wide the board may be is the page's business. This set grid-template-columns
  // itself, to `repeat(n, auto)`, which is how a fixed 4rem cell stayed 4rem at 15 columns and ran off
  // the page (see the note in index.html).
  board.style.setProperty("--n", String(s.size));
  if (board.children.length !== s.cells.length) {
    board.textContent = "";
    for (let i = 0; i < s.cells.length; i++) {
      const b = document.createElement("button");
      // The square's NAME is what the rules and the agent both speak: B2, not index 4.
      b.dataset.square = String.fromCharCode(65 + (i % s.size)) +
        String(Math.floor(i / s.size) + 1);
      b.onclick = () => play(b.dataset.square);
      board.appendChild(b);
    }
  }
  for (let i = 0; i < s.cells.length; i++) {
    const b = board.children[i];
    b.textContent = s.cells[i] ?? "";
    b.disabled = Boolean(s.cells[i] || s.over || s.turn !== s.human);
  }
  el("verdict").textContent = s.over
    ? (s.over === "draw" ? "a draw" : s.over === s.human ? "you win" : "the agent wins")
    : s.turn === s.human
    ? "your move"
    : "thinking\u2026";
}

// ── clicks: ask, render nothing ───────────────────────────────────────────────────────────────────────
function play(square) {
  el("note").textContent = "";
  send("play", { square });
}

// A new game is arithmetic too, and it is the only thing that clears a page that has given up asking:
// an empty board is a position nobody has been refused from.
el("new").onclick = () => {
  rejected = 0;
  gaveUp = false;
  el("note").textContent = "";
  send("new");
};

// QUIT: the rules end the app (`close` in rules.ts). What follows is the `player_left` handler below.
el("quit").onclick = () => send("quit");

/**
 * THE SECOND HALF OF THE TWO-REQUEST SEQUENCE, folded from the state the rules sent — and the whole of
 * when this page asks the agent anything.
 *
 * `askedFrom` is what makes this arithmetic rather than a guess (see the note where it is declared): a
 * move that lands advances the turn, so a state that is still the agent's after it has answered means the
 * answer was accepted without the turn moving — a rules bug, not a bad move — and the page may ask again,
 * bounded, because each ask is a turn boundary.
 */
function fold(s) {
  // `s.over` is the end of the game, and a finished game is nobody's move.
  const mine = Boolean(s.over) || s.turn === s.human;
  // THE AGENT ANSWERED: its move was folded into the position, and `asked` counts that.
  const came = askedFrom >= 0 && s.asked > askedFrom;
  if (came) {
    askPending = false;
    // AND THE COUNT MOVES WITH IT, whether or not another question follows: askedFrom means "the count at
    // the last question this page has had ANSWERED", so leaving it behind would make every later re-read
    // look like one more refusal, and the note's "N in a row" would grow on changes nobody made.
    askedFrom = s.asked;
    // AND IT LANDED, which is the only thing that clears a note this page wrote itself. The agent's
    // `played` frame used to do that; a page with no socket has one state and this is what it says.
    if (mine) {
      rejected = 0;
      gaveUp = false;
      el("note").textContent = "";
    }
  }
  // NOT THE AGENT'S MOVE: the game is over, or it is the human's. Nothing is asked — this is what keeps a
  // mechanical click from costing a turn boundary, and it is checked before anything else can ask.
  if (mine) return;
  // GIVEN UP IS FINAL UNTIL A NEW GAME, and it has to be checked HERE rather than left to the counter
  // below: a re-read with nothing new in it (the panel says "changed" for its own reasons) would otherwise
  // ask again, once per changed, for ever.
  if (gaveUp) return;
  // STILL WAITING, and nothing has come back: a re-read while the agent is thinking is not a new reason to
  // ask, and asking twice would spend two turn boundaries on one move.
  if (askPending && !came) return;
  if (came) {
    rejected++;
    if (rejected > RETRIES) {
      gaveUp = true;
      el("note").textContent = "the agent's move is refused \u2014 press new game.";
      return;
    }
    el("note").textContent = "";
  }
  askOpponent(s);
}

/**
 * Ask the agent for its move. THE ONE DECISION in this app.
 *
 * Sent by the page rather than by the rules, because `rules.ts` answers events and does not originate
 * them — and the guard against asking when it is not the agent's move lives THERE, so this can be a plain
 * send without a second copy of the rule. A question the rules can answer is refused by them for free,
 * which is why this does not need to check the turn again.
 *
 * THE ANSWER TO IT IS `ack`, not a move: a rule that returns `null` writes no frame, and `channel.ts`
 * answers a request nothing answered with `{action:"ack"}` at once, so the page is not left holding a
 * request for ten seconds. The move itself arrives later, as a re-read.
 */
function askOpponent(s) {
  askPending = true;
  askedFrom = s.asked;
  send("opponent");
}

// ── the answer: one switch on `action`, and it is the old `onmessage` ────────────────────────────────
/**
 * EVERY ANSWER THIS PAGE CAN GET, whether it asked or a click did.
 *
 * WHAT IS NOT HERE IS AS MUCH OF THE LESSON AS WHAT IS. There is no `played` case: that is what the app
 * PUSHES when the agent's `move` tool lands, a push is not a request's answer, and a page with no socket
 * is never handed one — the re-read that follows is, and `fold` above reads what it needs out of the
 * state it carries. And there is no `illegal` case because there is no `illegal` action anywhere any more:
 * an illegal move is the TOOL'S error, returned to the agent that made the call, and this page is never
 * told it happened. There is no `player_left` frame to wait for either except the answer to this page's
 * own `quit`: an app that stops is a request that FAILS, and "the channel" below is where that is said.
 */
function handle(action, data = {}) {
  switch (action) {
    // Mechanical, and the only thing that ever draws the board. A change the app pushes is APPLIED AT
    // ONCE, and nothing this page is in the middle of doing refuses it (README.md, the page contract, rule
    // 6: a page's state never gates another page's action, or the agent's). This page holds nothing it
    // could lose, so there is nothing to keep while a change is waiting.
    case "state":
      draw(data);
      // AND THE READ IS KEPT, for the document after this one (the section above): a successful read, and
      // only one.
      keep(data);
      // The position is committed, so NOW there is something to ask about. This is the second half of the
      // two-request sequence, and the rules refuse it if it is not actually the opponent's move.
      fold(data);
      return;

    // Mechanical too: the rules refused, with a reason, before any model was involved. If this ever feels
    // slow, something has been moved out of rules.ts that belongs in it.
    //
    // A REFUSAL CARRIES THE WHOLE STATE (rules.ts `refuse`), so it is the same renderer fed the same shape
    // — the page has no second way to draw.
    //
    // AND IT IS NOT THE PLAYER'S BUSINESS (owner, 2026-11-07: `ttt那个app也很啰嗦`, nothing about legality):
    // the board is redrawn and nothing is explained. Every square a player can press is already disabled, so
    // the refusals that reach here are the rules refusing the agent's own answer, and the reason it carries
    // is a sentence a player would have to be a referee to want.
    case "refused":
      draw(data);
      return;

    // THE REQUEST WAS TAKEN AND THE APP HAS NOTHING TO ADD — and for this app that is what a DECISION
    // answers with: `opponent` wakes the agent and writes no frame, so `channel.ts` acks it. Nothing to
    // draw: the state already says "thinking…", and the move arrives as a re-read.
    case "ack":
      return;

    // THE APP IS OVER: its own Quit, which is the answer to this page's `quit` — the app's server writes
    // the farewell frame and then exits, so the request that caused it carries it back.
    // **AND THIS IS THE ONLY FRAME A PAGE EVER SEES OF AN ENDING.** An app the AGENT stopped (or one that
    // crashed, or a session that ended) pushes that same farewell at nobody: a page with no socket is
    // handed no pushes, and what it gets instead is `404 no such app` on its next request — `unreachable`
    // above, and the SAME state, because it is the same fact about the same app.
    case "player_left":
      ended(data.reason);
      return;

    // AN EVENT THE RULES DID NOT RECOGNISE. Their answer, not the agent's, and never a notification — a
    // model woken for a typo in this file would be one turn boundary per typo.
    case "error":
      return;
  }
}

// ── the channel, and what this page says while it cannot reach the app ────────────────────────────────
//
// THE DEFECT THIS SECTION EXISTS FOR, measured on a phone against a live loombot (2026-10-21, on the task
// board): the page drew its chrome and under it NOTHING, which is exactly what a board with nothing on it
// looks like — and on this page the chrome IS the board's empty grid, so a page that never reached its app
// and a game not yet started would be the same picture. A request can fail; a page may not be SILENT
// about it. So the channel is a STATE, drawn in `#channel`:
//
//   "connecting"  a read is in flight and has not been answered yet.
//   "open"        the app answered. Silence here is the HEALTHY case's signature, which is what keeps an
//                 empty board from ever sounding like a page that failed.
//   "closed"      a request failed, and the reason is in words. RETRIED, on a ladder of its own.
//   "over"        the APP is over, and it is TERMINAL. Two ways to learn it and ONE state: the answer to
//                 this page's own Quit (`player_left`), and a 404 to any other request — an app the AGENT
//                 stopped, one that crashed, or a session that ended leaves no registration, so loombot
//                 answers `404 no such app` and that is the only witness a page with no socket has. Not a
//                 channel to retry: nothing is listening, so the sentence names the one move that helps
//                 (start it again and reload).
//
// **IT LEARNS OF A FAILURE WHEN IT ASKS, AND NOWHERE ELSE** — that is the design and not an oversight. An
// app has no socket, so nothing can push a failure at this page: it finds out at the next request — a
// press, a re-read the page asked for, or its own retry. What it must never do is look like a board that
// was read and found empty, which is why the words are on the page and not in a console.
//
// THE RETRY IS THIS PAGE'S OWN. The delay doubles up to LAST_RETRY_MS (a page that hammered loombot would be
// somebody else's outage), and it starts over when the network comes back (`online`) or the person comes
// back to the tab (`visibilitychange`). A background tab gets no retry: iOS suspends one mid-request, and
// the wake event is what brings it back.
const FIRST_RETRY_MS = 1000;
const LAST_RETRY_MS = 15000;
let channel = "connecting";
/** The delay the NEXT retry will wait: doubled on every failure, and put back to FIRST by an answer. */
let retryMs = FIRST_RETRY_MS;
/** The delay the PENDING retry is waiting, or 0 for none — what `#channel` counts down. */
let retryInMs = 0;
let retryTimer = 0;
/** Whether the app ever answered, which is how "connecting" and "reading again" are told apart. */
let everOpened = false;
/** Why the last attempt failed, in the app's or the network's own words, or "" — the sentence in `#channel`. */
let closedReason = "";

/** A BACKGROUND TAB ASKS NOTHING: iOS suspends one mid-request, and a wake event is what brings it back. */
function backgrounded() {
  return document.hidden === true || document.visibilityState === "hidden";
}

/** `#channel`, in a person's words — `""` when the app answers and the board speaks for itself. */
function channelText() {
  if (channel === "over") {
    return closedReason === "" ? "the app is over." : "the app is over (" + closedReason + ").";
  }
  if (channel === "closed") {
    const why = closedReason === "" ? "" : " (" + closedReason + ")";
    const when = retryInMs > 0 ? "retrying in " + Math.round(retryInMs / 1000) + "s" : "retrying";
    // ONE SENTENCE, AND IT SAYS ONLY WHAT A PLAYER NEEDS: the app is not answering, and this page is trying
    // again. The paragraph that followed it - which position the board is showing, and why the grid is
    // empty - was the red line the owner called wordy (`ttt那个app也很啰嗦`, 2026-11-07).
    return "the app is not answering" + why + " \u2014 " + when + ".";
  }
  // OPEN, AND THEREFORE SILENT: the healthy case's signature.
  if (channel === "open") return "";
  return everOpened ? "reading the board again\u2026" : "connecting to the app\u2026";
}

function renderChannel() {
  el("channel").textContent = channelText();
}

/** AN ANSWER: the channel is open, the ladder is reset, and the frame goes to the one switch. */
function answered(frame) {
  everOpened = true;
  channel = "open";
  clearTimeout(retryTimer);
  retryTimer = 0;
  retryInMs = 0;
  retryMs = FIRST_RETRY_MS;
  closedReason = "";
  handle(frame && frame.action, (frame && frame.data) || {});
  renderChannel();
}

/** WHAT A REQUEST SAYS WHEN THE APP IS GONE — the words in brackets in `channelText`, and the one thing a
 * page can say without knowing what loombot put in a body it sends as plain text. */
const GONE = "its server is gone";

/**
 * NOT AN ANSWER: the reason goes on the page, and it is retried — unless the app is GONE, where a retry
 * argues with a fact.
 */
function unreachable(e) {
  if (channel === "over") return;
  // **A 404 IS THE APP BEING OVER, AND NOTHING ELSE IS.** `startWorker`/`stopWorker`, a crash and the
  // session ending all leave loombot with no registration, and it answers the next request `404 no such app`
  // (`loombot/routes.ts`). No socket is there to be pushed a farewell down, so this failing request is the
  // ONLY witness a page has — and it is TERMINAL: nothing is listening, nothing will be until the app is
  // started again, and a retry would be a page arguing with a fact. A 503 or a failed connection is the
  // other half of the same test: nobody answered THIS time, so the page keeps asking (`dropped`).
  if (e && e.status === 404) return ended(GONE);
  dropped((e && e.message) || String(e) || "the app did not answer");
}

/**
 * THE APP IS OVER, drawn in ONE place because there are two ways to learn it and they must not drift: the
 * `player_left` frame, which is the answer to this page's own Quit, and a 404 to anything else. A person
 * gets one sentence and one move out of either, and neither is a channel to retry.
 */
function ended(why) {
  channel = "over";
  closedReason = why || "unmounted";
  renderChannel();
}

function dropped(why) {
  closedReason = why;
  channel = "closed";
  retryLater();
  renderChannel();
}

/** THE LADDER: the delay doubles up to LAST_RETRY_MS, and a background tab is given none at all. */
function retryLater() {
  clearTimeout(retryTimer);
  retryTimer = 0;
  retryInMs = 0;
  if (backgrounded()) return;
  retryInMs = retryMs;
  retryMs = Math.min(retryMs * 2, LAST_RETRY_MS);
  retryTimer = setTimeout(fresh, retryInMs);
}

/**
 * READ THE BOARD — the ONE place a read is started, so the state, the switch and the retry cannot be
 * attached in one place and forgotten in another. `hello` is the event (`rules.ts`): it answers from
 * memory with the whole position, which is why a reload never costs a model call, and it is every retry's
 * first word too.
 */
function fresh() {
  clearTimeout(retryTimer);
  retryTimer = 0;
  retryInMs = 0;
  closedReason = "";
  channel = "connecting";
  renderChannel();
  void ask("hello").then(answered, unreachable);
}

/**
 * A NEW REASON TO TRY — the network back, or the person back at the tab — so the ladder starts over AND
 * the read happens now rather than when the old delay was due.
 */
function wake() {
  if (channel !== "closed") return;
  retryMs = FIRST_RETRY_MS;
  fresh();
}

/**
 * THE PAGE SAYS WHEN TO RE-READ, and this is the whole of the listener: the panel holds the session
 * socket, so it is what learns that this app changed, and its one message arrives here as a document event
 * (`loombot/routes.ts` `appPageSnippet` turns `{type:"loom/app-changed"}` into it, validating both halves).
 * Nothing is parsed, nothing is trusted, and what changed is not known — one read answers that.
 */
document.addEventListener("loom/app-changed", () => {
  if (channel === "over") return;
  void ask("hello").then(answered, unreachable);
});

document.addEventListener("visibilitychange", () => {
  if (!backgrounded()) wake();
});
globalThis.addEventListener("online", wake);

// THE LAST POSITION FIRST, THEN THE READ (rule 8): what a reload brings back is drawn from storage before
// anything is asked, and `fresh` below is what replaces it.
paintLastRead();
// LAST, and it has to be: `fresh` reads the state declared above it, and a `const` read before its own
// line has executed is a temporal-dead-zone throw rather than a page that merely failed to read.
fresh();
