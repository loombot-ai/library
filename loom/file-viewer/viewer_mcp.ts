#!/usr/bin/env -S deno run -A
/**
 * `viewer`: a loom app that shows a file, and lets the human EDIT it — markdown rendered, source in
 * CodeMirror, a PDF in the browser's own viewer, an image as an image.
 *
 *     deno run -A viewer_mcp.ts [--root <the workspace>] [--app <name>] [--page <dir>] [--log <path>]
 *                               [--save-notice-ms <n>] [--no-save-notice]
 *
 * **It registers itself, like every loom app** (`tracking:apps-register-themselves`): started by an agent
 * with `startWorker.mcp`, it finds `LOOM_BRIDGE_URL`/`LOOM_BRIDGE_TOKEN` in its environment, hands loombot
 * the page, and is told back the page URL, the socket and the credential that socket wants. The channel
 * protocol is `../building-a-loom-app/channel.ts` (`tracking:one-channel-two-apps`) — mount the viewer from
 * the library where it stands, or take that file with it.
 *
 * ## One tool
 *
 *     show({ path, readonly?, line? })   put that file on the page, revealed in front of the human
 *
 * It is the ONLY way a file gets onto the page: the page has no path box. A TEXT file is editable unless
 * `readonly: true` — the page opens in VIEW mode, **Edit** turns the same file into an editor in place,
 * **Save** writes it and goes back to view mode, and the agent is TOLD (below). There is no `save` tool:
 * the agent has its own write verbs, and a save is something the human does.
 *
 * ## Where the bytes travel
 *
 * The page — `assets/index.html`, `app.js`, `code.js` and the vendored CodeMirror bundle, all of it
 * written by `deno task build` from `src/` and `vendor/` — is the registration. A TEXT
 * file travels in the ANSWER: the frame a page's own request is answered with, `show` and `save` both, so
 * it never competes with the bundle for loombot's 16 MiB, and showing another text file re-registers only as
 * a RENAME (the tab title), which keeps loombot's version and does not reload the panel. A PDF or an image cannot travel that way — the
 * browser loads it from a URL — so it IS an asset, and a registration carrying one LEAVES OUT the bundle:
 * a PDF page never loads CodeMirror, and the PDF gets the whole cap bar the small page.
 *
 * ## The rules this server enforces, once, for both the page and the agent
 *
 *   WORKSPACE   `show` resolves through realpath and refuses anything outside `--root`.
 *   SHOWN ONLY  a save goes only to a path `show` served EDITABLE — the exact realpath. Any other path, or
 *               one shown `readonly`, is refused. The page never picks a path.
 *   CONFLICTS   the page saves with the hash it was SERVED; a base that is not the file's hash now is
 *               refused ("changed on disk since you opened it") and the page offers reload or overwrite.
 *               A base this server never served is refused too, so a page cannot claim one.
 *   ATOMIC      temp file in the same directory, the original's mode, then rename (`files.ts` saveAtomic).
 *   NOT RENDERED  BINARY, or past the 2 MiB cap: NOT a refusal, and not a truncation either — `show`
 *               ALWAYS answers a frame, and a file this viewer cannot put on the page answers the
 *               DOWNLOAD frame (`downloadable: true`, the sentence, and a token the page asks for the
 *               BYTES with, in chunks, over this same channel — cards t20261028-002834-882a and
 *               t20261028-010039-c7a2). NOT UTF-8 is still shown, decoded lossily,
 *               and NOT editable, saying why.
 *   UNSAVED     THE PAGE'S OWN (2026-10-27, card t20261027-025619-fb7e / card 1325): the page keeps the
 *               human's text, its own `dirty` flag and its own localStorage draft, says a change is
 *               waiting, and applies it at the human's pace (`building-a-loom-app/README.md`, the page
 *               contract, rule 6). THIS SERVER HOLDS NO DIRTY STATE, is told nothing per keystroke, and
 *               refuses nothing for it — the per-page flag (the tab title's `*`, the "who is holding
 *               something" sentence) was a ceremony that bought the agent a fact and cost every page a
 *               request per word. A Close ENDS THE APP: the ask is real, the tab leaves the strip, and
 *               the next `show` starts it again.
 *
 * ## The two view kinds, and the one thing a click may name (card t20261026-023551-35ae)
 *
 * `show` takes a FILE or a FOLDER. A folder publishes its LISTING — one directory, read, folders first and
 * sorted, capped at `LIST_ENTRIES` with the count of what was left out (`more`, and the sentence that
 * states the cap). A file's frame carries its CRUMB CHAIN (`crumbs`): from the root to the folder the file
 * sits in, folder names, root first, each segment one click from that folder's listing (card
 * t20261027-025619-fb7e — the file's own name is never a segment). There is no tree screen and no eager
 * walk — the folder is a showable object, and the page's own click is the only thing that opens the next
 * one. A LISTING's head names its folder root-relative, and the root names itself ("loom").
 *
 * A click sends a path back (`open_path`, ONE event for a listing row, a ".." row and a crumb segment) and
 * the LOOKUP routes it: a folder opens its listing, a file is shown by the same `showAbs` an agent's
 * `show` makes — THE PAGE OPENS IT, what was on screen is replaced, and the save notice is unchanged — so
 * a page-opened file the person then edits is announced exactly like one the agent showed.
 *
 * A CLICK IS NOT A NEW CAPABILITY. The page sends a path it was GIVEN and the server compares it against
 * what IT rendered (`files.ts` `renderedNode`, the map `renderRendered` rebuilds with every view): no
 * string from a page is ever resolved into a path here, exactly as with a save, so all a browser can name
 * is what the app already put in front of it — and a path outside `--root` is never rendered at all, so
 * the root is the security boundary at draw time and again at lookup time. A walk the click bought that
 * refuses itself (a folder gone between the click and the read) is answered with a SENTENCE where the
 * entries would be, in the human's voice because a human is the one clicking.
 *
 * ## A click on a markdown link

 *
 * A WORKSPACE PATH arrives here, and nothing else does (2026-11-02). `render.ts` draws a path as
 * `<a data-href="…">` with NO href, and this is the other half of that: a click sends the `href` here
 * (`open`) and the SERVER decides, so one rule has one owner. A relative href is resolved against the file
 * on show (its own directory) through the same realpath check `show` makes. The human is the one clicking,
 * so no turn is spent and no notice reaches the agent.
 *
 * **A URL IS THE PAGE'S OWN NOW, and the branch below is a guard rather than a door.** `render.ts` gives a
 * url a real `href` with `target="_blank"`; inside the panel the page hands the press to the PANEL
 * (`loom/open-url`, client/conversation.js), which opens a tab of the real browser — the one destination a
 * sandboxed frame cannot reach for itself. So a url reaching THIS function is a page older than the rule,
 * and it is refused in one sentence instead of the paragraph it used to be.
---PATCH /Users/xxie/Workspace/loom/.loom/worktrees/viewer-links/loom/library/file-viewer/viewer_mcp.ts
---OLD
  if (SCHEME.test(probe) || raw.startsWith("//")) {
    throw new Refused(
      raw +
        " is a URL, not a file in this workspace. This viewer opens files in the workspace, so " +
        "there is nothing here to open it with — and a press on it would take this frame away from " +
        "the app, with no way back. The URL itself is in the file on show, which is where it can be " +
        "copied from.",
    );
  }
---NEW
  if (SCHEME.test(probe) || raw.startsWith("//")) {
    // ONE SENTENCE, AND IT SAYS WHERE THE URL GOES. The paragraph this replaced explained, at length, a
    // refusal a person could do nothing with — and the page had already promised them a link. A url is the
    // page's own now (its anchor has an `href`; the panel opens the tab), so arriving here means a page
    // older than this rule, and the sentence says the true thing rather than arguing for it.
    throw new Refused(raw + " is a URL, not a file in this workspace — the page opens one in a new tab.");
  }
 *
 * ## The agent is told when the human saves
 *
 * `notifications/app/saved`: pressing **Save** sends it at once; a run of Cmd/Ctrl-S's (which stay in edit
 * mode) is one notice per burst (`--save-notice-ms`, default 3000), naming the path and the +/- lines.
 * It exists so the agent does not later overwrite the human's edit from a stale read, and it costs a TURN
 * when the agent is idle — that is the price and the point.
 */

import { renderDoc } from "./render.ts";
import { type Download, DOWNLOAD_SENTENCE, downloadRoute } from "./download.ts";
import {
  Conflict,
  inlineImages,
  lineDelta,
  listDir,
  type ListingEntry,
  MAX_FILE_BYTES,
  moreNote,
  readForShow,
  refusalText,
  Refused,
  type Rendered,
  renderedNode,
  resolveInWorkspace,
  saveAtomic,
  toBase64,
  Undisplayable,
} from "./files.ts";

import {
  bridgeFromEnv,
  captureConsole,
  channel,
  logFile,
  openLog,
} from "../building-a-loom-app/channel.ts";

// ── flags, paths, log ────────────────────────────────────────────────────────────────────────────────

const enc = new TextEncoder();

function flag(name: string): string | undefined {
  const i = Deno.args.indexOf("--" + name);
  return i >= 0 && i + 1 < Deno.args.length ? Deno.args[i + 1] : undefined;
}

