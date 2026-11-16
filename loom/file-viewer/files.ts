/**
 * What the file viewer does to FILES — resolving the shown path inside the workspace, reading it for the
 * page (and deciding whether it may be edited), the conflict check, the atomic write and the line count a
 * save notice carries. Pure of MCP and of sockets, so every refusal here is testable as a function call
 * (`tests/app_viewer_edit_test.ts`), and `viewer_mcp.ts` is only the wiring around it.
 *
 * **Every refusal is a sentence a person can act on**, because two different readers get it: the agent (a
 * tool result) and the human (the page prints it verbatim). "refused" alone is unactionable; "refused: X is
 * binary" is not.
 */
import { escapeHtml } from "./render.ts";

/**
 * A REFUSAL IS A MESSAGE, NOT AN EXCEPTION TYPE: both readers read text — and there ARE two readers,
 * which is why a refusal is written in two VOICES (t20261009-201706-c56d).
 *
 *   the AGENT reads the tool result. It can run `ls`, call show again, copy a file, restart the app.
 *   the HUMAN reads the page's status line, verbatim. It can click, save and cancel — nothing else.
 *
 * `message` is the agent's sentence, which is the default because a refusal's own verb ("show", "save")
 * belongs to the agent; `human` is the sentence the page prints. A refusal that tells its reader to do
 * something ONLY an agent can do has to carry the human one — "Check the path with `ls`" is a sentence a
 * human reads as nonsense, and it was reaching them (a click on a broken markdown link lands here).
 * `refusalText` is how a caller asks for the right voice, and it is the ONE place that chooses.
 */
export class Refused extends Error {
  readonly human: string;
  constructor(message: string, human?: string) {
    super(message);
    this.human = human ?? message;
  }
}

/** The sentence a refusal READS AS, for whoever is reading it. `why(e)` for a log line is the message. */
export function refusalText(e: unknown, who: "agent" | "human"): string {
  if (e instanceof Refused) return who === "human" ? e.human : e.message;
  return e instanceof Error ? e.message : String(e);
}

/**
 * BYTES AS BASE64, for the one thing this app carries that way: a picture inlined into the html a page is
 * handed (`inlineImages`). Chunked, because `String.fromCharCode(...bytes)` on a whole file overflows the
 * argument list. It used to live in viewer_mcp.ts, which grew the other user of it.
 */
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/**
 * THE FILE CHANGED UNDER THE PAGE. Its own class because the page answers it differently from every other
 * refusal: it offers RELOAD or OVERWRITE, and never picks one silently.
 */
export class Conflict extends Refused {
  constructor(message: string, readonly diskHash: string) {
    super(message);
  }
}

/**
 * A FILE THIS VIEWER CANNOT PUT ON THE PAGE — the one reason `show` still answers a FRAME (card
 * t20261028-002834-882a). It is NOT a `Refused`: a refusal leaves the page showing whatever it showed
 * before, and the whole point of the card is that a person who asked for a file gets a file — the bytes,
 * by download — rather than a sentence about one. So the thrower says what it cannot render and the
 * caller turns that into the download frame; nothing above it may turn it back into a refusal.
 *
 * `reason` reads as a clause and lands where the page's no-edit line is ("not text: ...", "too big to
 * render: ..."), and `bytes` is the file's size on disk — the number the download frame states.
 */
export class Undisplayable extends Error {
  constructor(readonly reason: string, readonly bytes: number) {
    super(reason);
  }
}

/**
 * THE SIZE CAP, on what is carried to the page and on what is saved. A text file travels over the app
 * socket, not in the registration, so it does not compete with the bundle for loombot's 16 MiB — the cap is
 * about editing: CodeMirror is comfortable well past this, a human editing a 2 MB file by hand is rare, and
 * a log or a minified bundle that size is not something to edit here. Past it the file is NOT rendered at
 * all: `Undisplayable`, which the page answers with the DOWNLOAD frame (card t20261028-002834-882a).
 * Showing the start of it was a third thing to explain — rendered, downloadable, and "rendered but not
 * really" — for a file nobody edits.
 */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** How far into a file the NUL test looks — the same 8 KiB the file viewer and git use. */
