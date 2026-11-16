// THE BROWSER HALF OF THE TASK BOARD. Its comments are the point, as in the two example apps: this file
// is what an agent copies when it is asked for a page like this one, so what it says about the split
// matters as much as what it does.
//
// THE SPLIT, from the page's side:
//
//   * the page READS NOTHING. The ROWS below arrived in ONE action from rules.ts — which read the board
//     with tasks.ts, the same parser the agent's own verbs use. There is no path here, no parser and no
//     index: a page that could re-read a board on its own is a page that could disagree about one, and a
//     second parser is the thing that drifts first.
//   * IT HOLDS NO BODY IT DID NOT OPEN (card t20261024-052218-0bb3). A `board` frame carries what a row
//     draws and nothing else, so the two things that need a card's TEXT are REQUESTS: opening one asks for
//     that card (`card`), and a search asks which ids match (`search`). What that costs is one request per
//     open and one per pause in the typing, and what it saves is a page holding a corpus nobody opened:
//     measured on a 259-card board, every re-read used to carry 1,977,123 bytes of it.
//   * SO TYPING IS A REQUEST AND NOT A TURN. A keystroke sends the query to its own app and the answer is a
//     list of IDS — the page has the rows, so the ids are all it needs, and the BODY never has to be here
//     for the filter to reach it. The events this page sends are `ready` on connect, `refresh` when the
//     human asks, `close` when they ask to end the app (which ENDS it, 2026-10-27; the panel folds and
//     the next show starts it again), `showing` when THEY open a task, and the two reads `card`
//     and `search` — each one mechanical, each one answered in about a millisecond, none the agent's.
//   * it WRITES NO RECORD, and it KEEPS ONE FACT. No button changes a record: claiming a task and moving
//     it between states are decisions, and they go through the agent (`tasks.ts`). Which task is open is
//     the page's own business and travels: a click reports it (`showing`), and `board` carries it back,
//     which is how a page that connects LATE or reloads opens the task the app remembers instead of the
//     list. Nothing else is cached: `board/` stays the only store of the records, and Refresh re-reads.
//
// THE APP, and this is the whole of the page's half of the app contract (README.md, "An app is FETCH-FIRST
// AND HAS NO SOCKET"):
//
//   * THERE IS NO SOCKET. This page asks its OWN APP one question at a time with `fetch`, and the answer is
//     the frame it draws — `{action, data}`, exactly what a socket carried before. ONE code path on both
//     homes: native on the machine, and carried by the service worker at the edge, where an app's DATA and
//     its ASSETS are the same address prefix and therefore the same carriage.
//   * THE ADDRESS IS RELATIVE — `__event`, under this document's own directory. The page is at
//     `/a/<session>/app/<name>/` on the machine and at `/d/<device>/a/<session>/app/<name>/` at the edge, so
//     a relative URL is the same one in both: no host, no port, no session id, no app name, no device.
//   * AND IT GIVES THAT ONE FACT AN ADDRESS, which is the one place "which card is showing" can be READ
//     without asking anybody: `?id=<card>` (or `#<card>`) names a card for a page that has none, every
//     selection is written back to the address, and Back/Forward are followed. The address is a VIEW of
//     `showing` and never its store — the state is the truth, and this is a second place the same fact
//     can be read. What writing one is allowed to BE (measured) is the "the address" section below.
//   * WHEN TO RE-READ IS THE PAGE'S TO SAY. The panel holds the session socket, so it is the one that knows
//     something changed: it posts ONE message into this frame, the line loombot splices into every app page
//     turns it into a `loom/app-changed` DOCUMENT EVENT, and this page reads again. No data, no id, no app
//     name and no protocol — the frame already knows what it is showing.
//   * AND WHAT THE PAGE SAYS WHEN IT CANNOT REACH THE APP IS PART OF THAT CONTRACT. A request can fail; a
//     page may not be SILENT about it. MEASURED on a phone (2026-10-21): the chrome drew and NOTHING under
//     it did, reported as "the app still does not display", which is exactly what an empty board looks
//     like. So "the channel" further down is a STATE with words on the page and a retry of its own, and one
//     rule: a board with nothing on it and a page that never reached the app must never look alike.
//
// (?player=<credential> on the app's socket is the app's OWN SERVER. That socket is the app server's; this
// page has none, and the whole point is that it does not need one.)
/** THE ONE ADDRESS THIS PAGE ASKS, relative to its own document: the app's own data path. */
const ENDPOINT = "__event";

const el = (id) => document.getElementById(id);
/**
 * ONE REQUEST, ONE ANSWER — the page's whole way of talking to its app.
 *
 * IT THROWS A SENTENCE AND NEVER A BARE NETWORK ERROR, because everything it can fail with ends up in front
 * of a person: "Failed to fetch" is what a console says, and `#channel` owes a reader the reason in words.
 *
 * A 503 IS NOT A DEAD APP. loombot answers 503 when NOTHING answered the event — no app server is connected
 * to that channel, or the one that is did not answer before its deadline — so the sentence it carries is
 * passed through rather than replaced by this page's guess. A DECISION is not a 503: the app answers every
 * request it took at once with `ack` (`channel.ts` `answering`), and the agent's answer arrives as a
 * re-read.
 *
 * AND THE ERROR KEEPS THE STATUS, because a 404 is a DIFFERENT FACT from all of that: loombot has no such app
 * any more, so that is the app being OVER rather than a channel that will come back (`unreachable` below).
 */
