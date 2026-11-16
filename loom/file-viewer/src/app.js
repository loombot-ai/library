// The viewer page: VIEW a file, EDIT it in place, SAVE it back — and one `fetch` to the MCP server that owns
// the file. THE PAGE HAS NO SOCKET (card t20261024-022904-fb60): its data comes over the same carriage as its
// own bytes, `POST __event` under its own address, and the answer is the frame a socket used to carry.
//
// The page never touches the disk and never picks a path. It is handed a file (`show`: the kind, and for a
// text file its text, the HASH it was served at, whether it is editable, and for markdown its rendering)
// and it hands back a save (`save`: that path, the text, that base hash). Every rule — which path may be
// saved, the conflict check, binary and size, the atomic write — is the SERVER'S (`viewer_mcp.ts`,
// `files.ts`); this page only says what the server said. One owner per rule.
//
// THE MODES, in Xiaohu's words: "user clicks Edit to go to edit mode, clicks Save to go back to viewer
// mode, and the agent is notified automatically."
//
//   view    the default. Markdown rendered (#view); source in CodeMirror READ-ONLY (#editor); a PDF in an
//           <iframe>; an image in an <img>. Edit is offered only for an editable text file.
//   edit    the SAME CodeMirror, editable — for markdown it replaces the rendering with the source.
//           Save writes and returns to view; Cmd/Ctrl-S writes and STAYS (the mid-edit habit); Cancel
//           leaves without saving, and with unsaved changes it ASKS, inline (the panel frame cannot show
//           a dialog: its sandbox has no allow-modals). The header then shows ONLY Save and Cancel: no
//           hint line (Cmd/Ctrl-S is in Save's title) and no Close, which is a view-mode button.
//
// What the page does own is what only a page can know: whether its buffer is DIRTY — and it is the ONLY
// holder of that fact (2026-10-27, card 1325): nothing is reported to the server per keystroke, the tab
// title carries no `*`, and no show is ever refused for it. What the page keeps is a DRAFT in
// localStorage (inside the panel frame a beforeunload prompt is not allowed to appear either), and a
// change that arrives while the human is typing here is ANNOUNCED, the read that would apply it is NOT
// made, and the page reads and draws it when the buffer is resolved (README.md, rule 6).
//
// CodeMirror is loaded by `loadCode()` — a dynamic import of this app's own `code.js` — the first time a
// text file is shown, and never for a PDF or an image.
const here = location.pathname.replace(/\/+$/, "");
// The page's URL is /a/<workspace>/app/<name>/: both halves of the per-app storage prefix come from it.
const where = /\/a\/([^/]+)\/app\/([^/]+)/.exec(here);
const WS = where ? decodeURIComponent(where[1]) : "";
const APP = where ? decodeURIComponent(where[2]).replace(/@.*$/, "") : "viewer";
const el = (id) => document.getElementById(id);
/**
 * WHERE IT SITS, for the head's second span — and EMPTY WHEN THAT IS THE NAME AGAIN: `#title` is the
 * name and `#path` is the path, so a file at the app's root printed the name twice ("CHANGELOG.md
 * CHANGELOG.md", measured on a phone, 2026-10-27). A nested path stays whole ("src/a.ts" under "a.ts"
 * is a location, not a repetition), and CSS keeps an empty span from taking a row.
 */
const whereOf = (display) => {
  // WHERE IT IS, NEVER ITS NAME: the title is the file's own name, so a path that ENDS in that name
  // repeats it (Xiaohu, 2026-10-27: '.loom/root-listing.md' beside the title 'root-listing.md'). The
  // folder is the part the title cannot say: '.loom/root-listing.md' -> '.loom', 'a.ts' -> ''.
  const s = String(display ?? "");
  const at = s.lastIndexOf("/");
  return at < 0 ? "" : s.slice(0, at);
};
const view = el("view"), pdf = el("pdf"), img = el("img"), notice = el("notice");
const body = document.body;

// `framed` WAS HERE - "is this the panel's frame or this page's own tab?" - and it is gone with `#hint`
// (2026-11-11): it existed only to add the PDF sentence in a frame, and today's Chrome renders a PDF in the
// panel as it does in a tab.

