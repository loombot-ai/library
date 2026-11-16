// THE PUBLISHED SET IS A FOLDER, AND THIS FILE IS THE ONE THAT READS IT (§6, owner 2026-11-08:
// `本地library里面有个share folder，share只是把这个folder同步到线上？这样是不是简单一些？`).
//
// Publishing is not a command with arguments: it is a FILESYSTEM FACT. `~/.loom/library/share/` is the
// public set, an entry is a folder in it holding `README.md`, and a folder in the middle of the tree that
// holds no `README.md` is just a nesting level (`share/relay/streams/` is an entry and `share/relay/` need
// not be one). Everything else in the private library is private and is never looked at.
//
// ## It refuses LOCALLY what the account would refuse
//
// §6's table is the account's own, and every row of it is cheaper to answer here: a folder with no
// `README.md` (`not_an_entry`), a `README.md` whose front matter has no `name`, `description` or `as_of`
// (`no_front_matter`), a file outside the five types (`unsupported_type`), and the three size limits
// (`too_large`). A sync is ONE request and it is all-or-nothing, so a tree with one bad entry would fail
// as a whole anyway - the difference is that this file can say WHICH entry, WHICH file and WHICH field
// before a byte leaves the machine, and the account's answer can only say it once and for one of them.
//
// ## What is never sent, and why the id still travels
//
// `AGENT.md` is the file beside CODE - read before CHANGING the thing it is about - and it is a fact about
// the private folder, not about the entry a stranger reads, so it is not sent (§2). A DOT FILE is metadata
// by the same rule, and `.loom-entry.json` is the one dot file this file READS: `{entry_id, handle}`, written
// the first time an entry is shared and never before, so an entry can be moved in the private tree and stay
// the same entry publicly (§5's three identities: `entry_id` is WHICH ENTRY, `slug` is WHERE it lives, `id`
// is WHICH VERSION). It is what lets a re-sync keep an entry's identity instead of minting a new one.
//
// ## The plan is a person's sentence
//
// §8: "`plan` (the default) shows add/update/delete and applies nothing". So the words are a list a person
// can act on - `2 new, 1 changed, 1 to remove`, then one line an entry with its address - and the last line
// says what did and did not happen. An apply writes the entry ids the account minted back into each entry's
// `.loom-entry.json`, which is the only thing on this machine a sync changes.

import { frontMatter } from "../../front_matter.ts";
import { Refused, why } from "./wire.ts";

/**
 * `~/.loom/library` — the personal root, and the ONE line of `loom/library.ts`'s `globalDir` this server
 * needs.
 *
 * RESTATED RATHER THAN IMPORTED, and the reason is measured rather than stylistic: a system-library program
 * has to have its whole value-import graph carried by `RUNTIME_FILES` (`tools/package.ts`, asserted by
 * `tests/system_programs_test.ts`), and `loom/library.ts` reaches five modules (`root.ts`, `home.ts`,
 * `entry_files.ts`, `front_matter.ts`, `@std/path`) to answer a three-line question about a path this file
 * already knows. `frontMatter` IS imported: two readers of one front-matter block is the duplication worth
 * refusing, and this server's whole local refusal exists to agree with what the account will say.
 */
function globalDir(): string | undefined {
  const home = Deno.env.get("HOME");
  return home === undefined || home === ""
    ? undefined
    : home.replace(/\/+$/, "") + "/.loom/library";
}

/** The entry file: what the entry IS and how to USE it (§2). Its front matter is where the fields live. */
export const README = "README.md";

/** The file beside CODE, read before changing it, and NEVER published (§2). */
export const AGENT = "AGENT.md";

/** An entry's own identity in its folder: `{entry_id, handle}` (§5). Read for the id, never sent as a file. */
export const META = ".loom-entry.json";

/** §2's three required fields, and the whole reason an entry can be listed, selected and retired. */
const REQUIRED = ["name", "description", "as_of"] as const;