const BINARY_PROBE = 8192;

/*
 * THE PICTURES A MARKDOWN DOCUMENT NAMES. `inlineImages` below fills each one into the html the page is
 * handed, as a data: URL, so these are the caps on what one document may carry — and they are byte caps
 * on the FILE, because the frame carries the html: what one costs on the wire is 4/3 of this.
 */
/** One picture. The same cap as a file the socket carries, for the same reason. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** …and one document's pictures TOGETHER: twenty of the above is not one page. */
export const IMAGE_BUDGET = 8 * 1024 * 1024;
/**
 * The kinds of picture an `<img>` in a document carries here, by extension. `svg` is here and NOT in
 * `viewer_mcp.ts`'s `BY_URL`: a picture in a document is drawn by an `<img>` whatever it is, while BY_URL
 * is about SHOWING that file as the app's one thing — and its `pdf` entry is the one that needs a browser
 * plugin, which is the whole of that list's story (README.md, "A PDF in the panel").
 */
export const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

const enc = new TextEncoder();

export async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * RESOLVE A PATH INSIDE THE WORKSPACE, or refuse it. `Deno.realPath` on both sides is the whole check, and
 * it is deliberately the strict one: it resolves `..` and follows symlinks, so `../../etc/passwd` and a
 * symlink pointing out of the tree are the same answer. The PAGE is served to a browser, so it may only
 * show files and folders from the workspace. The realpath is also the only path a save may later name:
 * nothing a page sends is ever resolved into a new one.
 */