const kib = (n) => n < 1024 ? n + " B" : (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KiB";
// ── state ───────────────────────────────────────────────────────────────────────────────────────────

/** The last `show` frame: what is on the page. */
let cur = null;
/** "view" or "edit". Edit exists only for an editable text file. */
let mode = "view";
/** The text as last saved or served — dirty is "the buffer is not this". */
let savedText = null;
let dirty = false;
/**
 * A CHANGE THAT COULD NOT BE DRAWN YET, because the human was editing here.
 *
 * A `show` used to be PUSHED to every page, so one that landed while this buffer was not empty was HELD
 * (`pending`), announced and drawn when the buffer was resolved. There is no push any more: the panel says
 * "this app changed" and the page re-reads, so a change now means THE APP'S STATE MOVED and this page has
 * not looked. Two ways to get it wrong, and both are failures:
 *
 *   * A PAGE THAT RE-READ WHILE IT WAS EDITING would draw the app's copy of the file over the text being
 *     typed, which is how an edit gets eaten. So the read does not happen while `dirty`.
 *   * A PAGE THAT SKIPPED THE READ IN SILENCE would sit on a file that is no longer the one on show and
 *     say nothing about it — a stale page, which looks exactly like a working one.
 *
 * `waiting` is the fact that tells them apart, and the sentence in `loom/app-changed` is how a person is
 * told: something is waiting, and it opens when the buffer is resolved (a Save that lands with nothing
 * typed since, or a Cancel that discards).
 */
let waiting = false;
/** The save in flight: the text it carried, and whether it was the Save BUTTON (back to view). */
let inflight = null;

// ── the last read, kept across a reload ─────────────────────────────────────────────────────────────
//
// **A RELOAD IS NOT THIS PAGE'S DECISION, AND IT USED TO BE A BLANK PAGE** (card t20261025-061113-3784;
// the board's page had the same hole first). The panel reloads an open frame when the app's version
// moves, and a restart of the app's MCP re-registers, so the reload lands while a file is being read;
// every byte this page held was in `cur`, so a reload was "Nothing shown yet" plus a fetch of the
// whole frame, and a failed fetch was reported over nothing. The rule this follows is the board's
// (building-a-loom-app/README.md, the page contract, rule 8), with the differences a read of BYTES
// forces — the full measurement story lives there and on the card; what the page needs is this:
//
//   * ONE KEY PER APP AND SESSION, from this page's own ADDRESS (`app:<session>:<app>:read`, the
//     keyspace the drafts live in). The name keeps its `@agent` suffix although the draft key strips
//     it: a draft has the base hash to check itself against, a kept read has nothing, so two agents'
//     apps of one name must not share.
//   * WRITTEN ON A SUCCESSFUL READ AND NEVER OTHERWISE — a `show` that was drawn, and the save that
//     replaced it — and replaced only by a read whose `rev` is not OLDER, so two tabs of one app
//     cannot make it go backwards.
//   * A FAILED READ NEVER EMPTIES THE SCREEN: the file stays, the failure is said in `#status`
//     beside it, and the channel sentence ("the file on screen is the last one read") is at last true.
//   * THE VIEW IS KEPT WITH THE READ — which screen is up, and how far down the reader was.
//
// THE SIZE IS THE DECISION THE MEASUREMENT MADE: `localStorage` is ONE budget of about 5 MB of
// characters for the whole origin (loombot's own page keeps a person's unsent draft in it; so do the
// drafts below), and the read is BYTES. Measured with the real `files.ts` and `render.ts`: a source
// file at the server's own ceiling keeps to a record of 2,098,213 characters, a 457 KB markdown
// document to 1,532,672 with its rendering, one level of a directory tree to 2,772. So the ceiling is
// `KEPT_MAX`, 2 MiB of characters — a record no bigger than the biggest file the server shows whole,
// ~40% of the origin — and a read past it is not dropped: it degrades to the PATH, the crumb and a
// `stale` note, and the page paints the header and says the bytes were too big to keep while it reads
// again (measured: markdown past ~600 KB of source, and a source file within ~3 KB of the ceiling).
const KEPT_VERSION = 1;
/** THE CEILING, in characters of JSON — the server's own file ceiling (`files.ts` `MAX_FILE_BYTES`). */
const KEPT_MAX = 2 * 1024 * 1024;
/** THE ONE KEY A READ IS KEPT UNDER, from the address the page was served at. No address (this page
    opened outside loombot), no keep: a read has nothing to be right about without one. */
const APPRAW = where ? decodeURIComponent(where[2]) : "viewer";
const KEEP = where === null ? null : "app:" + WS + ":" + APPRAW + ":read";
/** THE STATE VERSION OF THE LAST FRAME THAT ARRIVED (`answered`) — what `keepRead` labels a read with.
    Null when the app keeps none, and then nothing is refused. */
let lastRev = null;
/** Whether WHAT IS ON SCREEN is the kept read rather than an answer — the connecting line's fact. */
let keptOnScreen = false;
/** The read this document is holding in memory, as the record keeps it — or null for nothing kept. */
let keptNow = null;
/** THE OFFSET A PAINT COULD NOT REACH YET, and the file it belongs to — see `aimScroll`. */
let rescroll = 0;
let rescrollPath = "";

/** THIS BROWSER'S STORAGE, or null — a privacy mode refuses it, and a page with no memory is simply
    the page this one used to be. Nothing here may throw: what is on screen never depends on the copy. */
function storage() {
  try {
    return typeof localStorage === "undefined" || localStorage === null ? null : localStorage;
  } catch {
    return null;
  }
}

/** THE KEPT READ, as the record stores it, or null. A value that is not one of this page's reads is
    dropped without a word — there is no schema between this page and itself across a reload, so the
    shape is checked where it is read, not trusted where it was written. */
function remembered() {
  const s = storage();
  if (s === null || KEEP === null) return null;
  let kept = null;
  try {
    kept = JSON.parse(s.getItem(KEEP) || "null");
  } catch {
    return null;
  }
  if (!kept || kept.v !== KEPT_VERSION) return null;
  if (kept.stale === true) {
    return typeof kept.path === "string" && typeof kept.display === "string" &&
        typeof kept.kind === "string"
      ? kept
      : null;
  }
  const f = kept.frame;
  if (
    !f || typeof f.path !== "string" || typeof f.display !== "string" || typeof f.kind !== "string"
  ) {
    return null;
  }
  if ((f.kind === "code" || f.kind === "markdown") && typeof f.text !== "string") return null;
  return {
    rev: typeof kept.rev === "number" ? kept.rev : null,
    frame: f,
    scroll: typeof kept.scroll === "number" && isFinite(kept.scroll) && kept.scroll >= 0
      ? Math.round(kept.scroll)
      : 0,
  };
}

/** PUT ONE RECORD IN THE STORE — the one place a read is written. A record past the ceiling is not
    thrown away: it degrades to the PATH, the crumb and a `stale` note — unless this is a view change,
    which never demotes a read a previous write kept whole. */
function storeRead(record, allowStale = true) {
  const s = storage();
  if (s === null || KEEP === null) return;
  const text = JSON.stringify({ v: KEPT_VERSION, ...record });
  if (text.length > KEPT_MAX) {
    if (allowStale) storeStale(record.frame);
    return;
  }
  try {
    s.setItem(KEEP, text);
    keptNow = record;
  } catch {
    // A FULL OR REFUSING STORE IS NOT THIS PAGE'S FAULT: what is on screen is unaffected, and the next
    // successful read is what brings the kept copy up to date.
  }
}

/** THE PATH AND THE FACTS, when the bytes do not fit: a reload paints the header of the file that was
    on show and says why the bytes are not under it. Nothing of the bytes is kept — that is the point
    of the ceiling — and the read the page asks for anyway is what fills the screen. */
function storeStale(frame) {
  const s = storage();
  if (s === null || KEEP === null || !frame) return;
  const record = {
    stale: true,
    path: String(frame.path || ""),
    display: String(frame.display || frame.path || ""),
    kind: String(frame.kind || ""),
    bytes: typeof frame.bytes === "number" ? frame.bytes : 0,
    lines: typeof frame.lines === "number" ? frame.lines : 0,
    noEdit: String(frame.noEdit || ""),
    // THE CHAIN, so a read too big to keep does not empty the way OUT of the file (2026-10-29). It stands
    // where the facts line's text stood: that was kept only to repaint a row that is gone, and `crumbs` is
    // what the row it became is drawn from.
    crumbs: Array.isArray(frame.crumbs) ? frame.crumbs : [],
  };
  try {
    s.setItem(KEEP, JSON.stringify({ v: KEPT_VERSION, ...record }));
    keptNow = record;
  } catch { /* as above: what is on screen is unaffected */ }
}

/** THE APP SAID THERE IS NOTHING ON SHOW: the kept read goes with it, so a reload starts from the
    truth rather than from a file the app has put away. */
function dropRead() {
  keptNow = null;
  keptOnScreen = false;
  rescroll = 0;
  try {
    const s = storage();
    if (s !== null && KEEP !== null) s.removeItem(KEEP);
  } catch { /* nothing to drop */ }
}

/** KEEP THIS READ — when a `show` has been drawn and when the save that replaced it has landed, and
    nowhere else. The frame kept is the frame on screen; the rev is the one the answer that produced it
    carried, and an OLDER read never replaces a newer one already kept. */
function keepRead(rev) {
  if (KEEP === null || !cur || cur.kind === "empty") return;
  const at = typeof rev === "number" ? rev : null;
  const was = remembered();
  if (was !== null && !was.stale && was.rev !== null && at !== null && at < was.rev) return;
  // THE KIND IS THE VIEW: the frame kept is whole, so a reload repaints a LISTING as a listing and a file
  // as a file — the dir/file distinction is the frame's own `kind`, and the record loses it for nothing.
  storeRead({
    frame: { ...cur },
    rev: at,
    scroll: theScroll(),
  });
}

/** AND THE VIEW IS KEPT WITH THE READ, written when it changes and not only when a read lands — a
    fold and re-open re-points the frame at the app's entry page and re-loads the document
    (`client/conversation.js` `openApp`), and what must not survive that is a page that forgot where it
    was. A scroll is one stringify of the whole record (measured 2.5-5.5 ms at the sizes that fit), so
    the write is DEBOUNCED TRAILING — once per pause, not once per 300 ms of a burst: the one place
    this page differs from the board's 90 KB of rows. */
let viewTimer = 0;
function keepViewSoon() {
  clearTimeout(viewTimer);
  viewTimer = setTimeout(() => {
    viewTimer = 0;
    keepView();
  }, 300);
}
function keepView() {
  if (keptNow === null || keptNow.stale || !cur || cur.kind === "empty") return;
  if (cur.path !== keptNow.frame.path) return;
  storeRead({
    frame: { ...cur },
    rev: keptNow.rev,
    scroll: theScroll(),
  }, false);
}

/** THE ELEMENT THAT SCROLLS WHAT THE READER IS ON, or null: the source scrolls inside CodeMirror, and
    everything else — the rendering, a listing, a PDF, a picture — scrolls `main`. */
function scroller() {
  if (body.classList.contains("cm")) {
    return ed && ed.view && ed.view.scrollDOM ? ed.view.scrollDOM : null;
  }
  return typeof document.querySelector === "function" ? document.querySelector("main") : null;
}

/** HOW FAR DOWN THE READER IS, as the record keeps it: 0 for a screen that does not scroll. */
function theScroll() {
  const s = scroller();
  const at = s && typeof s.scrollTop === "number" ? s.scrollTop : 0;
  return isFinite(at) && at > 0 ? Math.round(at) : 0;
}

/** AIM FOR THE KEPT OFFSET: at the paint, and after every draw of the file it belongs to, until it is
    reached or the file changes. The editor fills ASYNC (the bundle imports on first text), so the
    place the reader was may only exist once the text has landed — an aim, not a one-shot. */
function aimScroll() {
  const s = scroller();
  const at = s && typeof s.scrollTop === "number" ? s.scrollTop : 0;
  if (rescroll === 0 || !cur || cur.path !== rescrollPath || at >= rescroll) {
    rescroll = 0;
    return;
  }
  if (s) s.scrollTop = rescroll;
}

/** A SCROLL ANYWHERE IN THIS PAGE: the reader's place moved — or the aim just applied it, which is the
    same write — so the view is kept soon, and an aim that has not landed yet is over. Scroll events do
    not bubble, but the capture phase still walks down from the document, which is why this hears
    `main` and CodeMirror's scroller alike. */
document.addEventListener("scroll", () => {
  rescroll = 0;
  keepViewSoon();
}, { capture: true, passive: true });

/** THE LAST READ IS PAINTED BEFORE ANY FETCH: the document a reload brings back is the file somebody
    was reading. The paint goes through the page's own `draw` — the header and the listing are
    synchronous, the text fills when the bundle lands, and the connecting line is SAID AGAIN after the
    draw, because the draw's own lines would have cleared it. */
function paintLastRead() {
  const kept = remembered();
  if (kept === null) return;
  if (kept.stale) return paintStale(kept);
  keptNow = kept;
  lastRev = kept.rev;
  rescroll = kept.scroll;
  rescrollPath = kept.frame.path;
  // THE READER'S OWN FACTS the agent's frame carried at the time are not re-asserted by memory: a kept
  // `line` was the agent's goto at show time, honored when it was shown, and a kept `by: "link"` would
  // say the human just clicked a link. The FILE is what memory restores; where in it is the scroll.
  const again = { ...kept.frame, line: null, by: kept.frame.by === "link" ? "" : kept.frame.by };
  // ARMED BEFORE THE PAINT AND DISARMED BY THE APP'S OWN FIRST FRAME (see `memoryOnScreen`): this draw is
  // memory, so nothing of it is a place this document went.
  memoryOnScreen = true;
  void draw(again, true).then(() => {
    // A FRESH ANSWER GOT THERE FIRST and drew some other view: memory does not argue with the app.
    if (!cur || cur.path !== kept.frame.path) return;
    aimScroll();
    // AND THE RESTORED VIEW IS THE RECORD, written now rather than on the scroll debounce: the 300 ms
    // between this and a debounced write is a window in which a second reload forgets the restore
    // this one just did.
    keepView();
    renderChannel();
  }).catch(() => renderChannel());
}

/** THE STALE RECORD: the header of the file that was on show, the chain it sat in, and the sentence that
    says why the bytes are not under it. Nothing here needs the app — it is painted before the ask, and
    the ask, or its failure said beside it in `#status`, is what replaces it. */
function paintStale(kept) {
  // A DRAW PATH OF ITS OWN — it never goes through `draw` — so it begins where every draw path begins.
  resetPaint();
  keptNow = kept;
  keptOnScreen = true;
  // THE HEADER IS `header`'s — a stale record carries the same fields a frame does, so this path no longer
  // writes `#title` and `#path` a second time (card t20261028-022447-aa96).
  header(kept);
  skin();
  // AND THE CHAIN COMES BACK WITH IT, from the record's own `crumbs`: on a screen whose bytes could not be
  // kept at all, the folders the file sits in are still one click away. The path span is empty because the
  // crumb says where this is — `header`'s rule, unchanged.
  drawCrumb(kept.crumbs, kept.path);
  el("noedit").textContent = kept.noEdit || "";
  el("refresh").disabled = true;
  el("edit").disabled = true;
  view.className = "empty";
  view.textContent = kept.display +
    " is what was on show — its bytes were too big to keep across this reload, so it is being read again.";
}

// ── CodeMirror, loaded once and only for text ───────────────────────────────────────────────────────

/** THE ONE PLACE the bundle is imported. A PDF or an image never calls this. */
function loadCode() {
  return import("./code.js");
}
let code = null;
let ed = null;
/** THE MODULE, for a text file this page DRAWS: a markdown's fences and any file's language name. Loading it
    is not the same as building the editor, which is the next function's whole point. */
async function ensureCode() {
  if (!code) code = await loadCode();
  return code;
}
/**
 * **THE EDITOR IS CREATED ONLY WHERE ITS BOX IS VISIBLE** (card t20261028-022447-aa96): CodeMirror measures
 * the element it is given, and a box the page is hiding (`body:not(.cm) #editor`, index.html) measures
 * nothing — the blank editor a phone showed on iOS. Both callers put the box on screen FIRST: `drawText`
 * for a code file, whose view mode IS the editor, and `enterEdit` for everything else. A markdown file's
 * view mode is the server's rendering, so its editor does not exist until somebody presses Edit.
 */
async function editor() {
  if (ed) return ed;
  await ensureCode();
  ed = code.createEditor(el("editor"), { changed, save: () => save(false, false) });
  return ed;
}

// For a probe driving a real browser: a module's bindings are not reachable from Runtime.evaluate.
globalThis.loomViewer = {
  state: () => ({
    kind: cur && cur.kind,
    mode,
    dirty,
    codeLoaded: code !== null,
    text: ed ? ed.text() : null,
  }),
  // **THE BYTES THE LAST DOWNLOAD HANDED THE BROWSER** (card t20261028-010039-c7a2): a save is the one
  // thing a press does that leaves nothing on the page to look at, so a probe that has to know WHAT was
  // saved reads it here rather than trusting a filename in a download folder.
  lastSave: () => (lastSave ? { name: lastSave.name, bytes: lastSave.bytes } : null),
  // **THE WALK AS THIS DOCUMENT MODELS IT** (the rig's column, card t20261111): `past`, `walkable` and
  // `named` are module bindings, and the served page is ONE MINIFIED LINE (`assets/app.js`), so a debugger
  // breakpoint at a `src/app.js` line number resolves against nothing — measured 2026-11-11, a rig that had
  // been reading `past` through two breakpoints got `capture: null` and `past: []` for every step of a run,
  // which is a column that agrees with any story. This is the same scope, read on purpose, where the page
  // already offers a probe for exactly this reason.
  history: () => ({
    past: past.slice(),
    walkable: walkable,
    named: named.slice(),
    viewMarked: viewMarked,
    landingMarked: landingMarked,
    returningTo: returningTo,
    historyWorks: historyWorks,
    memory: memoryOnScreen,
    len: history.length,
    state: history.state,
    here: cur ? String(cur.path || "") : "",
    backDisabled: el("back").disabled,
    kept: keptOnScreen,
    draws: paintGen,
  }),
};

// ── the app: one request, one answer, and no socket ─────────────────────────────────────────────────
//
// THE PAGE HAS NO SOCKET (Xiaohu, 2026-10-24: "I want simple and efficient"; card t20261024-022904-fb60).
// Its data comes over the same carriage as its own bytes — ONE `fetch` — and the answer is the frame a
// socket used to carry, `{action, data}`. The contract, in the order it matters to this page:
//
//   * THE ADDRESS IS RELATIVE: `__event`, under this document's own directory. The page is at
//     `/a/<session>/app/<name>/` on the machine and at `/d/<device>/a/<session>/app/<name>/` at the edge
//     (a published app is served by a service worker there), and a relative URL is the same one in both. No
//     host, no port, no session id, no app name, no device — and NO TOKEN: loombot splices nothing into this
//     page any more, because there is no socket left for a token to admit.
//   * ONE REQUEST, ONE ANSWER. `ask()` posts `{event, data}` and resolves with the app's own frame. A
//     request that cannot be answered fails with a SENTENCE rather than a bare "Failed to fetch", because
//     everything it can fail with is about to be read by a person.
//   * WHEN TO RE-READ IS THE PAGE'S TO SAY. The panel holds the session socket, so it is what learns that
//     this app changed: it posts ONE message into this frame, the line loombot splices into every app page
//     turns it into a `loom/app-changed` DOCUMENT EVENT, and this page reads again. No data, no id, no app
//     name and no protocol — the frame already knows what it is — and ONE NUMBER, `detail.rev`: the app's
//     state version. This page remembers the number of every answer it draws and skips a change whose
//     number it already holds, which is what turns a save's own change into ONE request instead of two
//     (card t20261024-061042-9b1e; `held`, below).
//   * SO A CHANGE IS A RE-READ, NOT A FRAME: the agent's `show`, a rename, another tab's reload. This page
//     therefore never parses a pushed frame, never checks an origin, and has no reconnect of its own — the
//     one it used to have is the ladder below, which now retries a READ.
//
// AND IT LEARNS OF A FAILURE WHEN IT ASKS, AND NOWHERE ELSE. Nothing can push a failure at a page with no
// socket: it finds out on the next request — a press, a re-read, or its own retry. A file that is on screen
// is therefore still what the app last said, which is still TRUE, and the page says so instead of emptying
// itself. That is the design's stated cost, and it is why the channel is a STATE with words on the page.
/** THE ONE ADDRESS THIS PAGE ASKS, relative to its own document: the app's own data path. */
const ENDPOINT = "__event";
/**
 * THIS PAGE'S NAME, once per load, on every request. It is NOT a correlation id — an answer comes back to
 * the request that asked it, and needs no id to find its way home (loombot mints `reply` for that and
 * strips it before a page sees the frame) — it is the name a page gives ITSELF, so a server that ever
 * wants to know which page is asking can. Since 2026-10-27 no server state is keyed on it (the per-page
 * dirty flag is gone), and it costs one field on a request.
 */
const PAGE_ID = "pg-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);

/**
 * ONE REQUEST, ONE ANSWER — the page's whole way of talking to its app.
 *
 * IT THROWS A SENTENCE AND NEVER A BARE NETWORK ERROR, because what it fails with is read by a person:
 * "Failed to fetch" is what a console says, and `#status` owes a reader the reason in words. A refused
 * request carries the server's own sentence (`{ok:false, reason}`); nothing is invented over it.
 *
 * AND THE ERROR KEEPS THE STATUS, because a 404 is a DIFFERENT FACT from a 503: loombot has no such app any
 * more, so that is the app being OVER rather than a channel that will come back. `unreachable` below is
 * where the two are told apart.
 */
async function ask(event, data = {}) {
  let res;
  // **THE SHARED LAYER, WHEN THERE IS ONE** (card t20261027-145404-6a9e): loombot splices
  // `loomApp.fetch` into every app page it serves, and that half adds ONE renewal and ONE retry when the
  // session cookie has run out — which is the fifteen-minute window in which every press in this page used
  // to die in silence. This page keeps its own `fetch` for a page opened outside loombot (a file:// copy, a
  // rig), where there is nothing to renew and nothing to ask.
  const post = typeof globalThis.loomApp?.fetch === "function" ? globalThis.loomApp.fetch : fetch;
  try {
    res = await post(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, data: { ...data, page: PAGE_ID } }),
    });
  } catch (e) {
    throw new Error((e && e.message) || "the viewer's server did not answer");
  }
  if (!res.ok) {
    let why = "";
    try {
      const said = await res.json();
      why = said && said.reason ? String(said.reason) : "";
    } catch { /* a refusal with no body is still a refusal */ }
    // **A 401 THAT SURVIVED THE RENEWAL IS SAID AS ITSELF** (card t20261027-145404-6a9e): it is not the
    // app refusing anything and not a server that will come back — this page is not signed in any more, and
    // no request it makes will land until it is paired again. Reloading is what pairs it.
    const err = new Error(
      why ||
        (res.status === 401
          ? "this page's session ran out and could not be renewed — the viewer is not reachable until the " +
            "page is paired again (reload it)"
          : "the viewer's server answered " + res.status),
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
    throw new Error("the answer was not a frame");
  }
}

/**
 * EVERY VERB THIS PAGE HAS goes through the same call, and `send` is its fire-and-forget half: a click, a
 * save, a close reports a fact and does not wait for the answer, because its caller is an event handler
 * and a handler that awaited would have to explain itself to nobody. It always answers true: whether the
 * request LANDED is not knowable synchronously any more, and a failure is said when it comes
 * (`unreachable`, below) rather than guessed at now.
 */
const send = (event, data = {}) => {
  void ask(event, data).then(answered, unreachable);
  return true;
};

// ── the channel: what the page says while it cannot reach its app ────────────────────────────────────
//
// THE DEFECT THIS SECTION EXISTS FOR (2026-10-21, a phone against a live loombot): the page drew its chrome
// and under it nothing — no file, no error, no "connecting". A request can fail; a page may not be SILENT
// about it. So the channel is a STATE, drawn in the one place a person is already reading, `#status`:
//
//   "connecting"  a read is in flight and has not been answered yet.
//   "open"        the app answered. The frame then speaks for itself — its own sentence about a link, a
//                 truncation, a save — and the channel says NOTHING: that silence is the healthy case, and
//                 it is what keeps a file on screen from ever sounding like a page that failed.
//   "closed"      a request failed, in words, and it is RETRIED on a ladder of this page's own. A 503 or
//                 a failed connection: nobody answered THIS time.
//   "over"        the APP is over, and it is TERMINAL. Two ways to learn it and one state: its Close is
//                 answered with `player_left`, and everything else (an agent's `stopWorker`, a crash, a
//                 session ending) arrives as `404 no such app`. Never retried, and the sentence names the
//                 one move that helps — and it keeps an unsaved buffer where it is.
//
// THE RETRY IS THIS PAGE'S OWN, and what it retries is the READ, which is the only move a page without a
// socket has: the delay doubles up to LAST_RETRY_MS (a page that hammered loombot would be somebody else's
// outage), it starts over when the network comes back (`online`) or the person comes back to the tab
// (`visibilitychange`), and a BACKGROUND tab asks nothing at all — iOS suspends one mid-request, and the
// wake event is what brings it back.
const FIRST_RETRY_MS = 1000;
const LAST_RETRY_MS = 15000;
let channel = "connecting";
/** The delay the NEXT retry will wait: doubled on every failure, and put back to FIRST by an answer. */
let retryMs = FIRST_RETRY_MS;
/** The delay the PENDING retry is waiting, or 0 for none — what the sentence counts down, and what a test reads. */
let retryInMs = 0;
let retryTimer = 0;
/** Whether the app ever answered, which is how "connecting" and "reading again" are told apart. */
let everOpened = false;
/** Why the last attempt failed, in the app's or the network's own words, or "" — the reason in `#status`. */
let closedReason = "";

/** Whether the channel is in a state a person has to ACT on, as opposed to a moment in the life of one. */
function fault() {
  return channel === "closed" || channel === "over";
}

/** A BACKGROUND TAB ASKS NOTHING: iOS suspends one mid-request, and a wake event is what brings it back. */
function backgrounded() {
  return document.hidden === true || document.visibilityState === "hidden";
}

/**
 * WHAT THE PAGE SAYS ABOUT ITS CHANNEL, in a person's words — `""` the whole time the app answers and the
 * frame speaks. The promise a failed save is owed is kept from the old close handler, because it is still
 * TRUE: saving is not possible while the channel is down, and what is on screen is the last thing read.
 */