/** §6's five types, by extension - the ONLY files an entry may hold. */
const TYPES: Readonly<Record<string, string>> = {
  md: "text/markdown",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** §6's three size limits: 32 files in an entry, 1 MB in a file, 2 MB in one sync. */
export const MAX_FILES = 32;
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

/** `~/.loom/library/share/`, or a path a caller named (a flag, a test's own tree). */
export function shareDir(named?: string | undefined): string {
  if (named !== undefined && named.trim() !== "") return named.trim().replace(/\/+$/, "");
  const library = globalDir();
  if (library === undefined) {
    throw new Refused(
      "no HOME is set, so there is no `~/.loom/library/share/` to publish and nothing was sent: name the " +
        "folder with --share PATH.",
    );
  }
  return library + "/share";
}

/** One file of one entry, as the payload carries it. */
export interface ShareFile {
  /** Relative to the entry's own folder, and never `..` - the tree it came out of decides that. */
  readonly path: string;
  /** §6's type, or "" for a file outside the five, which `check` refuses by name. */
  readonly type: string;
  readonly bytes: Uint8Array;
}

/** One entry: its place in `share/`, the id it already carries, and its files. */
export interface ShareEntry {
  /** The path inside `share/`, which IS the slug unless the front matter overrides it (§6). */
  readonly path: string;
  readonly entry_id: string | null;
  readonly files: readonly ShareFile[];
}

/** One thing that will stop a sync, and the sentence a person reads. */
export interface Trouble {
  readonly path: string;
  readonly sentence: string;
}

/** What one walk found. `strayed` is named in the answer and never refused: see `walkInto`. */
export interface Walked {
  readonly share: string;
  readonly entries: readonly ShareEntry[];
  readonly trouble: readonly Trouble[];
  readonly strayed: readonly string[];
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * ONE WALK OF `share/`, AND THE RULES THAT DECIDE WHAT IS AN ENTRY.
 *
 * A folder is an entry exactly when it holds `README.md` at its own level. Its sub-entries are separate
 * entries at their own paths, so the walk always descends - `share/relay/` may be an entry with
 * `share/relay/streams/` an entry under it, and the two are two addresses.
 *
 * A FOLDER WITH FILES AND NO README IS REFUSED, because a person who left one believes those bytes are
 * published and they are not - that is the mistake this verb exists to catch. A FOLDER WITH NEITHER FILES
 * NOR A README is silent: it is an empty nesting level, and `mkdir` leaves those behind.
 *
 * A FILE AT THE TOP OF `share/` IS NAMED AND SKIPPED rather than refused: the top of the folder is not an
 * entry and could never be one (`share/` is the set, not a member of it), so a note someone keeps there -
 * a `README.md` explaining the folder, a scratch file - is not a mistake about publishing. It is printed so
 * nobody has to wonder why it is not on the site.
 */
export async function walkShare(share: string): Promise<Walked> {
  const root = share.replace(/\/+$/, "");
  let info: Deno.FileInfo;
  try {
    info = await Deno.stat(root);
  } catch {
    throw new Refused(
      root +
        " does not exist, so nothing was sent: the published set IS that folder (§6) - an entry is a " +
        "folder in it holding README.md, and with the folder absent there is nothing to publish.",
    );
  }
  if (!info.isDirectory) {
    throw new Refused(
      root + " is not a folder, so nothing was sent: the published set is the folder " +
        "`~/.loom/library/share/`, and its entries are the folders inside it.",
    );
  }
  const out: { share: string; entries: ShareEntry[]; trouble: Trouble[]; strayed: string[] } = {
    share: root,
    entries: [],
    trouble: [],
    strayed: [],
  };
  await walkInto(root, "", out);
  out.entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  out.strayed.sort();
  return out;
}

interface Gathered {
  readonly share: string;
  readonly entries: ShareEntry[];
  readonly trouble: Trouble[];
  readonly strayed: string[];
}

async function walkInto(dir: string, rel: string, out: Gathered): Promise<void> {
  const names: string[] = [];
  const dirs: string[] = [];
  for await (const item of Deno.readDir(dir)) {
    if (item.isDirectory) dirs.push(item.name);
    else if (item.isFile) names.push(item.name);
  }
  names.sort();
  dirs.sort();
  const isEntry = rel !== "" && names.includes(README);
  // NOT SENT: the entry's own `AGENT.md` (§2) and every dot file (§5's metadata rule, `.loom-entry.json`
  // included - the id is READ below and never travels as a file). `README.md` IS carried: it is the entry,
  // and its own front matter is where §6 reads the three fields from.
  const carried = names.filter((n) => n !== AGENT && !n.startsWith("."));
  if (isEntry) {
    const entry: { path: string; entry_id: string | null; files: ShareFile[] } = {
      path: rel,
      entry_id: names.includes(META) ? await idIn(dir + "/" + META) : null,
      files: [],
    };
    for (const name of carried) {
      let bytes: Uint8Array;
      try {
        bytes = await Deno.readFile(dir + "/" + name);
      } catch (e) {
        throw new Refused(
          "share/" + rel + "/" + name + " could not be read (" + why(e) +
            "), so nothing was sent: a sync " +
            "sends bytes, and this file's are not readable.",
        );
      }
      entry.files.push({ path: name, type: TYPES[extensionOf(name)] ?? "", bytes });
    }
    out.entries.push(entry);
  } else if (rel !== "") {
    // FILES HERE BELONG TO NO ENTRY: printed, and refused, because they were meant to be published.
    for (const name of carried) out.strayed.push(rel + "/" + name);
    if (carried.length > 0) out.trouble.push({ path: rel, sentence: notAnEntry(rel, carried) });
  } else {
    // THE TOP OF `share/` IS NOT AN ENTRY. A file there is named and skipped; a `README.md` explaining the
    // folder is the common case and is not a mistake.
    for (const name of names) out.strayed.push(name);
  }
  for (const name of dirs) {
    await walkInto(dir + "/" + name, rel === "" ? name : rel + "/" + name, out);
  }
}

/** `.loom-entry.json`, read for the one field that decides whether a re-sync keeps an identity. */
async function idIn(path: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await Deno.readTextFile(path)) as { entry_id?: unknown };
    const id = typeof parsed.entry_id === "string" ? parsed.entry_id.trim().toLowerCase() : "";
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? id : null;
  } catch {
    // A dot file that is not one is not a refusal: the account mints the id at the first share anyway, and
    // refusing here would stop a publish over a file nothing reads.
    return null;
  }
}

