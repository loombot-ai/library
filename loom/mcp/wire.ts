// THE LIBRARY'S WIRE, FOR THE `library` MCP SERVER: the device credential, the two read addresses, and the
// shape of an answer. `library_mcp.ts` beside this file is the server; `share.ts` is the folder that is
// published. Everything this file says about the network is said once, here.
//
// ## The identity is the MACHINE's, and it is the relay's own credential
//
// §5: a bound machine publishes using the credential it already holds, and there is NO PUBLISH KEY - nothing
// to copy by hand, nothing to show once, and revoking the machine on `/account` takes publishing away in the
// same press that takes the tunnel away. So this file reads `session` out of a credential file and sends it
// as `Authorization: Bearer <device token>`, the header the account service reads back with
// `readDeviceSession` (the account service's own reader). The token is NEVER printed, not
// even inside a refusal, and nothing here ever writes a key.
//
// TWO PLACES THE CREDENTIAL CAN BE, AND BOTH ARE READ. `~/.loom/accounts/<origin>.json` is the machine-level
// slot §5 names - the one loom wrote before 2026-10-20, and the one this machine has. Since then loom keeps
// a workdir's credential beside the workdir, at `<workdir>/.loom/account.json` (`loombot/account.ts`
// `accountPathOf`), and THAT is the file a pairing writes today. A reader that knew only one of them would
// refuse a machine that is in fact bound, so both are candidates and the file's OWN `origin` decides which
// one is this stack's - the same rule `readAccount` applies, and for its reason: a credential for another
// stack is not this stack's, and "present but wrong" is a different answer from "absent". When neither file
// is there, the refusal is ONE sentence naming both paths and the press that fixes it.
//
// ## The read side is HTML today, so this file reads HTML - and prefers JSON
//
// `GET /library/<handle>` and `GET /library/<handle>/<slug>` are the addresses §3 and §4 define, and the
// deployment answers them with the site's own pages (`src/library.ts`). A machine-facing JSON shape is a
// decision nobody has made, so this client ASKS for one (`accept: application/json`) and falls back to the
// markup the site actually serves - pinned to what `entryRow` and `entryPage` emit, and to nothing else.
// The day the deployment answers JSON, the JSON branch runs and the two HTML readers are dead code rather
// than wrong code; a client that read only markup would be quietly broken the day the page changed, and one
// that read only JSON would not work today.
//
// ## `get` WRITES BYTES AND RETURNS A PATH
//
// §8's whole point: the entry's files land in a folder under the run's temp directory, and the file viewer
// and `read` then open THE SAME BYTES through the same tool. Nothing is ever written into a workdir, and a
// folder that already holds a previous copy is REMOVED first, so a stale image from an older version of the
// entry can never be read as if it were this one.

/** A refusal the agent is meant to read: the message IS the answer, so it must be a sentence with a fix. */
export class Refused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Refused";
  }
}