function channelText() {
  if (channel === "closed") {
    const why = closedReason === "" ? "" : " (" + closedReason + ")";
    const when = retryInMs > 0
      ? "retrying in " + Math.round(retryInMs / 1000) + "s"
      : "it retries the moment this tab is looked at again";
    return "the viewer's server is not answering" + why + " — " + when +
      ". Saving is not possible until it is back, and the file on screen is the last one read.";
  }
  if (channel === "connecting") {
    // A KEPT READ IS WHAT THE SCREEN HOLDS while this ask is in flight — the one line this page has
    // says so, because a page drawing an old file in silence would be claiming a freshness it has not
    // got. This is the board's #note sentence, said here: this page's channel line is its only note.
    if (keptOnScreen) {
      return "reading the file again — what is on screen is the last read this page kept";
    }
    return everOpened ? "reading the file again…" : "connecting to the viewer's server…";
  }
  return "";
}

/** The channel's one line, in `#status`. Silent in the two states where the frame is the whole answer. */
function renderChannel() {
  if (channel === "open" || channel === "over") return;
  say(channelText(), fault() ? "bad" : "");
}

/**
 * A FRAME FROM THE APP: the channel is open (whatever it said), the ladder is back, and it is drawn.
 *
 * **AN ANSWER IS THE CONNECTION, BACK** (card t20261026-024522-fd4a): `over` is per CONNECTION, not per
 * for ever. The frame in hand is the app answering — the one fact a page without a socket can hold — so
 * whatever `over` the restart window said is spent HERE, before `handle` draws. The state still exists
 * and two things still bring it on (a `player_left` frame, a 404 to any request): what no longer exists
 * is its FOREVER. A `player_left` that arrives as an answer un-overs here and is ended again by its own
 * draw, which is the same page, one request later.
 */
function answered(frame) {
  // THE STATE VERSION THIS ANSWER CARRIES, first of all — the draw this answer drives captures it, and
  // `keepRead` labels the read it stores with the rev of the answer that produced it, so two tabs of
  // one app cannot make the kept read go backwards. Null when the app keeps none.
  lastRev = frame && typeof frame.rev === "number" ? frame.rev : null;
  // THE STATE CLEARS BEFORE `handle` DRAWS, and the frame itself is the re-read — no second request.
  everOpened = true;
  channel = "open";
  retryMs = FIRST_RETRY_MS;
  // CLEAR FIRST, THEN FORGET: an id zeroed before `clearTimeout` is a timer nobody can cancel, and it
  // fires into a page that has already read its file. (Counted on the board's page first, by the test
  // that reads pending timers; the same line is here for the same reason.)
  clearTimeout(retryTimer);
  retryTimer = 0;
  retryInMs = 0;
  closedReason = "";
  body.classList.remove("dead");
  handle(frame && frame.action, (frame && frame.data) || {});
  // **THE ANSWER'S NUMBER IS WHAT THIS PAGE HAS HANDLED** — the one fact the echo of its own save is
  // compared against (`loom/app-changed` above). Absent when the app keeps none, and then `held` stays
  // null and nothing is ever skipped on a number.
  if (frame && typeof frame.rev === "number") held = frame.rev;
  // AND A CHANGE THAT LANDED WHILE THIS READ WAS IN FLIGHT IS READ ONCE MORE: the answer may predate it,
  // and one extra request is cheaper than a stale file (`loom/app-changed` above).
  if (again) read();
}

/** WHAT A REQUEST SAYS WHEN THE APP IS GONE — the words in the terminal sentence, and the one thing a page
 * can say without knowing what loombot put in a body it sends as plain text. */
const GONE = "its server is gone";

/**
 * NOT AN ANSWER: said where a person is looking, and retried — unless the app is GONE, where a retry argues
 * with a fact.
 */
function unreachable(e) {
  // THE SAVE THAT WAS IN FLIGHT WENT WITH THE REQUEST: a write nobody will confirm is not in flight any
  // more, and leaving it set would refuse every later Save with "a save is already on its way". **THE
  // BUFFER IS NOT THE REQUEST**: the text stays in the editor and stays `dirty`, which is what `ended`
  // below promises a person, and what a 404 arriving mid-edit must not take away.
  inflight = null;
  if (channel === "over") return;
  // **A 404 IS THE APP BEING OVER, AND NOTHING ELSE IS.** `startWorker`/`stopWorker`, a crash and the
  // session ending all leave loombot with no registration, and it answers the next request `404 no such app`
  // (`loombot/routes.ts`). No socket is there to be pushed a farewell down, so this failing request is the
  // ONLY witness a page has — and it is TERMINAL: nothing is listening, nothing will be until the app is
  // started again, and a retry would be a page arguing with a fact. A 503 or a failed connection is the
  // other half of the same test: nobody answered THIS time, so the page keeps asking (`dropped`).
  if (e && e.status === 404) return ended(GONE);
  dropped((e && e.message) || String(e) || "the viewer's server did not answer");
}

/**
 * THE APP IS OVER, drawn in ONE place because there are two ways to learn it and they must not drift: the
 * `player_left` frame, which is the answer to this page's own Close, and a 404 to anything else.
 *
 * **AND A BUFFER IS STILL THE PERSON'S.** The edits cannot be saved — the app that would write them is gone
 * — but throwing a half-written file away because a REQUEST failed is a different act, and the one thing
 * this page must not do. So the text stays exactly where it is, the sentence says it was NOT saved, and the
 * only move offered is the one that can actually land: start the app again and reload.
 */
function ended(why) {
  if (channel === "over") return;
  backSettled();
  channel = "over";
  body.classList.add("dead");
  say(
    "the viewer's server stopped: " + (why || "no reason given") +
      (dirty
        ? " — your unsaved edits are still on screen and were NOT saved: copy them before you reload"
        : " — reload this page once it is running again"),
    "bad",
  );
}