function notAnEntry(rel: string, carried: readonly string[]): string {
  return "share/" + rel + " is not an entry: an entry is a folder holding " + README +
    ", and this one " +
    "holds " + carried.join(", ") + " and no " + README +
    ", so those files belong to no entry and would never be published. Nothing was sent - move them into an " +
    "entry folder, or add a " + README + " beside them (§2: every entry is a folder with one).";
}

function noFrontMatter(share: string, rel: string, missing: readonly string[]): string {
  return share + "/" + rel + "/" + README + " has no " + missing.join(", no ") +
    " in its front matter, so nothing was sent: an entry's name, description and as_of are read from that " +
    "file's front matter and from nowhere else (§6), and all three are required at publish - an entry nobody " +
    "can summarise is one nobody will open, and an entry nobody can DATE cannot be retired on evidence. " +
    "Add " + missing.map((field) => field + ":").join(" ") +
    " to the block between the two `---` lines.";
}

function unsupported(share: string, rel: string, name: string): string {
  return share + "/" + (rel === "" ? "" : rel + "/") + name +
    " is not one of the five types an entry may " +
    "hold (" + Object.values(TYPES).filter((t, i, all) => all.indexOf(t) === i).join(", ") +
    "), so nothing was sent: §6 answers 422 unsupported_type for anything else, and a type an entry cannot " +
    "carry is a link a reader's page would have to fetch from somewhere it does not trust.";
}

function tooLarge(
  share: string,
  rel: string,
  name: string,
  bytes: number,
  limit: number,
  what: string,
): string {
  return share + "/" + (rel === "" ? "" : rel + "/") + name + " is " + kb(bytes) + " and " + what +
    " is at " +
    "most " + kb(limit) +
    ", so nothing was sent: §6 answers 413 too_large for it, and the limit exists " +
    "because one sync is one request.";
}

function kb(bytes: number): string {
  return bytes < 1024 ? bytes + " B" : Math.round(bytes / 1024) + " KB";
}

/**
 * EVERY REASON THIS TREE WOULD BE REFUSED, SAID BEFORE ANYTHING IS SENT.
 *
 * §6's refusals are the account's, and this answers the same ones locally: it is the same rule read twice,
 * and the copy that can be read first is the one that costs no request. `check` returns ALL of them, because
 * a person fixing an export wants the list rather than one line per attempt - and because the caller sends
 * nothing when it is non-empty (one message listing them).
 */