const APP = flag("app") ?? "viewer";
/**
 * THE PAGE THE BROWSER GETS: `assets/` beside this file, and it is BUILD OUTPUT rather than source.
 *
 * The app is split the way the owner asked on 2026-11-09 — `src/` is what a person writes, `assets/` is
 * what `deno task build` made, and loombot is handed the second one (an app's `--dir` IS its browser
 * assets; loom has no opinion about a layout, so nothing in the harness changed for this). What that buys
 * here is not a smaller download — the 735 KB CodeMirror bundle is 81% of the page and was already
 * minified — it is the page a PDF or an image is registered in, which is every byte BUT the bundle and
 * therefore `PAGE_LITE` and the PDF's room: 177,574 B hand-written became 74,197 B built, and the ~103 KB
 * that came off is 103 KB more PDF the panel can hold. The numbers are the build's own table.
 *
 * A directory that is not this one is what `--page` is for: a test serves a page it has just built.
 */
const PAGE_DIR = flag("page") ??
  decodeURIComponent(new URL("./assets/", import.meta.url).pathname);
/**
 * THE ONLY TREE THIS APP WILL READ OR WRITE. `Deno.cwd()` is the agent's workdir — loom spawns an MCP
 * server there — so the default is "the workspace you are working in" and nothing else.
 */
const ROOT = await Deno.realPath(flag("root") ?? Deno.cwd());
const LOG_FILE = flag("log") ?? logFile("viewer", APP);
const logLine = openLog(LOG_FILE);

/** WHERE A RESTART COMES BACK TO (Xiaohu, 2026-10-27: folding the panel and reopening it showed the boot
 * page, because a fresh viewer had nothing on show and answered `ready` with an empty frame). The path
 * of the last successful show is written beside the log; startup reads it back, so a restarted app
 * shows what it was showing instead of asking the human to start again. It is a HINT, never a fact: a
 * read that refuses at startup is dropped and the app starts empty, exactly as before. */
const LAST_FILE = LOG_FILE.slice(0, LOG_FILE.lastIndexOf("/")) + "/last-shown-" +
  ROOT.replace(/[^A-Za-z0-9]+/g, "_").slice(-60) + ".txt";
async function rememberShown(path: string): Promise<void> {
  try {
    await Deno.writeTextFile(LAST_FILE, path + "\n");
  } catch { /* a log directory that will not take it costs one restore, never a show */ }
}
async function lastShown(): Promise<string | null> {
  try {
    const text = (await Deno.readTextFile(LAST_FILE)).trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

// STDOUT IS THE PROTOCOL: a stray console.log corrupts the JSON-RPC stream, so every console verb writes
// to the log file instead. Done before anything that could print.
captureConsole(logLine);

const SAVE_NOTICE = !Deno.args.includes("--no-save-notice");
const SAVE_NOTICE_MS = Number(flag("save-notice-ms") ?? 3000);

// ── the caps, which are loombot's and are stated here so a refusal can name them ────────────────────────
//
// Duplicated from `loombot/registered.ts` on purpose: an app is an MCP server that may be running against a
// loombot it does not import, so this is this server's BELIEF about the limit, used to refuse early with a
// sentence that names a size. loombot enforces the real one.
/**
 * *** THIS IS NOT `loombot/registered.ts`'s `MAX_APP_BYTES`, AND BOTH WERE CALLED THAT UNTIL 2026-10-20 - WHICH
 * IS HOW ONE MESSAGE CAME TO PRINT "2097152 bytes (16 MiB)" AND ONE TEST CAME TO PROVE THIS APP WOULD MOUNT
 * A PAGE EIGHT TIMES OVER ITS OWN LIMIT. *** loombot's holds a whole registration and is 16 MiB; this one is the
 * page the viewer will mount, and it is what `BUDGET` and the mount-time check below are derived from. The
 * name now says whose it is so the collision cannot come back.
 */
export const VIEWER_MAX_APP_BYTES = 2 * 1024 * 1024;
/** Room for the manifest's own JSON overhead. */
const RESERVE = 4 * 1024;
/** The page file a PDF or an image registration leaves out — the one thing only a text file needs. */
const BUNDLE = "codemirror.js";

const kib = (n: number): string =>
  n < 1024
    ? n + " B"
    : n < 1024 * 1024
    ? (n / 1024).toFixed(1) + " KiB"
    : (n / 1048576).toFixed(2) + " MiB";

// ── the page's assets, read once ─────────────────────────────────────────────────────────────────────

type Asset = string | { base64: string };

/** Everything in `page/` but dotfiles and `.ts` — the same rule registration applies. */
async function pageAssets(dir: string): Promise<Record<string, Asset>> {
  const out: Record<string, Asset> = {};
  const walk = async (rel: string): Promise<void> => {
    for await (const e of Deno.readDir(rel ? dir + "/" + rel : dir)) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const path = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory) {
        await walk(path);
        continue;
      }
      if (!e.isFile || e.name.endsWith(".ts")) continue;
      const bytes = await Deno.readFile(dir + "/" + path);
      const ext = e.name.slice(e.name.lastIndexOf(".") + 1);
      out[path] = ["html", "js", "css", "json", "svg", "txt", "md"].includes(ext)
        ? new TextDecoder().decode(bytes)
        : { base64: toBase64(bytes) };
    }
  };
  await walk("");
  if (!out["index.html"]) {
    throw new Error(dir + ": no index.html, which is the file the page loads");
  }
  return out;
}

const sizeOf = (v: Asset): number =>
  typeof v === "string" ? enc.encode(v).byteLength : atob(v.base64).length;
const PAGE = await pageAssets(PAGE_DIR);
const PAGE_BYTES = Object.values(PAGE).reduce((n, v) => n + sizeOf(v), 0);
/** The page a PDF or an image is shown in: everything but the bundle. */
const PAGE_LITE = Object.fromEntries(Object.entries(PAGE).filter(([k]) => k !== BUNDLE));
const LITE_BYTES = Object.values(PAGE_LITE).reduce((n, v) => n + sizeOf(v), 0);
/** What is left for a PDF or an image, once the page it is shown in has been paid for. */
const BUDGET = VIEWER_MAX_APP_BYTES - LITE_BYTES - RESERVE;

// ── what is currently on show ────────────────────────────────────────────────────────────────────────

/** The kinds a browser loads from a URL, by extension. Everything else is read as text. */
const BY_URL: Record<string, { kind: "pdf" | "image"; mime: string }> = {
  pdf: { kind: "pdf", mime: "application/pdf" },
  png: { kind: "image", mime: "image/png" },
  jpg: { kind: "image", mime: "image/jpeg" },
  jpeg: { kind: "image", mime: "image/jpeg" },
  gif: { kind: "image", mime: "image/gif" },
  webp: { kind: "image", mime: "image/webp" },
};

/** The descriptor the page draws from, pushed as the `show` frame. */
interface Current {
  kind: "empty" | "markdown" | "code" | "pdf" | "image" | "listing" | "download";
  /** The realpath — the only path a save may name. */
  abs: string;
  /** Workspace-relative, which is what a human recognises. */
  path: string;
  /** A PDF's or an image's asset name; "" for text. */
  asset: string;
  mime: string;
  bytes: number;
  lines: number;
  /** A text file only: what the page shows (and edits), and the hash of the bytes it came from. */
  text: string;
  hash: string;
  /** "" when the human may edit it; otherwise the reason, which the page prints beside a missing Edit. */
  noEdit: string;
  /** The agent's `readonly: true`, kept so a reload of the page re-reads the file the same way. */
  readonly: boolean;
  /**
   * THE BYTES OF A FILE THIS VIEWER CANNOT RENDER (card t20261028-002834-882a): the ONE thing on the
   * frame that the old gating branches were — a `downloadable: true` frame carries this and nothing to
   * draw, so the page ASKS FOR THE BYTES instead of pretending to render. Absent on every other kind.
   * A TOKEN and a size, never a URL and never a path (`download.ts`).
   */
  download?: Download;
  /** Where the agent asked for the caret; kept so a reload of the frame lands there too. */
  line: number | null;
  /**
   * MARKDOWN ONLY, and computed once per read: the rendering every frame of this file carries, with the
   * pictures it names already inlined, and the ids its headings were given — which is what a `#fragment`
   * is checked against (`renderDoc`, `markdownOf`). null for anything that is not markdown.
   */
  rendered: { html: string; ids: string[] } | null;
  /**
   * A LISTING ONLY (card t20261026-023551-35ae): the folder IS a showable object, and these are the three
   * facts its frame is made of — the entries as drawn (sorted, capped), how many the cap left out, and
   * the sentence a refused walk shows where the entries would be. Absent on every other kind.
   */
  entries?: ListingEntry[];
  more?: number;
  note?: string;
}