function dropped(why) {
  // THE CHANNEL HAS A TRUE LINE OF ITS OWN (below), so a Back waiting for an answer is settled by it
  // rather than by a second sentence about the same failure.
  backSettled();
  body.classList.add("dead");
  closedReason = why;
  channel = "closed";
  retryLater();
  say(channelText(), "bad");
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
 * ASK WHAT IS ON SHOW — the ONE place a read is started, so the state, the handlers and the retry cannot
 * be attached in one place and forgotten in another. `ready` is the event: the app answers it with the
 * frame this page draws, and it is every retry's first word too, which is what makes a page that lost its
 * app come back with the file it never threw away.
 */
function fresh() {
  clearTimeout(retryTimer);
  retryTimer = 0;
  retryInMs = 0;
  closedReason = "";
  channel = "connecting";
  renderChannel();
  read();
}

/**
 * A NEW REASON TO TRY — the network back, or the person back at the tab — so the ladder starts over AND
 * the read happens now rather than when the old delay was due. A read already in flight is left alone:
 * two reads at once would be two answers racing to draw the same page.
 */
function wake() {
  if (channel !== "closed") return;
  retryMs = FIRST_RETRY_MS;
  fresh();
}

/**
 * THE PAGE SAYS WHEN TO RE-READ, and the ONE thing that stops it is a buffer of the human's that is not
 * saved. **A PAGE THAT RE-READ WHILE IT WAS EDITING WOULD DRAW OVER THE TEXT** — the frame carries the
 * file as the app has it, and applying that to a page in the middle of an edit is how an edit is eaten.
 * **AND A PAGE THAT SKIPPED THE READ IN SILENCE WOULD BE STALE AND SAY NOTHING** — the file on screen
 * would no longer be the one on show, which is the one value this app broadcasts.
 *
 * So the read WAITS, and the waiting is SAID in `#status`: `waiting` says it is still owed, and the buffer
 * being resolved (a Save landing with nothing typed since, or a Cancel that discards) is what reads again
 * and draws — `openWaiting`, which is the whole of this page's half of the page contract's rule 6.
 */
/**
 * **THE PARTS THIS PAGE DRAWS, AND THE ONE RULE THAT MAKES NAMES SAFE** (card t20261024-061052-2740;
 * `building-a-loom-app/README.md`, THE PAGE CONTRACT, rule 7).
 *
 * A push names the parts of the app's state that changed — `["file"]`, `["listing", "shown"]` — and a page
 * reads the ones it is DRAWING among them. `DRAWN` is that set, `KNOWN` is every part this page has ever
 * heard of, and the difference between them is the whole of the safety:
 *
 *   * A NAME THIS PAGE DOES NOT KNOW is a change. It may be a part of an app newer than this page, and the
 *     page cannot tell that from a part it simply does not draw — so it reads. That costs a request.
 *   * A PUSH THAT NAMES NOTHING (no `parts` at all) is the same: the app, or a loombot older than this,
 *     did not say which part changed, so everything this page draws is read. That is exactly what every
 *     page did before names existed.
 *   * A NAME IT KNOWS AND IS NOT DRAWING is the one case that costs nothing — and it is the case the
 *     mechanism exists for. It can never be the other way round: a name can only make a read
 *     UNNECESSARY. Getting a name wrong, or forgetting one, therefore costs a request and never an update,
 *     which is what makes this a fact to compare rather than an instruction to obey.
 *
 * The viewer DRAWS ALL FOUR (`listing`, `file`, `cursor`, `shown`): a file or a folder is on screen, and
 * the listing and the cursor are behind and around it. So for this app the saving is in the parts it does
 * NOT draw, which today is none — and the rule is still written out, because the next app is copied from
 * this one.
 */
const DRAWN = ["listing", "file", "cursor", "shown"];
/** Every part this page has heard of. A name outside it is treated as changed (`mustRead`). */
const KNOWN = DRAWN;

/**
 * HOW MANY READS ARE IN FLIGHT — 0 or 1, and `1` is what keeps a burst from being a read per frame. It is
 * counted rather than read off `channel`, because a change's re-read must NOT set `channel` to
 * "connecting": that is a sentence on the page ("reading the file again…"), and a push is not this page's
 * news.
 */
let reading = 0;
/**
 * Whether a change this page DID have to act on arrived while a read was in flight. Without numbers there
 * is no way to know whether the answer already includes it, so it is read once more — one extra request in
 * the rare overlap, never a stale file.
 */
let again = false;

/** The parts a `loom/app-changed` carried, or null when the panel or the app named none. */
function partsOf(e) {
  const parts = e && e.detail ? e.detail.parts : undefined;
  return Array.isArray(parts) ? parts : null;
}

/**
 * THE APP'S STATE VERSION THIS PAGE HAS HANDLED, from the `rev` its last ANSWER carried — or null when the
 * app keeps none. It is the ONLY thing that makes the echo of this page's own save free: the answer to the
 * `save` POST carries the number, so the push the same change causes is not newer and costs no request.
 *
 * IT IS NOT A LICENCE. One number cannot certify WHICH PARTS this page holds, so it decides nothing about
 * them: a part it is drawing is read whenever the number is newer, and a name it does not know is read even
 * when it is not. The number collapses duplicates and echoes, and that is all.
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
  return parts.some((part) => KNOWN.indexOf(part) < 0 || DRAWN.indexOf(part) >= 0);
}

/**
 * ASK WHAT IS ON SHOW — the ONE place a read is started, and the ONE place `again` is cleared: it belongs
 * to the read that is starting, and the answer is what decides whether one more is owed.
 */
function read() {
  again = false;
  reading++;
  void ask("ready").then(answered, unreachable).finally(() => {
    reading--;
  });
}

document.addEventListener("loom/app-changed", (e) => {
  if (channel === "over") {
    // THE CHANNEL RE-COVERS ITSELF (card t20261025-061114-f6b7: the dial ladder hands over to a
    // re-registration ladder, and an app outlives any loombot life), so the `over` this page said in the
    // restart window is often already stale when the next announcement lands. ONE read, here: the page
    // looks again instead of staying deaf to an app that returned (card t20261026-024522-fd4a — the
    // change-blind page was the whole of the dead clicks). The buffer still gates the read as everywhere
    // else (rule 6), and a read already in flight is answered once more (`again`) rather than doubled.
    if (dirty) {
      waiting = true;
      say(
        "a change is waiting from the viewer — your unsaved edits here are kept; it opens when you are done with them",
        "warn",
      );
      return;
    }
    if (reading > 0) {
      again = true;
      return;
    }
    retryMs = FIRST_RETRY_MS;
    fresh();
    return;
  }
  // THE SAVE THIS PAGE JUST MADE: the answer to its own POST carried this number, so the push that
  // follows the same change is the echo of a state already drawn. This is the one line the number buys.
  //
  // **AND A NUMBER THAT WENT BACKWARDS IS NOT AN ECHO — IT IS A NEW LIFE** (card t20261027-145404-6a9e).
  // Within one instance `rev` only ever goes UP (`viewer_mcp.ts` `moved`), so `rev < held` cannot be
  // anything this page has drawn: it is a FRESH INSTANCE, counting from zero because nothing survives an
  // app's server (ruling 2). Only `rev === held` is the echo. The `<=` this replaces made the page deaf to
  // the whole second life — measured in test/browser-test/viewer_rejoins_after_restart.ts: a restart the
  // page never saw (a sleeping phone, so no strip ever showed the app gone) sent the new instance's `show`
  // as rev 1 against a held 2, the push was dropped, and the frame went on drawing a dead instance's file
  // until the page was reloaded by hand.
  const rev = revOf(e);
  if (rev !== null && held !== null && rev === held) return;
  if (!mustRead(partsOf(e))) return;
  if (dirty) {
    waiting = true;
    say(
      "a change is waiting from the viewer — your unsaved edits here are kept; it opens when you are done with them",
      "warn",
    );
    return;
  }
  // A READ IS ALREADY IN FLIGHT, and two reads at once would be two answers racing to draw the same page.
  // Whether that answer already includes this change cannot be known without numbers, so the page reads
  // once more when it lands — one extra request in an overlap, and never a file left stale behind it.
  if (reading > 0) {
    again = true;
    return;
  }
  read();
});

document.addEventListener("visibilitychange", () => {
  if (backgrounded()) return;
  // **A PAGE THAT IS LOOKED AT AGAIN READS ONCE** (card t20261027-145404-6a9e). A phone that slept is the
  // case: while this page was away its app could be replaced, and NOTHING here says so — the strip is not
  // this document's, and a new life's numbers can land on a number this page has already handled (which
  // the comparison above drops as its own echo). One read answers it, and one read is what it costs. The
  // buffer still gates it (rule 6), as everywhere.
  if (channel === "over") return fresh();
  if (channel === "closed") return wake();
  if (dirty || reading > 0) return;
  read();
});
globalThis.addEventListener("online", wake);

/**
 * A SENTENCE THAT HAS TO OUTLIVE THE DRAW THAT FOLLOWS IT (card t20261109-233720-26f0). A refused
 * `open_path` is answered with the reason AND a refresh read, and that read's draw is the one writer of
 * #status — which says "" for every frame that is not a link. So the reason is handed over here and the
 * draw says it once, then it is spent. A reason on screen for one frame is the same silence the rule
 * against it was written for: the person is left with a screen that did not move.
 */
let sayAfterDraw = "";

/**
 * WHAT THE APP SAID, by its action — one switch, and it is the whole of this page's reading half. The frame
 * is exactly what a socket used to deliver, so the drawing below never learns which carrier brought it.
 *
 * THERE IS NO "IS THIS OURS" TEST ANY MORE, and that absence is the correlation: an answer comes back to
 * the REQUEST that asked it (`channel.ts` tags every frame written while a frame is being handled, and
 * loombot strips the id before a page sees it), so a frame in this function is this page's by construction.
 * Where the old test mattered — a second tab's `saved`, a `goto_anchor` meant for another page — those
 * frames are not delivered here at all now: they answer THAT page's request.
 */
function handle(action, data) {
  const d = data || {};
  if (action === "show") {
    // NEVER OVER UNSAVED WORK — AND NEVER REFUSED FOR IT EITHER. Which file is on show is this app's one
    // thing and every page is told about it; what such a frame may not do is replace text this page has not
    // saved. That is the whole of the old refusal's job, done on the side that holds the text (README.md,
    // the page contract, rule 6): the server no longer turns the agent away, and no page turns another page
    // away.
    if (dirty && cur) {
      // A CHANGE THAT ARRIVED WHILE THIS PAGE WAS EDITING. It is not drawn now (that would eat the edit)
      // and it is not dropped either: the page SAYS it is waiting, and reads again when the buffer is
      // resolved. `draw` clears `waiting`, because a draw IS the change — or something newer than it.
      waiting = true;
      say(
        "a change from the viewer is waiting — your unsaved edits here are kept; it opens when you are done with them",
        "warn",
      );
      return;
    }
    return void draw(d).catch((e) => deadDraw("could not draw", e));
  }
  if (action === "goto") {
    if (ed && cur && d.path === cur.path && d.line) ed.goto(d.line);
    return;
  }
  if (action === "goto_anchor") {
    // A `#fragment` IN THE FILE ON SHOW (t20261009-201706-c56d). The SERVER checked the id — the headings of
    // the rendering carry the ids render.ts minted, and it is the one place that knows them — and this is
    // the scroll. Where in the file somebody is looking is THAT page's own business: the answer goes back
    // to the page that asked, so a second tab showing this file keeps its place instead of jumping under
    // its reader.
    if (!cur || d.path !== cur.path) return;
    return jumpTo(d.anchor);
  }
  // (the `children` frame is gone with the tree screen — card t20261026-023551-35ae: a folder is shown,
  // not expanded, and the click that opens one is `open_path` like every other)
  if (action === "saved") return saved(d);
  if (action === "save_refused") {
    const leave = inflight ? inflight.leave : false;
    inflight = null;
    say("not saved", "bad");
    if (d.conflict) {
      // THE CONFLICT IS OFFERED, NEVER DECIDED: reload loses the edits here, overwrite loses the change on
      // disk, and which to lose is the human's call.
      askBar(d.reason, [
        ["Reload from disk", "discard my edits here", () => reloadFromDisk()],
        ["Overwrite", "replace the file with my text", () => save(true, leave)],
        ["Keep editing", "decide later", hideBar],
      ]);
    } else {
      askBar(d.reason, [["OK", "dismiss", hideBar]]);
    }
    return;
  }
  if (action === "ack") {
    // THE APP TOOK IT AND HAS NOTHING TO SAY — a save's `dirty` report is the one such event left, and it
    // produces no frame at all: `channel.ts` answers that silence itself so no request is left hanging.
    // Nothing to draw, and nothing wrong — it is the quiet success of every one of them.
    return;
  }
  // A CLEAN page's Close used to be refused back here (`close_refused`) because ANOTHER page held unsaved
  // edits, and the question was asked on this page. BOTH ARE GONE (2026-10-20): the server does not refuse
  // the close, and a page's state never gates another page's action (README.md, the page contract, rule 6).
  if (action === "error") {
    // THE SERVER'S REFUSAL, said where the person is looking. An open_path refusal (`from` on the frame,
    // viewer_mcp.ts) is staleness evidence — this page named a path the server no longer remembers — so
    // it is a refresh trigger, not silence: ONE read (card t20261026-024522-fd4a). A link's refusal is
    // not staleness, and says only.
    backSettled();
    const why = d.reason || "error";
    say(why, "bad");
    // A BACK THAT WAS REFUSED DID NOT LAND: the path it asked for is still what the next draw of that path
    // would pop, so the flag goes with the refusal (`goBack`, `draw`).
    returningTo = "";
    if (d.from === "open_path") {
      // **THE REASON HAS TO SURVIVE THE REFRESH THIS TRIGGERS** (card t20261109-233720-26f0): the read
      // below lands in `draw` and a draw has one line for #status, so the person was left with a screen
      // that did not move and no word about the press that did not either.
      sayAfterDraw = why;
      return read();
    }
    return;
  }
  // `app_replaced` (loombot swapped this app's bytes) IS DELIBERATELY NOT ANSWERED HERE. What it carried was
  // loombot's own count of registrations; the show frame describing the swap follows as a re-read.
  if (action === "detached") {
    // THE PAGE'S CLOSE, DECLINED BY THE APP (the durable viewer, card t20261025-061114-f6b7): the server
    // answers the request with this frame and ends nothing. THE PAGE STILL CLOSES LOCALLY (card
    // t20261027-025619-fb7e): the frame is deregistered and the panel folds through the page contract's
    // one verb (`loomApp.close`, spliced in by loombot), so the button works whatever the app decides.
    // The sentence says what this page CANNOT do, never what it can.
    closeLocally();
    say("this page is detached — it cannot edit or save; Close folded the panel here", "");
    return;
  }
  if (action === "player_left") {
    // THE APP IS OVER, and this frame rides on a request that was being answered when the app ended
    // (`unmount`) — it is NOT the answer to this page's Close any more: the durable viewer answers
    // that with `detached` (above) and ends for nobody's button. A viewer the agent stopped, one that
    // crashed, or a session that ended pushes this farewell at nobody, and the page learns it from a
    // `404 no such app` on its next request — `unreachable` above.
    ended(d.reason);
  }
}

// ── drawing a file ──────────────────────────────────────────────────────────────────────────────────

// ── the listing ──────────────────────────────────────────────────────────────────────────────────────
//
// THE FOLDER VIEW (card t20261026-023551-35ae): the folder is a showable object, and its listing is one of
// the TWO things this page draws — a file, or a folder's entries. The rows carry the path the SERVER drew
// (`data-path`, the server's own realpath) and the click sends it back (`open_path`); the ".." row is a
// row like any other, and the FILE view's crumb is the other way out (card t20261027-025619-fb7e). This
// page never reads a directory and never works out a path: what exists, what a click may open, and how
// much of a huge directory is listed are all decided on the server (files.ts `listDir`, `renderedNode`).
// An empty view is not a thing this page can draw.

// ── the one clearing place every draw path begins at ────────────────────────────────────────────────
//
// **A DRAW ERASES EVERY KIND'S CHROME FIRST, THEN PAINTS ITS OWN** (card t20261027-025619-fb7e): the phone
// that proved it stacked a file's chrome under a folder's listing. The four branches below then write only
// their own, so NO ELEMENT HAS TWO WRITERS (card t20261028-022447-aa96). NOT HERE, because none of it is a
// kind's chrome: `#title`/`#path` (`header`), `#status` (the channel's), the body's classes (`skin`), and
// `#view`'s display (`setMode`).
/** The generation of the paint in flight — a draw that awaits must not finish after a newer one. */
let paintGen = 0;

function resetPaint() {
  el("noedit").textContent = "";
  // NO CRUMB: no segments, and the row it sits in takes no pixel.
  el("crumb").textContent = "";
  el("crumb").classList.remove("on");
  el("list").classList.remove("on");
  el("list").textContent = "";
  // about:blank rather than removing the attribute: dropping an <iframe>'s src does not navigate it, so
  // the old PDF would stay loaded behind a display:none element.
  pdf.setAttribute("src", "about:blank");
  pdf.classList.remove("on");
  img.classList.remove("on");
  notice.textContent = "";
  notice.classList.remove("on");
  hideBar();
}

/**
 * THE CRUMB, IN BOTH VIEWS, BY ONE RULE (cards t20261027-025619-fb7e and t20261028-002834-882a): the
 * frame's `crumbs` — the chain the SERVER built, root first, folder names — is drawn; every segment that
 * names somewhere else is a button; and THE SEGMENT WHOSE PATH IS THE THING ON SHOW IS INERT, because a
 * control that navigates to where you already are is a dead control.
 *
 * That is one rule and not two because it is decided by COMPARISON rather than by "the last one": a
 * listing's own folder is the last segment and it is what is on show, so it is inert; a file's chain ends
 * at the folder it sits in, which is NOT where the person is (the file is, and the file's name is the
 * title above, never a segment — the doubled title Xiaohu photographed), so every segment there opens its
 * folder. The page splits no path and names no segment of its own; a click sends the path it was DRAWN
 * with.
 */
function drawCrumb(crumbs, here) {
  const box = el("crumb");
  box.textContent = "";
  if (!Array.isArray(crumbs) || crumbs.length === 0) {
    box.classList.remove("on");
    return;
  }
  crumbs.forEach((c, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "/";
      box.appendChild(sep);
    }
    const name = String(c.name || "");
    const path = String(c.path || "");
    if (path && path === here) {
      // WHERE YOU ARE: drawn like the rest of the chain and NOT a control — a <span> with the same colour
      // and no pointer, so the chain still reads as one line and nothing invites a click that does nothing.
      const now = document.createElement("span");
      now.className = "here";
      now.setAttribute("aria-current", "page");
      now.textContent = name;
      now.title = path;
      box.appendChild(now);
      return;
    }
    const seg = document.createElement("button");
    seg.type = "button";
    seg.textContent = name;
    seg.setAttribute("data-path", path);
    seg.title = path ? "open " + path : name;
    box.appendChild(seg);
  });
  box.classList.add("on");
}

