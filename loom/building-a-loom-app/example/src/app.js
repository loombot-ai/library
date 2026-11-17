// The BROWSER half of the example app. Its comments are the point: this file is what an agent copies
// when it is asked to build an app, so what it says about the split matters as much as what it does.
//
// THE SPLIT, from the page's side:
//
//   * every click sends an EVENT and nothing else — the page never decides anything it renders;
//   * events the app's rules.ts can answer come back in about a millisecond, in the answer to the very
//     request that asked;
//   * the ONE event that needs judgement ("raise the limit") comes back when the agent has answered,
//     which is seconds, because a model answers at a turn boundary. Say so in the UI rather than
//     pretending otherwise — "asking the agent…" is the honest spinner. What the answer looks like
//     when it lands is the one rule this file states about decisions, and it states it once, at the
//     switch below.
//
// What this file must NOT do: enforce the limit itself. Not because it could not, but because there
// would then be two copies of the rule — one here and one in rules.ts — and the day they disagree the
// page shows a number the channel refuses. One owner per rule, and the owner is rules.ts because it is
// also the thing whose state the channel server persists (channel-state.json — state.json is loombot's
// board file, and two writers on it corrupt each other silently).

// THE ENDPOINT, and this is the whole of the page's half of the app contract (README.md, "The page contract").
//
//   * the ADDRESS comes from the page: location.pathname IS this app's address, and its data is one POST
//     under it. Never location.origin — that is the one fact a frame with an OPAQUE origin cannot give you
//     (it reads "null", and a URL built from it throws before anything is sent). pathname is a fact of this
//     page's own URL, it survives that, and it needs no port, no session id and no app name: a publisher
//     that serves these bytes elsewhere supplies the page's address rather than the app spelling a host.
//   * the CREDENTIAL is the SESSION COOKIE, which the browser sends by itself because the page is served
//     from the address it asks. Nothing is spliced into these bytes for it, so there is nothing to read out
//     of them and nothing to keep.
//   * NOTHING IS PUSHED AT A PAGE. Every frame this page draws is the ANSWER to a request it made, and a
//     change the app has — a publish, or the agent's decision folded into state — arrives as ONE
//     `loom/app-changed` message from the panel, after which the page READS. That is the whole transport:
//     one request, one frame back.
const ENDPOINT = location.pathname.replace(/\/+$/, "") + "/__event";

const el = (id) => document.getElementById(id);

// ── the last read, kept across a reload ───────────────────────────────────────────────────────────────
//
// **THE PAGE CONTRACT, RULE 8** (README.md; `task-board/src/app.js` has the long copy of this). This page is
// reloaded by something that is not a person finishing with it — the panel reloads an open frame when the
// app's version moves, and a restart of the MCP re-registers — and a page whose only copy of the state was a
// variable came back EMPTY and then had to ask a server before it could say anything at all. So the last
// state is kept, and painted before the first ask:
//
//   * ONE KEY PER APP AND SESSION, from the ADDRESS — `/a/<session>/app/<name>/` is the machine and
//     `/d/<device>/a/<session>/app/<name>/` is the edge, so two sessions never share a read;
//   * WRITTEN BY A SUCCESSFUL READ AND NEVER OTHERWISE, and drawn back only after the same shape check a
//     frame would have to pass, so a corrupt value is no state rather than a page of `undefined`.
//
// This app's frames carry no `at`, so "the newer read" is simply the read that succeeded last; an app that
// stamps its reads compares them, which is what the board's page does.
const MINE = /\/session\/([^/]+)\/app\/([^/]+)/.exec(location.pathname);
const KEEP = MINE ? "app:" + MINE[1] + ":" + MINE[2] + ":read" : null;

/** Whether this is a state this page can draw — the one shape check, used keeping and reading back. */
function whole(s) {
  return !!s && typeof s === "object" &&
    typeof s.count === "number" && typeof s.limit === "number" && typeof s.raises === "number";
}

function keep(s) {
  if (KEEP === null || !whole(s)) return;
  try {
    localStorage.setItem(KEEP, JSON.stringify({ v: 1, state: s }));
  } catch { /* a full or refusing store is not this page's fault: the screen is unaffected */ }
}