/** One line from anything thrown, for a message a caller can print. */
export function why(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** §5's stack: the origin `loombot/account.ts` `accountOrigin()` defaults to. */
export const DEFAULT_ORIGIN = "https://loombot.ai";

/** §4's page size, so `list` reads one page a person scrolls unless the caller asks for more. */
export const PAGE = 20;

/** What `list` will read at most, and past it a caller is asking for an export rather than a listing. */
export const MAX_LIMIT = 100;

/** §3's `entry_id`: a uuid and nothing else, the one shape a reference may cite as `loom://e/<uuid>`. */
export const ENTRY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One file of a credential, as `loombot/account.ts` `AccountFile` keeps it. `session` is the secret. */
export interface Credential {
  readonly origin: string;
  readonly deviceId: string;
  readonly session: string;
  readonly account?: string | undefined;
}

/**
 * THE ACCOUNT FILE'S NAME FROM THE ORIGIN — a convention, not a hash: `https://loombot.ai` is
 * `https-loombot.ai.json` and `http://localhost:8798` is `http-localhost-8798.json`. The scheme survives as a
 * prefix and every `:` and `/` after it becomes `-`, which is what the four files in `~/.loom/accounts/` on
 * this machine are named - measured, not assumed, because a wrong guess here is a refusal on a bound machine.
 */
export function slugOfOrigin(origin: string): string {
  return origin.replace(/\/+$/, "").replace("://", "-").replace(/[:/]/g, "-");
}

/** Where this server looks: the stack, the accounts directory, and the workdir whose `.loom/` it reads. */
export interface Where {
  readonly origin: string;
  readonly accounts: string;
  readonly workdir: string;
}

/** The credential files, nearest-first: the workdir's (what a pairing writes today), then the machine's. */
export function credentialPaths(w: Where): readonly string[] {
  const workdir = w.workdir.replace(/\/+$/, "");
  const accounts = w.accounts.replace(/\/+$/, "");
  return [workdir + "/.loom/account.json", accounts + "/" + slugOfOrigin(w.origin) + ".json"];
}

/** One credential file read, and what it turned out to be. */
interface Held {
  readonly credential: Credential | null;
  /** The origin the file names, when it names one at all - so a mismatch can be said out loud. */
  readonly origin: string | null;
}

function heldOf(text: string): Held {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { credential: null, origin: null }; // a torn file is present and unreadable: not a credential
  }
  if (parsed === null || typeof parsed !== "object") return { credential: null, origin: null };
  const o = parsed as Record<string, unknown>;
  const origin = typeof o.origin === "string" ? o.origin.replace(/\/+$/, "") : "";
  const deviceId = typeof o.deviceId === "string" ? o.deviceId : "";
  const session = typeof o.session === "string" ? o.session : "";
  if (origin === "" || deviceId === "" || session === "") {
    return { credential: null, origin: origin === "" ? null : origin };
  }
  return {
    credential: {
      origin,
      deviceId,
      session,
      ...(typeof o.account === "string" && o.account !== "" ? { account: o.account } : {}),
    },
    origin,
  };
}

/**
 * THE CREDENTIAL FOR THIS STACK, OR THE REFUSAL THAT NAMES THE PRESS WHICH FIXES IT.
 *
 * A missing credential is the one refusal that must never be a stack trace: the person's next move is a
 * press on a page, and the sentence says which page and which button. Nothing is sent first - an anonymous
 * sync would come back 401 `not_a_machine` and say the same thing more slowly, and a publish attempt that
 * reaches the network before it knows WHO it is is a request somebody has to explain in a log.
 */
export async function credentialOf(w: Where): Promise<Credential> {
  const origin = w.origin.replace(/\/+$/, "");
  const found: string[] = [];
  for (const path of credentialPaths({ ...w, origin })) {
    let text: string;
    try {
      text = await Deno.readTextFile(path);
    } catch {
      continue; // no file at all: this machine has nothing there, which is a state and not a failure
    }
    const held = heldOf(text);
    if (held.credential !== null && held.credential.origin === origin) return held.credential;
    found.push(
      path + (held.origin === null ? " (not a credential)" : " (it is for " + held.origin + ")"),
    );
  }
  if (found.length > 0) {
    throw new Refused(
      "this machine holds no device credential FOR " + origin + ", so nothing was sent: " +
        found.join(", ") + " is not it. Pair this machine again on the " + origin +
        "/account page (Connect this machine, with loom running there) - publishing uses the credential a " +
        "pairing leaves behind, and there is no publish key to paste in instead.",
    );
  }
  throw new Refused(
    "this machine is not bound to " + origin +
      ", so nothing was sent: no device credential is at " +
      credentialPaths({ ...w, origin }).join(" or ") + ". Pair this machine on the " + origin +
      "/account page - Connect this machine, with loom running there - and run this again. Publishing is " +
      "what a bound machine does with the credential it already holds, so there is no publish key to paste " +
      "in instead and nothing to copy by hand.",
  );
}