/** THE DATE A ROW SHOWS, short: month and day, with the year only when it is not this one. */
function whenOf(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const opts = { month: "short", day: "numeric" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString(undefined, opts);
}

/** ONE ROW. A folder is a row that opens its own listing (the trailing "/" says which); a file SHOWS. There
    is no ".." row: THE CRUMB IS THE WAY UP (card t20261108-084109 — Xiaohu, 有crumb就没必要了吧), and a second
    control for a move the chain above already offers is the duplication he pointed at. The name is what the
    person reads; the size and the date are the dim half of the row.
    The class is `row` and not bare `li` on purpose: a rendered markdown file has list items of its own,
    and the click that walks up from one must find no listing row behind it. */
function listRow(n) {
  const li = document.createElement("li");
  li.classList.add("row");
  li.setAttribute("data-path", n.path);
  li.setAttribute("data-name", n.name);
  if (n.dir) li.setAttribute("data-dir", "1");
  const name = document.createElement("span");
  name.textContent = n.dir ? n.name + "/" : n.name;
  li.appendChild(name);
  const at = document.createElement("span");
  at.className = "at";
  at.textContent = [n.dir ? "" : kib(n.bytes), whenOf(n.mtime)].filter(Boolean).join(" · ");
  li.appendChild(at);
  return li;
}

// ── THE FOUR WAYS A FRAME IS DRAWN: ONE WRITER PER THING ON THE PAGE (card t20261028-022447-aa96) ───
//
// `draw` writes the FRAME's chrome — the crumb, the header, the menu — and hands the frame to the ONE
// branch that owns the rest of the screen:
//
//     kind                branch          what it owns
//     listing             drawListing     #list
//     code / markdown     drawText        #view, the editor
//     pdf / image         drawUrl         #pdf or #img, #hint
//     download            drawDownload    #notice
//
// THE TABLE KEYS ON `kind` ALONE. `downloadable` and `download` are DATA on a frame — every file frame
// carries `downloadable: true`, so it separates no two kinds, and `download` is what `paintMenu` enables a
// row from — never a dispatch. The branches own DISJOINT elements, so no element has two writers and a fix
// at one site cannot be quietly undone by a later one, which is what the `#path` with two writers did.
const BRANCH = {
  listing: drawListing,
  code: drawText,
  markdown: drawText,
  pdf: drawUrl,
  image: drawUrl,
  download: drawDownload,
};

/**
 * THE LISTING VIEW: the rows, and the server's own sentences — a refused walk's (`note`), a capped one's
 * (`moreNote`) — where the rest of the entries would be. Rebuilt whole, like the file view is: what is on
 * screen is what the frame carried, nothing older.
 *
 * **THE LISTING SAYS ITS PATH ONCE, AND IT IS THE CRUMB** (card t20261108-084109). There used to be a head
 * line under the divider printing `d.display` — "loom/cli" beneath a crumb already reading "loom / loom /
 * cli" — and Xiaohu photographed exactly that (页面元素重复). The TITLE above says which folder this is and the
 * crumb says where it sits, so the line restated both; what is left is what a person can act on.
 */
function drawListing(d) {
  const box = el("list");
  box.textContent = "";
  box.classList.add("on");
  const ul = document.createElement("ul");
  ul.setAttribute("id", "listrows");
  for (const n of d.entries || []) ul.appendChild(listRow(n));
  box.appendChild(ul);
  const said = [d.note, d.moreNote].filter(Boolean);
  if (said.length) {
    const p = document.createElement("p");
    p.className = "note";
    p.textContent = said.join(" ");
    box.appendChild(p);
  }
}

/** THE TEXT KINDS, `code` and `markdown`: one branch, because the frame is one shape. What separates them is
    WHICH BOX SHOWS THE TEXT — and that is what decides where the editor may be created (`editor`). */
async function drawText(d, gen) {
  // **THE BODY IS PAINTED BEFORE THE MODULE IS LOADED** (Xiaohu, 2026-10-28: refreshing with the app open
  // showed the boot sentence for under a second, then the file - the header and crumb were already drawn,
  // and the body was waiting on the CodeMirror import). A markdown's HTML comes from the SERVER and needs
  // no module, so it goes up first; the import then only colours the fences. A code file has no early
  // paint: its body IS the editor.
  if (d.kind === "markdown") {
    view.className = "md";
    view.innerHTML = d.html;
  }
  const c = await ensureCode();
  // A NEWER FRAME TOOK THE SCREEN WHILE THE IMPORT RAN: this paint is history and does not get to finish.
  if (gen !== paintGen) return;
  if (d.kind === "markdown") {
    c.highlightFences(view);
  } else {
    const e = await editor();
    if (gen !== paintGen) return;
    e.load(d.path, d.text);
    if (d.line) e.goto(d.line);
  }
  savedText = d.text;
  if (d.editable) offerDraft(d);
}

async function draw(d, kept = false) {
  // EVERY DRAW PATH BEGINS AT THE ONE CLEARING PLACE, under a generation of its own: a newer frame can
  // arrive while this paint has an await in it (the CodeMirror import), and a paint that resumed after a
  // newer draw would put its own kind's chrome on top of the other kind's screen.
  const gen = ++paintGen;
  resetPaint();
  // A DRAW IS A LANDING, so a Back waiting for the view to move is over — whatever moved, and even if what
  // landed is a file the person opened some other way (card t20261109-233720-26f0).
  backSettled();
  // WHAT WAS WAITING IS NOT WAITING ANY MORE: this draw is it, or something newer.
  waiting = false;
  // WHAT PUT THIS FRAME THERE: the app speaking, or the kept read. `drewRev` is captured before the first
  // await, so the tail's keep cannot label this frame with a rev an answer that landed mid-draw carried.
  keptOnScreen = kept;
  const drewRev = lastRev;
  // **THE PATH STACK, AND IT IS PATHS ONLY** (cards t20261028-002834-882a and t20261105-225359-8b14): a
  // frame always comes from the server, so a Back is `open_path` with a path this page was at. A move records
  // where it came from AND the entry in the browser's history; the same path again (a save, a refresh) is not
  // a move; `kept` is memory repainting, not a navigation; and a frame the Back asked for records nothing,
  // because the browser has already walked there and a second entry would be a forward button nobody asked for.
  const was = cur ? String(cur.path || "") : "", here = String(d.path || "");
  // **WHETHER `was` CAME OUT OF THE KEPT READ, READ BEFORE THIS DRAW CLEARS THE FLAG** (measured
  // 2026-11-11, and it is the trap this fix itself fell into): the app's first frame is a NON-kept draw, and
  // clearing `memoryOnScreen` at the top of it made `was` look like a view the app had put there — so it was
  // pushed onto `past` and the fresh document's row came back ENABLED, which is the defect unchanged.
  const wasMemory = memoryOnScreen;
  // AND THE BROWSER'S HISTORY IS TOLD THE SAME THING (card t20261105-225359-8b14, `goBack` above): a view
  // this document MOVED to is a history entry, the first view of the document REPLACES the one it arrived
  // on, and the view a Back is still landing on is not a move — the browser has already been there.
  if (here && here !== viewMarked) {
    if (kept) {
      // **MEMORY IS NOT A VIEW THIS DOCUMENT WENT TO** (see `memoryOnScreen`): `paintLastRead` drew the kept
      // read before the app answered, and NOTHING of it is recorded — no entry is named for it, nothing
      // goes behind a Back, and the app's own first frame is what names the landing (the branches below).
      // Recording it was the fresh-open defect twice over: the landing got stamped with memory's path, so
      // the app's frame looked like a MOVE and pushed that path onto `past` — which enabled the row and
      // made the press ask the server for a path that app life had never drawn.
    } else if (was === here) {
      // NOT A MOVE, BUT STILL THE LANDING (card t20261108-081151-a766): the same view arriving again —
      // memory's after the app confirmed it, a save, or a refresh. The entry this document ARRIVED on must
      // still be named with what is on screen — otherwise the first real move counts as the document's
      // FIRST view and REPLACES it, the browser is left with no entry of its own behind that move, and the
      // Back after it moves nothing at all while this page says it is going.
      if (!landingMarked) {
        recordView(here, true);
        landingMarked = true;
        viewMarked = here;
      }
    } else if (here === returningTo) {
      returningTo = "";
      landingMarked = true;
      viewMarked = here;
    } else {
      // **A VIEW MEMORY PAINTED HAS NO ENTRY BEHIND IT** (see `memoryOnScreen`): `was` is what `cur` was,
      // and when `cur` came out of the kept read there is no history entry for it to walk back to — so
      // pushing it made `past` name a view the browser never had, which is `fallBack` asking the server
      // for a path this life never drew. The app's first frame is this document's LANDING, not a move.
      if (was && !wasMemory) past.push(was);
      recordView(here, !landingMarked);
      landingMarked = true;
      viewMarked = here;
    }
  }
  // THE APP HAS ANSWERED, so what is on screen is no longer memory: from this draw on, a view behind the
  // person is a view the app put there and it is a history entry of its own (see `memoryOnScreen`).
  if (!kept) memoryOnScreen = false;
  if (!d || d.kind === "empty") {
    // NOTHING IS ON SHOW: the reset took every kind's chrome, `setMode` takes `#view` and `skin` the body's
    // classes, and the kept read goes with it — the app said there is nothing, and memory does not outlive
    // that. It SAYS nothing, so a refusal's sentence in `#status` survives the draw of nothing.
    cur = null;
    setMode("view");
    dropRead();
    return;
  }
  cur = d;
  // THE FRAME'S OWN CHROME, HERE AND NOWHERE ELSE. With a chain below, the header says the FILE and the
  // crumb says where it is (Xiaohu, 2026-10-27). A CLICK ON A LINK is the one thing said: an agent `show`
  // says NOTHING (the file is the whole message; Xiaohu 2026-10-15, "为什么有个 shown by the agent？删掉"),
  // and neither does a file opened from a row.
  drawCrumb(d.crumbs, d.path);
  // ONE WRITER FOR #status, AND A SENTENCE THAT HAS TO OUTLIVE THIS DRAW SAYS ITSELF (see `sayAfterDraw`):
  // a refused `open_path` triggers the refresh that lands here, and this line would otherwise wipe the
  // refusal's reason one frame after the person read it.
  const after = sayAfterDraw;
  sayAfterDraw = "";
  say(after || (d.by === "link" ? "opened from a link" : ""), after ? "bad" : "");
  el("noedit").textContent = d.noEdit || "";
  // **A RE-READ OF THE FILE ALREADY BEING EDITED DOES NOT CLOSE THE EDITOR** (measured 2026-11-15 in
  // test/browser-test/viewer_edit_survives_a_switch.ts). Xiaohu: "我打开file viewer。点击edit，切换其他程序。
  // 重新回到浏览器，发现edit状态没了，退回到了read状态。" NOTHING had been discarded and NOTHING had
  // reloaded - the rig's frame document is the SAME one before and after (`performance.timeOrigin` and the
  // rig's own per-serve stamp both unmoved, `serves` 1 -> 1, no `src` assigned, no frame made), and the
  // panel never re-pointed or re-created it either. What reset it was THIS LINE: the page's own
  // `visibilitychange` handler re-reads once (a page looked at again reads, below), the answer was the
  // file the page already had on show, and a draw always returned to view - so the rendering went back
  // over an editor nobody had closed, at 1280x800 and at 390x844.
  //
  // THE CONDITION IS THE READER'S STATE, NOT A CASE FOR THAT HANDLER. A draw that lands on the file that
  // is ALREADY on show, while the person is in edit mode with nothing typed, and on a file the app still
  // says is editable, keeps the editor; every other draw still returns to view, which is right, because a
  // draw that moves the reader to another file must not leave an editor open over it. `dirty` needs no
  // part in it: it is the gate every re-read already passes through (`show`'s waiting note, the
  // visibility handler, `openWaiting`), so a buffer with text in it never reaches this line with a read
  // behind it, and the rig measures that too (`another-tab-typed`: mode and the byte both kept).
  const stillEditing = !kept && mode === "edit" && !dirty && was !== "" && was === here &&
    d.editable === true;
  savedText = null;
  dirty = false;
  setMode(stillEditing ? "edit" : "view");
  paint();
  await (BRANCH[d.kind] ?? drawText)(d, gen);
  if (gen !== paintGen) return;
  // AND THE BUFFER IS COMPARED AGAIN, because `savedText` has just moved to what the app served: keeping
  // the editor while the file changed under it would otherwise leave `dirty` saying "nothing unsaved"
  // about a buffer that is not what is on disk - and Cancel, which asks only when `dirty`, would then
  // discard the person's text in silence. With the comparison the ● appears and Cancel asks, which is the
  // rule this page already has for every other unsaved buffer.
  if (stillEditing && mode === "edit" && ed) setDirty(ed.text() !== (savedText ?? ""));
  // THE READ IS KEPT, at the place the reader is: the agent's `line` outranks memory and ends any aim this
  // page held, and THE AIM COMES BEFORE THE KEEP, so the record a reload restores is where the aim just put
  // them rather than the top the load started them at.
  if (d.line) rescroll = 0;
  aimScroll();
  keepRead(drewRev);
}

/** THE URL KINDS, `pdf` and `image`: the bytes are an ASSET the server serves, so this is a `src` and one of
    two elements. The reset has already taken the OTHER kind's element off the screen, and `skin` owns
    `body.pdf`, so each arm writes its own element and nothing else. */
function drawUrl(d) {
  const src = d.asset + "?v=" + d.version;
  // **THE SAME DOCUMENT IS NOT LOADED TWICE** (owner, 2026-11-11: `我切换程序离开浏览器再回来的时候viewer里面的pdf会
  // 闪一下`). Coming back to a browser re-reads the file on show, and this branch re-assigned `src` every time -
  // so the PDF RELOADED, which is the flash he saw. It is the same shape as the editor that closed on the same
  // re-read: a draw that lands on what is already on screen must not touch the DOM. `?v=` makes "the same" a
  // string compare, and a version that moved still repaints (that is what the version is for).
  if (d.kind === "image") {
    if (img.getAttribute("src") === src) {
      img.setAttribute("alt", d.display);
      img.classList.add("on");
      return;
    }
    img.setAttribute("src", src);
    img.setAttribute("alt", d.display);
    img.classList.add("on");
    return;
  }
  // THE ELEMENT IS AN <iframe>, WHICH IS NOT COSMETIC. In loombot's panel this document is inside a
  // sandboxed frame, and a sandboxed browsing context may not load PLUGINS — which is what Chrome's PDF
  // viewer is. Measured 2026-09-24, Chrome 153 and Firefox 152, panel and standalone tab:
  //
  //   element     Chrome in panel        Firefox in panel   either, standalone
  //   <embed>     empty box, no error    empty box          renders
  //   <iframe>    broken-document icon   RENDERS (pdf.js)   renders
  //
  // So the <iframe> is the only element that renders in the panel in any browser, and it renders in a
  // tab in both. Chrome in the panel cannot be fixed from here, so #hint says so.
  if (pdf.getAttribute("src") !== src) pdf.setAttribute("src", src);
  pdf.classList.add("on");
  // **THE HINT IS DELETED** (owner, 2026-11-11: `chrome上pdf好像是好的。那一句警告是不是过时了？`). It said a PDF
  // may not render in loom's panel because the sandboxed frame blocks Chrome's PDF viewer, and that was
  // MEASURED - on Chrome 153. The owner's own screenshot on today's Chrome shows the PDF rendering inside the
  // frame with the sentence above it, so the sentence was warning about something that no longer happens, and
  // `framed` no longer changes what a PDF does. A warning icon on every PDF would be the same problem smaller:
  // there is nothing to warn about. If a browser ever refuses again, the failure says so where it happens.
}

/**
 * A FILE THAT CANNOT BE DISPLAYED (card t20261028-002834-882a): the server's sentence in `#notice` — the
 * band a frame's own sentence about the file has always gone to, which the truncation banner used — and NO
 * reading area at all (`setMode` hides `#view` for a kind that is not a text file). The reason it cannot be
 * rendered is the no-edit line, and the Download row the sentence names is `paintMenu`'s (`cur.download` —
 * DATA, never a kind).
 */
function drawDownload(d) {
  notice.textContent = d.note || "";
  notice.classList.toggle("on", !!d.note);
}

/**
 * VIEW or EDIT, and it owns exactly two things: `#view`'s display and the editor's editability. What is on
 * screen follows from the kind and the mode and nothing else — source is always the editor; markdown is the
 * rendering in view and the editor in edit — while the body's classes are `skin`'s.
 */
function setMode(m) {
  mode = m;
  skin();
  const text = !!cur && (cur.kind === "code" || cur.kind === "markdown");
  view.style.display = text && cur.kind === "markdown" && m === "view" ? "" : "none";
  if (ed) ed.setEditable(m === "edit");
}

async function enterEdit() {
  if (!cur || !cur.editable) return;
  hideBar();
  // THE MODE FIRST, AND THE EDITOR AFTER IT: `setMode` is what puts the editor's box on screen, and
  // CodeMirror measured in a hidden box is the blank editor a phone showed (card t20261028-022447-aa96).
  // For a MARKDOWN file this call is also where its editor comes into being at all.
  setMode("edit");
  const e = await editor();
  e.load(cur.path, cur.text ?? savedText ?? "");
  if (mode === "edit") e.setEditable(true);
  // NO HINT LINE: the mode is the buttons (only Save and Cancel), and Cmd/Ctrl-S is in Save's title.
  say("");
}

/** Back to view mode. The buffer is what was saved (or served), so the view shows exactly that. */
function leaveEdit() {
  setMode("view");
  if (cur && cur.kind === "markdown" && cur.html != null) {
    view.innerHTML = cur.html;
    code.highlightFences(view);
  }
}

// ── editing ─────────────────────────────────────────────────────────────────────────────────────────

function changed() {
  if (!cur || savedText === null || mode !== "edit") return;
  // Compared as TEXT, so undoing back to the saved state is clean again.
  setDirty(ed.text() !== savedText);
  keepDraft();
}

function setDirty(v) {
  if (v === dirty) return;
  dirty = v;
  paint();
}

/**
 * **THE HEADER, IN ONE PLACE** (card t20261028-022447-aa96): `#title` is the name, `#path` is where it
 * sits, and the document's own title repeats the name. It had THREE writers — `draw` set the path from the
 * frame, `paint` set the title from `cur`, `paintStale` set both again from the kept record — so the last
 * one to run silently won and a fix at the path site never reached the screen. A frame and a kept record
 * carry the same two fields, so both hand this one object.
 */
function header(d) {
  const at = d ? String(d.path || "") : "";
  const name = at.slice(at.lastIndexOf("/") + 1);
  el("title").textContent = name;
  // WITH A CHAIN BELOW, THE HEADER SAYS WHICH FILE AND THE CRUMB SAYS WHERE IT IS (Xiaohu, 2026-10-27):
  // the folder label is only what the crumb cannot say, which is nothing when there is a chain.
  const display = d ? String(d.display || at) : "";
  el("path").textContent = (d && d.crumbs && d.crumbs.length) ? "" : whereOf(display);
  el("path").title = at;
  document.title = APP + (name ? " • " + name + (dirty ? "*" : "") : "");
}

/**
 * **THE BODY'S CLASSES, ALL FIVE, FROM THE STATE** (card t20261028-022447-aa96). index.html's CSS decides
 * which BOX is on screen from them, and they used to be set by three functions between them: `resetPaint`
 * cleared `cm` and `pdf`, `setMode` set `editing` and `cm`, and the draw paths added `pdf` and `can-edit` —
 * so no one of them could say what the page was wearing, and `can-edit` outlived the file that set it.
 */
function skin() {
  const kind = cur ? String(cur.kind || "") : "";
  const text = kind === "code" || kind === "markdown";
  body.classList.toggle("editing", text && mode === "edit");
  body.classList.toggle("cm", text && (kind === "code" || mode === "edit"));
  body.classList.toggle("pdf", kind === "pdf");
  body.classList.toggle("dirty", dirty);
  body.classList.toggle("can-edit", !!cur && cur.editable === true);
}

/**
 * THE PAGE'S CHROME, FROM THE STATE: the dirty mark, the header, and the menu rows that say whether they can
 * act. **EVERY ROW IS ALWAYS THERE AND SAYS WHETHER IT CAN ACT** (theme.ts, `.loom-menu-panel`): inside a
 * closed menu the ABSENCE of an item cannot be the sentence it used to be, so an action that cannot run is
 * drawn DISABLED — and the reason an edit cannot run is the no-edit line, which `draw` fills for every kind
 * that has a reason.
 */
function paint() {
  skin();
  el("mark").textContent = dirty ? "●" : "";
  el("mark").title = dirty ? "unsaved changes" : "";
  header(cur);
  // REFRESH RE-READS WHAT IS ON SHOW — a folder as much as a file (rule 8 reaches listings because a
  // listing IS a read). THE CRUMB IS NOT A ROW OF THIS MENU: its segments exist only while a frame that
  // carried a chain is drawn, and each one names a folder the server will open.
  el("refresh").disabled = !cur || (cur.kind !== "listing" && cur.editable !== true);
  el("edit").disabled = !cur || cur.editable !== true;
  paintMenu();
}

/** `leave` is the Save BUTTON: when the write lands, go back to view mode. Cmd/Ctrl-S stays. */
function save(force, leave) {
  if (!cur || !cur.editable || mode !== "edit") return;
  if (inflight) return say("a save is already on its way");
  inflight = { text: ed.text(), leave: leave === true };
  say(force ? "overwriting…" : "saving…");
  send("save", {
    path: cur.path,
    text: inflight.text,
    base: cur.hash,
    force: force === true,
    done: leave === true,
  });
}

/**
 * THE ANSWER TO THIS PAGE'S OWN SAVE, by construction: an answer comes back to the request that asked it, so
 * there is no id to compare and no other tab's save can arrive here. What makes it this page's QUESTION is
 * `inflight` — one save at a time, the text it carried, and whether it was the Save BUTTON.
 */
function saved(d) {
  if (!inflight) return;
  const { text, leave } = inflight;
  inflight = null;
  cur.hash = d.hash;
  cur.bytes = d.bytes;
  cur.lines = d.lines;
  cur.text = text;
  if (d.html != null) cur.html = d.html;
  savedText = text;
  hideBar();
  // SAID AGAIN EITHER WAY: text typed while the save was in flight is not on disk, so the buffer is
  // dirty again even though this page never stopped thinking so — and its draft stays until it is not.
  dirty = ed.text() !== savedText;
  paint();
  if (!dirty) dropDraft();
  // THE SAVE IS A READ TOO: the file on screen is now the file that was written, and the record a
  // reload restores is this one — not the one the show served, whose hash would offer a stale draft.
  keepRead(lastRev);
  const when = new Date().toLocaleTimeString();
  const what = "saved " + d.bytes + " bytes, " + d.lines + " lines" +
    (d.force ? " (overwrote the disk)" : "");
  // Back to the view only if nothing was typed while the save was in flight: that text is not on disk.
  const opens = leave && !dirty;
  if (opens) leaveEdit();
  say(
    what + " at " + when +
      (leave && dirty ? " — you typed since, so you are still editing" : "") +
      // A WAITING FILE IS NOT LOST WITH THE NOTICE: this line is about to replace the sentence that said
      // one was waiting, so while it is not opening it says so again. (Cmd/Ctrl-S lands here: it saves and
      // STAYS in edit mode, which is not the human being done.)
      (waiting && !opens ? "; the change that is waiting from the viewer still is" : ""),
    "ok",
  );
  // AND THE BUFFER IS RESOLVED: the Save button landed, the page is back in view mode with nothing
  // unsaved, so what the agent showed while the human was typing opens. NOT from a Cmd/Ctrl-S — that is
  // still an edit, and taking the file out from under it is the interruption this page exists to avoid.
  if (opens) openWaiting();
}

/** Cancel: nothing to lose, leave; unsaved changes, ASK — inline, and never discard in silence. */
function cancel() {
  if (mode !== "edit") return;
  if (!dirty) {
    hideBar();
    leaveEdit();
    // NOTHING TO LOSE, SO NOTHING IS ASKED — and leaving edit mode is the human being done, so a file the
    // agent showed while they were typing is read and drawn here too (`openWaiting` asks, and the answer
    // draws).
    if (waiting) return openWaiting();
    return say("");
  }
  askBar("You have unsaved changes to " + cur.display + ". Leave edit mode and discard them?", [
    ["Discard changes", "throw my edits away and go back to the view", () => {
      hideBar();
      ed.replace(savedText);
      setDirty(false);
      dropDraft();
      leaveEdit();
      say("changes discarded");
      // The buffer is gone, so what arrived while it was here is READ and drawn: the human chose to
      // discard the edits, not to be kept away from the file the agent showed.
      openWaiting();
    }],
    ["Keep editing", "go back to the text", hideBar],
  ]);
}

function reloadFromDisk() {
  if (!cur) return;
  dropDraft();
  dirty = false;
  send("reload", {});
}

/**
 * READ WHAT WAS WAITING. Called only where this page's buffer is RESOLVED — the Save button landed (back in
 * view mode, nothing unsaved) or Cancel discarded the edits — because that IS "the human's pace": the file
 * the agent showed is not put on screen while they are in the middle of something, and it is not thrown
 * away either. Anything else keeps it waiting: a Ctrl-S (which stays in edit mode), or typing back to the
 * saved text.
 *
 * AND IT ASKS RATHER THAN DRAWING A HELD FRAME, because a change is a RE-READ now: what the app has is not
 * known until the page asks, and the answer to that ask is the `show` it draws. `dirty` refuses here as
 * well, so "done with them" is a fact about the buffer and not about the moment this was called.
 */
function openWaiting() {
  if (!waiting || dirty) return;
  waiting = false;
  read();
}

/**
 * The Refresh button: read this file from disk again, and it is the same `reload` a refused save offers.
 *
 * IT ASKS NOTHING, because there is nothing here to lose: the menu this button lives in is not drawn in
 * edit mode at all (`body.editing #menu` in index.html), and `changed` marks dirty in edit mode alone — so
 * a page that can press Refresh is clean by construction. The confirmation that used to sit here was a
 * branch for a buffer this button cannot see, and a branch kept "because it is the RULE" is a branch no
 * test can reach; the human's own unsaved text is protected where it exists, by `show`'s waiting note and
 * by Cancel's question.
 */
function refreshFromDisk() {
  if (!cur || (cur.kind !== "listing" && cur.editable !== true)) return;
  reloadFromDisk();
}

// ── BACK AND DOWNLOAD: the two rows this card added (card t20261028-002834-882a) ────────────────────
//
// **BACK IS THE BROWSER'S HISTORY, AND THIS PAGE OWNS NOTHING OF ITS OWN** (card t20261105-225359-8b14).
//
// It used to be a private array of paths with a private Back button, and it had two faults the owner found
// at once. (1) It could not go back to a FILE: the app checked the previous path against what the CURRENT
// view had rendered, so a previous file was refused as a stale click and Back did nothing — the server's
// half of that fix is `drawn` in viewer_mcp.ts. (2) The browser's own Back and this menu's Back were two
// opinions about the same walk: the browser left the page while the menu walked the app.
//
// So there is ONE record now, and it is `history`: every view this document moves to is a history entry
// (`{loomView: <realpath>}`, the same realpath the frames carry and `open_path` looks up), the FIRST view
// REPLACES the entry the document arrived on — a landing never pushes its own return, so Back at the
// landing is genuinely nothing and the row is disabled — and a popstate, from the browser or from this
// menu (which presses `history.back()`), sends the same `open_path` with `back: true`. The two cannot
// disagree because there is nothing left for them to disagree ABOUT.
//
// The URL NEVER MOVES (`pushState` with no url): an app page's address is the app's, and a viewer history
// that rewrote it would change what a reload and a bookmark mean.
//
// WHAT SURVIVES A REALM THAT REFUSES `pushState` — a sandboxed frame with no same-origin — is `past`, the
// same stack, and then a Back sends `open_path` itself. `historyWorks` is the answer to which realm this
// is, decided once by trying.
//
// THE RECORD LIVES WITH THE DOCUMENT: a reload is a new visit (a fresh page, a fresh stack), and a frame a
// fresh page draws is not somewhere it went. Empty stack, disabled row.
// `past` is MUTATED (push/pop) and never reassigned, so it is a const BINDING holding a mutable array.
const past = [];
/** The path a Back asked for: the draw that lands there does not record a move (see `draw`). */
let returningTo = "";
/** The view this document has recorded last — "" until the first frame of this document is drawn. */
let viewMarked = "";
/** Whether `history` takes entries here. A page that cannot push still walks with `past`. */
let historyWorks = true;
/**
 * WHETHER THE ENTRY THIS DOCUMENT ARRIVED ON HAS BEEN NAMED (card t20261108-081151-a766). It is NOT the same
 * question as `viewMarked === ""`: a document that boots with a KEPT READ paints it before any fetch
 * (`paintLastRead` -> `draw(kept)`), so the view is already on screen — and recorded by nothing — when the
 * app's own frame lands with the same path. Measured in a fresh frame document over a file: the crumb press
 * then counted as the FIRST view, REPLACED the entry the document arrived on, and the Back after it had
 * nowhere to go — "going back…" for ever, in a frame, where a press that moves nothing says nothing.
 */
let landingMarked = false;
/**
 * THE ENTRIES OF THIS DOCUMENT'S OWN BEHIND THE ONE IT IS ON — what a Back can actually walk. It is not
 * `past.length`: `past` is this page's model of the walk, and a browser with nothing there answers
 * `history.back()` with silence. That silence under a sentence saying "going back…" IS the defect.
 */
let walkable = 0;
/**
 * **WHAT IS ON SCREEN CAME OUT OF THE KEPT READ, NOT OUT OF THE APP** (owner, 2026-11-11 — the fresh-open Back).
 *
 * `paintLastRead` draws memory's frame before the app answers anything, so on a fresh document `cur` is
 * already a path — and that path is a view THIS DOCUMENT HAS NEVER BEEN TO: a reload is a new visit, a
 * fresh stack. Measured 2026-11-11 in real Chrome: a document that remembered a FILE while its app was
 * showing a FOLDER ended up with `past.length` 1, the menu's Back ENABLED and `history` holding an entry
 * named for the file — and the press asked the server for a path that app life had never drawn, which is
 * the owner's sentence verbatim ("refused: this path is not one the viewer showed you"). It is true from
 * the kept paint until the first frame of the app itself lands, and then it is false for good.
 */
let memoryOnScreen = false;
/**
 * THE PATHS THIS DOCUMENT ITSELF NAMED — every view it recorded, in order, whatever the browser did with
 * it. It is what `walked` checks a popstate against: the browser's entries outlive a document at the same
 * address (a reload keeps its own entry's `state`), so a popstate can hand this page a `loomView` from the
 * document it replaced — a view this page never showed, which the server has never drawn.
 */
const named = [];

/** Record a view: the first one REPLACES the entry the document arrived on, every later one is pushed. */
function recordView(at, first) {
  // WHAT THIS DOCUMENT NAMED, whether or not the browser took an entry for it: `walked` sends an
  // `open_path` only for a path in here (see `named`), because anything else names a view this page never
  // showed and the server would refuse it.
  if (at && named.indexOf(at) < 0) named.push(at);
  if (!historyWorks) return;
  try {
    if (first) {
      history.replaceState({ loomView: at }, "");
      return;
    }
    history.pushState({ loomView: at }, "");
    walkable++;
  } catch {
    // A browser (or a sandbox) that refuses the push keeps the walk in `past`, which is why `past` is
    // still here: what is lost is the browser's Back, and that is the address bar's business, not a press.
    historyWorks = false;
  }
}

/**
 * HOW LONG A PRESS'S EFFECT MAY TAKE BEFORE THE PAGE STOPS SAYING IT IS GOING (card t20261109-233720-26f0).
 *
 * **THE BOUND IS ON THE EFFECT, NEVER ON THE PRESS.** `walkable` is this page's COUNT of the pushes it made,
 * and a count is not the browser's own entries: Chrome stops taking `pushState` at FIFTY entries in one
 * document and says NOTHING when it does — measured 2026-11-09 through CDP in a real panel frame: pushes
 * 51..60 threw nothing and left `history.length` at 50, and the `history.back()` after them answered with
 * SILENCE (no popstate, no throw, no draw) while `walkable` still counted entries that are not there. So a
 * press that said "going back…" could have nothing coming at all, and the sentence stood for ever: that is
 * the owner's screen, photographed in the rig (`4g`). 1200ms is generous against a popstate (milliseconds
 * here) and against this machine answering an `open_path`; what it is NOT measured against is a phone over
 * the relay, where a late answer's own draw corrects the line rather than leaving it wrong.
 */
const BACK_MS = 1200;
/** Which press the pending bound belongs to: a press, a walk and a landing each bump it. */
let backSeq = 0;
let backTimer = 0;

/** THE PRESS SAYS IT IS GOING, AND ITS EFFECT IS NOW ON A BOUND OF ITS OWN. */
function going() {
  const mine = ++backSeq;
  say("going back…");
  clearTimeout(backTimer);
  backTimer = setTimeout(() => {
    backTimer = 0;
    if (mine !== backSeq) return;
    // THE BROWSER WAS ASKED AND DID NOT WALK. Its capacity is not this page's model of it, so the page
    // stops trusting the model and takes the walk it does own, `past` — and every later press goes
    // straight there, because a browser that answered silence once answers it again.
    if (historyWorks && walkable > 0) {
      historyWorks = false;
      walkable = 0;
      return fallBack();
    }
    // THE QUESTION WAS ASKED AND THE VIEW DID NOT MOVE: the line becomes the truth about the stack that
    // is left, never an intention that outlives its press.
    say(nothingWentBack(), "bad");
    paintMenu();
  }, BACK_MS);
}

/** WHAT A PRESS THAT MOVED NOTHING SAYS — about the stack, and about who was asked. */
function nothingWentBack() {
  return past.length === 0
    ? "nothing to go back to"
    : "nothing went back — the viewer's server is not answering";
}

/** SOMETHING LANDED: the press waiting for it is over, whatever the landing said. */
function backSettled() {
  backSeq++;
  clearTimeout(backTimer);
  backTimer = 0;
}

/** THE WALK `past` IS: ask the server for the view behind — all a browser that cannot walk leaves. */
function fallBack() {
  if (past.length === 0) return;
  const was = past.pop();
  returningTo = was;
  send("open_path", { path: was, back: true });
  going();
  paintMenu();
}

/**
 * A BACK IS ONE MOVE, WHOEVER ASKS FOR IT: this presses the browser's Back and lets `popstate` do the work,
 * so the menu's row and the browser's own button cannot take two different roads. With no history to walk
 * (a realm that refused the push, or a document that moved nowhere) it asks the server directly — and BOTH
 * roads are under the bound above, so a press that moves nothing ends in a sentence that is true.
 */
function goBack() {
  if (past.length === 0) return;
  // A BACK NEEDS SOMEBODY WHO CAN MOVE IT, AND HERE THAT IS NOBODY: with the channel down an `open_path`
  // goes to a server nobody answers, so the walk is said to have failed NOW, in one sentence, instead of
  // leaving "going back…" standing over a request that cannot land. `past` is not popped — the view behind
  // is still behind, and the press can be made again once the server is back.
  if (fault()) {
    say(nothingWentBack(), "bad");
    paintMenu();
    return;
  }
  going();
  // ONLY WHERE THE BROWSER MAY HAVE AN ENTRY OF THIS DOCUMENT'S BEHIND THIS VIEW (card
  // t20261108-081151-a766). It is not enough that `past` says there is one, and it is not enough that
  // `walkable` does either — see `BACK_MS` — but an over-count now costs a WAIT, not the sentence.
  if (historyWorks && walkable > 0) {
    try {
      history.back();
      return;
    } catch {
      historyWorks = false;
    }
  }
  fallBack();
}

/**
 * THE BROWSER WALKED: one of this page's own entries became current, and where it names is a view this
 * page was at. A BACK takes the entry it came from off `past`; a FORWARD (one the menu cannot press) puts
 * the view it left behind on — so `past` stays the stack of views behind where the person is.
 */
function walked(ev) {
  // THE BROWSER WALKED, so whatever this page was saying about going is settled here — and the answer the
  // walk sends below is a press of its own, with the bound on THAT (card t20261109-233720-26f0).
  backSettled();
  const at = ev && ev.state && typeof ev.state.loomView === "string" ? ev.state.loomView : "";
  // A BACK THAT MOVES NOTHING MUST NOT LEAVE "going back…" BEHIND IT (card t20261108-081151-a766): the page
  // said it was going, so it says nothing rather than a sentence about a move that is not happening. The
  // owner read that sentence for a minute as "it is working".
  if (!at) {
    say("");
    paintMenu();
    return;
  }
  const here = cur ? String(cur.path || "") : "";
  // **AN ENTRY THIS DOCUMENT NEVER NAMED IS NOT A VIEW IT MAY ASK FOR** (see `named`). The browser's
  // entries outlive a document at the same address — a reload keeps its own entry's `state` — so a
  // popstate can hand this page a `loomView` from the document it replaced, and asking the server for it
  // is the owner's refusal verbatim: "refused: this path is not one the viewer showed you ... Nothing was
  // opened." A refusal is not a walk: the page asks nothing and moves no view.
  if (!named.includes(at)) {
    say("");
    // AND THE ENTRY IS RENAMED TO WHAT IS ON SCREEN, which is the walk this page really has: the person is
    // looking at `viewMarked` and the entry they are standing on said something else, so the next press
    // would land on a stale name again. One `replaceState` (no new entry, nothing behind it) makes the
    // browser agree with the screen; a realm that cannot write keeps the guard, which is the whole of what
    // the refusal needed.
    const mine = viewMarked || here;
    if (historyWorks && mine) {
      try {
        history.replaceState({ loomView: mine }, "");
      } catch {
        historyWorks = false;
      }
    }
    paintMenu();
    return;
  }
  if (at === here) {
    say("");
    paintMenu();
    return;
  }
  if (past.length > 0 && past[past.length - 1] === at) {
    past.pop();
    walkable = Math.max(0, walkable - 1);
  } else if (here) {
    past.push(here);
    walkable++;
  }
  returningTo = at;
  send("open_path", { path: at, back: true });
  going();
  paintMenu();
}
addEventListener("popstate", walked);

/** THE MENU'S STATE, for the two rows that are not about a file being editable at all. */
function paintMenu() {
  // THE ROW IS ENABLED ONLY BY A MOVE THIS DOCUMENT RECORDED (`past` is filled by a real move, never by
  // memory repainting a reload — see `memoryOnScreen`), so a fresh document's Back is grey, which is also
  // the state `#back` ships in (`index.html`, `disabled`).
  el("back").disabled = past.length === 0;
  el("download").disabled = !(cur && cur.download);
  fitMenu();
}

/**
 * **THE MENU GETS THE ROOM ITS BOX HAS, AND NEVER MORE** (card t20261105-225359-8b14).
 *
 * The panel hangs under its own button and nothing bounds it: measured 2026-11-05 in real Chrome, it is
 * 174.4px tall under a 54.4px anchor, so every box shorter than 228px CUTS it — at a 200px viewport the
 * Close row was outside the viewport and the panel's own bottom was 28.8px past it. In the panel the box is
 * the app frame, which is whatever the window leaves, so the state is one window size away at all times.
 *
 * The cap is the THEME's name (`--loom-menu-room`, shared/theme.ts `.loom-menu-panel`), because a capped
 * panel scrolls and that is the panel's own look; what this page supplies is the one number only it knows —
 * how much room is left under its summary. A floor of 80px keeps the menu a menu when the room is absurd
 * (four rows scroll rather than vanish); above that the panel is inside its box at every size.
 */
function fitMenu() {
  // A PAGE WITH NO LAYOUT MEASURES NOTHING, and says nothing: a rig's stand-in document has no height and no
  // boxes, and the honest answer there is the theme's default (no cap), not a number invented from zeros.
  if (typeof innerHeight !== "number") return;
  const panel = document.querySelector(".loom-menu-panel");
  const button = el("actions");
  if (!panel || !button) return;
  // 6.4px is the gap the theme puts between the button and the panel, 10px the panel's own padding and
  // border, and 8px the room this page keeps under it — so the number handed over is what the CONTENT may
  // take. The floor keeps the menu a menu where the room is absurd; four rows scroll rather than vanish.
  const room = Math.round(innerHeight - button.getBoundingClientRect().bottom - 6.4 - 10 - 8);
  panel.style.setProperty("--loom-menu-room", Math.max(80, room) + "px");
}
addEventListener("resize", fitMenu);
el("menu").addEventListener("toggle", fitMenu);

/**
 * DOWNLOAD: the frame's TOKEN, and the bytes brought over the app's OWN channel (card t20261028-010039-c7a2).
 *
 * IT USED TO BE A NAVIGATION to an absolute `http://127.0.0.1:<port>/d/<token>` URL, and that URL is
 * resolved by THE BROWSER'S machine: on a phone reached through the relay, 127.0.0.1 is the PHONE, so the
 * press did nothing and said nothing at all (Xiaohu's phone, 2026-10-28). `__event` is the one address this
 * page has that IS carried to the machine from wherever it is open, so the bytes come the way everything
 * else this page knows comes.
 *
 * A BLOB AND AN `<a download>`: the answer is `{action: "bytes", data: {offset, length, b64, done}}` and
 * the page turns the bytes it collected into a Blob and hands the browser a blob: URL — iOS Safari has taken
 * a blob this way since 13, though NO iOS was available to this repo's rigs, so what is MEASURED here is
 * Chrome inside the panel's exact sandbox saving nine megabytes (`test/browser-test/folder_check.ts` 7h,
 * 7h2). The panel's sandbox must grant `allow-downloads` for ANY save at all (measured,
 * client/conversation.js), and the anchor is the one form a sandboxed frame downloads from.
 *
 * ONE CHUNK AT A TIME, IN ORDER, AND THE OFFSET IS CHECKED against what was asked for. A page that counted
 * its own answers would save a file with a hole in it after one lost chunk; this one stops and says so. The
 * server decides the sizes (`chunk` on the frame) and says which answer was the last, so a file of any size
 * and a file of no size at all are the same loop.
 */
/** The last bytes this page handed to the browser: what a probe reads to prove they are the file's own. */
let lastSave = null;
/** The token being downloaded, so a second press does not interleave two files into two blobs. */
let saving = "";

/** BASE64 → BYTES. `atob` gives a string of char codes, ONE PER BYTE, which is why this is not a decoder. */
function unbase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** THE SAVE A PHONE CAN PRESS: a real anchor carrying the blob, in the notice band, with the name and
 * the size. It replaces itself on every download, so there is never a link to the PREVIOUS file's bytes. */
function offerSaveLink(name, bytes) {
  notice.textContent = "";
  // **iOS SAVES THROUGH ITS OWN SHEET** (2026-10-27): a blob: URL is not navigable inside the panel's
  // sandboxed frame on iOS - the link appeared and pressing it, or long-pressing it, did nothing - and a
  // programmatic click outside a gesture is refused too. `navigator.share` with a File is the one path
  // that hands the bytes to iOS itself, and it runs INSIDE the press.
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = "Save " + (name || "the file") + " (" + kib(bytes) + ")";
  b.style.cssText =
    "color:var(--fg);background:none;border:1px solid var(--line);border-radius:6px;" +
    "padding:0.3rem 0.6rem;font:inherit;font-weight:600";
  b.addEventListener("click", async () => {
    const bytesOf = lastSave && lastSave.bytes;
    if (!bytesOf) return say("the bytes are gone - press Download again", "bad");
    const file = new File([bytesOf], String(name || "download"), {
      type: "application/octet-stream",
    });
    try {
      if (!(navigator.canShare && navigator.canShare({ files: [file] }))) {
        // NO ANCHOR FALLBACK HERE ON PURPOSE: on iOS it either saves nothing or saves a second, badly
        // named copy beside the real one (measured: "text", 15 bytes). One save shape, or a sentence.
        return say("this browser cannot hand a file to iOS — open the app in Safari", "bad");
      }
      // NO `title`: iOS turns a title into a SECOND, TEXT item beside the file (measured 2026-10-27: a
      // 15-byte "text" file whose content was the file's name).
      await navigator.share({ files: [file] });
    } catch (e) {
      // A cancelled sheet is not a failure, and there is nothing else to say.
      if (!(e && e.name === "AbortError")) say("the share sheet could not open: " + e, "bad");
    }
  });
  notice.appendChild(b);
  notice.classList.add("on");
}
/** HAND THE BYTES TO THE BROWSER AS A SAVE. The name is the frame's, which is the file's own on disk. */
async function handToBrowser(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) {
    // **ONE PRESS, IF iOS ALLOWS IT** (Xiaohu, 2026-10-27: '我们可以点按钮直接出分享面板吗'): the share
    // sheet straight from the Download press, when Safari still counts the press as the gesture that
    // started it. It does not always - the fetch is several awaits long - and a share that was refused
    // falls back to the button, which is a press of its own.
    try {
      const file = new File([bytes], String(name || "download"), {
        type: "application/octet-stream",
      });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        // NO `title`: iOS turns a title into a SECOND, TEXT item beside the file (measured 2026-10-27: a
        // 15-byte "text" file whose content was the file's name).
        await navigator.share({ files: [file] });
        return;
      }
    } catch (e) {
      if (e && e.name === "AbortError") return; // cancelled: not a failure, and no second control
    }
    offerSaveLink(name, bytes.byteLength);
    return;
  }
  // A BROWSER ON A MACHINE SAVES THE OLD WAY, AND ONLY THAT WAY: an anchor click, now, while the answer
  // is fresh. It does not ALSO offer the button — two save shapes on one press is how a phone saved two
  // files (2026-10-27).
  const a = document.createElement("a");
  a.href = url;
  a.setAttribute("download", String(name || ""));
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function downloadNow() {
  const d = cur && cur.download;
  if (!d || !d.token || saving) return;
  const token = d.token;
  saving = token;
  say("downloading " + d.name + "…");
  const parts = [];
  let at = 0;
  try {
    for (;;) {
      // NOT `send`: this is not a frame to draw and it must not go through the channel's own bookkeeping
      // (a chunk is a byte transfer, and several are one press). The answer comes back on THIS request.
      const frame = await ask("download", { token, offset: at });
      const got = (frame && frame.data) || {};
      if (!frame || frame.action !== "bytes") {
        throw new Error(got.reason || "the viewer did not answer the download");
      }
      if (got.token !== token) {
        throw new Error("the viewer is offering another file now — press Download again");
      }
      if (got.offset !== at) {
        throw new Error("the viewer answered the bytes at " + got.offset + ", asked for " + at);
      }
      const bytes = unbase64(String(got.b64 || ""));
      if (bytes.byteLength !== got.length) {
        throw new Error(
          "the viewer's chunk decoded to " + bytes.byteLength + " bytes, not the " + got.length +
            " it stated",
        );
      }
      parts.push(bytes);
      at += bytes.byteLength;
      if (got.done) break;
      if (bytes.byteLength === 0) {
        throw new Error("the viewer answered an empty chunk before the end of the file");
      }
      say(
        "downloading " + d.name + "… " +
          Math.min(99, Math.floor((at / Math.max(1, d.bytes)) * 100)) + "%",
      );
    }
    const all = new Uint8Array(at);
    let at2 = 0;
    for (const part of parts) {
      all.set(part, at2);
      at2 += part.byteLength;
    }
    await handToBrowser(all, d.name);
    lastSave = { name: d.name, bytes: all };
    if (channel === "open") say("");
  } catch (e) {
    // THE HUMAN PRESSED A ROW, so the reason is said where they are reading it — and when the app is gone
    // this is also how they find out, since a request with no answer is the only way a page like this can.
    fail("download", e);
  } finally {
    saving = "";
  }
}