let paintedNote = false;
/** THE LAST STATE, drawn before anybody answers — and NAMED as old, in the note the next read replaces. */
function paintLastRead() {
  if (KEEP === null) return;
  let kept = null;
  try {
    kept = JSON.parse(localStorage.getItem(KEEP) || "null");
  } catch {
    return; // a corrupt value is no state
  }
  if (!kept || kept.v !== 1 || !whole(kept.state)) return;
  draw(kept.state);
  el("note").textContent =
    "showing the last state this page read — asking the app for a newer one.";
  paintedNote = true;
}

// ── draw ─────────────────────────────────────────────────────────────────────────────────────────────
// One renderer, fed by the "state" action and by one fact of its own: whether an ask of ours is out
// (`pending`, below). The buttons decide nothing — a click that drew its own result would be a second
// copy of the rules, and it would be wrong the first time one is refused; what a click may say is what
// it is WAITING for, and `draw` owns the line from the first read onwards.
let pending = false;

function draw(s) {
  el("count").textContent = String(s.count);
  el("limit").textContent = "limit " + s.limit +
    (s.raises ? " (raised " + s.raises + "\u00d7 by the agent)" : "");
  // THE VERDICT LINE, drawn like every other fact: from the state's `verdict` field, which the rules
  // keep when the agent's decision is folded (rules.ts). While one of OUR asks is still out, the
  // spinner wins — no read has answered it yet. The read that carries a verdict IS the answer: it
  // names the outcome and ends the wait. (A SECOND ask can be ended early by the PREVIOUS ask's
  // verdict still in the state; the page then shows the last settled answer, which is the state that
  // is true, until the new one lands. The ask itself cannot live in the rules' state — a decision and
  // a state change are exclusive, `event` returns one or the other — so this is the page's own fact.)
  el("verdict").textContent = pending && !s.verdict
    ? "asking the agent\u2026"
    : s.verdict === "granted"
    ? "granted \u2014 the limit is " + s.limit
    : s.verdict === "denied"
    ? "denied \u2014 the limit stays " + s.limit
    : "";
  if (s.verdict) pending = false;
}

// ── clicks: send an event, render nothing ────────────────────────────────────────────────────────────
el("up").onclick = () => send("bump", { by: 1 });
el("down").onclick = () => send("bump", { by: -1 });
el("reset").onclick = () => send("reset");

el("ask").onclick = () => {
  // THE ONE DECISION. It reaches the agent as an MCP notification — one that names the app's own tool
  // as the way to answer — and is answered at a turn boundary, so the page says it is waiting, here so
  // the person sees it at once and from every read until the answer lands. Nothing else in this app
  // costs a model call.
  pending = true;
  el("verdict").textContent = "asking the agent\u2026";
  send("raise", { to: Number(el("to").value), why: el("why").value });
};

// ── the answers ───────────────────────────────────────────────────────────────────────────────────────
// Nothing arrives here that this page did not ask for, so this is `handle(what came back)`, not a listener.
function handle(action, data = {}) {
  switch (action) {
    // Mechanical, and the only thing that ever draws the numbers. The buttons do not touch it: a click that
    // drew its own result would be a second copy of the rules, and it would be wrong the first time one is
    // refused. THE FAULT IS NOT UNDONE HERE: `answered` has already taken the dead class, the sentence and
    // the retry ladder off, because a page told a `refused` or an `ack` is a page whose app answered.
    case "state":
      // THE STATE IS ALSO THE ANSWER TO "WHAT DID THE AGENT DECIDE", so the verdict line is drawn from it
      // like everything else (see `draw`). A page left saying "asking the agent…" after the agent has
      // answered is that trap in its smallest form, and a line the click may write but no read may redraw
      // is how it happens — the click's spinner is the one thing on this page that is not state, and the
      // next read owns replacing it.
      draw(data);
      // AND THE PAINTED SENTENCE GOES WITH IT: the note named an OLD read, and a read that answered is not
      // old. Only that sentence — a note a click wrote is the page's own, and nothing here owns it.
      if (paintedNote) {
        paintedNote = false;
        el("note").textContent = "";
      }
      // AND THE READ IS KEPT, for the document after this one (the section above): a successful read, and
      // only one.
      keep(data);
      return;
    // The app TOOK the event and has nothing to add yet: "raise" is on its way to the agent, and the answer
    // comes back later as a change this page is told about (see the listener below). Say so rather than
    // pretending to know.
    case "ack":
      return;
    // Mechanical too: the rules refused, with a reason, before any model was involved. If this ever feels
    // slow, something has been moved out of rules.ts that belongs in it.
    case "refused":
      draw(data);
      el("note").textContent = data.reason ?? "refused";
      return;
    // AND NO CASE FOR THE DECISION ITSELF — this file used to carry `raise_granted` / `raise_denied` arms
    // that could not run, and the rule they got wrong is stated here once: A DECISION'S ANSWER REACHES A
    // PAGE AS STATE. The agent answers through the app's own `verdict` tool (rules.ts), the tool's fold is
    // adopted, persisted and broadcast, and a broadcast is one "the app changed" that makes every page
    // READ AGAIN — the action name on it is delivered to nobody, because no request is waiting on a frame
    // (app_mcp.ts, above `Handled`). So the decision arrives as the re-read's `state`, and the two dead
    // arms are one live reading of it, in `draw`.
    case "error":
      el("note").textContent = data.reason ?? "error";
      return;
  }
}