const EMPTY: Current = {
  kind: "empty",
  abs: "",
  path: "",
  asset: "",
  mime: "",
  bytes: 0,
  lines: 0,
  text: "",
  hash: "",
  noEdit: "",
  readonly: false,
  line: null,
  rendered: null,
};
let current: Current = EMPTY;
/** The bytes of a PDF or an image on show: one entry, replaced on every show. */
let urlAsset: Record<string, Asset> = {};
/**
 * THE BYTES OF A FILE THIS VIEWER CANNOT RENDER — `download.ts` for the whole of it: the token, the chunks,
 * and the one-at-a-time rule. It listens on NOTHING (card t20261028-010039-c7a2): the page asks for the
 * bytes over this app's own channel, which is the one carriage a relayed page can reach, so there is no
 * port held open and nothing to stop in `shutdown`.
 */
const download = downloadRoute({ log: (line) => logLine(line) });
/**
 * Every file `show` served EDITABLE, with every hash this server SERVED or WROTE for it. Its KEYS are the
 * only paths a save may name, and its values the only bases a save may claim. A file shown `readonly` (or
 * not editable) is taken OUT: the agent's latest word on a path is the one that counts.
 */
const served = new Map<string, Set<string>>();
/**
 * WHAT THIS APP HAS PUT IN FRONT OF THE PERSON — path to what that path was (`files.ts` `Rendered`,
 * `renderedNode`) — `served`'s twin, and the same rule: a page's word is only ever COMPARED against what
 * this app itself produced, never resolved into a path. Rebuilt with EVERY view this app puts on the page
 * (`renderRendered` below), because what the page may click is what is IN FRONT OF THE PERSON: a path
 * from an older view is not in the map, however real it is on disk.
 */
const rendered = new Map<string, Rendered>();
/**
 * EVERY PATH THIS APP HAS PUT IN FRONT OF THE PERSON — file or folder, one entry per path — and the only
 * map a BACK is checked against (card t20261105-225359-8b14).
 *
 * `rendered` above answers "what may a CLICK name", and it is rebuilt with every view: a row, a crumb and a
 * ".." row are things the person is LOOKING AT. Back asks a different question — it names a view this page
 * WAS at — and a view is a file as often as it is a folder. Measured 2026-11-05 in real Chrome against this
 * build: the walk `walk-a.md` → link → `walk-b.md` → link → `walk-c.md`, then Back twice, left the page on
 * `walk-c.md` BOTH times with Back still enabled — the previous view was the FILE walk-b.md, which the
 * current view's map does not hold, so the app refused its own history as a stale click.
 *
 * So the paths this app has DRAWN are kept for its life, exactly like `served` (its twin: same rule, the
 * page's word compared against what the app produced and never resolved into a path; one difference, this
 * map only grows). It is consulted for `back` and for nothing else: an ordinary click still reads
 * `rendered`, because a ROW that names a path from an older view is still not a click.
 */
const drawn = new Map<string, Rendered>();

/**
 * REBUILD THE MAP FROM WHAT IS ON SHOW — the whole security model in five lines. A listing records its
 * entries and the folder it is in; a file records itself and EVERY SEGMENT OF ITS CRUMB, which is what a
 * crumb click is FOR. Nothing else is ever in the map, so a
 * click can never name a path the person was not already looking at — and nothing outside `--root` can
 * ever be in it, which is what makes the root the security boundary at draw time as well as at lookup
 * time.
 */
function renderRendered(): void {
  rendered.clear();
  if (current.kind === "listing") {
    // THE WAY UP IS THE CRUMB (card t20261108-084109): the ancestors below are the clicks out of a listing,
    // and there is no ".." row to mark — a folder with no inside-work is a listing whose chain is all there is.
    for (const e of current.entries ?? []) rendered.set(e.path, { dir: e.dir });
    // AND THE CRUMB'S ANCESTORS, which a listing draws now: every one of them but the last is a click to
    // that folder. The last is where the person already is and the page makes it inert — it is in the map
    // all the same, because a frame that is not clickable and a path that is not rendered are two facts,
    // and this map answers the second.
    for (const c of crumbChain(current.abs, true)) rendered.set(c.path, { dir: true });
  } else if (current.kind !== "empty") {
    rendered.set(current.abs, { dir: false });
    for (const c of crumbChain(current.abs)) rendered.set(c.path, { dir: true });
  }
}

/**
 * THE LISTING NOW ON SHOW: the folder read (`listDir`), and a walk that refused becomes a SENTENCE where
 * the entries would be rather than a failed show — a folder that vanished between the click and the read
 * still puts its listing on the page, with the reason in it.
 */
async function listNow(abs: string): Promise<Current> {
  const base: Current = {
    ...EMPTY,
    kind: "listing",
    abs,
    // THE HEAD NAMES WHERE YOU ARE, and the root names ITSELF: `rel(ROOT)` is the absolute path, and a
    // listing is the one place a person reads that name (`shownPath`).
    path: shownPath(abs),
  };
  try {
    const walk = await listDir(abs, ROOT);
    return { ...base, entries: walk.entries, more: walk.more, note: "" };
  } catch (e) {
    return { ...base, entries: [], more: 0, note: refusalText(e, "human") };
  }
}

const remember = (abs: string, hash: string): void => {
  const s = served.get(abs) ?? new Set<string>();
  s.add(hash);
  served.set(abs, s);
};
const rel = (
  abs: string,
): string => (abs.startsWith(ROOT + "/") ? abs.slice(ROOT.length + 1) : abs);
const baseName = (abs: string): string => abs.slice(abs.lastIndexOf("/") + 1);
const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/**
 * A `#fragment` as an id: DECODED, because that is what a browser does before it looks an anchor up, and
 * left alone when its %-escapes do not decode (then it simply matches no id).
 */
const fragId = (frag: string): string => {
  try {
    return decodeURIComponent(frag);
  } catch {
    return frag;
  }
};

/** The directory a file is in — the base a relative LINK or PICTURE inside it resolves against. */
const dirOf = (abs: string): string => abs.slice(0, abs.lastIndexOf("/"));

/**
 * A PATH AS A PERSON READS IT. `rel` is right for everything UNDER the root — but the ROOT ITSELF has no
 * root-relative spelling, so `rel(ROOT)` is the ABSOLUTE path, which is what put "/Users/xxie/Workspace/
 * loom" in the listing's head on Xiaohu's phone (2026-10-27, card t20261027-025619-fb7e). The root reads
 * as its BASENAME: the security boundary a person is standing at is named "loom", not by where it happens
 * to live on this machine.
 */
const shownPath = (abs: string): string => (abs === ROOT ? baseName(ROOT) : rel(abs));

/**
 * THE CRUMB CHAIN: from the app's `--root` down, ROOT FIRST and named by its basename, one segment per
 * folder (card t20261027-025619-fb7e). For a FILE it stops at the folder the file sits in — the FILE is
 * never a segment: the header's title is the file, and a crumb carrying its name was the doubled title
 * Xiaohu photographed. For a LISTING (`self`) it ends at the folder itself, because that is what is on
 * show (card t20261028-002834-882a). A file AT the root gets the one-segment chain ("loom").
 *
 * WHAT IS INERT IS NOT DECIDED HERE. The frame carries the chain; the PAGE draws every segment and makes
 * inert the one whose path is the thing on show — so "where you already are" is one rule for both views
 * rather than two callers agreeing about which segment is last.
 */
function crumbChain(abs: string, self = false): { name: string; path: string }[] {
  const dir = self ? abs : dirOf(abs);
  const chain = [{ name: baseName(ROOT), path: ROOT }];
  const rest = dir === ROOT ? "" : dir.startsWith(ROOT + "/") ? dir.slice(ROOT.length + 1) : "";
  let at = ROOT;
  for (const part of rest.split("/")) {
    if (!part) continue;
    at = at + "/" + part;
    chain.push({ name: part, path: at });
  }
  return chain;
}

/**
 * A MARKDOWN FILE AS A FRAME CARRIES IT: the rendering, and the ids its headings were given — from the
 * same walk, so a `#fragment` and an `id` can never be two spellings of one rule (`render.ts`).
 *
 * THE PICTURES IT NAMES ARE FILLED IN HERE, because the page cannot read the workspace: a relative `src`
 * sent to the browser is a request to LOOMBOT, which has never heard of a file that lives in the workspace
 * (`inlineImages`). Done once per read, so every frame of this file carries the same html.
 */
async function markdownOf(abs: string, text: string): Promise<{ html: string; ids: string[] }> {
  const doc = renderDoc(text);
  return { html: await inlineImages(doc.html, dirOf(abs), ROOT), ids: doc.ids };
}

/** A text file as the page gets it. `readonly` is the agent's opt-out; the reader's refusals are its own. */
async function textCurrent(abs: string, readonly: boolean, line: number | null): Promise<Current> {
  const d = await readForShow(abs);
  const ext = baseName(abs).split(".").pop()?.toLowerCase() ?? "";
  const noEdit = d.noEdit ||
    (readonly
      ? "read-only: the agent showed this file with readonly, so it is not for editing here."
      : "");
  if (noEdit) served.delete(abs);
  else remember(abs, d.hash);
  const markdown = ext === "md" || ext === "markdown";
  return {
    kind: markdown ? "markdown" : "code",
    abs,
    path: rel(abs),
    asset: "",
    mime: "",
    bytes: d.bytes,
    lines: d.lines,
    text: d.text,
    hash: d.hash,
    noEdit,
    readonly,
    line,
    // MARKDOWN IS RENDERED ONCE, HERE. A code file is never rendered — it has no html and no anchors.
    rendered: markdown ? await markdownOf(abs, d.text) : null,
  };
}