export async function resolveInWorkspace(
  raw: string,
  root: string,
): Promise<{ abs: string; rel: string }> {
  const asked = String(raw ?? "").trim();
  if (!asked) {
    throw new Refused("show needs a path: the file you want on the page, relative to " + root);
  }
  const guess = asked.startsWith("/") ? asked : root + "/" + asked.replace(/^\.\//, "");
  let abs: string;
  try {
    abs = await Deno.realPath(guess);
  } catch {
    // TWO VOICES, because a click on a broken markdown LINK lands here too: the human cannot run `ls`.
    throw new Refused(
      "no such file: " + asked + " does not exist under " + root +
        " — nothing was shown, and the page still holds what it held. Check the path with `ls` and call show again.",
      "no such file: " + asked + " does not exist under " + root + " — nothing was shown.",
    );
  }
  if (abs !== root && !abs.startsWith(root + "/")) {
    throw new Refused(
      "refused: " + abs + " is outside this viewer's workspace (" + root +
        "). The PAGE is served to a browser, so it may only show files from the workspace — otherwise a tab " +
        "becomes a file browser for the whole disk. You can still read that file yourself; to put it on the " +
        "page, copy it into the workspace, or restart this app with --root pointing at the tree you mean.",
      "refused: " + abs + " is outside this viewer's workspace (" + root +
        "), and the page is served to a browser: it may only show files from the workspace. Nothing was shown.",
    );
  }
  const info = await Deno.stat(abs);
  // A DIRECTORY IS SHOWABLE NOW (card t20261026-023551-35ae): resolveInWorkspace answers WHERE, and the
  // caller decides file or folder by kind — `showTool`, `openLink`. What still refuses here is anything
  // that is neither, which nothing on the page can draw.
  if (!info.isFile && !info.isDirectory) {
    throw new Refused(
      "refused: " + abs + " is not a file or a folder, so there is nothing to show.",
    );
  }
  return { abs, rel: abs.slice(root.length + 1) };
}

export const lineCount = (text: string): number =>
  text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

const kib = (n: number): string =>
  n < 1024
    ? n + " B"
    : n < 1048576
    ? (n / 1024).toFixed(1) + " KiB"
    : (n / 1048576).toFixed(2) + " MiB";

/** A text file as the page gets it, and whether the human may edit it (and if not, why not). */
export interface TextDoc {
  abs: string;
  /** The whole file's text. Past the cap there is no TextDoc at all (`Undisplayable`). */
  text: string;
  /** SHA-256 of the BYTES on disk — the base a save must match. "" when the file is not editable. */
  hash: string;
  /** The file's size on disk. */
  bytes: number;
  /** Lines of `text`. */
  lines: number;
  /** "" when the human may edit it; otherwise the sentence the page and the agent are given. */
  noEdit: string;
}

/**
 * READ A TEXT FILE FOR THE PAGE. One reader for view and edit, because the page shows the text it would
 * edit — so the rules that protect an edit decide here, once, whether there may BE one:
 *
 *   TOO BIG     past `max` it is not read at all: `Undisplayable`, and the page offers its bytes instead.
 *   BINARY      a NUL in the first 8 KiB is `Undisplayable` too: there is no text to render and no edit
 *               to offer, and the bytes are what a person wants.
 *   NOT UTF-8   shown decoded lossily and NOT editable: saving it back would rewrite every byte that did
 *               not decode.
 */
export async function readForShow(abs: string, max = MAX_FILE_BYTES): Promise<TextDoc> {
  const size = (await Deno.stat(abs)).size;
  /** The file's size, as the one sentence the download frame carries — named for the cap it broke. */
  const tooBig = (bytes: number): Undisplayable =>
    new Undisplayable(
      "too big to render: " + kib(bytes) + ", and this viewer renders at most " + kib(max) +
        " of one file — download it to open it",
      bytes,
    );
  // THE CAP RUNS BEFORE THE READ, so a 900 MiB log costs a stat and nothing else.
  if (size > max) throw tooBig(size);
  const file = await Deno.open(abs, { read: true });
  let raw: Uint8Array;
  try {
    // One byte past the file's SIZE catches one that grew between the stat and the read.
    const buf = new Uint8Array(size + 1);
    let n = 0;
    while (n < buf.length) {
      const got = await file.read(buf.subarray(n));
      if (got === null) break;
      n += got;
    }
    raw = buf.subarray(0, n);
  } finally {
    file.close();
  }
  // A FILE THAT GREW PAST THE CAP BETWEEN THE STAT AND THIS READ: the same answer, and no text at all.
  if (raw.byteLength > max) throw tooBig(raw.byteLength);
  if (raw.subarray(0, BINARY_PROBE).includes(0)) {
    throw new Undisplayable(
      "not text: a NUL byte in the first " + kib(BINARY_PROBE) +
        ", so there is nothing to render — download it to open it",
      size,
    );
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    return {
      abs,
      text,
      hash: await sha256(raw),
      bytes: raw.byteLength,
      lines: lineCount(text),
      noEdit: "",
    };
  } catch {
    // NOT UTF-8, AND STILL SHOWN: decoded lossily, and no Edit — saving it back would rewrite every byte
    // that did not decode. NOT `Undisplayable`: there is text here to read.
    const text = new TextDecoder().decode(raw);
    return {
      abs,
      text,
      hash: "",
      bytes: raw.byteLength,
      lines: lineCount(text),
      noEdit:
        "not editable: the file is not valid UTF-8, so saving it through a text buffer would " +
        "rewrite every byte that did not decode.",
    };
  }
}

export interface Saved {
  hash: string;
  bytes: number;
  lines: number;
  /** The text that was on disk before this write — what a save notice diffs against. */
  before: string;
}

/**
 * SAVE: refuse a stale base, then write ATOMICALLY — a temp file in the same directory, then `rename`, so
 * a reader (the agent, a build, git) sees the old bytes or the new ones and never half of either. Same
 * directory because a rename across filesystems is not atomic. The temp takes the original's mode, so a
 * save does not strip an executable bit.
 *
 * **A stale base is REFUSED, never merged and never overwritten**, unless the caller says `force` — which
 * the page only sends after a human pressed "overwrite" on the conflict it was shown.
 *
 * The window between the hash check and the rename is not locked: a writer landing in that millisecond is
 * overwritten. Closing it needs a lock every other writer honours, and none of them (git, an editor, the
 * agent's own `Deno.writeTextFile`) would.
 */
export async function saveAtomic(
  abs: string,
  text: string,
  base: string,
  opts: { force?: boolean; max?: number } = {},
): Promise<Saved> {
  const max = opts.max ?? MAX_FILE_BYTES;
  const bytes = enc.encode(text);
  if (bytes.byteLength > max) {
    throw new Refused(
      "refused: the text is " + bytes.byteLength + " bytes and the viewer's edit cap is " + max +
        " bytes; nothing was written.",
    );
  }
  let disk: Uint8Array;
  try {
    disk = await Deno.readFile(abs);
  } catch {
    throw new Refused(
      "refused: " + abs +
        " is gone from disk since you opened it; nothing was written. Reopen the " +
        "path to recreate it from a new file, or copy your text out first.",
      // THE SAVE REFUSAL IS ALWAYS READ BY THE HUMAN (the page prints it; the agent has no save verb),
      // and the text they typed is still in the page — which is what they need to be told.
      "refused: " + abs +
        " is gone from disk since it was shown here; nothing was written. Your text is still in the " +
        "page — copy it out before you close it.",
    );
  }
  const diskHash = await sha256(disk);
  if (diskHash !== base && !opts.force) {
    throw new Conflict(
      "refused: " + abs + " changed on disk since you opened it — nothing was written. Reload it " +
        "(your edits here are discarded) or overwrite it (the change on disk is discarded).",
      diskHash,
    );
  }
  const info = await Deno.stat(abs);
  const slash = abs.lastIndexOf("/");
  const tmp = abs.slice(0, slash + 1) + "." + abs.slice(slash + 1) + ".loom-edit-" +
    crypto.randomUUID().slice(0, 8) + ".tmp";
  try {
    await Deno.writeFile(tmp, bytes, { mode: info.mode ?? 0o644, createNew: true });
    if (info.mode !== null) await Deno.chmod(tmp, info.mode & 0o7777);
    await Deno.rename(tmp, abs);
  } catch (e) {
    await Deno.remove(tmp).catch(() => {});
    throw new Refused(
      "could not save " + abs + ": " + (e instanceof Error ? e.message : String(e)) +
        " — the file on disk is unchanged.",
    );
  }
  return {
    hash: await sha256(bytes),
    bytes: bytes.byteLength,
    lines: lineCount(text),
    before: new TextDecoder().decode(disk),
  };
}

/**
 * +/- LINES between two texts: the shortest insert/delete script (Myers), so a changed line is one removed
 * and one added, as `git diff --stat` counts it. Only the edit DISTANCE is computed, in O((N+M)D) time and
 * O(N+M) space; past `cap` the answer is the upper bound (every line of the differing middle), which is
 * still true as a +/- and costs nothing.
 */
export function lineDelta(a: string, b: string, cap = 4000): { added: number; removed: number } {
  const x = a === "" ? [] : a.replace(/\n$/, "").split("\n");
  const y = b === "" ? [] : b.replace(/\n$/, "").split("\n");
  let s = 0;
  while (s < x.length && s < y.length && x[s] === y[s]) s++;
  let ex = x.length, ey = y.length;
  while (ex > s && ey > s && x[ex - 1] === y[ey - 1]) ex--, ey--;
  const n = ex - s, m = ey - s;
  if (n === 0 || m === 0) return { added: m, removed: n };
  const max = Math.min(n + m, cap);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let i = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])
        ? v[off + k + 1]
        : v[off + k - 1] + 1;
      let j = i - k;
      while (i < n && j < m && x[s + i] === y[s + j]) i++, j++;
      v[off + k] = i;
      if (i >= n && j >= m) {
        // d = added + removed, and added - removed = m - n.
        return { added: (d + m - n) / 2, removed: (d - m + n) / 2 };
      }
    }
  }
  return { added: m, removed: n };
}