/**
 * Ask the app something and get the frame to draw back — the ONE way this page talks to it.
 *
 * A REQUEST THAT CANNOT BE ANSWERED IS NOT A LOST CLICK: the fetch REJECTS with a sentence, and a person
 * reading the page sees it. What it must NOT do is throw the failure away half-read — THE STATUS IS KEPT on
 * the error, because a 404 and a 503 are two different facts about an app and `unreachable` below is where
 * they are told apart. One `catch` that treats every failure alike reports an app that is GONE as a channel
 * that is down, and a person who believes it is coming back waits for ever.
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
    // NOTHING ANSWERED AT ALL — the network's own words, which is a console's "Failed to fetch" and not a
    // sentence to hand a person. No status is set, because there was no answer to carry one: that is the
    // retryable half, and `dropped` is what says so.
    throw new Error((e && e.message) || "the app did not answer");
  }
  if (!res.ok) {
    // LOOMBOT'S OWN SENTENCE IS PASSED THROUGH rather than replaced by this page's guess: a 503 carries a
    // `reason` naming the actual cause ("no player is connected to this app"), and a 404 is `no such app:
    // <name>` as PLAIN TEXT — so a body that is not JSON is nothing to add, not a failure of its own.
    let why = "";
    try {
      const said = await res.json();
      why = said && said.reason ? String(said.reason) : "";
    } catch { /* a body that is not JSON is not an error here */ }
    const err = new Error(why || ("the app answered " + res.status));
    err.status = res.status; // 404 IS the app being over — `unreachable` reads this, and nothing else does
    throw err;
  }
  return await res.json();
}

/** A click, a change or a retry: ask, and hand whatever comes back to the one switch. */
function send(event, data = {}) {
  ask(event, data).then(answered, unreachable);
}

// ── the two ways a request fails, and the ONE difference between them ─────────────────────────────────
//
// THE PAGE IS WHERE THE PERSON FINDS OUT. The strip that leads here draws ONE dot with two states — the
// app's channel is up, or it is not, orange when it is not — and it stops there. THIS is where the person
// actually is, so the page says the same thing and stops pretending to be interactive.
//
// FOUR STATES, AND THE LAST TWO ARE TOLD APART BY THE STATUS CODE RATHER THAN BY THE WORDS:
//
//   answering      a request was answered. Say NOTHING about the channel: that silence is the healthy
//                  case's signature, and `answered` below is where it is drawn.
//   thinking       the app answered `ack` — a decision it put to the agent. `pending` and the verdict line
//                  draw that wait, and this section never touches it: it is not a fault.
//   not answering  a 503, or a fetch that threw. RETRYABLE: say it, say when it tries again, and ask.
//   over           a 404. TERMINAL: the app is not slow, it is gone. No retry, and one move offered.
//
// **A 404 IS THE APP BEING OVER, AND A 503 IS NOT.** `stopWorker`, a crash and a session that ended leave
// loombot with no registration, and the next request is answered `404 no such app` (`loombot/routes.ts`). No
// socket is there to be pushed a farewell down, so this failing request is the ONLY witness a page has — and
// it is terminal: nothing is listening, and nothing will be until the app is started again, so a retry would
// be a page arguing with a fact. A 503 is the other fact: the app is STILL registered and nobody answered
// the event YET, so the channel is not up and the page keeps asking. Draw the two alike and a stopped app is
// reported as a temporary fault — which is the bug this whole section exists for.
const FIRST_RETRY_MS = 1000;
const LAST_RETRY_MS = 15000;
/** The delay the NEXT retry waits: doubled on every failure, and put back to FIRST by any answer. */
let retryMs = FIRST_RETRY_MS;
/** The pending retry's timer, or 0 for none — one at a time, whatever else is clicking. */
let retryTimer = 0;
/** The app is OVER: nothing is asked of it again, neither by a click nor by a retry. */
let over = false;