/** A PDF or an image: its bytes as the one asset — or, past what a registration can carry, `Undisplayable`. */
async function urlCurrent(
  abs: string,
  t: { kind: "pdf" | "image"; mime: string },
): Promise<{ cur: Current; asset: Record<string, Asset> }> {
  const size = (await Deno.stat(abs)).size;
  const path = rel(abs);
  // **A PICTURE OR A PDF PAST THIS APP'S BUDGET IS NOT A REFUSAL ANY MORE** (card t20261028-002834-882a).
  // Its bytes cannot be cut short and a registration cannot carry them, so the page is offered the
  // download — which is the one true answer for both kinds this branch used to turn away.
  if (size > BUDGET) {
    throw new Undisplayable(
      "too big to render: " + kib(size) + ", and this app can carry at most " + kib(BUDGET) +
        " of one file in a registration — download it to open it",
      size,
    );
  }
  served.delete(abs);
  const name = t.kind === "pdf"
    ? "doc.pdf"
    : "img." + (baseName(abs).split(".").pop() ?? "").toLowerCase();
  return {
    asset: { [name]: { base64: toBase64(await Deno.readFile(abs)) } },
    cur: { ...EMPTY, kind: t.kind, abs, path, asset: name, mime: t.mime, bytes: size },
  };
}

/**
 * A FILE THIS VIEWER CANNOT PUT ON THE PAGE, as the frame that says so. It replaces three branches — a
 * refused PDF, a picture past the cap, a truncated text file — with ONE answer: what it is, how big, why
 * it cannot be rendered (where a no-edit reason goes), and the URL its BYTES are served at.
 */
function downloadCurrent(abs: string, e: Undisplayable): Current {
  // NOT EDITABLE, SO NOT IN `served`: the set of paths a save may name holds nothing that cannot be edited.
  served.delete(abs);
  return { ...EMPTY, abs, path: rel(abs), ...download.view(abs, e.reason, e.bytes) };
}

/**
 * WHAT A PATH IS, AS A FRAME — the ONE place the kind is decided, and `show` and a page's `reload` both ask
 * it. A PDF or a picture travels as an asset, text as text, and a file this viewer cannot render as the
 * DOWNLOAD frame: `Undisplayable` is caught HERE, so no caller can turn it back into a refusal.
 */
async function readCurrent(
  abs: string,
  opts: { readonly: boolean; line: number | null },
): Promise<{ cur: Current; asset: Record<string, Asset> }> {
  const ext = baseName(abs).split(".").pop()?.toLowerCase() ?? "";
  const byUrl = BY_URL[ext];
  try {
    return byUrl
      ? await urlCurrent(abs, byUrl)
      : { cur: await textCurrent(abs, opts.readonly, opts.line), asset: {} };
  } catch (e) {
    if (!(e instanceof Undisplayable)) throw e;
    return { cur: downloadCurrent(abs, e), asset: {} };
  }
}

/** The frame the page draws from. Markdown carries its RENDERING too: view mode is the rendered page. */
function showFrame(cur: Current, extra: Record<string, unknown> = {}): Record<string, unknown> {
  // `rendered` is left out of `rest`: the frame carries its HTML and nothing else of it (and the ids it
  // also holds are the SERVER's business — the page scrolls to an id, it never checks one). A listing's
  // three fields go the same way: `listingFrame` is the frame builder for that kind, and no file frame
  // carries them.
  const { abs: _abs, rendered, entries: _e, more: _m, note: _n, ...rest } = cur;
  return {
    ...rest,
    path: cur.abs,
    display: cur.path,
    // loombot's version of the registration this frame describes: a PDF's src carries it, so showing
    // another PDF navigates the <iframe> (the same src would not).
    version: ch.version(),
    editable: (cur.kind === "code" || cur.kind === "markdown") && !cur.noEdit,
    // The html was rendered when the file was READ, not here: a frame is drawn many times (a page
    // arriving, a reload, a retitle) and rendering is not what a frame does.
    ...(rendered ? { html: rendered.html } : {}),
    // **A FILE THAT CANNOT BE RENDERED IS A FRAME LIKE ANY OTHER** (card t20261028-002834-882a): the
    // sentence, and the TOKEN the same read can be asked for the bytes of (`download.ts`). This is the
    // whole of what the page needs to offer a Download instead of a refusal.
    // **EVERY FILE OFFERS THE DOWNLOAD** (2026-10-27): a rendered PDF or markdown is still worth saving,
    // so the action is not a consolation prize for the undisplayable — it is on every file frame. The
    // sentence stays the download frame's own (a file that cannot be rendered says so).
    ...(cur.abs && cur.kind !== "listing" && cur.kind !== "empty"
      ? {
        downloadable: true,
        ...(cur.download ? { note: DOWNLOAD_SENTENCE } : {}),
        download: cur.download ?? download.offer(
          cur.abs,
          cur.abs.slice(cur.abs.lastIndexOf("/") + 1),
          (() => {
            try {
              return Deno.statSync(cur.abs).size;
            } catch {
              return 0;
            }
          })(),
        ),
      }
      : {}),
    // THE CRUMB TRAVELS WITH WHAT IS ON SHOW (cards t20261027-025619-fb7e and t20261028-002834-882a):
    // the chain from the root to the folder the file sits in, folder NAMES, root first — never the file's
    // own name. The page works out no path of its own: these are the whole of what its crumb may send.
    ...(cur.abs ? { crumbs: crumbChain(cur.abs) } : {}),
    ...extra,
  };
}

/**
 * THE FRAME A FOLDER ON SHOW DRAWS FROM. Same shape as a file's `show` frame — kind, path, display,
 * version — with the entries where the text would be, FOLDERS FIRST and sorted (`listDir` did both). NO ".."
 * ROW (card t20261108-084109): the crumb IS the way up, every ancestor segment above being a click to that
 * folder, and a second control for one move is the duplication Xiaohu pointed at. The walk's own sentence
 * (`note`) and the cap's (`moreNote`) are the server's words, drawn verbatim.
 */
function listingFrame(cur: Current, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const entries = [...(cur.entries ?? [])];
  const more = cur.more ?? 0;
  return {
    kind: "listing",
    path: cur.abs,
    display: cur.path,
    version: ch.version(),
    editable: false,
    noEdit: "",
    entries,
    ...(more > 0 ? { more, moreNote: moreNote(more) } : {}),
    note: cur.note ?? "",
    // **THE CRUMB IS ONE RULE, IN BOTH VIEWS** (card t20261028-002834-882a): a listing carries the chain
    // too, and it ends at ITSELF. The page draws every segment and makes inert the one that names where
    // the person already is — which is why nothing here says "last": the page compares, and one rule
    // decides both views.
    crumbs: crumbChain(cur.abs, true),
    ...extra,
  };
}

/**
 * PUT A FOLDER ON THE PAGE — the twin of `showAbs`, one caller per door and no third (the agent's
 * `show`, a click in the page, a link that names a folder). The registration is the same page bytes, so
 * showing a folder is a RENAME at loombot (no version move, no reload), the parts move, and the answer is
 * the listing frame every page draws.
 */
async function showListing(abs: string, opts: { by: string }): Promise<string> {
  const path = rel(abs);
  const was = current;
  current = await listNow(abs);
  try {
    await register(true);
  } catch (e) {
    current = was;
    throw new Refused("could not show " + path + ": " + why(e) + " — nothing changed.");
  }
  // **THE VIEW ON SHOW CHANGED, AND THAT MOVES THE NUMBER** — after the registration landed, so a
  // rollback above never bumps a number no page was told about, and before the push below. TWO parts:
  // what is on screen (`shown`) and the listing that was just rebuilt (`listing`). No `file` and no
  // `cursor` moved — no file did.
  moved("shown", "listing");
  renderRendered();
  // A FOLDER IS A PLACE TO COME BACK TO (see `drawn`): the map a Back is checked against.
  drawn.set(current.abs, { dir: true });
  ch.toBrowsers("show", listingFrame(current, { by: opts.by }));
  const entries = current.entries ?? [];
  const facts = [entries.length + (entries.length === 1 ? " entry" : " entries")];
  if (current.more) facts.push((current.more as number) + " more");
  if (current.note) facts.push("refused: see the page");
  return "showing the folder " + path + " (" + facts.join(", ") + ") at " + ch.page() +
    " — version " + ch.version() + pageNote(ch.watching());
}

/**
 * HAS A PAGE EVER BEEN HERE, as the sentence at the end of a `show` says it — and it is ONE judgement, in
 * ONE place (t20261009-193432-d5f1).
 *
 * It used to be `toBrowsers`'s return value, which answers a DIFFERENT question: was there a socket to
 * loombot to push on. The channel redials, so that false is a fact about the SOCKET and nothing about a
 * browser — the sentence was quiet when nobody was looking (socket up, no page: exactly the case it
 * exists for) and loud when a page was watching a channel that had blinked. `watching()` is the one answer
 * now, and it has TWO: a page has spoken, or nothing ever has — which is UNKNOWN, and is said as itself
 * rather than as "nobody" (the same two `state()` reports, `app_mcp.ts`).
 *
 * **"NO PAGE IS OPEN" IS GONE WITH THE STATE THAT SAID IT** (card t20261024-022904-fb60). A page used to
 * hold a socket, so loombot saw the last one leave and closed the player with a 1000 the channel read as
 * "nobody is looking"; a page is a request now and loombot counts none, so nothing can ever say the last one
 * went. A sentence for that state could only ever be printed for a state that cannot happen.
 */