export function check(walked: Walked): readonly Trouble[] {
  const trouble: Trouble[] = [...walked.trouble];
  let total = 0;
  for (const entry of walked.entries) {
    const readme = entry.files.find((file) => file.path === README);
    const fields = readme === undefined
      ? undefined
      : frontMatter(new TextDecoder().decode(readme.bytes));
    const missing = REQUIRED.filter((field) => ((fields?.[field]) ?? "").trim() === "");
    if (missing.length > 0) {
      trouble.push({
        path: entry.path,
        sentence: noFrontMatter(walked.share, entry.path, missing),
      });
    }
    for (const file of entry.files) {
      if (file.type === "") {
        trouble.push({
          path: entry.path + "/" + file.path,
          sentence: unsupported(walked.share, entry.path, file.path),
        });
        continue; // its bytes are not sent, so its size is not the next thing to say
      }
      if (file.bytes.byteLength > MAX_FILE_BYTES) {
        trouble.push({
          path: entry.path + "/" + file.path,
          sentence: tooLarge(
            walked.share,
            entry.path,
            file.path,
            file.bytes.byteLength,
            MAX_FILE_BYTES,
            "a file",
          ),
        });
      }
      total += file.bytes.byteLength;
    }
    if (entry.files.length > MAX_FILES) {
      trouble.push({
        path: entry.path,
        sentence: walked.share + "/" + entry.path + " holds " + entry.files.length +
          " files and an entry is " +
          "at most " + MAX_FILES + ", so nothing was sent (§6 answers 413 too_large for it).",
      });
    }
  }
  if (total > MAX_PAYLOAD_BYTES) {
    trouble.push({
      path: walked.share,
      sentence: "this tree is " + kb(total) + " and one sync is at most " + kb(MAX_PAYLOAD_BYTES) +
        ", so nothing was sent (§6 answers 413 too_large for it): publish fewer entries at once.",
    });
  }
  return trouble;
}

/**
 * ONE MESSAGE FOR EVERYTHING THAT IS WRONG, and it opens by saying nothing was sent.
 *
 * The count is in the first line because the person's next move depends on it: one bad entry is a fix, and
 * nine are a different afternoon. Every sentence follows on its own line, so a scan finds the field or the
 * file that has to change.
 */
export function refusalOf(trouble: readonly Trouble[]): Refused {
  const lines = trouble.map((one) => one.sentence);
  return new Refused(
    "nothing was sent: " + trouble.length + (trouble.length === 1 ? " thing" : " things") +
      " in share/ would be refused at publish, and a sync is all-or-nothing (§6)\n" +
      lines.join("\n"),
  );
}

/** §6's request body: `sync` decides dry run or apply, and one entry per folder holding a README. */
export function payloadOf(walked: Walked, sync: boolean): Record<string, unknown> {
  return {
    sync,
    entries: walked.entries.map((entry) => ({
      path: entry.path,
      entry_id: entry.entry_id,
      files: entry.files.map((file) => ({
        path: file.path,
        type: file.type,
        content: file.bytes.toBase64(),
      })),
    })),
  };
}

/** One row of §6's answer: an entry the sync adds, updates or deletes. */
export interface Answered {
  readonly path: string;
  readonly entry_id: string | null;
  readonly url: string | null;
  readonly change: string;
}

/** §6's answer, normalized: the three counts and one row per entry, deletions included. */
export interface Answer {
  readonly add: number;
  readonly update: number;
  readonly delete: number;
  readonly entries: readonly Answered[];
}

/** §6's answer body, read defensively: a count that is not a number is counted instead of trusted. */
export function answerOf(body: unknown): Answer {
  const o = body !== null && typeof body === "object" ? body as Record<string, unknown> : {};
  const rows = Array.isArray(o.entries) ? o.entries : [];
  const entries: Answered[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const path = typeof r.path === "string" ? r.path : "";
    if (path === "") continue;
    const change = typeof r.change === "string" ? r.change : "update";
    entries.push({
      path,
      entry_id: typeof r.entry_id === "string" && r.entry_id !== "" ? r.entry_id : null,
      url: typeof r.url === "string" && r.url !== "" ? r.url : null,
      change,
    });
  }
  const count = (key: "add" | "update" | "delete", kind: string): number => {
    const value = o[key];
    return typeof value === "number"
      ? value
      : entries.filter((entry) => entry.change === kind).length;
  };
  return {
    add: count("add", "add"),
    update: count("update", "update"),
    delete: count("delete", "delete"),
    entries,
  };
}

/**
 * THE HANDLE THIS MACHINE'S PUBLISHED ENTRIES CARRY, or null.
 *
 * §5 puts an entry's identity in its folder (`.loom-entry.json`, `{entry_id, handle}`), so a person who
 * has published anything has their own name on disk and `list` with no argument means "mine". Nothing is
 * asked of the account for it: the file is the fact, the walk is the one above this function's, and a
 * machine that has published nothing answers null so `list` can say what to pass instead of guessing at a
 * name that belongs to somebody else.
 */