async function ask(event, data = {}) {
  let res;
  // THE SHARED LAYER (card t20261027-145404-6a9e): `loomApp.fetch` is `fetch` plus one renewal and one
  // retry for the session cookie that expired while the page sat open. A page opened outside loombot keeps
  // plain `fetch`, because there is nothing there to renew.
  const post = typeof globalThis.loomApp?.fetch === "function" ? globalThis.loomApp.fetch : fetch;
  try {
    res = await post(ENDPOINT, {
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
    // A 401 THAT SURVIVED THE RENEWAL: this page is not signed in any more, and nothing it asks will land
    // until it is paired again — reloading is what pairs it.
    const err = new Error(
      why ||
        (res.status === 401
          ? "this page's session ran out and could not be renewed — the board is not reachable until the " +
            "page is paired again (reload it)"
          : "the app answered " + res.status),
    );
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
 * reports a fact and does not wait for the answer, because its callers are event handlers and a handler that
 * awaited would have to explain itself to nobody.
 */
const send = (event, data = {}) => {
  void ask(event, data).then(answered, unreachable);
  return true;
};

/** The five states, in the order they are drawn: what is unfinished first, what is over last. */
const STATES = ["open", "claimed", "done", "deferred", "dropped"];
/** The states a reader is here for, so they are the ones already open. The rest are one click away. */
const DEFAULT_OPEN = ["open", "claimed"];

/** A record id as `tasks.ts` mints one (`t20261005-071707-5cf6`): the shape `links` means by an id. */
const TASK_ID = /^t[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$/;

/**
 * THE LIST, as the last `board` frame said it is — {board, at, records, showing, error?}, where each record
 * is a ROW (`rules.ts` `rowOf`) and not a card.
 *
 * `board/` IS STILL THE ONLY STORE, and a read still replaces this object whole. What changed on 2026-10-25
 * (card t20261025-051703-9964) is that the LAST READ ALSO OUTLIVES THE DOCUMENT: it is kept in
 * `localStorage` on every successful read and painted before the first fetch — because this page is reloaded
 * by something that is not a person finished with it (the panel reloads an open frame when the app
 * re-registers, `client/conversation.js` `drawTabs`), and a page whose only copy of the rows was a variable
 * came back as an empty board with a fetch that could fail. The section below is that half.
 */
let board = null;
/**
 * The search text, exactly what the human typed — and it goes TO THE APP, which is the half that has the
 * bodies. Nothing here matches anything: see `hits`.
 */
let query = "";
/**
 * THE IDS THE APP SAID MATCH `query`, as `{ q, ids }` — or null when it has not answered THIS query yet,
 * which is what `q` is for: three keystrokes are three requests, and an answer to an old one must not draw
 * over a newer query's. `null` means "no filter yet", so the list shows every row it holds; it never means
 * "nothing matched", which is `{ q, ids: [] }`.
 */
let hits = null;
/**
 * THE ONE CARD THIS PAGE HOLDS WHOLE: `{ id, record }` out of a `card` answer, or null. It is the card the
 * detail is drawing and nothing else — dropped when the detail goes back to the list, and ignored when its
 * `id` is not the one showing, so a person never reads a card the app answered about some other one.
 */
let card = null;
/**
 * The task whose detail is open, by id, or null for the list — and it is THE APP'S fact rather than this
 * page's: it arrives on every `board` frame (`showing`) and goes back out as `showing` when the human
 * picks one.
 */
let selectedId = null;
/** Which groups the human has opened or shut, by state. Untouched groups follow DEFAULT_OPEN. */
const expanded = new Map();

// ── the last read, kept across a reload ──────────────────────────────────────────────────────────────
//
// **A RELOAD IS NOT THIS PAGE'S DECISION, AND IT USED TO BE A BLANK PAGE** (card t20261025-051703-9964,
// reported from a phone). The panel reloads an open frame when the app's version moves, deliberately — new
// bytes under a page somebody is looking at — and a restart of the app's MCP re-registers, so the reload
// lands while a board is being read. Every row this page held was in a variable, so a reload was an empty
// board plus a fetch: and when that fetch failed, the report was "the app is not answering (Load failed) —
// retrying in 8s" over nothing, which looks exactly like a board with nothing on it.
//
// So the last read is KEPT, and the two rules it obeys are the whole of it:
//
//   * ONE KEY PER APP AND SESSION, derived from this page's own ADDRESS — never one key for "the board". The
//     address is `/a/<session>/app/<name>/` on the machine and `/d/<device>/a/<session>/app/<name>/` at the
//     edge, so two sessions, two devices, and two agents' apps that happen to share a name never share a
//     read: the worst thing one shared key could do is paint one session's tasks into another's page.
//   * WRITTEN ON A SUCCESSFUL READ AND NEVER OTHERWISE — not by a failed read, not by an empty frame, not by
//     a `card` answer — and replaced only by a read whose `at` is not older, so two tabs of one app cannot
//     make it go backwards.
//
// What it is NOT: a second store of anybody's records. `board/` remains the only one, the page still reads
// on load, on every change and on its own ladder, and the note on screen has always said out loud which read
// is being drawn ("read <at> from <board>") — this is that same fact, kept where a reload cannot lose it.
//
// AND THE CARD'S BODY IS STILL A REQUEST. What is kept of a selection is WHICH card — the app's own fact,
// adopted on every frame — and what a restored detail draws until the body answers is the row's own facts,
// which is exactly the state a click leaves the page in. A kept BODY would be a second store of something
// the app answers for, and the address — `?id=<card>` — is still what overrides all of it: an instruction
// wins over memory, and an id the painted rows do not hold is waited for, spent as always on the first
// read that answers (`entryId`).
const KEPT_VERSION = 1;
/**
 * A CEILING ON WHAT ONE APP MAY KEEP, in characters of JSON. `localStorage` is ONE budget for the whole
 * origin — loombot's own page keeps a person's unsent draft in it — so a read too big to be worth that is not
 * written at all, and the page behaves exactly as it did before this existed. A 259-card board's rows
 * measure about 90 KB, so this is room for a board several times the largest one that exists.
 */
const KEPT_MAX = 512 * 1024;
/**
 * THE ONE IDENTITY A PAGE CAN READ FOR ITSELF, and the same one the file viewer's draft key already uses
 * (`file-viewer/src/app.js` `draftKey`): nothing is spliced into these bytes, and the address is the one
 * fact that survives a page being served from somewhere else. The app name keeps its `@agent` suffix —
 * two agents may register one name (`loombot/registered.ts` `servedId`), and their boards are two boards.
 */
const MINE = /\/a\/([^/]+)\/app\/([^/]+)/.exec(location.pathname);
const KEEP = MINE === null
  ? null
  : "app:" + decodeURIComponent(MINE[1]) + ":" + decodeURIComponent(MINE[2]) + ":read";

/**
 * THIS BROWSER'S STORAGE, or null. A privacy mode refuses it and a page with no memory is simply the page
 * this one used to be, so nothing here may throw: the read on screen never depends on the copy.
 */
function storage() {
  try {
    return typeof localStorage === "undefined" || localStorage === null ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * WHETHER A FRAME'S RECORDS ARE A LIST THIS PAGE CAN DRAW — one shape check, used when a read is kept and
 * again when it is read back. There is no schema between this page and itself across a reload, and a row
 * with no id or no title would draw `undefined` and could not be opened: a kept read that fails this is
 * dropped without a word, which is the same thing as a browser that has never loaded this app.
 */
function drawable(rows) {
  return Array.isArray(rows) && rows.every((rec) =>
    rec !== null && typeof rec === "object" &&
    typeof rec.id === "string" && typeof rec.title === "string" &&
    STATES.indexOf(rec.state) >= 0
  );
}

// AND THE VIEW IS KEPT WITH THE ROWS, because the reload this exists for is not only a version bump: the
// panel re-points the frame at the app's ENTRY page whenever the frame has walked away — and a frame walks
// away when the app navigates itself, which the board does not do, but a FOLD AND RE-OPEN on a phone goes
// through the same `openApp` and re-loads the document (`client/conversation.js` `openApp`, "the tab means
// show me this app"). That reload is DELIBERATE and it stays; what must not survive it is a page that
// forgot where it was. So the record carries three facts beside the rows, written when they change and not
// only when a read lands:
//
//   * `showing`   which card is open — the app's own fact, adopted on every frame, and restored only when
//                 the painted rows still hold it. The card's BODY is still a request (`askCard`): what the
//                 detail draws until it answers is the row's own facts, which is exactly the state a click
//                 leaves the page in.
//   * `expanded`  which groups the human had open, so a restored list is the list they were reading.
//   * `scroll`    how far down, restored after the rows are painted and before anything is asked.
//
// THE ADDRESS STILL WINS over a kept `showing`: `?id=<card>` is an instruction, and a page that opens what
// its memory says when the address names something else is arguing with the person who handed it over.
let keptNow = null;

/** THE VIEW THIS PAGE IS SHOWING, as the record keeps it: which card, which groups, how far down. */
function theView() {
  return {
    showing: typeof selectedId === "string" ? selectedId : null,
    expanded: [...expanded],
    scroll: typeof globalThis.scrollY === "number" && isFinite(globalThis.scrollY)
      ? Math.max(0, Math.round(globalThis.scrollY))
      : 0,
  };
}

/** PUT ONE RECORD IN THE STORE — the one place a write happens, for a read and for a view change alike. */
function store(frame, view) {
  const s = storage();
  if (s === null || KEEP === null || !drawable(frame.records)) return;
  const text = JSON.stringify({
    v: KEPT_VERSION,
    board: String(frame.board || ""),
    at: String(frame.at || ""),
    records: frame.records,
    showing: view.showing,
    expanded: view.expanded,
    scroll: view.scroll,
  });
  if (text.length > KEPT_MAX) return;
  try {
    s.setItem(KEEP, text);
    keptNow = {
      board: String(frame.board || ""),
      at: String(frame.at || ""),
      records: frame.records,
      showing: view.showing,
      expanded: view.expanded,
      scroll: view.scroll,
    };
  } catch {
    // A FULL OR REFUSING STORE IS NOT THIS PAGE'S FAULT: what is on screen is unaffected, and the next
    // successful read is what brings the kept copy up to date.
  }
}

/**
 * KEEP THE VIEW, AND THE ROWS WITH IT — called when the view changes (a card opened or shut, a group, a
 * scroll) and nowhere else. It writes the rows THIS DOCUMENT holds, and refuses to write an OLDER read over
 * a newer one, which is the same rule `keep` applies to reads: two tabs of one app, and the one whose reader
//  is moving around must not drag the kept read backwards.
 */
function keepView() {
  if (keptNow === null || board === null) return;
  if (board.at !== "" && keptNow.at !== "" && board.at < keptNow.at) return;
  store(board, theView());
}

/**
 * THE OFFSET A PAINT COULD NOT REACH YET, or 0 for none. What a reload paints is the ROW's facts, and a
 * row is SHORTER than the card the read brings back — so the place the reader was may only exist once the
 * body has arrived. So the page AIMs for the kept offset — at the paint, and after each answer until it
 * lands — and stops the moment it is reached or the reader moves, which is what keeps this from being a
 * page that yanks somebody's scroll out from under them.
 */
let rescroll = 0;

/** AIM FOR THE KEPT OFFSET, and give up on it the moment it is reached (a reader's move ends it too). */
function applyRescroll() {
  const at = typeof globalThis.scrollY === "number" ? globalThis.scrollY : 0;
  if (rescroll === 0 || at >= rescroll) {
    rescroll = 0;
    return;
  }
  if (typeof globalThis.scrollTo === "function") globalThis.scrollTo(0, rescroll);
}
/** A VIEW CHANGE THAT ARRIVES FASTER THAN IT IS WORTH WRITING: a scroll is one of those. */
let viewTimer = 0;
function keepViewSoon() {
  if (viewTimer !== 0) return;
  viewTimer = setTimeout(() => {
    viewTimer = 0;
    keepView();
  }, 300);
}

/**
 * THE KEPT READ, as a `board` of the same shape a frame has, or null. `{v, board, at, records}` is the whole
 * of what is written below, and `v` is what lets this survive its own shape changing.
 */
function remembered() {
  const store = storage();
  if (store === null || KEEP === null) return null;
  let kept = null;
  try {
    kept = JSON.parse(store.getItem(KEEP) || "null");
  } catch {
    return null;
  }
  if (!kept || kept.v !== KEPT_VERSION || !drawable(kept.records)) return null;
  if (typeof kept.showing !== "string" && kept.showing !== null) return null;
  const groups = Array.isArray(kept.expanded)
    ? kept.expanded.filter((e) =>
      Array.isArray(e) && STATES.indexOf(e[0]) >= 0 && typeof e[1] === "boolean"
    )
    : [];
  const scroll = typeof kept.scroll === "number" && isFinite(kept.scroll) && kept.scroll >= 0
    ? Math.round(kept.scroll)
    : 0;
  return {
    board: String(kept.board || ""),
    at: String(kept.at || ""),
    records: kept.records,
    showing: kept.showing,
    expanded: groups,
    scroll,
  };
}

/**
 * KEEP THIS READ — called on every successful `board` frame, and nowhere else.
 *
 * THE `at` COMPARISON IS THE WHOLE OF "the newer read wins": `rules.ts` stamps each frame with
 * `new Date().toISOString()`, so two strings of that shape order as the times they name. Two tabs of one app
 * can land their reads out of order and the older one must not overwrite the newer one already there; an
 * `at` this page cannot read (empty) is not a reason to refuse a read that has just happened.
 */
function keep(data) {
  if (KEEP === null || !drawable(data.records)) return;
  const at = String(data.at || "");
  const was = remembered();
  if (was !== null && was.at !== "" && at !== "" && at < was.at) return;
  store(data, theView());
}

/**
 * THE LAST READ IS PAINTED BEFORE ANY FETCH: the document a reload brings back is the board somebody was
 * reading, and the read at the bottom of this file is what replaces it. It says WHICH read it is, in the
 * same note that says what was read — a page drawing an old board in silence would be claiming a freshness
 * it has not got, which is the defect this whole section exists against.
 */
function paintLastRead() {
  const kept = remembered();
  if (kept === null) return;
  keptNow = kept;
  // THE ROWS, first: the list is the thing a reload used to throw away.
  board = kept;
  // WHICH CARD, second — the address wins when it names one the painted rows hold, and the app's own
  // remembering is what a reload restores when it does not. An id the rows do NOT hold is waited for: it
  // is spent, as always, on the first read that answers (`entryId`).
  const want = entryId !== "" && holds(kept.records, entryId)
    ? entryId
    : kept.showing !== null && holds(kept.records, kept.showing)
    ? kept.showing
    : null;
  if (want !== null) selectedId = want;
  for (const [state, open] of kept.expanded) expanded.set(state, open);
  render();
  note(
    "the last read, " + long(kept.at) + " from " + kept.board +
      " — asking the app for a newer one.",
    false,
  );
  // HOW FAR DOWN, last: the rows and the detail are on the page by now, so the offset means what it
  // meant — as far as this document is tall, which a row-only detail may not yet be. What is left of it is
  // `rescroll`, and the first read that answers applies the rest.
  rescroll = kept.scroll;
  applyRescroll();
}

/** Whether the records this page holds name this id — the one check a restored selection must pass. */
function holds(records, id) {
  return records.some((rec) => rec.id === id);
}

// ── the address: the same one fact, as a URL ─────────────────────────────────────────────────────────
//
// WHICH TASK IS SHOWING IS THE APP'S FACT: it arrives in every `board` frame as `showing`, and this page's
// own `send("showing", …)` is how a human's choice is folded into it. THE ADDRESS IS A VIEW OF IT, and the
// whole of the arithmetic between the two is three rules and the forty lines below them:
//
//   * ON THE WAY IN, `?id=<card>` — or `#<card>` — NAMES A CARD for a page that has not been told anything
//     yet. It is read at load and spent on the FIRST `board` frame, because an id is only worth opening
//     against records this page actually holds; an id the board does not hold is SAID and the view stays
//     where it was. That one claim WINS over `showing`: a URL somebody handed you is an instruction, not a
//     promise that the app's memory is right about what to look at. It is also REPORTED (`showing`) on the
//     spot, so the app agrees at once and the two are never out of step.
//   * ON THE WAY OUT, every change of `selectedId` is written back — `pushState` for a card somebody
//     PICKED (a row, an id in `links`, the way back to the list), so Back returns to the card they were
//     looking at, and `replaceState` for a selection that ARRIVED (the entry address, the app's `showing`,
//     the agent's `select`), because nobody navigated and a view does not own anybody's history.
//   * AND BACK/FORWARD ARE FOLLOWED: `popstate` is the human moving, so whatever the address now names is
//     opened and reported, exactly as a click on a row is. Nothing is written there: the address is
//     already where they put it.
//
// IT IS ALSO ALLOWED, and that is why this exists at all. MEASURED 2026-10-09 in headless Chrome, against
// a frame carrying THIS page's own sandbox attribute (`allow-scripts allow-forms allow-same-origin`),
// served from an /a/<session>/app/<name>/ path:
//
//   * `history.replaceState(null, "", "?id=<card>")`, `history.pushState(…)` and `location.hash = "#<card>"`
//     ALL SUCCEED. Each is a SAME-DOCUMENT navigation: no further request for this page, the document's own
//     token survived, and CDP reported `navigatedWithinDocument` rather than a frame navigation.
//     `history.back()`, `history.forward()` and `popstate` all work in that frame too, and the address it
//     writes is readable from OUTSIDE it (`frame.contentWindow.location`) because the sandbox has
//     `allow-same-origin` — without it that same read is a cross-origin SecurityError.
//   * `location.pathname` is untouched by any of them, so the RELATIVE address this page asks — `ENDPOINT`,
//     `__event` under its own directory — resolves exactly where it did: an address write is not a
//     navigation and disturbs nothing the page is in the middle of reading.
//   * AND THE OTHER HALF IS THE TRAP THIS FILE ALREADY KNEW: assigning to `location` — `location.href = …`,
//     `location.search = …` — is NOT an address write, it NAVIGATES. Measured in the same frame: the page
//     re-requested its own URL at once and came back as a NEW document (a `Page.frameNavigated` event, a
//     new token, the board gone). So this page never assigns to `location`; it writes the history, and that
//     difference is the whole of why a card can have an address without the board, its rows and every
//     control being thrown away with it (t20261009-182107-6176 is what that costs — see `renderDetail`).

/** The card an address names: `?id=` first (the form this page writes), then `#<card>`; `""` for neither. */
function addressId() {
  let raw = "";
  try {
    raw = new URLSearchParams(location.search).get("id") || "";
  } catch {
    // A search string that is not one names no card, and is not a reason to throw during a page load.
  }
  if (raw === "") {
    try {
      raw = decodeURIComponent(String(location.hash).replace(/^#/, ""));
    } catch {
      raw = "";
    }
  }
  return raw.trim();
}

/**
 * THE ADDRESS THIS PAGE WRITES: its own path and query, `id` set (or gone), and no fragment. The `#<card>`
 * form is READ and never written — this page has no anchors, so a fragment here only ever meant a card —
 * and the query is the form that survives a copy-paste whole.
 */
function addressFor(id) {
  const params = new URLSearchParams(location.search);
  if (id) params.set("id", id);
  else params.delete("id");
  const q = params.toString();
  return location.pathname + (q === "" ? "" : "?" + q);
}

/** Where this page actually is, in the one form the browser and this file both agree on. */
function here() {
  return location.pathname + location.search + location.hash;
}

/**
 * PUT THE SELECTION IN THE ADDRESS — the ONE writer, so `?id=` and the detail cannot come to say different
 * things. A no-op when the address already says it, which is what keeps a render that changed nothing (a
 * keystroke in the search box, a Refresh, a frame carrying the same `showing`) out of anybody's history.
 *
 * `push` is for a card somebody PICKED; `false` for one that ARRIVED (see the section header). And it is
 * never `location.href = …`: that is the navigation the measurement above closed off.
 */
function showInAddress(push) {
  const want = addressFor(selectedId);
  if (want !== here()) {
    try {
      history[push ? "pushState" : "replaceState"](null, "", want);
    } catch (e) {
      // The address is a VIEW, so a browser that refuses to write it must not take the board with it: it
      // is said once, and the page goes on working.
      note("this page could not write its own address (" + (e && e.message) + ")", true);
    }
  }
  renderAddress();
}

/**
 * THE ADDRESS OF THIS PAGE, ON THE PAGE — the one thing a person in the panel cannot otherwise get: the app
 * runs in a FRAME, and a frame has no address bar. Absolute, out of `location.protocol + location.host` and
 * never `location.origin` (the one fact a frame with an opaque origin cannot give — see the address note at
 * the top of this file), and drawn as TEXT, because it is something to copy rather than to click.
 */
function renderAddress() {
  const line = location.protocol + "//" + location.host + here();
  el("addr").textContent = "address " + line;
  el("addr").title =
    "the address of this page, and it names the card that is showing: open it and that " +
    "card opens. Copy it — a click here would load a new document into the frame and take the board with it.";
}

/**
 * BACK AND FORWARD, FOLLOWED. Measured to fire inside this page's own sandbox, and the reason the address
 * is a view rather than a decoration: the human moved, so whatever the address now names is opened and
 * REPORTED, exactly as a click on a row is. Nothing is written here — the address is already where they
 * put it — and the one case that writes is an id the board does not hold, which cannot stay in the address
 * of a page that is not showing it.
 */
globalThis.addEventListener("popstate", () => {
  const id = addressId();
  if (id === "") {
    selectedId = null;
    render();
    send("showing", { id: null });
    keepView();
    return;
  }
  if (showTask(id, false)) send("showing", { id });
  else showInAddress(false);
});

/**
 * THE CARD THE ADDRESS NAMES ON THE WAY IN, read once at load and spent on the first `board` frame. Once,
 * and not on every frame, on purpose: a page that re-opened its URL's card each time the board was read
 * would fight the human every time they clicked a row.
 */
let entryId = addressId();

// AND IT IS PAINTED AT LOAD, before the first answer has arrived: the address is the one fact this page
// has without being told anything, and a page in the panel has nowhere else it could be seen.
renderAddress();

// ── drawing ──────────────────────────────────────────────────────────────────────────────────────────
// One renderer per area, fed only by `board` and by the two pieces of local UI state (query, selected).
// Nothing here decides anything about the board: it filters, groups and prints what rules.ts sent.

function render() {
  renderHead();
  renderChannel();
  renderList();
  renderDetail();
}

function renderHead() {
  // THE ADDRESS IS A FACT OF THE PAGE AND NOT OF THE BOARD, so it is drawn before the first frame arrives —
  // and it is drawn from `location`, so the line cannot claim an address the browser is not at.
  renderAddress();
  if (!board) {
    el("count").textContent = "";
    el("count").title = "";
    return;
  }
  const by = {};
  for (const state of STATES) by[state] = 0;
  for (const rec of board.records) if (by[rec.state] !== undefined) by[rec.state]++;
  el("count").textContent = board.records.length + " tasks · " +
    STATES.filter((s) => by[s] > 0).map((s) => by[s] + " " + s).join(" · ");
  el("count").title = el("count").textContent;
}

/**
 * WHAT THE FILTER MEANS HERE: "the ids the app answered for the query in hand", or null for no filter.
 *
 * THE MATCHING IS NOT THIS PAGE'S ANY MORE (card t20261024-052218-0bb3). It was `matches(rec)` over
 * `rec.why` and `rec.acceptance`, which is exactly why the list's frame had to carry every card's text; the
 * body is on the app's side of the wire, so the app answers the query with ids and `rules.ts` `matches` is
 * the one definition of what a search means. `null` draws every row rather than none: an empty list while a
 * request is in flight would be this page claiming a result it has not been told.
 */
function hitIds() {
  return hits !== null && hits.q === query ? new Set(hits.ids) : null;
}

/**
 * ASK FOR ONE CARD — the detail's own request, and the reason it exists: the list's frame carries rows, so a
 * card's brief is read when somebody opens it and not before. The answer is dropped if the page has moved on
 * (see `handle`), and the detail draws the ROW's facts meanwhile, so a click is never a blank screen.
 */
function askCard(id) {
  void ask("card", { id }).then(answered, unreachable);
}

/**
 * ASK WHICH IDS MATCH — the filter's own request, and the page's half of the one thing that is not free in
 * this split: the search reaches the BODY, and the body is not here. It was arithmetic over a frame that
 * carried every card; it is one request now, and the answer is ids.
 */
function askSearch() {
  const q = query;
  if (q === "") {
    hits = null;
    render();
    return;
  }
  void ask("search", { q }).then(answered, unreachable);
}

function renderList() {
  const list = el("list");
  list.textContent = "";
  if (!board) {
    // NOTHING HAS BEEN READ YET, so the page says WHY in the place the cards would be — never an empty
    // list, because an empty list is exactly what a board with nothing on it looks like. This is the
    // sentence that was missing on the phone: the chrome was drawn and under it there was nothing at all.
    const said = line(readingText());
    said.classList.toggle("bad", fault() || readFail !== "");
    list.append(said);
    return;
  }
  let shown = 0;
  const ids = hitIds();
  for (const state of STATES) {
    const all = board.records.filter((rec) => rec.state === state);
    const inGroup = ids === null ? all : all.filter((rec) => ids.has(rec.id));
    // A SEARCH SHOWS ONLY WHAT MATCHES, headings included: a group heading over an empty list is noise
    // while someone is narrowing 75 records down to two.
    if (ids !== null && inGroup.length === 0) continue;

    const group = document.createElement("details");
    group.className = "group";
    // `open` is set BEFORE the listener, so a programmatic change is not recorded as the human's.
    group.open = ids !== null
      ? true
      : (expanded.has(state) ? expanded.get(state) : DEFAULT_OPEN.includes(state));
    group.addEventListener("toggle", () => {
      expanded.set(state, group.open);
      keepViewSoon();
    });

    const summary = document.createElement("summary");
    summary.append(document.createTextNode(state + " "));
    const n = document.createElement("span");
    n.className = "n";
    n.textContent = ids === null
      ? "(" + inGroup.length + ")"
      : "(" + inGroup.length + " of " + all.length + ")";
    summary.append(n);
    group.append(summary);
    for (const rec of inGroup) {
      group.append(row(rec));
      shown++;
    }
    list.append(group);
  }
  if (shown === 0) {
    // THREE SILENCES ARE TOLD APART: a board with nothing on it, an answer that matched nothing, and a
    // request still in flight (which draws every row, so it cannot reach here).
    list.append(line(
      board.records.length === 0
        ? "this board is empty. Nothing is open, claimed, done, deferred or dropped."
        : "no record matches " + JSON.stringify(query) + " in any id, title or body.",
    ));
  }
}

/** One row: what a reader picks a task by — the title, its tags, and the facts that date it. */
function row(rec) {
  const node = document.createElement("div");
  node.className = "row";
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.setAttribute("aria-label", "open " + rec.title);
  const top = document.createElement("div");
  top.className = "rowtop";
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = rec.title;
  top.append(title);
  if (rec.tags && rec.tags.length > 0) top.append(chips(rec.tags));
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = [
    rec.id,
    rec.owner || "unowned",
    rec.worktree || "",
    "updated " + short(rec.updated),
  ]
    .filter((part) => part !== "").join(" · ");
  // One line, cut with an ellipsis: the full text is a long-press away.
  meta.title = meta.textContent;
  node.append(top, meta);
  const open = () => {
    selectedId = rec.id;
    card = null;
    render();
    // THE HUMAN'S OWN CHOICE, REPORTED: this is the one fact the app cannot work out for itself, and the
    // rule behind `showing` folds it into state without waking anybody. A page that connects later is
    // handed it back in the `board` frame, which is what makes the panel follow the state rather than
    // the last action anyone happened to be connected for.
    send("showing", { id: rec.id });
    // AND THE CARD IS ITS OWN REQUEST: the row is a summary, and this is the frame that carries the brief.
    askCard(rec.id);
    // AND A CHOICE IS A NAVIGATION, so it PUSHES: Back returns to the card they were looking at. What
    // ARRIVES instead — `showing` in a frame, the agent's `select`, an id in the page's own address —
    // replaces, because a view does not own anybody's history.
    showInAddress(true);
    keepView();
  };
  node.addEventListener("click", open);
  // A TAP ON A PHONE: iOS Safari withholds the synthesized click inside a scrollable list (measured, viewer 2026-10-27), so the row is marked and acted on at pointerup below.
  node.setAttribute("data-tap", "1");
  node.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  });
  return node;
  // THE DOCUMENT-LEVEL TAP FALLBACK (data-tap, the iOS withheld click of 2026-10-27) IS NOT HERE. It arrived
  // BELOW THIS return in ea60aa3, so it never ran from here - and it could not have run correctly anyway: these
  // are DOCUMENT-level listeners, and a pair per row drawn leaks a pair per row. That dead block is what
  // `deno lint` reported as unreachable (with `lastTapAt` unused) from ea60aa3 until it was removed on
  // 2026-10-29, keeping `deno task check` red on main for every lane. It belongs beside the page's other
  // document-level listeners; the code is in that commit until it is installed there.
}

/** A chip per tag, drawn wherever a record is — a row on the list and the detail alike. */
function chips(tags) {
  const box = document.createElement("span");
  box.className = "chips";
  for (const tag of tags) {
    const chip = document.createElement("span");
    chip.className = "tag";
    chip.textContent = tag;
    box.append(chip);
  }
  return box;
}

/**
 * THE HEADER'S ONE SLOT HOLDS ONE OF TWO CONTROLS. A search over the list cannot narrow a page that is
 * showing a single record, so the box and the way back are SUBSTITUTES rather than neighbours: the list
 * gets the search box, a card gets `← all tasks`, and whichever is not showing is `hidden`. The
 * substitution is decided HERE, in the same pass as the view, so the two cannot come to disagree about
 * which view is on screen.
 */
function showSearch(on) {
  el("q").hidden = !on;
  el("back").hidden = on;
}

/**
 * BACK TO THE LIST IS A CHOICE TOO: the app stops remembering the task, so the next page to connect is
 * handed the list the human is actually looking at. And it PUSHES like any other choice, so Back returns
 * to the card they just left.
 */
function backToList() {
  selectedId = null;
  // THE CARD GOES WITH THE DETAIL: going back to the list is the page saying it is no longer reading one,
  // and a card kept here would be a brief nobody asked for any more.
  card = null;
  render();
  send("showing", { id: null });
  showInAddress(true);
  keepView();
}

function renderDetail() {
  const detail = el("detail");
  const list = el("list");
  const rowRec = board && selectedId ? board.records.find((r) => r.id === selectedId) : null;
  if (!rowRec) {
    // Back to the list — and if the record VANISHED (the board was re-read and it moved), its detail
    // cannot be shown from memory, because there is no memory here beyond the frame. THE ADDRESS IS NOT
    // WRITTEN FROM HERE: a renderer that writes history beats the human's own click to it ("back to the
    // list" PUSHES, and this branch runs first), and a renderer that decides things is the drift this page
    // is written against. The one place a selection can go STALE is a `board` frame, and the address is
    // corrected there — where the frame that took the card away is.
    selectedId = null;
    card = null;
    detail.hidden = true;
    detail.textContent = "";
    list.hidden = false;
    showSearch(true);
    return;
  }
  list.hidden = true;
  detail.hidden = false;
  detail.textContent = "";
  showSearch(false);

  // WHAT THE ROW ALREADY KNOWS IS DRAWN AT ONCE — the title, the state and the tags are in the frame the
  // list was drawn from — so opening a card is a detail on screen and never a blank one. Everything below
  // them is the CARD'S, read by its own request; until it arrives the page says what it is doing.
  // A CARD THE APP ANSWERED WITH NOTHING IS NOT A CARD TO DRAW: `record: null` means the id is not on the
  // board, so the row's own facts are drawn and the page says so — never a renderer reaching into a null.
  const answered = card !== null && card.id === selectedId;
  const head = answered && card.record !== null ? card.record : rowRec;
  const h = document.createElement("h2");
  h.textContent = head.title;
  detail.append(h);

  const labels = document.createElement("div");
  labels.className = "chips";
  const pill = document.createElement("span");
  pill.className = "pill " + head.state;
  pill.textContent = head.state;
  labels.append(pill);
  if (head.tags && head.tags.length > 0) labels.append(chips(head.tags));
  detail.append(labels);

  if (head === rowRec) {
    // TWO DIFFERENT SILENCES: a request that has not answered yet, and an answer that said the id is not on
    // the board. A person who opened a card is owed the difference (the note carries the same sentence).
    const said = line(
      answered ? "this card is no longer on the board." : "reading this card…",
    );
    said.classList.toggle("bad", fault());
    detail.append(said);
    return;
  }
  const rec = head;

  // WHERE IT CAME FROM AND WHO HAS IT, which is what a reader asks next: the id to quote, the folder
  // whose name IS the state, the owner and their worktree, who asked for it, and the two times.
  detail.append(terms([
    ["id", rec.id],
    ["owner", rec.owner || "unowned"],
    ["worktree", rec.worktree || ""],
    ["source", rec.source && rec.source.who ? rec.source.who : "nobody recorded"],
    ["words", rec.source && rec.source.words ? rec.source.words : ""],
    ["created", long(rec.created)],
    ["updated", long(rec.updated)],
    ["file", rec.path || ""],
  ]));

  detail.append(section("Why", body(rec.why, rec.whyHtml)));

  const ul = document.createElement("ul");
  ul.className = "acceptance";
  // EACH ITEM IS ITS OWN MARKDOWN, rendered in the server beside the item's own text: `acceptance` holds
  // one string per bullet, so the bullet drawn here is the one `render.ts` made of that string.
  const itemHtml = Array.isArray(rec.acceptanceHtml) ? rec.acceptanceHtml : [];
  (rec.acceptance || []).forEach((item, i) => {
    const li = document.createElement("li");
    li.className = "markdown";
    inject(li, item, itemHtml[i]);
    ul.append(li);
  });
  detail.append(section("Acceptance criteria", ul));

  // WHAT A LINK VALUE MAY DO ON THIS PAGE, and this is the whole of it: nothing that touches `location`.
  //
  // The board is served into loombot's app panel, which is an
  // <iframe sandbox="allow-scripts allow-forms allow-same-origin"> — and the report of 2026-10-09
  // (t20261009-182107-6176) is what that costs: a CARD ID in `links` passed `safeUrl()` as a relative URL,
  // so a click sent the frame to /a/<session>/app/board/<id>, loombot answered the app's 404 ("no <file> in
  // app <name>"), and the board, its rows and every control were gone with no way back.
  //
  // MEASURED in headless Chrome on 2026-10-09, against a frame with exactly this sandbox attribute:
  //
  //   * a RELATIVE href pressed inside the frame navigates the FRAME ITSELF: /app -> /second. So does an
  //     ABSOLUTE http:// URL. An absolute URL is NOT the safe half of this, and neither is a path that
  //     happens to exist — this page IS the app, and any document load replaces it.
  //   * target="_blank" does nothing at all: the frame stays and NO new page target is created (the
  //     sandbox has no allow-popups), so a link cannot be rescued by asking for another tab.
  //   * `mailto:` did not navigate the frame either, but that is the OS's protocol handler answering a
  //     headless browser rather than a promise, so it is text here too.
  //   * history.back() DID restore the app (a frame navigation is one joint-history entry), but nothing
  //     in the panel goes back: loombot's tab strip does not reload a frame it already has (openApp,
  //     web_page_js.ts), which is the "no way back" as it was reported.
  //
  // SO every link value is drawn as TEXT — selectable, copyable, inert. The ONE click that stays in the
  // page is a value that NAMES A TASK on this board: it opens that task's detail and touches no location.
  // Nothing else here follows anything, and nothing offers to: the panel's ↗ item that loaded this app
  // in a real tab was deleted on 2026-10-24 (card t20261024-open-in-tab), and a tab is the one place an
  // app cannot work at the edge anyway. The value is text, and copying it is what a reader can do.
  const links = document.createElement("ul");
  links.className = "links";
  for (const link of rec.links || []) {
    const li = document.createElement("li");
    const id = String(link).trim();
    if (TASK_ID.test(id)) {
      li.append(taskButton(link, id));
    } else {
      // A URL, a path into the repo, a scheme nothing should run: each of them the TEXT it is. A click
      // does nothing, which is the point — the value is still in front of the reader, to read or copy.
      const code = document.createElement("code");
      code.textContent = link;
      li.append(code);
    }
    links.append(li);
  }
  const box = document.createElement("div");
  box.append(linkText(), links);
  detail.append(section("Links", box));

  if (rec.notes && rec.notes.length > 0) {
    const ul2 = document.createElement("ul");
    ul2.className = "acceptance";
    for (const n of rec.notes) {
      const li = document.createElement("li");
      // A note is history: when, who, and what they said, in the words the record kept.
      li.textContent = (n.at ? short(n.at) + " " : "") + (n.who ? "(" + n.who + ") " : "") + n.text;
      ul2.append(li);
    }
    detail.append(section("Notes", ul2));
  }
}

function section(heading, content) {
  const box = document.createElement("section");
  const h = document.createElement("h3");
  h.textContent = heading;
  box.append(h, content);
  return box;
}

function body(text, html) {
  // A DIV AND NOT A `p`: the rendered markdown is blocks of its own (`<p>`, `<ul>`, `<pre>`, and a
  // heading a record wrote), and a `p` cannot hold one.
  const box = document.createElement("div");
  box.className = "body markdown";
  inject(box, text, html);
  return box;
}

/**
 * PUT A FIELD THE SERVER RENDERED INTO THE PAGE — the ONE place this page puts HTML in, and the whole of
 * why that is allowed.
 *
 * The reason it is safe is NOT that a record is trusted. It is that the HTML was made in the SERVER
 * (`rules.ts`, from `file-viewer/render.ts` — the renderer the file viewer's own view mode uses), which
 * escapes every piece of text it draws and gives a link no href to follow: a script tag, an `onerror=`,
 * a `javascript:` URL all arrive here as the characters they are. This page never renders markdown,
 * never reads a file and never builds markup out of a record; it puts finished, escaped HTML in one
 * place, which is exactly what the viewer's page does with the same renderer.
 *
 * AND THE TEXT IS STILL THE FALLBACK, so nothing depends on the rendered field being there: a frame from
 * a server that did not render it, or a field that is empty, is drawn with `textContent` — precisely
 * what this page drew before there was any HTML to inject.
 */
function inject(el, text, html) {
  if (typeof html === "string" && html !== "") el.innerHTML = html;
  else el.textContent = text || "";
  return el;
}

function terms(pairs) {
  const dl = document.createElement("dl");
  for (const [key, value] of pairs) {
    if (value === "" || value === undefined || value === null) continue;
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value;
    dl.append(dt, dd);
  }
  return dl;
}

function line(text) {
  const p = document.createElement("p");
  p.className = "meta";
  p.textContent = text;
  return p;
}

/**
 * OPEN ONE TASK BY ID — the whole of what `action === "select"` does, and now also what a task id in a
 * record's links does (`taskButton`), what the page's own ADDRESS claims, and what a Back lands on: ONE
 * path, so the agent pointing at a task, a URL somebody was handed and a click on its id cannot drift
 * apart. A task the board does not hold is SAID, and the view stays where it was: an id that moved between
 * the read and this call is not a reason to throw away what is on screen.
 *
 * `push` goes straight to `showInAddress`: a card the human picked pushes a history entry, and everything
 * that ARRIVES here — the agent, the entry address, a Back — replaces the one that is already there.
 */
function showTask(id, push) {
  const rec = board ? board.records.find((r) => r.id === id) : null;
  if (!rec) {
    note("no task " + JSON.stringify(id) + " on the board that was last read", true);
    return false;
  }
  selectedId = rec.id;
  card = null;
  // AND ITS GROUP IS OPEN BEHIND IT, so "← all tasks" comes back to a list that shows where this card
  // lives instead of a shut group it is inside of — which is what "open that card" has to mean when the
  // card's own state is one of the three that start collapsed.
  expanded.set(rec.state, true);
  render();
  showInAddress(push);
  // THE BRIEF IS A REQUEST OF ITS OWN, and it is made here rather than by each caller: a link, a Back, the
  // page's own address and the agent's `select` all arrive through this one path, so none of them can open a
  // detail the app was never asked about.
  askCard(rec.id);
  keepView();
  return true;
}

/**
 * THE ONE LINK VALUE THAT IS CLICKABLE: a value that names a task. A BUTTON and never an `<a>`, because a
 * button has no href to follow — there is nothing in it for the sandbox to send this frame to. An id the
 * last read does not hold goes down the same path as `select`: the note says so and the detail stays put.
 */
function taskButton(link, id) {
  const b = document.createElement("button");
  b.className = "link";
  b.type = "button";
  b.textContent = link;
  b.title = "opens this task in the page — this click does not navigate";
  b.addEventListener("click", () => showTask(id, true));
  return b;
}

/** The sentence that says why the links below are text, so that text does not read as a broken link. */
function linkText() {
  const p = document.createElement("p");
  p.className = "meta";
  p.textContent =
    "shown as text: a click on a link here would take this frame away from the app for " +
    "good, and there is no way back. the value is still here to read, and to copy.";
  return p;
}

/** A timestamp as a reader wants it: the minute, and no timezone arithmetic in the page. */
function short(iso) {
  return String(iso || "").slice(0, 16).replace("T", " ");
}
/**
 * THE STAMP, SHOWN AS IT WAS WRITTEN, ZONE AND ALL (Xiaohu, 2026-10-24): `2026-10-24 11:15 +08:00`, not
 * `2026-10-24 03:15 UTC`. No arithmetic happens here - the offset is read off the string and printed, which is
 * what "static is enough" asks for, and it cannot be wrong because nothing converts.
 *
 * A `Z` STAMP STILL READS: cards written before the change carry one, and `Z` means UTC, so it says so rather
 * than pretending to know an offset it was never given.
 */
function long(iso) {
  const s = String(iso || "");
  if (!s) return "";
  const m = /([+-])(\d{2}):(\d{2})$/.exec(s);
  if (m) return short(s) + " " + m[1] + m[2] + ":" + m[3];
  if (/Z$/.test(s)) return short(s) + " UTC";
  return short(s);
}

function note(text, bad) {
  const n = el("note");
  n.textContent = text;
  // The line is one line, cut with an ellipsis when it does not fit: the full text stays one long-press away.
  n.title = text;
  n.classList.toggle("bad", bad === true);
}

// ── the page's controls, and the frames that come back ───────────────────────────────────────────────

el("q").addEventListener("input", (e) => {
  query = e.target.value.trim();
  render();
  // AND THE APP ANSWERS THE FILTER: it is the half that has the bodies, so the query is a request and the
  // answer is the ids that match (see `askSearch`). Typing still costs no turn — nothing here reaches the
  // agent, and the rule that answers is mechanical.
  askSearch();
});

// THE MENU'S ITEMS CLOSE THE PANEL FIRST: a native <details> stays open until its summary is pressed again,
// and an action chosen from it must not leave it hanging over the page behind the change it made. That is
// the only line of menu logic here — the look and the disclosure are shared/theme.ts's.
const pick = (fn) => () => {
  el("menu").open = false;
  fn();
};
el("refresh").addEventListener("click", pick(() => send("refresh")));

// ── THE MENU'S OTHER TWO EXITS, which the element does not have ────────────────────────────────────────
// A native <details> opens itself and closes only when its own summary is pressed AGAIN: there is no
// outside-press behaviour and no Escape on the element, and a menu left hanging over the board is the one
// annoyance a menu this size can be. The VIEWER's page has had the outside press since it was written and
// this one did not (card t20261021-063446-f637) -- a press anywhere else left it open, which is what a person
// means by "it does not collapse when I click elsewhere". The LOOK is shared/theme.ts's and stays there; a
// stylesheet cannot listen, so these lines are the page's.
const menu = el("menu");
// A PRESS ANYWHERE BUT THE MENU SHUTS IT, in the CAPTURE phase so a control that cancels a press cannot keep
// it open. Nothing here OPENS it: that is the browser's, on the summary.
document.addEventListener("pointerdown", (e) => {
  if (!menu.open) return;
  const t = e.target;
  if (t === menu || (t && menu.contains && menu.contains(t))) return;
  menu.open = false;
}, true);
// AND ESCAPE, which the element does not answer either. It is read HERE rather than in loombot's escape stack
// (client/panel.js escLayers): this is a separate document, and that stack belongs to the page around it.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && menu.open) menu.open = false;
});
// WIRED ONCE, because this button lives in the header for the life of the page: a listener added per
// render would stack. (The detail's own button was created fresh each time, so it could not.)
el("back").addEventListener("click", backToList);
el("close").addEventListener("click", pick(() => requestClose()));

/**
 * THE CLOSE, from the button — and the local half never waits for the ask (card t20261027-025619-fb7e):
 * the frame is deregistered and the panel folds NOW, whether the ask lands, is refused, or is answered by
 * an app that only detaches; and the ask goes too, so the app ends on the graceful path (the agent is
 * told, the tab leaves the strip). A Close that needed the channel was a dead button.
 */
function requestClose() {
  // **THE SENTENCE SAYS WHAT THIS PAGE CANNOT DO** (2026-10-27, card t20261027-025619-fb7e): the panel
  // folds this frame NOW (the local half never waits for the app), so this page is detached from its
  // app the moment the button is pressed. Said BEFORE `closeLocally`, because the panel reads `#note`
  // at that post; the app's own farewell replaces it if the ask is answered.
  note("this page is detached from the board — it cannot edit or save; the panel folds it here");
  closeLocally();
  send("close");
}

/**
 * THE LOCAL HALF OF A CLOSE — the page contract's verb, and the ONE place this page calls it: loombot
 * splices `loomApp.close` into every app page. It tells the panel to deregister this frame and fold, and
 * answers whether there was a panel to tell. A standalone tab has none, and the sentence is then the
 * whole of what the press produces.
 */
function closeLocally() {
  try {
    return !!(globalThis.loomApp && globalThis.loomApp.close && globalThis.loomApp.close());
  } catch {
    return false;
  }
}

/**
 * WHAT THE APP SAID, by its action — one switch, and it is the whole of this page's reading half. The frame
 * is exactly what a socket delivered, so the drawing below never learns which carrier brought it.
 */
function handle(action, data) {
  if (action === "board") {
    // **A READ THAT FAILED IS NOT A BOARD, AND IT MUST NEVER EMPTY THE SCREEN** (card
    // t20261025-051703-9964). `rules.ts` answers a board it could not read with `records: []` AND an
    // `error`, and this page used to assign that frame like any other: the rows went, the count said
    // "0 tasks", and a board somebody was reading became one sentence over nothing at all — the same
    // picture as a page that never reached its app. What is already on screen is the LAST READ, which is
    // still what the board said, so the failure goes BESIDE it and the rows stay. Nothing else in this
    // frame is acted on either: a selection, an entry id and a query all need records, and it has none.
    if (data.error) {
      readFail = String(data.error);
      note(failedText(), true);
      render();
      return;
    }
    readFail = "";
    board = data;
    // WHAT THE PAGE WAS SHOWING BEFORE THIS FRAME, because "the app moved the selection" is a DIFFERENCE
    // and not a state: a re-read that says the same thing must not write the address it already has.
    const wasShowing = selectedId;
    // THE SELECTION COMES FROM THE APP, never from this page's memory: `showing` is what rules.ts
    // remembers, and adopting it here is the whole of what makes a page that connects late, reloads or
    // comes back to the panel open the task the agent pointed at — an action is not replayed to it.
    selectedId = data.showing ?? null;
    render();
    // AND WHAT COULD NOT BE READ IS SAID BESIDE THE ROWS (card t20260710-000000-0720), one file each: one
    // bad file used to fail the whole read, and the other half of that failure is a page drawing forty
    // cards out of forty-one without a word. The read time is still the line when everything read.
    const broken = Array.isArray(data.broken) ? data.broken : [];
    if (broken.length > 0) note(brokenText(broken), true);
    else note("read " + long(data.at) + " from " + data.board, false);
    // AND THE READ IS KEPT, for the document after this one (the section near the top of this file): on
    // every successful read, and only on one.
    keep(data);
    // AND THE OFFSET A PAINT COULD NOT REACH YET: the board's frame is here, but the card's BODY is a
    // request of its own and the page is not tall until it lands — so this aims, and the `card` answer
    // aims again.
    applyRescroll();
    // A FRAME CAN ALSO TAKE THE SELECTION AWAY — a card that moved off the board, or a re-read that no
    // longer holds it: `renderDetail` has drawn the LIST, and the address has to stop naming a card nobody
    // is looking at. A non-null `showing` that leaves `selectedId` null is that whole condition.
    // A FRAME THAT COULD NOT BE READ CHANGES NOTHING ABOUT THE ADDRESS: nothing is known about the board,
    // and the address is the one fact that still holds — the next read settles it either way.
    // **A FRAME THAT MOVES THE SELECTION MOVES THE ADDRESS WITH IT** (card t20261024-022904-fb60). The agent
    // pointing at a card arrives as state now — `rules.action` folds `select` in, the page is told to
    // re-read, and the frame comes back naming it — so the address is corrected IN PLACE here, which is the
    // same write a pushed `select` used to make (`showTask(id, false)`). A frame that takes the selection
    // away (the card moved off the board, or the app forgot it) clears the address the same way. And a
    // re-read that changes nothing writes nothing, which is what keeps the human's own pick from having its
    // `pushState` replaced by a `replaceState` one moment later.
    if (!data.error && wasShowing !== selectedId) showInAddress(false);
    // THE ADDRESS GETS ITS ONE SAY — here, after the frame is drawn and after the note is written, because
    // "no task … on the board" is something the human has to be able to READ, and `showTask` is what says it.
    // A READ THAT FAILED IS NOT ONE OF THOSE FRAMES: there are no records to open anything against, and
    // claiming otherwise would talk over the note that says the board could not be read — so the claim
    // WAITS, and the next frame that can answer it is the one that spends it (Refresh, or a re-read).
    if (entryId !== "" && !data.error) {
      const claimed = entryId;
      entryId = "";
      if (showTask(claimed, false)) {
        // Reported unless the app already remembers exactly this: one rule either way, no turn, and it is
        // what makes a URL somebody was handed stick for the next page to connect.
        if ((data.showing ?? "") !== claimed) send("showing", { id: claimed });
      } else {
        // An id the board does not hold: the note above says so, and the address stops naming a card
        // nobody is looking at.
        showInAddress(false);
      }
    } else if (selectedId !== null) {
      // **AND A CARD THAT IS ALREADY OPEN IS RE-READ WITH THE LIST** (t20261024-052218-0bb3). The detail's
      // brief is no longer a field of this frame, so the frame that brings the rows back is also the one
      // that has to bring the CARD back — otherwise a record that changed on disk (a claim, a note, a new
      // acceptance criterion) would sit in a detail that never moves. The claim above asks for its own
      // card through `showTask`, so this branch is only the frame that arrives with nothing to claim.
      askCard(selectedId);
    }
    // **AND A QUERY IN THE BOX IS RE-ASKED WITH IT**, for the same reason: the ids this page holds are an
    // ANSWER, and a re-read is new rows they were not computed from — a filter left alone would keep
    // showing a card that no longer matches, or hide one that now does.
    if (query !== "") askSearch();
    return;
  }
  if (action === "card") {
    // **A CARD THE PAGE HAS MOVED ON FROM IS DROPPED**, and this is the one thing an asynchronous detail
    // needs: `id` is the id that was ASKED FOR, so a slow answer about the card somebody clicked before
    // this one can never draw over the card they are reading. A `record: null` is an answer too — the board
    // does not hold that id — and the note says so rather than the detail going quietly blank.
    if (!data || data.id !== selectedId) return;
    if (data.error) {
      card = null;
      note("the card could not be read: " + data.error, true);
    } else {
      card = { id: data.id, record: data.record ?? null };
      if (data.record === null || data.record === undefined) {
        note("no task " + JSON.stringify(data.id) + " on the board that was just read", true);
      }
    }
    render();
    // AND THE SAME AIM, now that the body has made the page as tall as the place the reader was.
    applyRescroll();
    return;
  }
  if (action === "search") {
    // **AN ANSWER TO A QUERY THAT IS NO LONGER IN THE BOX IS NOT DRAWN.** Three keystrokes are three
    // requests and nothing promises they come back in order; `q` is what makes the last one win. A read that
    // FAILED is not a query that matched nothing, so it lifts the filter and says so instead of leaving the
    // list looking empty.
    if (!data || String(data.q ?? "") !== query) return;
    if (data.error) {
      hits = null;
      note("the board could not be read, so nothing was searched: " + data.error, true);
    } else {
      hits = { q: data.q, ids: Array.isArray(data.ids) ? data.ids : [] };
    }
    render();
    return;
  }
  if (action === "ack") {
    // THE APP TOOK IT AND HAS NOTHING TO SAY — a `showing` report is state, and a rule that returns only
    // state produces no frame at all (`channel.ts` answers those itself). Nothing to draw, and nothing
    // wrong: it is the quiet success of every click that reports a selection.
    return;
  }
  if (action === "error") {
    note(data.reason || "error", true);
    return;
  }
  if (action === "detached") {
    // THE PAGE'S CLOSE, DECLINED BY THE APP (the durable board, card t20261025-061114-f6b7): the server
    // answers the request with this frame and ends nothing. THE PAGE STILL CLOSES LOCALLY (card
    // t20261027-025619-fb7e): the frame is deregistered and the panel folds through the page contract's
    // one verb (`loomApp.close`, spliced in by loombot), so the button works whatever the app decides. The
    // sentence says what this page CANNOT do, never what it can.
    closeLocally();
    note("this page is detached — it cannot edit or save; Close folded the panel here");
    return;
  }
  if (action === "player_left") {
    // THE APP IS OVER, and this frame rides on a request that was being answered when the app ended
    // (`unmount`). **IT IS NOT THE ONLY WAY, AND `stopWorker` IS NOT ONE OF THEM**: a board the agent
    // stopped, one that crashed, or a session that ended pushes this same farewell at nobody, and the
    // page learns it from a `404 no such app` on its next request — `unreachable` above. One state and
    // one sentence for both, because it is one fact about the same app. A page's OWN Close is answered
    // `detached` (above), not this: the durable board ends for nobody's button.
    ended(data.reason);
  }
}

// ── the channel, and what the page says while it cannot reach the app ────────────────────────────────
//
// THE DEFECT THIS SECTION EXISTS FOR, measured on a phone against a live loombot (2026-10-21): the page drew
// its chrome — "Tasks", Refresh, Close, the search box — and under them NOTHING. No cards, no error, no
// "connecting", reported as "the app still does not display". A request can fail; a page may not be SILENT
// about it. So the channel is a STATE, and it is drawn in TWO places — the header's own line (#channel) and
// the list's placeholder, which is where the person looked:
//
//   "connecting"  a read is in flight and has not been answered yet.
//   "open"        the app answered. The page then says what it READ (#note) and nothing about the channel:
//                 silence here is the HEALTHY case's signature, which is what keeps a board with nothing on
//                 it from ever sounding like a page that failed.
//   "closed"      a request failed, and the reason is in words. RETRIED, on a ladder of its own.
//   "over"        the APP is over, and it is TERMINAL. Two ways to learn it and one state: its Close is
//                 answered with `player_left`, and everything else (an agent's `stopWorker`, a crash, a
//                 session ending) arrives as `404 no such app`. Never retried: the sentence names the move
//                 that helps — start it again, then reload.
//
// **IT LEARNS OF A FAILURE WHEN IT ASKS, AND NOWHERE ELSE** — that is the design and not an oversight. An
// app has no socket, so nothing can push a failure at this page: it finds out at the next read — a person's
// press, a re-read the page asked for, or its own retry. A board whose app has died therefore keeps showing
// what it last read, which is still TRUE, until somebody asks it something. What it must never do is look
// like a board that was read and found empty.
//
// THE RETRY IS THIS PAGE'S OWN. The delay doubles up to LAST_RETRY_MS (a page that hammered loombot would be
// somebody else's outage), and it starts over — the ladder AND the read — when the network comes back
// (`online`) or the person comes back to the tab (`visibilitychange`). A background tab gets no read at all:
// iOS suspends one mid-request, and the wake event is what brings it back.
const FIRST_RETRY_MS = 1000;
const LAST_RETRY_MS = 15000;
let channel = "connecting";
/** The delay the NEXT retry will wait: doubled on every failure, and put back to FIRST by an answer. */
let retryMs = FIRST_RETRY_MS;
/** The delay the PENDING retry is waiting, or 0 for none — what #channel counts down, and what a test reads. */
let retryInMs = 0;
let retryTimer = 0;
/** Whether the app ever answered, which is how "connecting" and "reading again" are told apart. */
let everOpened = false;
/** Why the last attempt failed, in the app's or the network's own words, or "" — the sentence in `#channel`. */
let closedReason = "";
/** Why the last READ of the board failed, in the app's own words, or "" — and it is NOT `closedReason`. */
let readFail = "";

/** Whether the channel is in a state a person has to ACT on, as opposed to a moment in the life of one. */
function fault() {
  return channel === "closed" || channel === "over";
}

/** A BACKGROUND TAB ASKS NOTHING: iOS suspends one mid-request, and a wake event is what brings it back. */
function backgrounded() {
  return document.hidden === true || document.visibilityState === "hidden";
}

/** The header's channel line, in a person's words — `""` when the app answers and the board speaks. */
function channelText() {
  // OPEN, AND THEREFORE SILENT: this is the healthy case's signature, and everything the page has to say
  // then it says elsewhere — `#note` says what was read, and the list says what is on it.
  if (channel === "open" || channel === "over") return "";
  if (channel === "closed") {
    const why = closedReason === "" ? "" : " (" + closedReason + ")";
    const when = retryInMs > 0
      ? "retrying in " + Math.round(retryInMs / 1000) + "s"
      : "it retries the moment this tab is looked at again";
    return "the app is not answering" + why + " — " + when +
      ". The board below is the last read and stays readable.";
  }
  return everOpened ? "reading the board again…" : "connecting to the app…";
}

/**
 * THE ONE SENTENCE A FAILED READ OWES, said in two places for one reason: a `board` frame carrying an `error`
 * has no records, so a page holding nothing would otherwise draw the words "could not be read" and nothing
 * else. With a read already held the sentence says WHICH read is still on screen — "what is below is the
 * last read (…)" — because a page showing old rows and saying nothing about them would be claiming a
 * freshness it has not got.
 */
/**
 * WHAT A READ THAT LEFT SOMETHING OUT OWES, in the same voice as the failed-read sentence below: one
 * clause per unreadable file, `path: reason`, because the next move is to open that file. It is a
 * WARNING (`bad: true`) and not the failed-read sentence: the rows on screen ARE the board, and only
 * part of it is missing.
 */
function brokenText(broken) {
  const parts = broken.map((b) => String(b.path || "") + ": " + String(b.reason || ""));
  const head = broken.length === 1
    ? "1 card on this board could not be read"
    : broken.length + " cards on this board could not be read";
  return head + " — " + parts.join("; ");
}

function failedText() {
  const why = readFail === "" ? "the app did not answer" : readFail;
  if (board === null) return "the board could not be read: " + why + ".";
  return "the board could not be read: " + why + " — what is below is the last read (" +
    long(board.at) + " from " + board.board + ").";
}

/**
 * WHAT THE LIST SAYS WHEN THERE IS NO BOARD TO DRAW — in the place the cards would be, because that is where
 * a person looked and found nothing. Deliberately NOT the empty board's sentence: "this board is empty" is
 * a claim about a board, and this page can only make it once it has read one.
 */
function readingText() {
  if (channel === "over") {
    return "no board has been read: this board app is over (" + (closedReason || "closed") +
      "). Start it again, then reload this page.";
  }
  if (channel === "closed") {
    return "the board could not be read: " +
      (closedReason === "" ? "the app did not answer" : closedReason) +
      ". It retries by itself, and this list fills in when it does.";
  }
  // THE APP ANSWERED AND THE BOARD IS WHAT FAILED: a different fact from a channel that is down, and
  // one no retry of this page's is scheduled for — Refresh is the move, so it is the move that is named.
  if (readFail !== "") return failedText() + " Refresh asks again.";
  return "connecting to the app… and this list fills in by itself when it answers.";
}

/**
 * THE CHANNEL'S ONE LINE, above `#note`. Hidden the whole time the app answers, because there is then
 * nothing to say — `#note` says what was read and the list says what is on it. Red for the states a person
 * has to act on, dim for the two that are the page working on its own.
 */
function renderChannel() {
  const p = el("channel");
  const text = channelText();
  p.textContent = text;
  p.title = text;
  p.hidden = text === "";
  p.classList.toggle("bad", fault());
}

/** A FRAME FROM THE APP: the channel is open (whatever it said), the ladder is back, and it is drawn. */
function answered(frame) {
  if (channel !== "over") {
    everOpened = true;
    channel = "open";
    retryMs = FIRST_RETRY_MS;
    // CLEAR FIRST, THEN FORGET: an id zeroed before `clearTimeout` is a timer nobody can cancel, and it
    // fires into a page that has already read its board. Found by the ladder test, which counts pending ones.
    clearTimeout(retryTimer);
    retryTimer = 0;
    retryInMs = 0;
    closedReason = "";
    document.body.classList.remove("dead");
    render();
  }
  handle(frame && frame.action, (frame && frame.data) || {});
  // **THE ANSWER'S NUMBER IS WHAT THIS PAGE HAS HANDLED** — what the echo of its own click is compared
  // against (`loom/app-changed` below). Absent when the app keeps none, and then nothing is skipped on a
  // number.
  if (frame && typeof frame.rev === "number") held = frame.rev;
  // AND A CHANGE THAT LANDED WHILE THIS READ WAS IN FLIGHT IS READ ONCE MORE: the answer may predate it,
  // and one extra request is cheaper than a stale board (`loom/app-changed` below).
  if (again) read();
}

/** WHAT A REQUEST SAYS WHEN THE APP IS GONE — the words in the terminal sentence, and the one thing a page
 * can say without knowing what loombot put in a body it sends as plain text. */
const GONE = "its server is gone";

/**
 * NOT AN ANSWER: said in both places, and retried — unless the app is GONE, where a retry argues with a
 * fact.
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
 * `player_left` frame, which is the answer to this page's own Close, and a 404 to anything else.
 *
 * THE LIST IS REDRAWN TOO, and not only the header: when nothing has been read its placeholder is the only
 * thing on the page, and leaving it saying "connecting to the app…" is a page that looks alive and answers
 * nobody. The board already on screen stays — it is the last thing read, and it is still true.
 */
function ended(why) {
  if (channel === "over") return;
  channel = "over";
  closedReason = why || "unmounted";
  document.body.classList.add("dead");
  render();
  note(
    "this board app is over (" + closedReason + "). Start it again, then reload this page.",
    true,
  );
}

function dropped(why) {
  document.body.classList.add("dead");
  closedReason = why;
  channel = "closed";
  retryLater();
  render();
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
 * ASK FOR THE BOARD — the ONE place a read is started, so the state, the handlers and the retry cannot be
 * attached in one place and forgotten in another. `ready` is the event: the app answers it with everything
 * the page draws, and it is every retry's first word too, which is what makes a page that lost its app come
 * back with the cards it never threw away.
 */
function fresh() {
  clearTimeout(retryTimer);
  retryTimer = 0;
  retryInMs = 0;
  closedReason = "";
  channel = "connecting";
  render();
  read();
}

/**
 * A NEW REASON TO TRY — the network back, or the person back at the tab — so the ladder starts over AND the
 * read happens now rather than when the old delay was due. A read already in flight is left alone: two reads
 * at once would be two answers racing to draw the same page.
 */
function wake() {
  if (channel !== "closed") return;
  retryMs = FIRST_RETRY_MS;
  fresh();
}

/**
 * **THE PARTS THIS PAGE DRAWS, AND THE ONE RULE THAT MAKES NAMES SAFE** (card t20261024-061052-2740;
 * `building-a-loom-app/README.md`, THE PAGE CONTRACT, rule 7).
 *
 * A push names the parts of the app's state that changed — `["list"]`, `["shown", "card"]` — and a page
 * reads the ones it is DRAWING among them. `KNOWN` is every part this page has heard of, `DRAWN` is what
 * is on screen right now, and the difference between them is the whole of the safety:
 *
 *   * A NAME THIS PAGE DOES NOT KNOW is a change, so it reads. It may be a part of an app newer than this
 *     page, and the page cannot tell that from a part it does not draw — so it reads, which costs a
 *     request.
 *   * A PUSH THAT NAMES NOTHING (no `parts` at all) is the same: everything this page draws is read,
 *     which is exactly what every page did before names existed.
 *   * A NAME IT KNOWS AND IS NOT DRAWING is the one case that costs nothing, and it is the case this
 *     exists for: the agent moving a task between states names `list`, a page with a card open is not
 *     drawing `list`, and its reader is not moved off the card — nor sent looking for anything.
 *
 * A name can therefore only ever make a read UNNECESSARY. A forgotten name, or a wrong one, costs a
 * request and never an update — which is what makes this a fact to compare rather than an instruction to
 * obey.
 */
const KNOWN = ["list", "card", "shown"];

/** What this page is drawing: the open card and its brief, or the list and its filter. */
function drawn() {
  return selectedId ? ["card", "shown"] : ["list", "shown"];
}

/**
 * HOW MANY READS ARE IN FLIGHT — 0 or 1, and `1` is what keeps a burst from being a read per frame. It is
 * counted rather than read off `channel`, because a change's re-read must NOT put "reading the board
 * again…" on the page: that sentence is for a page that cannot reach its app.
 */
let reading = 0;
/**
 * Whether a change this page DID have to act on arrived while a read was in flight. Without numbers there
 * is no way to know whether the answer already includes it, so it is read once more — one extra request in
 * the rare overlap, never a board left stale behind it.
 */
let again = false;

/** The parts a `loom/app-changed` carried, or null when the panel or the app named none. */
function partsOf(e) {
  const parts = e && e.detail ? e.detail.parts : undefined;
  return Array.isArray(parts) ? parts : null;
}

/**
 * THE APP'S STATE VERSION THIS PAGE HAS HANDLED, from the `rev` its last ANSWER carried — or null when the
 * app keeps none.
 *
 * IT IS NOT A LICENCE. One number cannot certify WHICH PARTS this page holds, so it decides nothing about
 * them: a part it is drawing is read whenever the number is newer, and a name it does not know is read even
 * when it is not. What the number does is collapse duplicates and echoes — and it is why the click that
 * opens a card does not cost that reader a second read of the card it just got.
 */
let held = null;

/** The `rev` a `loom/app-changed` carried, or null when the panel or the app kept none. */
function revOf(e) {
  const rev = e && e.detail ? e.detail.rev : undefined;
  return typeof rev === "number" ? rev : null;
}

/**
 * WHETHER THIS CHANGE IS ONE THIS PAGE HAS TO READ FOR — the whole of rule 7, in five lines.
 *
 * No names → yes. A name I do not know → yes. A name I know and am not drawing → no. An empty list is an
 * app saying it changed nothing a page can see → no.
 */
function mustRead(parts) {
  if (parts === null) return true;
  if (parts.length === 0) return false;
  const on = drawn();
  return parts.some((part) => KNOWN.indexOf(part) < 0 || on.indexOf(part) >= 0);
}

/**
 * ASK FOR THE BOARD AGAIN — the ONE place a change's read is started, and the ONE place `again` is
 * cleared: it belongs to the read that is starting, and the answer is what decides whether one more is
 * owed.
 */
function read() {
  again = false;
  reading++;
  void ask("ready").then(answered, unreachable).finally(() => {
    reading--;
  });
}

/**
 * THE PAGE SAYS WHEN TO RE-READ — the ONE document event the injected line turns the panel's message into
 * (`loombot/routes.ts` `appPageSnippet`, validated on both halves). Nothing is parsed, nothing is trusted.
 *
 * **AND IT READS ONLY WHAT IT DRAWS.** The names are the app's parts (rule 7, above): the agent moving a
 * task from open to done names `list`, this page with a card open is not drawing `list`, so the notice
 * costs it nothing — and, just as important, it is not a reason to switch the card the reader is reading.
 * That is not a rule anybody has to remember: `shown` is simply not among the names.
 */
document.addEventListener("loom/app-changed", (e) => {
  if (channel === "over") return;
  // THE CLICK THIS PAGE JUST MADE: the answer to its own POST carried this number, so a push that is not
  // newer is the echo of a state already drawn — the card it just opened costs it no second read.
  //
  // **A NUMBER THAT WENT BACKWARDS IS A NEW LIFE, NOT AN ECHO** (card t20261027-145404-6a9e, the same line
  // the viewer's page carried): `rev` only goes up within one instance, so `rev < held` is a FRESH
  // INSTANCE counting from zero — nothing survives an app's server (ruling 2). Only `rev === held` is the
  // echo. With `<=` the page went deaf to the whole second life and waited for a manual reload.
  const rev = revOf(e);
  if (rev !== null && held !== null && rev === held) return;
  if (!mustRead(partsOf(e))) return;
  // A READ IS ALREADY IN FLIGHT, and two reads at once would be two answers racing to draw the same board.
  // Whether that answer already includes this change cannot be known without numbers, so the page reads
  // once more when it lands — one extra request in an overlap, never a board left stale behind it.
  if (reading > 0) {
    again = true;
    return;
  }
  read();
});

document.addEventListener("visibilitychange", () => {
  if (!backgrounded()) wake();
});
globalThis.addEventListener("online", wake);
// AND THE VIEW IS WRITTEN AS IT CHANGES: a scroll is throttled (one write per 300 ms, not one per frame),
// and the document GOING AWAY is the one change that must not wait for the timer — a fold and a re-open is
// exactly a pagehide, and the whole point is what the next document paints.
document.addEventListener("scroll", () => {
  // A READER HAS MOVED if the page is not where the restore aims: that ends the restore, whatever the
  // next read does to the page's height. (The restore's own landing reads as `scrollY === rescroll`, and
  // `applyRescroll` has already cleared it by then.)
  if (rescroll !== 0 && globalThis.scrollY !== rescroll) rescroll = 0;
  keepViewSoon();
}, { passive: true });
globalThis.addEventListener("pagehide", () => {
  if (viewTimer !== 0) {
    clearTimeout(viewTimer);
    viewTimer = 0;
  }
  keepView();
});

// THE LAST READ FIRST, THEN THE READ (card t20261025-051703-9964): `paintLastRead` is what a reloaded
// document draws before anything has been asked, and `fresh` below is the asking. It stands beside
// `fresh` for the same reason `fresh` is last — the state it reads is declared above it.
paintLastRead();
// LAST, and it has to be: `fresh` reads the state declared above it, and a `const` read before its own line
// has executed is a temporal-dead-zone throw rather than a page that merely failed to read.
fresh();