// ── the pictures a document names ────────────────────────────────────────────────────────────────────

/** The `<img>` render.ts draws for a workspace-relative picture: the url is still in `data-src`. */
const IMG_DATA_SRC = /<img alt="([^"]*)" data-src="([^"]*)" \/>/g;

/** An attribute the renderer escaped, back as the text it was: `escapeHtml`'s four, in reverse. */
const htmlText = (s: string): string =>
  s.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

/** What one picture became: the markup that replaces it, and what it spent of the budget. */
interface Inlined {
  html: string;
  used: number;
}

/**
 * FILL IN THE PICTURES OF A RENDERED MARKDOWN DOCUMENT: every `<img data-src="…">` render.ts drew becomes
 * an `<img src="data:…">`, read out of the WORKSPACE through `resolveInWorkspace` — the same realpath gate
 * a markdown LINK goes through (t20261009-201706-c56d).
 *
 * WHY IT HAS TO BE THE SERVER. The page is served by loombot, so a relative `src` is a request to LOOMBOT for
 * /a/<ws>/app/<name>/pic.png, and loombot has never heard of the picture: it is a file in the WORKSPACE —
 * neither an app asset nor a route. The page cannot fetch it either (it holds no path and has no route of
 * its own), and the browser has no third way to ask. The html IS what reaches the page, so a picture
 * travels inside it as a data: URL or it does not travel — and a data: URL needs no request at all.
 *
 * WHAT IT NEVER LOOKS AT: only what render.ts drew as `data-src`, which is a workspace path and nothing
 * else. An absolute url (the browser's own to fetch) and one the allowlist refused (an empty src) were
 * never in that shape, so this cannot turn either of them into a file read.
 *
 * WHAT CANNOT BE FILLED IN — not in the workspace, not there any more, not a regular file, not a kind an
 * `<img>` draws, or past the caps — keeps NO src, so the browser draws the alt text where the picture would
 * be, and the reason goes in `title`. Nothing happens quietly, and nothing is invented.
 */
export async function inlineImages(
  html: string,
  dir: string,
  root: string,
  budget = IMAGE_BUDGET,
): Promise<string> {
  const jobs = [...html.matchAll(IMG_DATA_SRC)];
  if (jobs.length === 0) return html;
  const done = new Map<string, Inlined>();
  let left = budget;
  for (const job of jobs) {
    // ONE READ PER DISTINCT TAG: a document naming the same picture twice names one file, twice.
    if (done.has(job[0])) continue;
    const got = await picture(job[1], job[2], dir, root, Math.min(MAX_IMAGE_BYTES, left));
    left -= got.used;
    done.set(job[0], got);
  }
  return html.replace(IMG_DATA_SRC, (whole) => done.get(whole)?.html ?? whole);
}

/** One picture: read through the workspace gate, and the `<img>` that stands in its place. */
async function picture(
  alt: string,
  src: string,
  dir: string,
  root: string,
  room: number,
): Promise<Inlined> {
  const tag = (attrs: string): string => '<img alt="' + alt + '" ' + attrs + " />";
  /** No src at all: the browser draws the alt text, and the reason is one hover away. */
  const refuse = (reason: string): Inlined => ({
    html: tag('title="not shown: ' + escapeHtml(reason) + '"'),
    used: 0,
  });
  // THE URL AS A PATH: the fragment and the query belong to the browser, and the attribute was escaped.
  let path: string;
  try {
    path = decodeURIComponent(htmlText(src).split("#")[0].split("?")[0]);
  } catch {
    return refuse(src + " is not a path this app can read (its %-escapes do not decode).");
  }
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const mime = IMAGE_MIME[ext];
  if (!mime) {
    return refuse(
      "this viewer carries png, jpg, gif, webp and svg pictures, and this is " +
        JSON.stringify(ext ? "." + ext : path) + ".",
    );
  }
  let abs: string;
  try {
    // THE SAME GATE, AND THE SAME BASE, AS A LINK: the directory of the file the picture is named in.
    ({ abs } = await resolveInWorkspace(dir + "/" + path, root));
  } catch (e) {
    return refuse(refusalText(e, "human"));
  }
  const size = (await Deno.stat(abs)).size;
  if (size > room) {
    return refuse(
      "it is " + kib(size) + ", and " + kib(room) + " is all that is left for this document's " +
        "pictures (" + kib(MAX_IMAGE_BYTES) + " each, " + kib(IMAGE_BUDGET) + " together).",
    );
  }
  return {
    html: tag('src="data:' + mime + ";base64," + toBase64(await Deno.readFile(abs)) + '"'),
    used: size,
  };
}

// ── the listing ──────────────────────────────────────────────────────────────────────────────────────
//
// THE FOLDER IS A SHOWABLE OBJECT (card t20261026-023551-35ae): `show` takes a file OR a folder, and a
// folder is answered with a LISTING — one directory, read, sorted and capped. There is no depth bound and
// no tree: a listing is ONE level, the page's own click is what opens the next one, and the workspace root
// is the wall nothing walks past.

/**
 * HOW WIDE A LISTING OPENS, because the answer travels over the same socket the file does. A folder
 * holding more than this is NOT a refusal — it degrades to its first entries plus the count of what was
 * left out (`more`/`moreNote`), so the person still gets a page and the sentence says what they are
 * not seeing. The root bound is the security boundary; this one is only a page size.
 */
export const LIST_ENTRIES = 200;

/**
 * ONE ENTRY OF A LISTING, as the frame carries it and as the page sends it back.
 *
 * `path` IS THE REALPATH, AND IT IS THE ONLY THING A CLICK MAY NAME: the app compares the string it gets
 * against the paths IT rendered (`renderedNode` below) and never resolves it into a path, so a click
 * cannot name a folder the person was not already looking at. `name` is what the human reads.
 */
export interface ListingEntry {
  /** The entry's own name, which is what the page draws. */
  name: string;
  /** The realpath — the key `renderedNode` looks up, and what the page sends back on a click. */
  path: string;
  /** Whether the entry opens into its own listing: a file is the end of the branch. */
  dir: boolean;
  /** A file's size in bytes; a folder carries none (0). */
  bytes: number;
  /** The entry's mtime, in epoch milliseconds. */
  mtime: number;
}

/**
 * ONE FOLDER, READ — which is the only directory read this app does, and the only thing a listing frame
 * is made of. Sorted (folders first, then names), and CAPPED: a directory past `LIST_ENTRIES` is not a
 * refusal — it degrades to its first entries plus the count of what was left out, and the sentence that
 * says so states the cap. A person browsing a huge directory is owed a page, not an error.
 *
 * THE POLICY IS THE WALK THIS APP ALWAYS HAD: dotfiles and `node_modules` are SKIPPED — not listed, not
 * refused, not counted. Every entry is put through `Deno.realPath`, and one that resolves outside `root`
 * is skipped with them, so a symlink is not a door out of the workspace and every path the frame carries
 * is one this app will read again without resolving anything.
 *
 * EVERY REFUSAL IS A SENTENCE IN TWO VOICES (`Refused`), because the two readers differ: the page prints
 * the human's where the entries would be, and the agent's is what a log line gets.
 */
export async function listDir(
  dir: string,
  root: string,
): Promise<{ entries: ListingEntry[]; more: number }> {
  if (dir !== root && !dir.startsWith(root + "/")) {
    throw new Refused(
      "refused: " + dir + " is outside this viewer's workspace (" + root +
        "), and a listing reads only what is inside it — nothing was read.",
      "refused: that folder is outside this viewer's workspace, so it cannot be opened here. Nothing " +
        "was read.",
    );
  }
  let info: Deno.FileInfo;
  try {
    info = await Deno.stat(dir);
  } catch {
    throw new Refused(
      "refused: no such folder: " + dir + " — nothing was read.",
      "refused: that folder is not there any more — nothing was read.",
    );
  }
  if (!info.isDirectory) {
    throw new Refused(
      "refused: " + dir + " is a file, and a listing opens folders — nothing was read.",
      "refused: that is a file, not a folder — there is nothing to list.",
    );
  }
  const found: ListingEntry[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    let abs: string, st: Deno.FileInfo;
    try {
      abs = await Deno.realPath(dir + "/" + entry.name);
      // The REALPATH's kind, size and mtime, from the one stat: a symlink to a folder is a folder here,
      // and a link that resolves outside the workspace is dropped by the check below either way.
      st = await Deno.stat(abs);
    } catch {
      continue; // gone between the listing and the resolve, or a link to nothing: not an entry
    }
    if (abs !== root && !abs.startsWith(root + "/")) continue; // a link out of the workspace
    found.push({
      name: entry.name,
      path: abs,
      dir: st.isDirectory,
      bytes: st.isDirectory ? 0 : st.size,
      mtime: st.mtime?.getTime() ?? 0,
    });
  }
  // FOLDERS FIRST, then by name — codepoint order, so a listing sorts the same on every machine that
  // serves one. The cap cuts the SORTED list: the first page of a huge directory is its most readable
  // one, not whatever readdir happened to hand over first.
  found.sort((a, b) =>
    a.dir === b.dir ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.dir ? -1 : 1
  );
  if (found.length > LIST_ENTRIES) {
    return { entries: found.slice(0, LIST_ENTRIES), more: found.length - LIST_ENTRIES };
  }
  return { entries: found, more: 0 };
}

/** The sentence a CAPPED listing carries, built where the cap is known — the page only draws it. */
export function moreNote(more: number): string {
  return "and " + more + " more entries not listed — a listing carries its first " + LIST_ENTRIES +
    ".";
}

/**
 * WHAT THIS APP HAS RENDERED — path to what that path was — `served`'s twin, and the same rule: a page's
 * word is only ever COMPARED against what this app itself produced, never resolved into a path.
 *
 * Rebuilt with EVERY view this app puts on the page (`renderRendered` in viewer_mcp.ts): a listing
 * records its entries, a file records itself and the folder the page's breadcrumb names, and both record
 * the parent folder a ".." row or a breadcrumb names. A path from an OLDER view is therefore not in the
 * map — which is exactly the point: what the page may click is what is IN FRONT OF THE PERSON.
 */
export interface Rendered {
  /** The two kinds a click can name, and the two frames that answer them: a listing, or a shown file. */
  dir: boolean;
}

/**
 * THE SECURITY CHECK, AND IT IS ONE LOOKUP: the app opens a path only if IT put that path in front of
 * the person, and the page sends back the path it was GIVEN. The answer is the KIND — a listing or a
 * file — which is the caller's routing, not a second rule.
 *
 * A miss is a path this app never drew, however plausible it looks AND EVEN IF IT EXISTS ON DISK — an
 * escaping `..` cannot be in the map, because nothing outside `root` is ever rendered into it, which is
 * what makes the root the security boundary twice over: once at draw time (only in-root paths are
 * rendered) and once here. NO STRING FROM A PAGE IS EVER RESOLVED INTO A PATH. That is the whole of the
 * rule, and the reason the page hands a browser in an app frame no capability it did not already have:
 * it can name only what the agent already served, and it asks for it again. (`show`'s `served` map,
 * which a save is checked against, is this map's twin — same shape, same rule, one path owner each.)
 */
export function renderedNode(path: string, rendered: ReadonlyMap<string, Rendered>): boolean {
  const node = rendered.get(path);
  if (node === undefined) {
    throw new Refused(
      "refused: " + (path || "(no path)") +
        " is not a path this viewer is showing you, so there is nothing to open there. The listing " +
        'opens only what it drew for you: its rows, its "..", and the folder above the file on show.',
      "refused: this path is not one the viewer showed you, so it cannot be opened here. Nothing was " +
        "opened.",
    );
  }
  return node.dir;
}