// EVERY ITEM CLOSES THE MENU FIRST: the panel is over the page, and an action chosen from it must not
// leave it hanging open behind the change it made. The `<details>` is the state, so this is the only line
// of menu logic in the page.
const pick = (fn) => () => {
  el("menu").open = false;
  fn();
};
// THE CRUMB'S SEGMENTS, ONE DELEGATED HANDLER: the chain is rebuilt on every file draw, so a listener per
// segment would be a listener per draw. The path a segment sends is the one the SERVER drew (`data-path`,
// the server's realpath) — the page works out nothing (card t20261027-025619-fb7e).
el("crumb").addEventListener("click", (e) => {
  const seg = e.target && e.target.closest ? e.target.closest("button[data-path]") : null;
  if (!seg) return;
  send("open_path", { path: seg.getAttribute("data-path") });
  say("opening " + seg.textContent + "…");
});
el("back").onclick = pick(() => goBack());
el("download").onclick = pick(() => downloadNow());
el("refresh").onclick = pick(() => refreshFromDisk());
el("edit").onclick = pick(() => enterEdit());
el("save").onclick = () => save(false, true);
el("cancel").onclick = () => cancel();
el("close").onclick = pick(() => closeViewer());

// ── THE MENU'S OTHER TWO EXITS ─────────────────────────────────────────────────────────────────────────
// A native <details> opens itself and closes only when its own summary is pressed AGAIN. The outside press
// has been here since this page was written (the click handler further down used to carry it); the KEY did
// not, and neither did the BOARD's page have the press at all -- one menu, three behaviours, until card
// t20261021-063446-f637. Both exits are here now, in the one place the menu's own logic lives, and the look
// stays shared/theme.ts's.
const menu = el("menu");
// A PRESS ANYWHERE BUT THE MENU SHUTS IT, in the CAPTURE phase so a control that cancels a press cannot keep
// it open, and by walking the targets a <details> CONTAINS rather than by closest("details") -- closest would
// also answer yes for a press inside a DIFFERENT disclosure on the page. Nothing here OPENS it: the browser
// does that, on the summary.
document.addEventListener("pointerdown", (e) => {
  if (!menu.open) return;
  const t = e.target;
  if (t === menu || (t && menu.contains && menu.contains(t))) return;
  menu.open = false;
}, true);
// AND ESCAPE, which the element does not answer either. Read HERE rather than in loombot's escape stack: this
// is a separate document, and that stack belongs to the page around it.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && menu.open) menu.open = false;
});