function pageNote(seen: true | undefined): string {
  if (seen === true) return "";
  return ". No page has spoken to this app yet: it will show this file as soon as one connects.";
}

// ── the save notice ──────────────────────────────────────────────────────────────────────────────────

interface Burst {
  before: string;
  after: string;
  lines: number;
  saves: number;
  forced: boolean;
  timer?: ReturnType<typeof setTimeout>;
}
const bursts = new Map<string, Burst>();

export function savedText(
  app: string,
  path: string,
  d: { added: number; removed: number },
  lines: number,
  saves: number,
  forced: boolean,
): string {
  return 'app "' + app + '": the human SAVED ' + path + " in the viewer (+" + d.added + " −" +
    d.removed + " lines, now " + lines + " lines" + (saves > 1 ? ", " + saves + " saves" : "") +
    ")" +
    (forced ? ", OVERWRITING a change on disk they were shown" : "") +
    ". Anything you read of this file before now is stale: re-read it before you edit it, or your write " +
    "will undo theirs.";
}

function sendNotice(abs: string): void {
  const b = bursts.get(abs);
  if (!b) return;
  clearTimeout(b.timer);
  bursts.delete(abs);
  const d = lineDelta(b.before, b.after);
  const path = rel(abs);
  ch.notify("notifications/app/saved", {
    app: APP,
    path,
    abs,
    added: d.added,
    removed: d.removed,
    lines: b.lines,
    saves: b.saves,
    forced: b.forced,
    text: savedText(APP, path, d, b.lines, b.saves, b.forced),
  });
}

/** One notice per burst of Cmd-S's; `now` (the Save button: the edit is DONE) sends it at once. */
function noteSave(
  abs: string,
  before: string,
  after: string,
  lines: number,
  forced: boolean,
  now: boolean,
): void {
  if (!SAVE_NOTICE) return;
  const had = bursts.get(abs);
  if (had) clearTimeout(had.timer);
  const b: Burst = had
    ? { ...had, after, lines, saves: had.saves + 1, forced: had.forced || forced }
    : { before, after, lines, saves: 1, forced };
  bursts.set(abs, b);
  if (now) return sendNotice(abs);
  b.timer = setTimeout(() => sendNotice(abs), SAVE_NOTICE_MS);
}

// ── the channel ──────────────────────────────────────────────────────────────────────────────────────

const bridge = bridgeFromEnv();

const ch = channel({
  app: APP,
  log: logLine,
  bridge,
  // A PDF or an image rides as an asset in a page WITHOUT the bundle; a text file rides in the frames the
  // page draws, which is why the registration is the same bytes for every text file.
  files: () => (current.kind === "pdf" || current.kind === "image"
    ? { ...PAGE_LITE, ...urlAsset }
    : PAGE),
  onFrame,
  // NO `notifyWhenIdle` AND NO `idleHint` HERE (2026-10-20). They are deleted from `channel.ts` with the
  // refusal this app's hook existed to back up: the hook dropped the dirty flags when the last browser
  // left, so that a page which crashed without sending `gone` could not refuse the agent's `show` for

  // ever. Nothing refuses now, so nothing needs backing up.
  // The channel's own endings — the dial ladder and the re-registration ladder it hands over to — write
  // the channel's own sentences, which name the recovery and the verb, so nothing is overridden here.
  // The channel's own endings — the dial ladder, and the exit a loombot that stays gone ends with — write
  // the channel's own sentences, which name what happened and the verb, so nothing is overridden here.
});
const { reply, send, toolResult } = ch;

/**
 * THE VIEWER'S PARTS, AND THE ONE PLACE THEY MOVE (card t20261024-061052-2740).
 *
 *     listing  the folder view — a listing's entries, or the breadcrumb folder of a shown file — rebuilt
 *              by `listNow`/`renderRendered`
 *     file     the path and its text — what a `show` or a save changed
 *     cursor   where the cursor sits — the line a `show` or a link asked for
 *     shown    which file is on screen — the app's one fact, as the pointer is the board's
 *
 * A page reads the parts it is DRAWING among these names and nothing else, so this list is the whole
 * vocabulary between this app and its page: a name no page has ever heard of is READ (`README.md`, rule 7),
 * which is the safe direction for a page older than its app, and a name omitted from a change costs the
 * page a read rather than an update.
 *
 * EVERY CALL IS AT A MOMENT THE VIEWER'S STATE CHANGED — never on a read: `ready` and `reload` read the
 * file from disk and change nothing, so they name nothing, and a page that asked has its answer already.
 */
const moved = (...which: string[]): void => {
  ch.touched();
  ch.named(...which);
};

/**
 * THE TAB LABEL: just the file, `main.tex` — no `*`: the page's buffer is the page's own and is reported
 * nowhere (2026-10-27, card 1325). Not
 * `viewer • main.tex` any more (unified-panels (c), 2026-09-27): loombot labels a tab `title || name` at every
 * width and names the app in the tab's tooltip, so the prefix only cost width -- most of a phone's tab. An
 * empty viewer has no file, so its label is its name.
 */
/**
 * A TAB LABEL IS 64 CHARACTERS, AND THAT CAP IS LOOMBOT'S, NOT OURS (`loombot/apps.ts`, `MAX_APP_TITLE`).
 * The strip is what a long label wrecks -- one tab reading a paragraph pushes every other app off it --
 * and loombot REFUSES a longer title rather than cutting it, because a label that came back shorter than
 * the app asked for looks like a bug in the strip. The label here is the FILE'S OWN NAME, so a long one
 * is ordinary and the cut is ours to make: on 2026-10-09 that refusal was the whole symptom, since
 * `show` on a task card whose file name is 72 characters failed to register and the file would not open.
 *
 * BOTH ENDS ARE KEPT, with the ellipsis between them: the head identifies the file (a task card's id
 * sits at its front) and the tail carries the extension. The full path stays on the page, which is where
 * a person looks when the label is not enough -- so nothing is lost by cutting the label.
 */
const MAX_TITLE = 64;

/** The label, cut to `max` characters: head, an ellipsis, tail. */
function shorten(name: string, max: number): string {
  if (name.length <= max) return name;
  const room = max - 1;
  const head = Math.ceil(room / 2);
  return name.slice(0, head) + "\u2026" + name.slice(name.length - (room - head));
}

function titleNow(): string {
  if (current.kind === "empty") return APP;
  return shorten(baseName(current.abs), MAX_TITLE);
}

/** Registrations one at a time: a reveal and a retitle racing would each send a stale title. */
let regTail: Promise<unknown> = Promise.resolve();
/**
 * THE TITLE THE BRIDGE HAS BEEN TOLD — or is being told RIGHT NOW, while a registration is in flight.
 *
 * ASSIGNED BEFORE `ch.register` IS AWAITED, NEVER AFTER IT (t20261019-000143-f36c). Assigning it after
 * the answer arrived made `retitle`'s guard compare a change against a title that no longer held, so a
 * change arriving inside that round-trip was DROPPED — no registration, no frame, no error, no log — and
 * the label stayed wrong until some later change happened to register again. That is why `tests/poll.ts`'s
 * default went to 60s, and why `app_viewer_edit_test.ts` burned a whole ceiling twice on one wait
 * (20005ms/1644 polls on 2026-10-09, 60002ms/4944 on 2026-10-18) while nothing was ever slow.
 */
let sentTitle = "";
/**
 * `reveal` is "put this in front of the human now": FALSE at boot and on a retitle, TRUE on every show —
 * `show({path})` is a person having asked to see a file, the one push that may mount the panel.
 *
 * THE GUARD IS HERE, WHERE THE TITLE IS READ — not in `retitle`, which could only compare a title it
 * GUESSED a later body would send against a `sentTitle` that might still be in flight. Bodies run one at
 * a time (`regTail`), so `titleNow()` here is the state at the moment of sending and `sentTitle` is the
 * title of the last attempt, settled or in flight. Every change therefore ENQUEUES, and the body decides:
 * a change that has already reverted by its turn is one the bridge does not need to hear — decided on the
 * title READ, never on a guess about the title a body will read later.
 */
function register(reveal: boolean): Promise<void> {
  const next = regTail.then(async () => {
    const title = titleNow();
    if (!reveal && title === sentTitle) return;
    sentTitle = title;
    try {
      // DURABLE (card t20261025-061114-f6b7): the viewer is a fixture, not a session toy — a page's
      // Close detaches that page, the server stays registered, and the next `show` needs no restart.
      await ch.register({ reveal, title, durable: true });
    } catch (e) {
      // A TITLE THE BRIDGE NEVER ACCEPTED MUST NOT BLOCK THE NEXT ATTEMPT: nothing is known to be there
      // any more, so the next change registers whatever the title then is (`titleNow` is never empty).
      sentTitle = "";
      throw e;
    }
  });
  regTail = next.catch(() => {});
  return next;
}
/** A RENAME: same bytes, new title, so loombot keeps the version and the open panel is not reloaded. */
function retitle(): void {
  register(false).catch((e) => logLine("retitle failed:", why(e)));
}