export async function handleIn(share: string): Promise<string | null> {
  const root = share.replace(/\/+$/, "");
  const dirs = [root];
  while (dirs.length > 0) {
    const dir = dirs.shift() as string;
    let items: Deno.DirEntry[];
    try {
      items = [];
      for await (const item of Deno.readDir(dir)) items.push(item);
    } catch {
      continue; // a folder that cannot be read holds nothing this can trust
    }
    items.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const item of items) {
      const abs = dir + "/" + item.name;
      if (item.isDirectory) dirs.push(abs);
      else if (item.isFile && item.name === META) {
        try {
          const parsed = JSON.parse(await Deno.readTextFile(abs)) as { handle?: unknown };
          const handle = typeof parsed.handle === "string" ? parsed.handle.trim() : "";
          if (handle !== "") return handle;
        } catch { /* not a dot file this reads: the next entry decides */ }
      }
    }
  }
  return null;
}

/** The handle an answer's `url` names: `https://loombot.ai/library/<handle>/relay/streams`. */
export function handleOfUrl(url: string | null): string | null {
  if (url === null) return null;
  const m = /\/library\/([^/?#]+)\//.exec(url);
  return m === null ? null : decodeURIComponent(m[1]);
}

/**
 * THE PLAN AS A PERSON READS IT: the counts §8 names, then one line per entry with its address, then what
 * did and did not happen. An apply says the same thing in the same order - so the words a person pressed and
 * the words they got back are comparable, which is the only way "the plan was right" can be checked.
 */
export function wordsOf(answer: Answer, applied: boolean, wrote: readonly string[] = []): string {
  const label = (change: string): string =>
    change === "add" ? "new" : change === "delete" ? "remove" : "changed";
  const lines = [
    (applied ? "applied: " : "") + answer.add + " new, " + answer.update + " changed, " +
    answer.delete +
    " to remove",
    "",
  ];
  for (const entry of answer.entries) {
    lines.push(
      "  " + label(entry.change).padEnd(8) + " " + entry.path +
        (entry.url === null ? "" : "  " + entry.url),
    );
  }
  lines.push("");
  if (applied) {
    lines.push(
      "the published set is now exactly " + "share/ — " +
        (wrote.length === 0
          ? "no entry carried a new id back, so no .loom-entry.json changed."
          : wrote.length + (wrote.length === 1 ? " entry id" : " entry ids") + " written into " +
            META + ": " + wrote.join(", ")),
    );
  } else {
    lines.push(
      "nothing was published: this was a plan. It is one dry-run request (`sync: false`) - the account " +
        "computed these counts from this tree and wrote nothing, and no entry id was written here. Press " +
        "sync({plan: false}) to apply it.",
    );
  }
  return lines.join("\n");
}

/**
 * THE ONLY THING A SYNC CHANGES ON THIS MACHINE: each entry's `.loom-entry.json`, written with the id the
 * account minted (the first time) or kept (every time after, because the payload carried it).
 *
 * Written for adds and updates, never for deletions - a deleted entry's folder is not on this machine any
 * more, and a dot file left behind would claim an identity the account no longer holds. The write is atomic
 * (temp beside it, then rename) so an interrupted sync leaves the old file rather than half of one.
 */
export async function rememberIds(share: string, answer: Answer): Promise<readonly string[]> {
  const root = share.replace(/\/+$/, "");
  const handle = answer.entries.map((entry) => handleOfUrl(entry.url)).find((h) => h !== null) ??
    null;
  const wrote: string[] = [];
  for (const entry of answer.entries) {
    if (entry.change === "delete" || entry.entry_id === null) continue;
    const dir = root + "/" + entry.path;
    const file = dir + "/" + META;
    const body = JSON.stringify(
      { entry_id: entry.entry_id, ...(handle === null ? {} : { handle }) },
      null,
      2,
    ) + "\n";
    try {
      const held = await Deno.readTextFile(file).catch(() => "");
      if (held === body) continue; // already exactly this: a second sync rewrites nothing
      await Deno.mkdir(dir, { recursive: true });
      const temp = file + "." + crypto.randomUUID() + ".tmp";
      await Deno.writeTextFile(temp, body, { mode: 0o644 });
      await Deno.rename(temp, file);
      wrote.push(entry.path);
    } catch (e) {
      throw new Refused(
        "the sync was applied on the account, but " + file + " could not be written (" + why(e) +
          "): the entry is published and this machine has not recorded its id, so the next sync will mint " +
          "a second identity for it - fix the folder's permissions and run sync({plan: false}) again.",
      );
    }
  }
  return wrote;
}