/**
 * Close: the VIEWER ends — its server exits, its tab leaves the strip, its agent is told. At once, with no
 * question from THIS page, because this page cannot be dirty while Close is on screen: Close is hidden in
 * edit mode (index.html), `changed` marks dirty only in edit mode, and every way back to view (Cancel's
 * discard, a Save that landed with nothing typed since, a reload) is clean. A DRAFT left in localStorage by
 * a closed panel is not a dirty buffer: it is only offered, and a Close keeps it for next time.
 *
 * AND NO PAGE IS ASKED ABOUT ANOTHER PAGE'S EDITS (2026-10-20). The server used to answer a plain close
 * with `close_refused`, naming the dirty file, and this page asked "Close anyway?" — one page's state
 * gating another page's action, which is the design this page is written against (README.md, the page
 * contract, rule 6). The text in that other page is not lost by closing: its browser keeps it as a DRAFT
 * and offers it on the next show, which is why the close simply goes — and why the file that went with it
 * is named to the AGENT, which can act on it, instead of being asked of the person closing.
 */
function closeViewer() {
  requestClose();
}
function requestClose() {
  hideBar();
  // **THE SENTENCE SAYS WHAT THIS PAGE CANNOT DO** (card t20261027-025619-fb7e): the panel folds this
  // frame NOW (the local half never waits for the app), so this page is detached from the viewer the
  // moment the button is pressed — and if the ask is answered (`player_left`), the app's own farewell
  // replaces this line. Said BEFORE `closeLocally`, because the panel reads `#status` at that post.
  say(
    "this page is detached from the viewer — it cannot edit or save; the panel closes it here",
    "",
  );
  // **CLOSE ENDS THE APP, AND THE LOCAL HALF NEVER WAITS FOR IT** (card t20261027-025619-fb7e): the
  // frame is deregistered and the panel folds NOW — whether the ask lands, is refused, or is answered
  // by an app that only detaches — and the ask goes too, so the app ends on the graceful path
  // (`ch.close`: the agent is told, the tab leaves the strip). A Close that needed the channel was a
  // dead button; one that waited for it would be a slow one.
  closeLocally();
  send("close");
}