async function onFrame(text: string): Promise<void> {
  let msg: { event?: unknown; data?: Record<string, unknown> };
  try {
    msg = JSON.parse(text);
  } catch {
    logLine("bad frame (not JSON):", text.slice(0, 200));
    return;
  }
  const name = typeof msg.event === "string" ? msg.event : "";
  const data = msg.data ?? {};
  const id = data.id ?? null;
  if (name === "ready" || name === "reload") {
    // A FRESH PAGE, or "reload from disk" after a conflict (its human agreed to drop the edits): what is
    // on show is read from disk NOW, not as it was served.
    if (current.kind === "listing") {
      // THE FOLDER IS READ AGAIN, like a file is: what is on disk now is what the page gets — rule 8
      // reaches listings because a listing IS a read. A walk that refuses now is a sentence where the
      // entries were, not a failed show, exactly as at the first draw.
      current = await listNow(current.abs);
      renderRendered();
      ch.toBrowsers("show", listingFrame(current, { id, by: name }));
      retitle();
      return;
    }
    if (current.kind === "code" || current.kind === "markdown") {
      try {
        current = await textCurrent(current.abs, current.readonly, current.line);
      } catch (e) {
        // **A FILE THAT CANNOT BE RENDERED IS A FRAME, NOT AN ERROR** (card t20261028-002834-882a): it may
        // have become binary, or grown past the cap, since it was read — and the page that asked to re-read
        // it gets the answer a `show` would give it, not a sentence about a failure.
        if (e instanceof Undisplayable) {
          current = downloadCurrent(current.abs, e);
        } else {
          // A page asked, so a human is looking at the answer: the human sentence (files.ts `Refused`).
          ch.toBrowsers("error", { id, reason: refusalText(e, "human") });
          return;
        }
      }
    }
    ch.toBrowsers("show", showFrame(current, { id, by: name }));
    retitle();
    return;
  }
  if (name === "save") {
    const abs = String(data.path ?? "");
    const baseHash = String(data.base ?? "");
    const force = data.force === true;
    try {
      if (typeof data.text !== "string") {
        throw new Refused("refused: a save carries the text as a string");
      }
      // ONLY A PATH show() SERVED EDITABLE, compared exactly: nothing a page sends is resolved into a path.
      const bases = served.get(abs);
      if (!bases) {
        throw new Refused(
          "refused: " + rel(abs) + (current.abs === abs && current.noEdit
            ? " is shown " + (current.readonly ? "read-only" : "but " + current.noEdit)
            : " was never shown editable in this viewer") +
            ", and it saves only what the agent showed for editing. Nothing was written.",
        );
      }
      if (!bases.has(baseHash)) {
        throw new Refused(
          "refused: this viewer never served " + rel(abs) +
            " at that version, so there is no base " +
            "to check the file against. Reload it from disk and make the edit again.",
        );
      }
      const s = await saveAtomic(abs, data.text, baseHash, { force });
      remember(abs, s.hash);
      // **THE HUMAN'S WRITE MOVES `file`, AND THE ANSWER BELOW CARRIES THE NEW NUMBER** (card
      // t20261024-061052-2740). ONE part, and that is the point of parts: a page whose open card is
      // drawing `file` reads, a page drawing something else does not, and the page that pressed Save
      // already holds this number, so the notification that follows its own write costs it nothing.
      //
      // It is here rather than at the top of the handler because a save that is REFUSED — an old base, a
      // conflict, a binary file — changed nothing and must not move any number.
      moved("file");
      if (current.abs === abs) {
        current = { ...current, text: data.text, hash: s.hash, bytes: s.bytes, lines: s.lines };
        // …AND RE-RENDERED, because the human's new text is what view mode goes back to. The pictures
        // are filled in again too: an edit can name one that was not there before (markdownOf).
        if (current.kind === "markdown") {
          current = { ...current, rendered: await markdownOf(abs, data.text) };
        }
      }
      ch.toBrowsers("saved", {
        id,
        path: abs,
        hash: s.hash,
        bytes: s.bytes,
        lines: s.lines,
        force,
        // THE NEW RENDERING: Save goes back to view mode, and view mode of a markdown file is this.
        ...(current.abs === abs && current.rendered ? { html: current.rendered.html } : {}),
      });
      logLine("saved", abs, s.bytes + " bytes", force ? "(forced)" : "");
      noteSave(abs, s.before, data.text, s.lines, force, data.done === true);
    } catch (e) {
      ch.toBrowsers("save_refused", {
        id,
        path: abs,
        conflict: e instanceof Conflict,
        // THE PAGE PRINTS THIS AND THE AGENT NEVER SEES IT: a save is the human's own act, so the reason
        // is the human's sentence (files.ts `Refused`).
        reason: abs ? refusalText(e, "human").replaceAll(abs, rel(abs)) : refusalText(e, "human"),
      });
      logLine("save refused:", why(e));
    }
    return;
  }
  if (name === "open_path") {
    // A CLICK IN THE PAGE — a row of the listing, its ".." row, or the folder above the file on show —
    // and it is `show` DRIVEN BY THE PAGE (t20261020-181818-5573, generalised by t20261026-023551-35ae):
    // ONE event for all three, the same `showAbs`/`showListing` an agent's `show` and a markdown link
    // go through, so the frame, the re-registration and the `served` bookkeeping a save is checked
    // against are ONE code path and cannot drift apart.
    //
    // IT REPLACES WHAT THE AGENT PUT THERE, which the app's docs say plainly: a click is a person moving
    // around their own workspace, and it is not a transaction with the agent. Nobody is told — only a
    // SAVE costs a turn — and the save notice for a file opened this way is the ordinary one, because
    // `showAbs` served it.
    //
    // THE PATH IS LOOKED UP, NEVER RESOLVED (`files.ts` `renderedNode`): the page may name only a path
    // this app rendered into what is in front of the person, and the LOOKUP's answer routes — a folder
    // opens its listing, a file is shown. A click cannot read a path the person was not already looking
    // at, and a path outside the workspace cannot be in the map at all: the root is the security
    // boundary twice over.
    const path = String(data.path ?? "");
    // **A BACK IS CHECKED AGAINST WHAT THIS APP HAS DRAWN, A CLICK AGAINST WHAT IS ON SCREEN** (card
    // t20261105-225359-8b14, and `drawn` above says why): the page's own history names a view it was at,
    // and that view is a FILE as readily as a folder. Both maps hold only paths the SERVER produced, so the
    // rule that no string from a page is ever resolved into a path is the same either way — what changes is
    // which of the app's own answers the question.
    const back = data.back === true;
    try {
      const dir = renderedNode(path, back ? drawn : rendered);
      logLine(
        "opened from the page:",
        dir
          ? await showListing(path, { by: "page" })
          : await showAbs(path, { readonly: false, line: null, by: "page" }),
      );
    } catch (e) {
      logLine("open refused:", why(e));
      // `from` IS THE PAGE'S KEY to the one refusal that is staleness evidence: an open_path the server
      // never rendered means the page holds a view this life did not draw — the restart's — and the page
      // reads once on it (card t20261026-024522-fd4a: a refusal is a refresh trigger, not silence). A
      // link's refusal is nobody's staleness, and carries no key.
      ch.toBrowsers("error", { id, reason: refusalText(e, "human"), from: "open_path" });
    }
    return;
  }

  if (name === "open") {
    // A CLICK ON A MARKDOWN LINK (t20261009-184950-2ba3), which is the ONE navigation this app has and is
    // not a location: the page stays where it is and a `show` frame arrives instead. Nobody is told — a
    // human reading a file is not a decision, and a click that cost a turn would be one.
    try {
      logLine("link:", await openLink(String(data.href ?? ""), id));
    } catch (e) {
      logLine("link refused:", why(e));
      // THE HUMAN IS THE ONE CLICKING, so the refusal they are shown is the one written for them
      // (files.ts `Refused.human`): a sentence telling its reader to run `ls` cannot be read on a page.
      ch.toBrowsers("error", { id, reason: refusalText(e, "human") });
    }
    return;
  }
  if (name === "close") {
    // **THE HUMAN PRESSED CLOSE, AND CLOSE ENDS THE VIEWER** (card t20261027-025619-fb7e): the f6b7
    // premise — a durable app outlives its pages, so the page was answered `detached` and the server
    // stayed — was reversed by Xiaohu on 2026-10-27 ("apps die with loombot, and the agent starts what it
    // needs next"), after pressing a Close that did nothing twice. The ask is a REAL request now: the
    // viewer takes the graceful path — the agent is told (`notifications/app/closed`, by "user"), the
    // page gets its farewell, the tab leaves the strip, exit 0 — which is the same path `stopWorker`
    // takes. The NEXT `show` starts it again. (A page that cannot reach its server closes LOCALLY
    // instead — the page contract's `loomApp.close`; `detached` is not this button's answer any more.)
    logLine("the human pressed Close — the viewer is ending");
    await ch.close("the human pressed Close", {
      by: "user",
      // A PENDING SAVE NOTICE GOES NOW rather than lost: the save happened whether or not we linger.
      flush: () => {
        for (const abs of [...bursts.keys()]) sendNotice(abs);
        return Promise.resolve();
      },
    });
    return;
  }
  if (name === "download") {
    // **THE PAGE ASKS FOR THE BYTES, AND THIS IS THE ONLY WAY IT CAN GET THEM** (card
    // t20261028-010039-c7a2). A frame cannot carry a file, and a URL on 127.0.0.1 is the BROWSER's machine
    // — on a phone reached through the relay that is the phone, which is why pressing Download there did
    // nothing at all. So the page asks HERE, one chunk at a time, and the answer rides back on the request
    // that asked it: the same carriage as every other event this app answers, nothing for loombot to learn,
    // and no listener to keep alive (`download.ts`).
    const token = typeof data.token === "string" ? data.token : "";
    const offset = typeof data.offset === "number" ? data.offset : Number(data.offset ?? 0);
    try {
      ch.toBrowsers("bytes", { ...(await download.chunk(token, offset)) });
    } catch (e) {
      // THE HUMAN PRESSED DOWNLOAD, so the refusal is the one written for them (`files.ts`
      // `Refused.human`): "press Download again" is a sentence somebody can act on, and "the app did not
      // answer" is not.
      ch.toBrowsers("error", { id, reason: refusalText(e, "human"), from: "download" });
    }
    return;
  }
  logLine("unknown event:", name);
  ch.toBrowsers("error", {
    id,
    reason: 'unknown event "' + name +
      '"; this app answers ready, reload, save, open, open_path, download and close',
  });
}