/** A machine that has a credential, and the origin it is for: everything below takes this and nothing else. */
export interface Wire {
  readonly origin: string;
  readonly session: string;
  /** Injectable so a test drives this module without a socket to a real account. */
  readonly fetch?: typeof fetch | undefined;
}

/** A ceiling on one request, so a hung account answers with a refusal rather than a turn that never ends. */
const TIMEOUT_MS = 20_000;

async function request(w: Wire, url: string, init: RequestInit): Promise<Response> {
  const call = w.fetch ?? fetch;
  try {
    return await call(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new Refused(
      url + " could not be reached (" + why(e) +
        "), so nothing was read and nothing was written - check " +
        "the origin and this machine's network.",
    );
  }
}

/** One answered page, after every redirect this client agrees to follow. */
interface Page {
  readonly status: number;
  /** The address the answer came from, which is how an entry id is turned into its CURRENT place. */
  readonly url: string;
  readonly contentType: string;
  readonly text: string;
}

/**
 * GET, FOLLOWING UP TO THREE REDIRECTS BY HAND.
 *
 * By hand because §3's resolver IS a redirect and the address it lands on is the answer: `/library/e/<uuid>`
 * answers 302 to wherever the entry lives now, and a client that let `fetch` follow it would learn the page
 * and lose the address. Three hops is more than this service has ever used - the resolver, the old-name 301,
 * and the old-slug 301 - and a fourth is a loop this client refuses rather than spins in.
 */
async function follow(w: Wire, url: string, accept: string): Promise<Page> {
  let at = url;
  for (let hop = 0; hop < 4; hop++) {
    const res = await request(w, at, {
      method: "GET",
      headers: { accept },
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (location === null) {
        throw new Refused(
          at + " answered " + res.status + " with no location, so there is nothing to follow.",
        );
      }
      at = new URL(location, at).toString();
      continue;
    }
    return {
      status: res.status,
      url: at,
      contentType: (res.headers.get("content-type") ?? "").toLowerCase(),
      text: await res.text(),
    };
  }
  throw new Refused(
    url + " redirected more than three times, so this client stopped rather than loop: the " +
      "address it last went to is " + at + ".",
  );
}

/** The site's own sentence from a page, or the account's `message` from a JSON refusal. */
function messageOf(page: Page): string {
  if (page.contentType.includes("json")) {
    try {
      const body = JSON.parse(page.text) as { error?: unknown; message?: unknown };
      const error = typeof body.error === "string" ? body.error : "";
      const message = typeof body.message === "string" ? body.message : "";
      if (message !== "") return error === "" ? message : error + ": " + message;
    } catch { /* not JSON after all: fall through to the markup */ }
  }
  const lede = /<p class="lede">([\s\S]*?)<\/p>/.exec(page.text);
  if (lede !== null) return unesc(lede[1]).trim();
  return "";
}

/** A refusal built from an answer, so a 404 says what the site says rather than only its status. */
function refused(page: Page, what: string): Refused {
  const message = messageOf(page);
  return new Refused(what + " answered " + page.status + (message === "" ? "" : ": " + message));
}

/** The five characters `esc()` escapes in `src/views.ts`, back again. Names and descriptions are text. */
function unesc(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function objectOf(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? v as Record<string, unknown>
    : null;
}

// ── listing: GET /library/<handle> ───────────────────────────────────────────────────────────────────

/** §4's one row: what a listing is FOR, and nothing else is asked of the account. */
export interface RemoteEntry {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  /** `published_at` is the account's own; absent when the page was read as HTML (see the header). */
  readonly published_at: string | null;
  readonly url: string;
  readonly entry_id: string | null;
  /** §3's content id: WHICH VERSION, the thing an asset URL carries and an endorsement names. */
  readonly id: string | null;
}

export interface Listing {
  readonly entries: readonly RemoteEntry[];
  /** The cursor a page carries for the next one, or null when this is the last page. */
  readonly before: string | null;
}

function rowOf(row: Record<string, unknown>, origin: string, handle: string): RemoteEntry {
  const slug = str(row.slug) === "" ? str(row.path) : str(row.slug);
  return {
    slug: slug.replace(/^\/+|\/+$/g, ""),
    name: str(row.name),
    description: str(row.description),
    published_at: str(row.published_at) === "" ? null : str(row.published_at),
    url: str(row.url) === "" ? origin + "/library/" + handle + "/" + slug : str(row.url),
    entry_id: ENTRY_ID.test(str(row.entry_id)) ? str(row.entry_id) : null,
    id: str(row.id) === "" ? null : str(row.id),
  };
}

function listingJson(text: string, origin: string, handle: string): Listing {
  const body = objectOf(JSON.parse(text)) ?? {};
  const rows = Array.isArray(body.entries) ? body.entries : [];
  const entries = rows.map(objectOf).filter((row): row is Record<string, unknown> => row !== null)
    .map((row) => rowOf(row, origin, handle));
  const before = body.before;
  return {
    entries,
    before: typeof before === "number" ? String(before) : (str(before) === "" ? null : str(before)),
  };
}

/**
 * THE LISTING AS THE SITE DRAWS IT, pinned to `entryRow`'s own output:
 *
 *     <li><p><a href="/library/<handle>/<slug>">NAME</a></p><p class="lede">DESCRIPTION</p>
 *         <p class="lede">DAY</p></li>
 *
 * and the "Older entries" link carries the cursor (`?before=<published_at>:<slug>`). The rows and the link
 * are matched together so a description that happens to be shaped like a link cannot be mistaken for one.
 */
const LISTING_ROW =
  /<li><p><a href="([^"]+)">([\s\S]*?)<\/a><\/p><p class="lede">([\s\S]*?)<\/p><p class="lede">([\s\S]*?)<\/p><\/li>/g;

function listingHtml(text: string, origin: string, handle: string): Listing {
  const entries: RemoteEntry[] = [];
  for (const m of text.matchAll(LISTING_ROW)) {
    const url = unesc(m[1]);
    const slug = url.replace(/^.*\/library\/[^/]+\//, "").replace(/[?#].*$/, "");
    entries.push({
      slug,
      name: unesc(m[2]).trim(),
      description: unesc(m[3]).trim(),
      published_at: unesc(m[4]).trim() === "" ? null : unesc(m[4]).trim(),
      url: url.startsWith("http") ? url : origin + url,
      entry_id: null,
      id: idOfUrl(url),
    });
  }
  const older = new RegExp('href="[^"]*?/library/' + esc4(handle) + '\\?before=([^"&]+)"').exec(
    text,
  );
  return { entries, before: older === null ? null : unesc(older[1]) };
}

/** A handle is a path segment and a query, so it is escaped for a regex built from it. */
function esc4(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** §10's `?v=<content id>` on every asset URL - the one place a page states the version it is of. */
function idOfUrl(url: string): string | null {
  const v = /[?&]v=([^&#]+)/.exec(url);
  return v === null ? null : decodeURIComponent(v[1]);
}

/**
 * `list`: ONE HANDLE'S ENTRIES, NEWEST FIRST, WALKED BY CURSOR UNTIL THE CALLER'S LIMIT.
 *
 * The walk is §4's keyset walk and not an offset, so a limit larger than one page costs one request a page
 * and never re-reads a row. Ten pages is the ceiling because a hundred entries is `MAX_LIMIT`'s whole point
 * and a walk that went further would be an export, which is a different verb this lane does not have.
 */
export async function listLibrary(
  w: Wire,
  handle: string,
  limit: number,
): Promise<
  { readonly handle: string; readonly entries: readonly RemoteEntry[]; readonly more: boolean }
> {
  const want = Math.max(1, Math.min(Math.trunc(limit), MAX_LIMIT));
  const entries: RemoteEntry[] = [];
  let before: string | null = null;
  let more = false;
  for (let page = 0; page < 10; page++) {
    const at = w.origin + "/library/" + encodeURIComponent(handle) +
      (before === null ? "" : "?before=" + encodeURIComponent(before));
    const got = await follow(w, at, "application/json, text/html;q=0.9");
    if (got.status !== 200) throw refused(got, at);
    const listing = got.contentType.includes("json")
      ? listingJson(got.text, w.origin, handle)
      : listingHtml(got.text, w.origin, handle);
    entries.push(...listing.entries);
    before = listing.before;
    if (entries.length >= want || before === null) {
      more = entries.length > want || before !== null;
      break;
    }
  }
  return { handle, entries: entries.slice(0, want), more };
}

// ── one entry: GET /library/<handle>/<slug> ──────────────────────────────────────────────────────────

/** One file of an entry, as the page or the manifest names it. `content` is base64 when inlined. */
export interface RemoteFile {
  readonly path: string;
  readonly type: string | null;
  readonly url: string | null;
  readonly content: string | null;
}

/** One entry: §3's three identities, the two fields a listing shows, and the files to write. */
export interface RemoteEntryPage {
  readonly handle: string;
  readonly slug: string;
  readonly entry_id: string | null;
  readonly id: string | null;
  readonly name: string;
  readonly description: string;
  readonly published_at: string | null;
  readonly files: readonly RemoteFile[];
}

function fileOf(row: Record<string, unknown>): RemoteFile | null {
  const path = str(row.path).replace(/^\/+/, "");
  if (path === "") return null;
  return {
    path,
    type: str(row.type) === "" ? null : str(row.type),
    url: str(row.url) === "" ? null : str(row.url),
    content: str(row.content) === "" ? null : str(row.content),
  };
}

function entryJson(text: string, handle: string, slug: string): RemoteEntryPage {
  const body = objectOf(JSON.parse(text)) ?? {};
  const rows = Array.isArray(body.files) ? body.files : [];
  return {
    handle: str(body.handle) === "" ? handle : str(body.handle),
    slug: str(body.slug) === "" ? slug : str(body.slug),
    entry_id: ENTRY_ID.test(str(body.entry_id)) ? str(body.entry_id) : null,
    id: str(body.id) === "" ? null : str(body.id),
    name: str(body.name),
    description: str(body.description),
    published_at: str(body.published_at) === "" ? null : str(body.published_at),
    files: rows.map(objectOf).filter((row): row is Record<string, unknown> => row !== null)
      .map(fileOf).filter((file): file is RemoteFile => file !== null),
  };
}

/**
 * THE ENTRY PAGE AS THE SITE DRAWS IT (`entryPage`), and the FILES a reader can reach from it.
 *
 * Two facts are read out of the markup and nowhere else: the name (the page's own `og:title`, which is the
 * row's name) and the content id (the `?v=` every asset URL carries, §10). What is NOT on the page is
 * `entry_id` and `published_at`: the page prints "as of <front matter> · shared <day>" but nothing that
 * names the row's uuid, so both come back null and the answer says so rather than inventing one.
 *
 * THE FILE LIST IS THE FILES THE ENTRY ADDRESSES: `README.md` itself, plus every asset URL inside the
 * entry's own folder that the rendered body points at (§2: "diagram.png and whatever else the entry
 * addresses relatively"). A file the README never mentions is not reachable from a page, so no client can
 * enumerate it from this side - `get` takes what the entry shows, which is exactly §2's own definition of
 * what sharing copies.
 */
function entryHtml(text: string, origin: string, handle: string, slug: string): RemoteEntryPage {
  const title = /<meta property="og:title" content="([^"]*)">/.exec(text);
  const h1 = /<h1>([\s\S]*?)<\/h1>/.exec(text);
  const description = /<meta name="description" content="([^"]*)">/.exec(text);
  const article = /<article class="post">([\s\S]*?)<\/article>/.exec(text);
  const version = /[?&]v=([^"&#]+)/.exec(text);
  const id = version === null ? null : decodeURIComponent(version[1]);
  const prefix = "/library/" + handle + "/" + slug + "/";
  const seen = new Set<string>();
  const files: RemoteFile[] = [{
    path: "README.md",
    type: "text/markdown",
    url: origin + prefix + "README.md" + (id === null ? "" : "?v=" + id),
    content: null,
  }];
  seen.add("README.md");
  for (const m of (article === null ? "" : article[1]).matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = unesc(m[1]);
    if (!url.startsWith(prefix)) continue; // another entry, a citation, a third party: not this folder
    const path = decodeURIComponent(url.slice(prefix.length).replace(/[?#].*$/, ""));
    if (path === "" || seen.has(path)) continue;
    seen.add(path);
    files.push({ path, type: null, url: origin + url, content: null });
  }
  return {
    handle,
    slug,
    entry_id: null,
    id,
    name: title === null ? (h1 === null ? slug : unesc(h1[1]).trim()) : unesc(title[1]),
    description: description === null ? "" : unesc(description[1]),
    published_at: null,
    files,
  };
}

function pageFrom(page: Page, origin: string, handle: string, slug: string): RemoteEntryPage {
  return page.contentType.includes("json")
    ? entryJson(page.text, handle, slug)
    : entryHtml(page.text, origin, handle, slug);
}

async function entryPageOf(w: Wire, handle: string, slug: string): Promise<RemoteEntryPage> {
  const at = w.origin + "/library/" + encodePath(handle) + "/" + encodePath(slug);
  const got = await follow(w, at, "application/json, text/html;q=0.9");
  if (got.status !== 200) throw refused(got, at);
  return pageFrom(got, w.origin, handle, slug);
}

/** A slug is a path (§3), so its segments are escaped and its slashes kept. */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** Where `/library/<handle>/<slug>/…` points: the two parts an entry's place is made of. */
function placeFromUrl(url: string): { readonly handle: string; readonly slug: string } | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const segments = path.split("/").filter((s) => s !== "");
  if (segments.length < 4 || segments[0] !== "library") return null;
  if (segments[1] === "e") return null; // the resolver again: not a place
  return {
    handle: decodeURIComponent(segments[1]),
    slug: segments.slice(2).map(decodeURIComponent).join("/"),
  };
}

/** §8's `get` arguments: an address, or §3's identity. One or the other, never both. */
export interface Ask {
  readonly handle?: string | undefined;
  readonly slug?: string | undefined;
  readonly id?: string | undefined;
}

/** What `get` answers: the PATH first, because that is what the viewer and `read` are handed. */
export interface Got {
  readonly path: string;
  readonly handle: string;
  readonly slug: string;
  readonly entry_id: string | null;
  readonly id: string | null;
  readonly name: string;
  readonly description: string;
  readonly published_at: string | null;
  readonly files: readonly { readonly path: string; readonly bytes: number }[];
}

/** A path inside an entry's folder and nothing else - the same rule §6's `path_escapes` keeps at publish. */
function insidePath(raw: string): string {
  const path = raw.replace(/^\/+/, "");
  const segments = path.split("/");
  if (
    path === "" || segments.some((s) => s === "" || s === "." || s === "..") || path.includes("\\")
  ) {
    throw new Refused(
      JSON.stringify(raw) +
        " is not a path inside the entry, so nothing was written: an entry's files are " +
        "relative paths under its own folder, and " + JSON.stringify(raw) +
        " would land somewhere else.",
    );
  }
  return path;
}

async function download(w: Wire, url: string): Promise<Uint8Array> {
  const res = await request(w, url, { method: "GET", redirect: "follow" });
  if (res.status !== 200) {
    await res.body?.cancel();
    throw new Refused(
      url + " answered " + res.status +
        ", so this entry's file is not there and nothing was written - the " +
        "entry's row may be newer than its bytes, and a re-sync fixes that.",
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * `get`: THE ENTRY'S FILES INTO A FOLDER, AND THE PATH BACK.
 *
 * The folder is `<into>/<handle>/<slug>`, which is the entry's own place with its slashes kept, so a
 * sub-entry (`relay/streams`) writes into `relay/streams/` and two entries never collide. An existing folder
 * is REMOVED first: a version of the entry that dropped an image must not leave the old image readable.
 *
 * `id` is §3's ENTRY id and it is resolved through the resolver, because a reference has to survive the
 * entry moving - a client that only understood `<handle>/<slug>` would be reading an address a citation
 * cannot name. A content id is refused BY NAME: it names a version, and §3 gives versions no resolver.
 */
export async function fetchEntry(w: Wire, ask: Ask, into: string): Promise<Got> {
  let handle = (ask.handle ?? "").trim();
  let slug = (ask.slug ?? "").trim().replace(/^\/+|\/+$/g, "");
  let held: Page | null = null;
  const id = (ask.id ?? "").trim().toLowerCase();
  if (id !== "") {
    if (handle !== "" || slug !== "") {
      throw new Refused(
        "get takes {handle, slug} OR {id}, and both arrived: pass the address you have, and an id only " +
          "when you are holding a reference (`loom://e/<uuid>`) - an id is resolved to the entry's CURRENT " +
          "address, so the two cannot disagree once both are given.",
      );
    }
    if (!ENTRY_ID.test(id)) {
      throw new Refused(
        JSON.stringify(ask.id) +
          " is not an entry id, so nothing was fetched: an entry id is the uuid a " +
          "reference cites (loom://e/<uuid>), and a CONTENT id - the version an asset URL carries - has no " +
          "resolver (§3), so pass {handle, slug} for a version you are looking at.",
      );
    }
    const at = w.origin + "/library/e/" + id;
    held = await follow(w, at, "application/json, text/html;q=0.9");
    if (held.status !== 200) throw refused(held, at);
    const place = placeFromUrl(held.url);
    if (place === null) {
      throw new Refused(
        at + " answered " + held.status +
          " at its own address instead of resolving to an entry's place: an " +
          "id resolves to /library/<handle>/<slug> (§3), and this answer did not, so there is no folder to " +
          "write into.",
      );
    }
    handle = place.handle;
    slug = place.slug;
  }
  if (handle === "" || slug === "") {
    throw new Refused(
      "get needs an entry: pass {handle, slug} - the handle is the name a stranger types at " +
        w.origin +
        "/library/<handle>, and the slug is the path inside that person's entry tree - or " +
        "{id} when you are holding a reference.",
    );
  }
  const page = held === null
    ? await entryPageOf(w, handle, slug)
    : pageFrom(held, w.origin, handle, slug);
  const dir = into.replace(/\/+$/, "") + "/" + page.handle + "/" + page.slug;
  await Deno.remove(dir, { recursive: true }).catch(() => {}); // a stale copy is worse than no copy
  await Deno.mkdir(dir, { recursive: true });
  const written: { path: string; bytes: number }[] = [];
  for (const file of page.files) {
    const path = insidePath(file.path);
    const bytes = file.content !== null
      ? Uint8Array.fromBase64(file.content)
      : await download(w, resolveUrl(file.url, w.origin));
    const abs = dir + "/" + path;
    await Deno.mkdir(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
    await Deno.writeFile(abs, bytes);
    written.push({ path, bytes: bytes.byteLength });
  }
  return {
    path: dir,
    handle: page.handle,
    slug: page.slug,
    entry_id: page.entry_id,
    id: page.id,
    name: page.name,
    description: page.description,
    published_at: page.published_at,
    files: written,
  };
}

/** A URL from a manifest, absolute or relative to the stack. */
function resolveUrl(url: string | null, origin: string): string {
  if (url === null || url === "") {
    throw new Refused(
      "a file arrived with neither bytes nor an address, so nothing was written: an entry's manifest has to " +
        "say WHERE each file is.",
    );
  }
  try {
    return new URL(url, origin + "/").toString();
  } catch {
    throw new Refused(JSON.stringify(url) + " is not a URL, so nothing was written.");
  }
}