/**
 * THE LOCAL HALF OF A CLOSE — the page contract's verb, and the ONE place this page calls it (card
 * t20261027-025619-fb7e). loombot splices `loomApp.close` into every app page: it tells the panel to
 * deregister this frame and fold, and answers whether there was a panel to tell. In a STANDALONE tab there
 * is none, so the sentence is what the press produces — and nothing pretends otherwise.
 */
function closeLocally() {
  try {
    return !!(globalThis.loomApp && globalThis.loomApp.close && globalThis.loomApp.close());
  } catch {
    return false;
  }
}
// Cmd/Ctrl-S outside the editor (the header) is still a save that STAYS, never the browser's "save page".
addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (!ed || !ed.hasFocus()) save(false, false);
  }
});

// ── a click on a markdown link ───────────────────────────────────────────────────────────────────────
//
// A WORKSPACE PATH IS NOT AN ANCHOR. `render.ts` draws one as an `a` with NO href and the url in `data-href`,
// because this page runs inside the panel of loombot — a sandboxed iframe — where a press on an href navigates
// the FRAME ITSELF, relative and absolute alike, and nothing in the panel brings it back (MEASURED in
// headless Chrome: loom/library/loom-app-frame-navigation/README.md, and this app's README.md).
//
// So a click on a PATH is a MESSAGE, not a location: this page sends the href it was DRAWN with — never a
// path it worked out — and the server answers by showing that file, or with the sentence that says why it
// will not (`open`, viewer_mcp.ts). One owner per rule, exactly as with `save`. A url the renderer refused
// carries an empty data-href and is not sent anywhere.
//
// A URL IS THE OTHER KIND (2026-11-02), and it gets the one destination a person expects: a TAB of the real
// browser, which leaves this frame exactly as it was. Opened top-level, the page is an ordinary document and
// its own `href` + `target="_blank"` does it — no script needed. Inside the panel it is NOT possible: the
// sandbox has no allow-popups, so `open()` from in here returns null (MEASURED 2026-09-24), and the frame
// therefore ASKS THE PANEL, the one document that may open a window, over the message channel it already
// asks for a renewal on (`loom/open-url`, client/conversation.js). The panel decides; this page never
// navigates anywhere for a link.
/**
 * SCROLL THE RENDERING TO A HEADING, on the frame the server sent (`goto_anchor`). The lookup is scoped to
 * `#view`, where the rendering is — NOT to the whole document: this page's own chrome has ids of its own
 * (#view, #save, #close, …), and a heading whose text is "Close" has to scroll to itself and not to the
 * page's Close button. The id is the SERVER's word for what it rendered; this page only finds it, which
 * is why nothing here ever works out what an anchor is called.
 */
function jumpTo(id) {
  const attr = String(id).replace(/["\\]/g, "\\$&");
  const t = view.querySelector('[id="' + attr + '"]');
  if (!t || !t.scrollIntoView) {
    return say("there is no heading " + JSON.stringify(id) + " in this file", "bad");
  }
  t.scrollIntoView({ block: "start" });
  say("");
}

/**
 * A TAP IS ACTED ON AT POINTERUP, ONCE — because a click is NOT guaranteed on a phone (2026-10-27).
 * iOS Safari can withhold the synthesized click for a press inside a scrollable region (measured on
 * Xiaohu's iPhone: the document's click listener never fired for a listing row, while the same press
 * on the header's crumb did). Pointerup fires for every completed press, so the row is resolved there
 * too: a press that moved less than a finger's width is a TAP (a scroll is not), and a tap handled here
 * marks itself so the synthesized click that follows does not run the action a second time.
 */
let lastTapAt = 0;
/**
 * WHICH ROW THE TAP WAS ON — and the mark is the ROW, not a moment in time (card t20261105-225359-8b14).
 *
 * The synthesized click that follows a handled tap is on the SAME row, so the row is the whole of what has
 * to be recognised. A clock alone was too broad: any click in the next 500ms was dropped, and measured in
 * real Chrome on 2026-11-05 that swallowed a REAL press — row `walk-a.md` tapped, the link inside it pressed
 * 300ms later, and nothing happened at all, no request and no sentence. A person opening a folder row and
 * then a link in the file it opened presses exactly that fast.
 */
let lastTapRow = null;
function actOnRow(row) {
  const path = row.getAttribute("data-path");
  if (!path) return false;
  send("open_path", { path });
  say("opening " + (row.getAttribute("data-name") || "") + "…");
  return true;
}
let downAt = null;
addEventListener("pointerdown", (e) => {
  downAt = { x: e.clientX, y: e.clientY, t: Date.now() };
}, true);
addEventListener("pointerup", (e) => {
  const d = downAt;
  downAt = null;
  if (!d || !e.target || !e.target.closest) return;
  if (Math.abs(e.clientX - d.x) > 12 || Math.abs(e.clientY - d.y) > 12) return; // a scroll, not a tap
  const row = e.target.closest("li.row");
  if (!row) return;
  if (actOnRow(row)) {
    lastTapAt = Date.now();
    lastTapRow = row;
  }
}, true);

addEventListener("click", (e) => {
  const t = e.target;
  // THIS CLICK IS THE TAP POINTERUP ALREADY HANDLED — and only that one: the same row, moments later.
  if (lastTapRow && Date.now() - lastTapAt < 500) {
    const on = t && t.closest ? t.closest("li.row") : null;
    if (on && on === lastTapRow) return;
  }
  // THE OUTSIDE PRESS LEFT THIS HANDLER: a menu is closed on a pointerdown now, with the key beside it, where
  // the rest of the menu's logic is (see "THE MENU'S OTHER TWO EXITS" above). One exit, one place, and the
  // same two lines on the board's page.
  // A ROW OF THE LISTING, first: it is not inside #view, so it can never be a markdown link, and a click
  // sends back the path the row was DRAWN with and nothing else (viewer_mcp.ts `open_path` — ONE event for
  // a file row, a folder row and the ".." row; the server's lookup routes it).
  //
  // THE ROW IS `li.row` AND NOT BARE `li` ON PURPOSE: a rendered markdown file has list items of its own,
  // and this handler used to resolve a click with `closest("li")` — which matched THOSE, so a link inside
  // a markdown list item fell into the tree branch, found no path, and returned before the link branch
  // could run: the one dead link this page had. Measured here as the fix (2026-10-26): the link in a
  // rendered list item opens, and a listing row still answers.
  const row = t && t.closest ? t.closest("li.row") : null;
  if (row) {
    const path = row.getAttribute("data-path");
    if (!path) return;
    send("open_path", { path });
    say("opening " + (row.getAttribute("data-name") || "") + "…");
    return;
  }
  // A URL FIRST (`render.ts` gives one a real href and no data-href), because it is not the server's to open.
  const ext = t && t.closest ? t.closest("a[href]") : null;
  if (ext) {
    // **AN ANCHOR CARRYING `download` IS A SAVE, NOT A LINK** (card t20261109-172208-f444; found by
    // `test/browser-test/folder_check.ts` 7h). `handToBrowser` saves a file by pressing an anchor it made —
    // `href` the blob, `download` the file's own name — and the frame branch below cancels EVERY anchor's
    // default action. So in the panel, the one place a human presses Download, the bytes arrived, the blob
    // was made, the press was cancelled, and Chrome saved NOTHING: 7h read nine megabytes in the page's own
    // record and an empty download folder. Top-level the branch returns two lines down, which is why no rig
    // that pressed Download outside the panel ever saw it. A save is the browser's act, like a link's target.
    if (ext.getAttribute("download") !== null) return;
    // TOP-LEVEL THERE IS NOTHING TO DO: the anchor's own href and target="_blank" are the browser's, and a
    // script that stepped in would be a second way to open the same tab.
    const here = globalThis.self;
    if (!here || !here.parent || here.parent === here) return;
    // IN THE PANEL'S FRAME THE TAB IS THE PANEL'S ACT: the sandbox has no allow-popups, so `open()` in here
    // returns null (MEASURED 2026-09-24), and the frame asks over the channel it already asks for a renewal
    // on. `self` is read off `globalThis` because that is how this file reaches the browser.
    e.preventDefault();
    const url = ext.getAttribute("href") || "";
    try {
      here.parent.postMessage({ type: "loom/open-url", url: url }, location.origin);
    } catch {
      // NO PARENT REACHED means no tab, so say what did not happen rather than "opening…".
      return say("could not open " + url + " — this panel refused the tab", "bad");
    }
    return say("opened " + url + " in a new tab");
  }
  const a = t && t.closest ? t.closest("a[data-href]") : null;
  if (!a) return;

  e.preventDefault();
  const href = a.getAttribute("data-href") || "";
  if (!href) {
    return say("that link is not a url this viewer may open — nothing was sent", "bad");
  }
  send("open", { href });
  say("opening " + href + "…");
});

// ── leaving with unsaved changes ────────────────────────────────────────────────────────────────────
//
// A standalone tab asks through the browser. The panel frame CANNOT ask, so the draft below is what
// survives there: show the file again and the page offers it.
addEventListener("beforeunload", (e) => {
  if (!dirty) return;
  e.preventDefault();
  e.returnValue = "";
});
// LEAVING SAYS NOTHING TO THE SERVER (2026-10-27, card 1325): there is no per-page flag to clear, so a
// closed tab has nothing to report. THE DRAFT STAYS in localStorage and is offered on the next show —
// that is the page's whole memory of unsaved work, and it needs no goodbye.

// THE PER-APP PREFIX, app:<workspace>:<app name>: — loombot's own keys live under `loom.` in this same
// origin, and one keyspace means an app could break the human's draft in loombot itself
// (tracking:apps-for-non-trivial-uis, gap G).
const draftKey = (path) => "app:" + WS + ":" + APP + ":draft:" + path;
let draftTimer = 0;
function keepDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    if (!cur) return;
    try {
      if (dirty) {
        localStorage.setItem(
          draftKey(cur.path),
          JSON.stringify({ base: cur.hash, text: ed.text(), at: Date.now() }),
        );
      } else localStorage.removeItem(draftKey(cur.path));
    } catch {
      // No storage, or over quota: the page still works, but SAYS it has no safety net.
      say("your draft could not be kept in this browser — save before you close the panel", "warn");
    }
  }, 300);
}
function dropDraft() {
  clearTimeout(draftTimer);
  try {
    if (cur) localStorage.removeItem(draftKey(cur.path));
  } catch { /* nothing to drop */ }
}
function offerDraft(d) {
  let draft = null;
  try {
    draft = JSON.parse(localStorage.getItem(draftKey(d.path)) || "null");
  } catch { /* a corrupt draft is no draft */ }
  if (!draft || typeof draft.text !== "string" || draft.text === d.text) return;
  const stale = draft.base !== d.hash;
  askBar(
    "Unsaved edits to " + d.display + " from " + new Date(draft.at).toLocaleString() +
      " survived a reload." +
      (stale ? " The file has changed on disk since — saving them will ask." : ""),
    [
      ["Restore", "put my edits back, in edit mode", async () => {
        hideBar();
        // Restored as an EDIT, so it is undoable, and on the base it was made against: if the disk moved,
        // the save is a conflict the human is shown rather than a silent overwrite. `enterEdit` is also what
        // CREATES the editor (card t20261028-022447-aa96), so a markdown draft has one to put back.
        await enterEdit();
        cur.hash = draft.base;
        ed.replace(draft.text);
      }],
      ["Discard", "forget them", () => {
        hideBar();
        dropDraft();
      }],
    ],
  );
}

// ── what the page says ──────────────────────────────────────────────────────────────────────────────

function say(text, kind) {
  const s = el("status");
  s.textContent = text || "";
  s.className = kind || "";
}
function fail(what, e) {
  say(what + ": " + (e && e.message ? e.message : e), "bad");
}
/**
 * **A DRAW THAT DIED MUST NOT LEAVE THE BOOT LINE UNDER A DRAWN HEADER** (card t20261028-033140-b374; Xiaohu:
 * "Nothing shown yet — ask loom to show you a file or a folder" appearing WITH the file's title and crumb
 * drawn above it). \`draw\` puts the title, the crumb and \`paint()\` on screen BEFORE its first await, and that
 * await is \`drawText\`'s \`ensureCode()\` = the dynamic import of \`./code.js\` — so a module that never arrives leaves
 * index.html's boot sentence in \`#view\` while the header names the file. Measured in a real Chrome, a
 * markdown frame with code.js answering 502: title "CHANGELOG.md", crumb "loom", \`#view\` still the boot
 * sentence, and the browser's own "Failed to fetch dynamically imported module … code.js" only in \`#status\`.
 *
 * The boot sentence is a fact about a page that has been shown NOTHING; here the page was shown a file and
 * could not draw it, so that sentence goes, and the reason goes in \`#notice\` — the band a file that cannot
 * be displayed already uses (drawDownload above), so one place says "this file is not on screen, and why".
 * The status line keeps the browser's exact words either way; this is the sentence where the body is.
 */
function deadDraw(what, e) {
  fail(what, e);
  // NOTHING WAS SHOWN: with no frame there is no file to blame, so the status line is the whole of it.
  if (!cur) return;
  const why = e && e.message ? String(e.message) : String(e || "the draw failed");
  notice.textContent = "This file could not be drawn: " + why;
  notice.classList.add("on");
  view.textContent = "";
  view.className = "empty";
}
function askBar(text, buttons) {
  const bar = el("bar");
  bar.textContent = "";
  const p = document.createElement("span");
  p.textContent = text;
  bar.appendChild(p);
  for (const [label, title, fn] of buttons) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.onclick = fn;
    bar.appendChild(b);
  }
  bar.classList.add("on");
}
function hideBar() {
  el("bar").classList.remove("on");
  el("bar").textContent = "";
}

// ── and then the page starts ────────────────────────────────────────────────────────────────────────
//
// THE KEPT READ IS PAINTED FIRST, and the ask follows it: a reload comes back as the file somebody was
// reading, and the read is what replaces it or confirms it. BOTH are here at the file's end, and that
// is not cosmetic: the paint goes through the page's own `draw`, whose synchronous half touches what
// the sections above declare (`view`, `list` among them), and a call from higher up would reach it in the
// declaration's temporal dead zone — which is exactly the throw the line above `fresh` warns about,
// reached one section earlier. The paint is SYNCHRONOUS as far as the header, the listing and the views;
// the text fills when the editor bundle lands, and the ask below is what replaces the paint or
// confirms it.
paintLastRead();

// LAST, and it has to be: `fresh` reads the state declared above it, and a `const` read before its own line
// has executed is a temporal-dead-zone throw rather than a page that merely failed to read.
fresh();