// ── MCP ──────────────────────────────────────────────────────────────────────────────────────────────

const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "show",
    description: [
      "Show a file OR A FOLDER on the loom web UI, revealed in front of the human: markdown RENDERED,",
      "source in a syntax-highlighted CodeMirror view, a PDF in the browser's PDF viewer, an image as",
      "itself — and a folder as its LISTING (name, kind, size, date; folders first, sorted, the largest",
      "directories capped with a sentence saying how many were left out). The human can click through: a",
      "row opens a file, another folder, or any folder on the file view's breadcrumb. Only",
      "paths inside the workspace (" + ROOT +
      ") can be shown. A TEXT file is EDITABLE by default: the",
      "human presses Edit, changes it, and Save writes it (atomic, refused if the file changed on disk",
      "since it was shown) and you get notifications/app/saved with a +/- line count, so re-read before",
      "you edit it. Pass readonly: true to show it without Edit (a folder ignores it). Not editable, and",
      "said so: non-UTF-8 text, and anything this viewer cannot render at all — binary data, or a file",
      "past " + kib(MAX_FILE_BYTES) +
      " — which is answered with the DOWNLOAD view instead of a refusal: the",
      "human is told it cannot be displayed and gets a Download that saves the file's bytes. Nothing is",
      "refused but a path outside the workspace. A page's unsaved work never refuses this: the show",
      "lands, and a page holding a buffer keeps it, says a change is waiting, and shows it when the",
      "human is done.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "The file or folder, relative to the workspace root (an absolute path inside it is fine too).",
        },
        readonly: {
          type: "boolean",
          description:
            "Show a text file WITHOUT an Edit button; saves to it are refused. Unused for a folder.",
        },
        line: {
          type: "integer",
          minimum: 1,
          description: "Scroll a text file to this line (1-based).",
        },
      },
      required: ["path"],
    },
  },
];

async function showTool(args: Record<string, unknown>): Promise<string> {
  const rawLine = args.line;
  const line = rawLine === undefined || rawLine === null ? null : Number(rawLine);
  if (line !== null && (!Number.isInteger(line) || line < 1)) {
    throw new Refused(
      "refused: line must be a whole number from 1; got " + JSON.stringify(rawLine),
    );
  }
  const { abs } = await resolveInWorkspace(String(args.path ?? ""), ROOT);
  // A FOLDER IS A SHOWABLE OBJECT (card t20261026-023551-35ae): `show` of a directory publishes its
  // LISTING — the same page, a frame of a different kind. `readonly` and `line` are file arguments and
  // are simply not used here; the tool's description says so.
  const info = await Deno.stat(abs);
  if (info.isDirectory) return await showListing(abs, { by: "agent" });
  return await showAbs(abs, { readonly: args.readonly === true, line, by: "agent" });
}

/**
 * PUT A FILE ON THE PAGE. Three callers and no fourth: the `show` tool above, a CLICK ON A MARKDOWN LINK
 * (`openLink`), and a CLICK in the page (`open_path` — a folder opens its listing instead, through
 * `showListing`). They differ in ONE thing -- `by`, which the page prints -- because a file arrives the
 * same way whoever asked for it: the same realpath, the same re-registration, the same frame. Splitting the
 * doors would be two ways for a file to get onto the page, and the one nobody tests is the one that drifts.
 */
async function showAbs(
  abs: string,
  opts: { readonly: boolean; line: number | null; by: string },
): Promise<string> {
  const { readonly, line } = opts;
  const path = rel(abs);
  // A PAGE'S BUFFER IS THE PAGE'S (2026-10-20, and the last of the ceremony on 2026-10-27, card 1325). A
  // `Refused` stood here once ("Ask them to Save or Cancel first") and it was the disease whole: one tab's
  // buffer refused the agent for every tab, and a crashed page refused it for ever. The show LANDS: every
  // page is told, and the page holding a buffer keeps that text, says a change is waiting, and draws the
  // file when the human is done (`src/app.js`). The text also survives as that page's own localStorage
  // draft, offered on its next show — so nothing is lost by letting the show through, and THE SERVER HOLDS
  // NO DIRTY STATE to sentence anybody about.
  // **THE KIND IS DECIDED IN ONE PLACE** (`readCurrent`), and a file this viewer cannot render comes back
  // as the DOWNLOAD frame rather than as a throw (card t20261028-002834-882a): `show` always answers.
  const next = await readCurrent(abs, { readonly, line });
  const was = current, wasAsset = urlAsset;
  current = next.cur;
  urlAsset = next.asset;
  await rememberShown(rel(abs));
  try {
    await register(true);
  } catch (e) {
    // NOTHING CHANGED — loombot validates before it swaps, so put back what was on show and say so.
    current = was;
    urlAsset = wasAsset;
    throw new Refused("could not show " + path + ": " + why(e) + " — nothing changed.");
  }
  // **THE FILE ON SHOW CHANGED, WHICH IS THE OTHER PLACE THE REVISION MOVES** (card
  // t20261024-061042-9b1e) — after the registration landed, so a rollback above never bumps a number no
  // page was told about, and before the push below, so the `show` it sends IS newer than what the pages
  // hold. The viewer is agent-driven and has no `state` variable to hang this on (`app_mcp.ts` has
  // exactly one, `apply`'s); what it has is TWO moments when a page would draw something different, and
  // this is the one that carries a new file.
  // **THE FILE ON SHOW CHANGED, AND THAT IS THE OTHER PLACE THE NUMBERS MOVE** (card
  // t20261024-061052-2740) — after the registration landed, so a rollback above never bumps a number no
  // page was told about, and before the push below, so the `show` it sends IS newer than what the pages
  // hold. The viewer is agent-driven and has no `state` variable to hang this on (`app_mcp.ts` has
  // exactly one, `apply`'s); what it has is TWO moments when a page would draw something different.
  //
  // FOUR parts, because a show really is four facts: which file is on screen (`shown`), the text and size
  // of it (`file`), the breadcrumb's folder and the map the next click is checked against (`listing`),
  // and where the cursor sits (`cursor`). A page that draws any of them reads once; a page drawing none
  // of them — which the board's open card does on a status change — is not sent looking.
  moved("shown", "file", "listing", "cursor");
  // THE MAP IS REBUILT BEFORE THE PUSH: what the next click may name is what this frame puts in front of
  // the person — the file, and the folder its breadcrumb names (`renderRendered`).
  renderRendered();
  // A FILE IS A PLACE TO COME BACK TO, and this is the line its absence cost (see `drawn`).
  drawn.set(current.abs, { dir: false });
  ch.toBrowsers("show", showFrame(current, { by: opts.by }));

  const facts = [current.kind, kib(current.bytes)];
  if (current.kind === "code" || current.kind === "markdown") facts.push(current.lines + " lines");
  const edit = current.download
    // A FILE THIS VIEWER CANNOT RENDER: the agent is told the same sentence the page shows, and why —
    // the bytes ARE on their way, and that is the thing worth knowing (`downloadCurrent`).
    ? ". " + DOWNLOAD_SENTENCE + " (" + current.noEdit + ")"
    : current.kind === "pdf" || current.kind === "image"
    ? ""
    : current.noEdit
    ? ". " + current.noEdit.replace(/^./, (c) => c.toUpperCase())
    : ". The human can Edit it; you are told when they save";
  return "showing " + path + " (" + facts.join(", ") + (line ? ", at line " + line : "") + ") at " +
    ch.page() + " — version " + ch.version() + edit + pageNote(ch.watching());
}