/** A FAILED REQUEST — and the status is the whole of the decision: which of the two facts is this? */
function unreachable(err) {
  if (over) return;
  if (err && err.status === 404) return gone();
  return dropped(err);
}

/**
 * THE APP IS OVER — one sentence and one move, and NOTHING scheduled: a retry that cannot land is a page
 * telling a person to wait for something that is not coming.
 *
 * The sentence is FIXED rather than the error's message, because loombot's 404 body is plain text (`no such
 * app: <name>`) and a page cannot read a reason out of it: the status is the whole of the fact, and `no
 * such app` is what it says. A 503's reason IS readable, and `dropped` passes that one through.
 */
function gone() {
  over = true;
  clearTimeout(retryTimer);
  retryTimer = 0;
  document.body.classList.add("dead");
  el("note").textContent =
    "the app is over (no such app). Nothing is listening; start it again and " +
    "reload this page.";
}

/**
 * NOT ANSWERING YET — a 503 or a failed connection, in its own words, and ASKED AGAIN on this page's own
 * ladder: the delay doubles up to LAST_RETRY_MS, because a page that hammered loombot would be somebody else's
 * outage. Nothing here waits for a person to press something.
 */
function dropped(err) {
  document.body.classList.add("dead");
  el("note").textContent = "the app is not answering (" + said(err) + ") \u2014 retrying in " +
    Math.round(retryMs / 1000) + "s.";
  clearTimeout(retryTimer);
  retryTimer = setTimeout(read, retryMs);
  retryMs = Math.min(retryMs * 2, LAST_RETRY_MS);
}

/** The failure's own words, for a sentence: an `Error`'s message, or whatever else was thrown. */
function said(err) {
  return String(err?.message ?? err);
}

/**
 * ANY ANSWER AT ALL IS THE APP ANSWERING, and that is the only proof this page needs to take a fault off:
 * the class, the sentence and the ladder all go, and the next failure starts its back-off over. One place,
 * and it is here rather than inside the switch so that a `refused` or an `ack` ends a wait with the rest —
 * an app that answers again is alive again, whatever it answered.
 */
function answered(frame) {
  clearTimeout(retryTimer);
  retryTimer = 0;
  retryMs = FIRST_RETRY_MS;
  over = false;
  document.body.classList.remove("dead");
  el("note").textContent = "";
  handle(frame.action, frame.data);
}

/**
 * READ THE APP — the ONE place a read is started, so the first read, a change and a retry cannot drift into
 * three different requests. `hello` is mechanical (`rules.ts`): it answers from the app's own state, so no
 * read here costs a turn boundary — and it is what a retry asks for too, because a CLICK THAT FAILED IS NOT
 * RE-SENT: the state is the truth, and one re-read carries all of it.
 */
function read() {
  send("hello");
}

// A CHANGE THE APP HAS — a publish, or the agent's decision folded into state — is not pushed at a page.
// The panel posts ONE `loom/app-changed` message into this document and the page READS. It is a document
// event rather than a callback so an app needs no code beyond this listener, and it carries no data: the
// page knows what it is showing.
document.addEventListener("loom/app-changed", () => {
  // AN APP THAT IS OVER IS ASKED NOTHING: a `changed` is not a reason to ask what a 404 has already answered
  // for ever (`unreachable`'s guard is the same fact, from the other side).
  if (!over) read();
});

// THE LAST STATE FIRST, THEN THE READ (rule 8): what a reload brings back is drawn from storage before
// anything is asked, and the read below is what replaces it.
paintLastRead();
// A reloaded page must not have to be told what the state is by a model: `hello` is mechanical, so this is
// one round trip. loombot sends nothing on its own — it holds no app state, and has stopped pretending to.
read();