/** A URL AS THE BROWSER READS IT: a scheme, or protocol-relative. The first C0 control is not a defence. */
const SCHEME = /^[A-Za-z][A-Za-z0-9+.\-]*:/;

/**
 * A CLICK ON A MARKDOWN LINK IN THE PAGE -- the ONE way a file opens without the agent (t20261009-184950-2ba3).
 *
 * The page sends the `href` it was DRAWN with and nothing else: not a path, and not a decision about what a
 * URL is. So the two rules live here, and neither of them creates a location:
 *
 *   RELATIVE   resolved against THE FILE ON SHOW -- its own directory, so `../loom/x.md` in `docs/a.md` means
 *              `loom/x.md` -- through the same `resolveInWorkspace` realpath check `show` makes, so a link in
 *              a file can never become a file browser for the whole disk.
 *   FRAGMENT   `#why` is the document addressing ITSELF, and it is the one click that opens NOTHING: the
 *              headings of a markdown file carry the ids `render.ts` minted, so the id is checked against
 *              the file on show here and the PAGE scrolls to it (`goto_anchor`) -- in place, with no
 *              navigation, no location and no second file (t20261009-201706-c56d).
 *   ELSE       a URL or a `mailto:`: REFUSED. The sentence says what IS so -- a URL is not a file in this
 *              workspace, this viewer opens files, and the URL can be copied from the file's own source --
 *              and promises no way out, because there is none to promise: `render.ts` draws no href at all,
 *              since a click on one inside loombot's sandboxed panel takes the frame away and the panel has no
 *              back.
 *
 * The ids are checked HERE and not in the page for the same reason the path of a link is resolved here:
 * `render.ts` is where an id is minted, and a page that worked out its own answer would be a second
 * spelling of that rule. The SCROLL is the page's, because the ids are in its DOM and nowhere else.
 *
 * A human is the one clicking here, so nothing is sent to the agent: this is a read, and a read costs no turn.
 * `ask` is the id of the frame that asked, which is the one page the `goto_anchor` answer goes to.
 */
async function openLink(href: string, ask: unknown): Promise<string> {
  const raw = href.trim();
  if (!raw) throw new Refused("refused: that link carries no url, so there is nothing to open.");
  if (!current.abs || current.kind === "listing") {
    // A LISTING has no document to be relative to (and no links in it to click): the guard says the same
    // thing the empty case always has. A LINK THAT NAMES A FOLDER is fine below — it opens the listing.
    throw new Refused("refused: no file is on show, so a link has nothing to be relative to.");
  }
  // READ THE URL THE WAY THE BROWSER DOES, which is the way `render.ts` read it before offering it: the
  // WHATWG parser drops leading C0 controls and spaces and every tab/CR/LF, so `\x01javascript:` IS a scheme.
  // Two readings of one string have to agree, or a refused link comes back here as a path.
  // deno-lint-ignore no-control-regex -- the C0 range IS the point: it is what the URL parser strips
  const probe = raw.replace(/^[\x00-\x20]+/, "").replace(/[\t\n\r]/g, "");
  if (SCHEME.test(probe) || raw.startsWith("//")) {
    throw new Refused(
      raw +
        " is a URL, not a file in this workspace. This viewer opens files in the workspace, so " +
        "there is nothing here to open it with — and a press on it would take this frame away from " +
        "the app, with no way back. The URL itself is in the file on show, which is where it can be " +
        "copied from.",
    );
  }
  const bare = raw.split("#")[0].split("?")[0];
  if (!bare) {
    const at = raw.indexOf("#");
    const id = fragId(at < 0 ? "" : raw.slice(at + 1));
    const ids = current.rendered?.ids ?? [];
    if (id && ids.includes(id)) {
      // THE PAGE THAT CLICKED, and not every page: WHICH FILE is on show is the app's one thing and its
      // frames go to every page, but WHERE IN IT a reader is looking is that page's own — a second tab
      // showing this file keeps its place, exactly as it keeps its own scroll and its own caret.
      ch.toBrowsers("goto_anchor", { id: ask, anchor: id, path: current.abs });
      return "jumped to #" + id + " in " + rel(current.abs) +
        " — the page scrolled; nothing changed.";
    }
    throw new Refused(
      "refused: " + raw +
        (id ? " names no heading in " + rel(current.abs) : " is an empty fragment") +
        " — the ids of a markdown file's headings are the anchors here, and this file has no such one. " +
        "Nothing changed.",
    );
  }
  const dir = dirOf(current.abs);
  // A file (or a folder — a link that names one opens its listing) of the workspace, and only that:
  // `resolveInWorkspace` is the one gate, the same one `show` passes. `bare` starts with "/" only for
  // a link written workspace-absolute.
  const { abs } = await resolveInWorkspace(bare.startsWith("/") ? bare : dir + "/" + bare, ROOT);
  const info = await Deno.stat(abs);
  if (info.isDirectory) return await showListing(abs, { by: "link" });
  return await showAbs(abs, { readonly: false, line: null, by: "link" });
}

async function handle(msg: Record<string, unknown>): Promise<void> {
  const id = msg.id;
  const method = msg.method;
  if (method === "initialize") {
    reply(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "loom-viewer-mcp", version: "2" },
    });
    // Only now: a push before the handshake settles races the client transport.
    ch.connect();
    return;
  }
  if (typeof method === "string" && method.startsWith("notifications/")) return;
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") return reply(id, { tools: TOOLS });
  if (method !== "tools/call") {
    if (id !== undefined && id !== null) {
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: "unknown method: " + method } });
    }
    return;
  }
  const params = (msg.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
  if (params.name !== "show") {
    return toolResult(
      id,
      "unknown tool: " + params.name + "; this app exposes show({path, readonly?, line?})",
      true,
    );
  }
  try {
    return toolResult(id, await showTool(params.arguments ?? {}));
  } catch (e) {
    if (!(e instanceof Refused)) {
      logLine("show failed:", e instanceof Error ? (e.stack ?? e.message) : e);
    }
    return toolResult(id, e instanceof Refused ? e.message : "show failed: " + why(e), true);
  }
}

// ── shutdown: the page is TOLD, never left hanging ───────────────────────────────────────────────────

async function shutdown(reason: string): Promise<void> {
  if (ch.unmounting()) return;
  // A PENDING SAVE NOTICE is sent now rather than lost: the save happened whether or not we linger.
  for (const abs of [...bursts.keys()]) sendNotice(abs);
  await ch.unmount(reason);
  Deno.exit(0);
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    Deno.addSignalListener(sig, () => {
      shutdown("the agent unmounted this app (" + sig + ")");
    });
  }
  if (!bridge.url || !bridge.token) {
    logLine(
      "usage: no LOOM_BRIDGE_URL/LOOM_BRIDGE_TOKEN in the environment, so there is nobody to register " +
        "with and this app would have no page. Start it from an agent with " +
        'startWorker.mcp("viewer", "deno", ["run", "-A", "<this file>", "--root", "<the workspace>"]).',
    );
    Deno.exit(2);
  }
  // REGISTERED BEFORE THE HANDSHAKE, so the tab exists the moment the agent's mount returns — and so that
  // a refusal (a name loombot will not serve, a page over the cap) kills the mount instead of leaving a
  // server whose page never appears.
  try {
    if (PAGE_BYTES > VIEWER_MAX_APP_BYTES - RESERVE) {
      throw new Error(
        "the page is " + PAGE_BYTES + " bytes, over this app's " + VIEWER_MAX_APP_BYTES +
          "-byte cap",
      );
    }
    await register(false);
  } catch (e) {
    logLine("registration FAILED, so this app has no page:", why(e));
    Deno.exit(2);
  }
  logLine(
    "viewer up: app=" + APP + " root=" + ROOT + " page=" + PAGE_BYTES + "B (" + LITE_BYTES +
      "B without the bundle) budget=" + BUDGET + " pid=" + Deno.pid + " saveNotice=" +
      (SAVE_NOTICE ? SAVE_NOTICE_MS + "ms" : "off"),
  );

  // **A RESTART COMES BACK TO WHAT IT WAS SHOWING** (Xiaohu, 2026-10-27: folding the panel and reopening it
  // showed the boot page - a fresh process had nothing on show and answered `ready` with an empty frame).
  // The path is the last successful show, and it is re-read from disk here; a path that refuses now is
  // dropped in silence, because an app that starts empty is the old behaviour and never a worse one.
  const remembered = await lastShown();
  if (remembered) {
    try {
      await showTool({ path: remembered });
      logLine("restored on start: " + remembered);
    } catch (e) {
      logLine("nothing restored (" + remembered + "): " + why(e));
    }
  }

  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of Deno.stdin.readable) {
    buf += dec.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        await handle(JSON.parse(line));
      } catch (e) {
        logLine("bad frame:", why(e), line.slice(0, 200));
      }
    }
  }
  // STDIN CLOSED: the client is gone, which is the first half of what stopWorker does.
  await shutdown("the agent unmounted this app (stdin closed)");
}
