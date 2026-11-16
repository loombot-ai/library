// deno-lint-ignore-file no-explicit-any
// tasks.ts — a FIVE-VERB task board. Library-only: loom just loads it, and NOTHING in loom changes.
//
// Records are ONE FILE PER TASK at <dir>/<state>/<id>-<slug>.md, where <state> is one of open,
// claimed, done, deferred, dropped. THE FOLDER IS THE STATE: it is not a field in the front matter, so it
// cannot go stale beside one, "what is unfinished" is `ls <dir>/open`, and a state change is a
// rename. The front matter carries what the folder cannot (id, title, owner, worktree, times,
// source, links, tags), and the body carries WHY and the ACCEPTANCE CRITERIA — that body is what a
// sub-agent brief is made from.
//
// claim() is ATOMIC. Its critical section is a lock file created with O_EXCL (Deno.open's
// createNew), so of two concurrent claimers exactly one wins and the loser is told the task is
// already claimed. The lock is <dir>/.claim/<id>.lock — keyed by ID and NOT placed beside the
// record, because the holder RENAMES the record into claimed/ and a lock beside it would be left
// behind in the folder the record just left. There is NO shared index file: one file per task is
// the whole point, and an index is the thing that would corrupt.
//
// A `release` VERB, ADDITIVE, because a claim that cannot be given up has no exit: `claim` refuses
// a second claimer and `update` never took an owner, so an agent that failed to start, died or was
// stopped left a card saying it was being worked on for ever — and the workaround (move it to
// another state and back) reorders the notes (t20261022-050953-eb3b). release(id, { owner })
// renames the record back into open/, clears owner and worktree, and keeps the notes in order; only
// the name the record HOLDS may do it. `claim`'s signature is unchanged, on purpose: three agents
// were claiming live when this landed.
//
// THE OWNER OF A CLAIM IS THE WORKER'S NAME, AND THAT IS A BRIEF RATHER THAN CODE. A `claim` call
// cannot tell whether its caller is a sub-agent or the orchestrator, so nothing here infers it:
// whoever hands work to a worker claims UNDER THE WORKER'S NAME, and claims only once that worker
// exists so a failed start leaves no claim behind; the orchestrator claims in its own name only for
// work it does itself. Four cards read `owner: loom` while four sub-agents were doing the work, and
// a LATER run called loom read `loom` as itself — which is the failure this paragraph prevents, by
// being a paragraph. The convention is also in this entry's README.md, where an agent starting work
// reads it, and in `claim`'s own help text, where the caller is.

//
// A VERB REFUSES A FIELD IT DOES NOT KNOW, by name, listing the ones it does take: update(id,
// {notes: "..."}) — the field is `note` — was accepted, rewrote the record with a fresh `updated` and
// put the paragraph nowhere, which is the one failure a caller cannot see. The list is the verb's own
// schema, so the refusal and the signature help prints cannot disagree.
//
// AND THE READER REFUSES A BAG, the mirror of that: `readBoard` is the one export whose argument is a
// DIRECTORY rather than an options bag, so `readBoard({ dir })` — the shape create/update/list take —
// was answered with an EMPTY BOARD for a board of 142 records: `String({ dir })` is "[object Object]",
// which is a directory name the filesystem is happy to answer NotFound about, and an empty board is a
// legitimate answer to this function, so nothing could tell the two apart
// (t20261009-203105-2327). A shape that cannot be what the caller meant is refused at the edge, by
// name — as every field above already is.
//
// THE MIRROR OF THAT, AND THE WORSE HALF — it is not even empty: the six verbs take an OPTIONS BAG and
// nothing positional, so `list(dir)`, the way anyone would spell `list({ dir })`, had its argument
// IGNORED and read DEFAULT_DIR: the caller was answered about a DIFFERENT board, with no error. The same
// seam one shape over was merely loud — `create(dir)` came back as "create does not take 0, 1, 2, ...",
// the string's own INDICES, and `update({ id, title })` as "no task [object Object] in ./tasks" — and
// neither names the argument that was wrong. So a verb refuses an argument that is not a bag, and the
// three that take an `id` refuse a non-string one, each naming the shape it got and the call it takes
// (t20261009-212755-a15a).
//
// NO IMPORTS, on purpose: a bare specifier resolves against loom's own module rather than this
// folder, so this file uses only absolute paths and the globals Deno provides.
//
// VERSION 4: the front matter gained an OPTIONAL `tags` list — the same block-list-of-scalars
// grammar `links` already uses, so a hand-edited record stays readable. A record without the field
// reads as an EMPTY LIST rather than an error, which is why the records already on disk needed no
// migration, and the writer emits `tags: []` for a record nobody tagged, exactly as it does for
// `links` (Xiaohu, 2026-10-05).
// VERSION 3: a fifth state, deferred — work consciously set down, which is NOT dropped (Xiaohu,
// 2026-10-05; it is how loom-hq/docs/tracking/*/deferred migrated onto the board).
// VERSION 2: the record layout became dir/<state>/<id>-<slug>.md, and the front matter lost its
// state field — the folder is the state.
//
// THE BODY IS MARKDOWN WITH ONE KIND OF STRUCTURE: a line at column 0 that begins "## " starts a
// section. Everything else is content, and there are two ways to write content that looks like that
// — the two markdown itself has, both of them the WRITER's job and both undone by the reader. A
// heading-looking line in the prose of ## Why is ESCAPED, so the content "## SEQUENCING" is written
// "\## SEQUENCING", which is what a markdown reader shows as well; and an entry's further lines are
// INDENTED under its bullet. This is not decoration: the first record to carry an embedded
// "## SEQUENCING" line read back with 32 of its 44 criteria GONE, and nothing was raised.
//
// FORMAT IS THE WRITER'S; LAYOUT IS `deno fmt`'s. Every record this writer emits — front matter
// included — goes through `deno fmt --ext md -` before a byte is written, and what comes back is
// what lands (formatRecord, below). So fmt's own rules are no longer re-implemented here: no blank
// line it would have inserted, no column it would have moved a line to, no rewrite of the content
// itself. What is left is only what fmt cannot know: this board's own grammar — the "## " a
// section reader keys on, the bullet an entry rides, the two-space continuation that keeps a
// field's line the field's line.

export const VERSION = "4";

// The records directory is a PARAMETER on every verb, never a constant. The default is ./tasks
// relative to the working directory: ./tasks travels with the repo and is what two writers can
// see; .loom/tasks does not travel and is for machine-local work. One format, one tool, the
// location is the caller's choice.
export const DEFAULT_DIR = "./tasks";

const NL = "\n";
const CR = "\r";
const RECORD_SUFFIX = ".md";
const LOCK_SUFFIX = ".lock";
// The lock's own directory, beside the state folders and never inside one: a record is RENAMED
// into another state's folder while the lock is held, so a lock keyed to the record's path would
// be left behind by the very operation it guards. Keyed by id, the lock does not move.
const LOCK_DIR = ".claim";
const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 60000;
const POLL_MS = 5;
// The five states — and the five FOLDER names, because the folder a record sits in IS its state.
const STATES = ["open", "claimed", "done", "deferred", "dropped"];

const encoder = new TextEncoder();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Every refusal carries a machine-readable code, so a caller can tell "already claimed" from
// "not found" instead of reading prose: ALREADY_CLAIMED, NOT_FOUND, EXISTS, CORRUPT,
// BUSY, INVALID, NOT_CLAIMED, NOT_OWNER, and FMT — fmt could not be run, or it refused the record and
// nothing was written.
function err(code: string, message: string, id?: string): Error {
  const e = new Error(message) as Error & { code: string; taskId?: string };
  e.code = code;
  if (id) e.taskId = id;
  return e;
}

function req(value: any, name: string): string {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw err("INVALID", "a non-empty " + name + " is required");
  }
  return String(value);
}

// A LIST-SHAPED field is ONE PARAGRAPH or an array of them: a caller with a single sentence passes a
// string and gets the obvious thing, and the stored form is ALWAYS an array of non-empty trimmed
// strings, so no reader has to guess which shape it was handed. A shape that cannot be a paragraph is
// refused HERE, at the edge, naming the field and what was expected — never by a .map TypeError from
// inside a verb, which is how this was found the first time the board was really used.
function shapeOf(value: any): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  const kind = typeof value;
  if (kind === "object") return "an object";
  if (kind === "number") return "a number";
  if (kind === "boolean") return "a boolean";
  return "a " + kind;
}

function listOf(value: any, name: string): string[] {
  if (value === undefined || value === null) return [];
  const items = typeof value === "string" ? [value] : Array.isArray(value) ? value : null;
  if (items === null) {
    throw err(
      "INVALID",
      name + " is a paragraph or an array of paragraphs, not " + shapeOf(value),
    );
  }
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") {
      throw err(
        "INVALID",
        name + " is a paragraph or an array of paragraphs, not an array holding " + shapeOf(item),
      );
    }
    const text = item.trim();
    if (text !== "") out.push(text);
  }
  return out;
}

// A LIST-SHAPED front matter field as it is READ. `listOf` above is the CALLER's edge, where a wrong
// shape is worth a refusal naming the field; this is the RECORD's edge, where refusing would make a
// file already on disk unreadable. It takes what the writer emits (a block list), `[]`, and the one
// shape a hand edit produces by accident (a single scalar). AN ABSENT FIELD IS AN EMPTY LIST, not a
// missing fact: every record has tags and only some had them written down.
function asList(value: any): string[] {
  if (value === undefined || value === null) return [];
  const items = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of items) {
    const text = item === undefined || item === null ? "" : String(item).trim();
    if (text !== "") out.push(text);
  }
  return out;
}

/**
 * THE SERVER'S OWN CLOCK, WITH ITS OFFSET, AND NOBODY CONVERTS IT (Xiaohu, 2026-10-24): "the cards can store
 * the loombot server's local time plus the timezone instead of UTC, so they are easy to read - do not overdo it,
 * no per-reader timezone switching. Static is enough."
 *
 * SO THIS IS `2026-10-24T11:15:00+08:00`, not `...Z`. Both are ISO 8601 and both parse identically; the
 * difference is that the first says what the wall clock said where the work happened, and the second makes
 * every reader do arithmetic to find out. Cards written before this keep their `Z` and still read correctly -
 * `src/app.js` prints an offset stamp as that offset and a `Z` stamp as `UTC`.
 *
 * THE ID IS NOT CHANGED WITH IT (`t20261024-031547-788f`, built from UTC parts at `newId`): an id is a name,
 * and every reference to an existing card would break if the same card could be named differently after this.
 */
/**
 * OLDEST FIRST, COMPARED AS INSTANTS AND NOT AS STRINGS (2026-10-24). Both call sites sorted by
 * `(a.created + a.id).localeCompare(...)`, which is right only while every stamp is written in the same
 * offset form - and since the local-time change it is not: a card written before it carries
 * `2026-10-24T03:15:47.601Z`, one written after carries `2026-10-23T20:23:19-07:00`, and the SECOND is the
 * newer instant while sorting FIRST as a string. `Date.parse` reads both as the instant each names, which is
 * what the order is about. The id remains the tiebreak, so two cards made in the same second stay stable.
 */
function byCreated(
  a: { created?: string; id?: string },
  b: { created?: string; id?: string },
): number {
  return (Date.parse(a.created || "") || 0) - (Date.parse(b.created || "") || 0) ||
    String(a.id).localeCompare(String(b.id));
}

function iso(): string {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const abs = Math.abs(off);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1, 2) + "-" + pad(d.getDate(), 2) +
    "T" + pad(d.getHours(), 2) + ":" + pad(d.getMinutes(), 2) + ":" + pad(d.getSeconds(), 2) +
    // MILLISECONDS STAY, and this is not decoration: two cards made in the same SECOND used to be ordered by
    // `created`'s milliseconds, and a version of this with only whole seconds made them an exact tie whose
    // tiebreak was the random slug in the id - so "oldest first" held by luck and failed under `deno test`
    // while passing under `--filter`. MEASURED 2026-10-24, the day the offset was added.
    "." + pad(d.getMilliseconds(), 3) +
    (off >= 0 ? "+" : "-") + pad(Math.floor(abs / 60), 2) + ":" + pad(abs % 60, 2);
}

function pad(n: number, width: number): string {
  let s = String(n);
  while (s.length < width) s = "0" + s;
  return s;
}

function randHex(n: number): string {
  const bytes = new Uint8Array(Math.ceil(n / 2));
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += (b < 16 ? "0" : "") + b.toString(16);
  return s.slice(0, n);
}

// t20261005-014121-b7c2 — sorts by creation time, and the O_EXCL create still has the last word.
function newId(): string {
  const d = new Date();
  return "t" + String(d.getUTCFullYear()) + pad(d.getUTCMonth() + 1, 2) + pad(d.getUTCDate(), 2) +
    "-" + pad(d.getUTCHours(), 2) + pad(d.getUTCMinutes(), 2) + pad(d.getUTCSeconds(), 2) +
    "-" + randHex(4);
}

function join(dir: string, name: string): string {
  return dir.endsWith("/") ? dir + name : dir + "/" + name;
}

function trimSlash(p: string): string {
  return p.length > 1 && p.endsWith("/") ? trimSlash(p.slice(0, -1)) : p;
}

function slug(title: string): string {
  let s = String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  while (s.startsWith("-")) s = s.slice(1);
  while (s.endsWith("-")) s = s.slice(0, -1);
  if (s.length > 48) s = s.slice(0, 48);
  while (s.endsWith("-")) s = s.slice(0, -1);
  return s === "" ? "task" : s;
}

function stripCR(line: string): string {
  return line.endsWith(CR) ? line.slice(0, -1) : line;
}

/**
 * Trailing whitespace is not content, and fmt does two different things with it: on a line it
 * merely passes it strips it, and on a line ending in TWO spaces — a markdown hard break — it
 * writes a backslash instead, which is a character the caller never typed. Neither belongs on disk,
 * so the writer right-trims every line it emits and fmt never sees one.
 */
function rtrim(line: string): string {
  return line.replace(/\s+$/, "");
}

// A JSON string IS a valid YAML double-quoted scalar, so escaping is JSON's job on the way out
// and JSON's job on the way back in: a title holding quotes, a backslash or a newline round-trips.
function yamlScalar(value: any): string {
  if (value === undefined || value === null) return '""';
  return JSON.stringify(String(value));
}

function scalar(token: string): any {
  if (token === "") return "";
  const first = token[0];
  if (first === '"') {
    try {
      return JSON.parse(token);
    } catch {
      return token.slice(1, token.length - 1);
    }
  }
  if (first === "'") return token.slice(1, token.length - 1);
  if (token === "true") return true;
  if (token === "false") return false;
  if (token === "null") return null;
  return token;
}

// The front-matter subset this tool WRITES: scalars, one level of nesting (source: {who, words}),
// and block lists of scalars (links). A hand-edited file that stays inside that subset reads back.
function parseFrontMatter(lines: string[]): any {
  const fm: any = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "" || line.startsWith("  ")) {
      i++;
      continue;
    }
    const at = line.indexOf(":");
    if (at < 0) {
      throw err("CORRUPT", "front matter line is not key: value: " + line);
    }
    const key = line.slice(0, at).trim();
    const rest = line.slice(at + 1).trim();
    const children: string[] = [];
    let j = i + 1;
    while (j < lines.length && (lines[j].startsWith("  ") || lines[j].trim() === "")) {
      children.push(lines[j]);
      j++;
    }
    if (rest === "[]") {
      fm[key] = [];
    } else if (rest === "{}") {
      fm[key] = {};
    } else if (rest !== "") {
      fm[key] = scalar(rest);
    } else {
      const kids = children.filter((l) => l.trim() !== "");
      if (kids.length > 0 && kids[0].trim().startsWith("- ")) {
        fm[key] = kids.map((l) => scalar(l.trim().slice(2).trim()));
      } else {
        const map: any = {};
        for (const l of kids) {
          const text = l.trim();
          const colon = text.indexOf(":");
          if (colon < 0) continue;
          map[text.slice(0, colon).trim()] = scalar(text.slice(colon + 1).trim());
        }
        fm[key] = map;
      }
    }
    i = j;
  }
  return fm;
}

// A BODY LINE THAT BEGINS "## " AT COLUMN 0 STARTS A SECTION, and that is the only structure the body
// has — which is exactly why content must never be allowed to LOOK like it. Two escapes, both
// markdown's own, and they are the writer's half of the grammar the reader has:
//   * in PROSE (## Why), a line that would read as a heading is ESCAPED: the content "## SEQUENCING"
//     is written "\## SEQUENCING", which is what a markdown reader shows as well;
//   * in an ENTRY (a criterion), the continuation lines are INDENTED under the bullet, so a "## " on
//     one of them is unambiguous already.
// Neither is decoration: one migrated criterion held an embedded "## SEQUENCING" line, the reader took
// it for a section, and 32 of that record's 44 criteria left the record with nothing raised at all.
const HEADING = "## ";
const HEADING_LIKE = /^\\*## /;
const ESCAPED_HEADING = /^\\+## /;
// The app's own continuation indent: written under a bullet, and the ONLY part stripped on the way
// back in — a deeper indent belongs to the entry's own markdown (a nested list inside it).
const CONTINUATION = "  ";
// What a markdown reader takes for a LIST MARKER at the start of an entry's first line. An entry like
// that is written as a bullet with the list INDENTED under it: the same record with ONE marker instead
// of two, the entry's own text untouched, and the shape deno fmt itself rewrites "- - x" and
// "- 1. x" into — which matters because this repo's pre-commit hook refuses a record that is not
// fmt-clean, and a board whose records cannot be committed is not a board.
const LIST_MARKER = /^(?:[-*+](?: |$)|\d+[.)] )/;

/** A line of prose that a reader would take for a heading: escaped on the way out. */
function escapeHeading(line: string): string {
  return HEADING_LIKE.test(line) ? "\\" + line : line;
}

/** Its inverse, and the only place a leading backslash means anything. */
function unescapeHeading(line: string): string {
  return ESCAPED_HEADING.test(line) ? line.slice(1) : line;
}

function parseSections(body: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let current = "";
  for (const line of body) {
    if (line.startsWith(HEADING)) {
      current = line.slice(HEADING.length).trim().toLowerCase();
      out[current] = [];
      continue;
    }
    if (current !== "") out[current].push(unescapeHeading(line));
  }
  return out;
}

/**
 * The acceptance criteria: ONE ENTRY PER BULLET, and an entry is the bullet's own line plus every
 * line INDENTED under it, each keeping its line break — that is what carries a criterion holding a
 * "## " line, or a nested list, or a second paragraph, back out as itself. A line at column 0 that
 * is not a bullet is a LAZY continuation (markdown folds it into the same paragraph) and is folded
 * with a SPACE, because a wrapped line is not a line break. A blank line whose next line is still
 * indented is a paragraph break INSIDE the entry; anywhere else it is spacing and says nothing.
 * A bullet with nothing after its marker is the writer's shape for an entry whose OWN first line is a
 * list ("- 1. do this" would be a nested list to a markdown reader): its text starts on the line
 * under it, and the two are ONE entry. Nothing is stripped from an entry's text on the way in or out:
 * a marker inside it is the entry's own markdown, and the reader returns what the file says.
 */
function parseBullets(lines: string[]): string[] {
  const items: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line.trim();
    if (text === "") {
      if (items.length > 0 && items[items.length - 1] !== "" && /^\s/.test(lines[i + 1] || "")) {
        items[items.length - 1] += NL;
      }
      continue;
    }
    // A bullet STARTS an entry only at column 0. An indented one belongs to the entry above it —
    // that is a nested list, and it is how the writer emits an entry whose own first line is a list.
    if (
      line === text && (text.startsWith("- ") || (text === "-" && /^\s/.test(lines[i + 1] || "")))
    ) {
      items.push(text.slice(2).trim());
      continue;
    }
    if (items.length === 0) continue; // a line above the first bullet belongs to no entry
    const at = items.length - 1;
    if (line.startsWith(CONTINUATION)) {
      const rest = line.slice(CONTINUATION.length);
      items[at] = items[at] === "" ? rest.trim() : items[at] + NL + rest;
    } else {
      items[at] = items[at] === "" ? text : items[at] + " " + text;
    }
  }
  return items;
}

/**
 * A NOTE AS THE FILE CAN SAY IT, plus the WRITER's memory of which shape the file said it in — never a
 * field of the record: a caller sees `{at, who, text}`. Two shapes exist on a board. The tool's own is
 * a BULLET, `- <at> (<who>): text`. The other is a PLAIN PARAGRAPH under `## Notes`, which is what a
 * hand-written or migrated record carries, and which every rewrite used to DROP in silence: a reader
 * keyed on "- " reads nothing there, and the next update re-renders the whole record from what it read
 * (t20261005-074713-d235; the real one is board/done/t20261005-041822-f41e-state-claim.md).
 */
type Note = { at: string; who: string; text: string; bullet?: boolean };

/** A note with its shape remembered — non-enumerably, so the shape is not a field of the record. */
function noteOf(at: string, who: string, text: string, bullet: boolean): Note {
  const note: Note = { at: at, who: who, text: text };
  Object.defineProperty(note, "bullet", { value: bullet, enumerable: false });
  return note;
}

/**
 * The notes, in BOTH shapes a record may carry them.
 *
 * A BULLET is the tool's own. A blank line whose next line is still indented is a paragraph break
 * INSIDE it — the same rule parseBullets applies to an entry, and the reader's half of what noteLines
 * writes: without it a two-paragraph note reads back as one run-on paragraph, the boundary the caller
 * wrote gone and nothing raised. A line at column 0 after one is a LAZY continuation, which markdown
 * folds into the same paragraph and so does this, with a SPACE.
 *
 * A PARAGRAPH NOTE is a line at column 0 that is not a bullet. Every line under it joins it VERBATIM
 * while no blank line intervenes — its lines stand at column 0 by their own right, and the two-space
 * strip a bullet's continuation gets would eat the record's own text — and a blank line is a
 * paragraph break, which is what makes the next line either a second paragraph of this note or a note
 * of its own. `at` and `who` are empty because the file states neither.
 */
function parseNotes(lines: string[]): Note[] {
  const notes: Note[] = [];
  let blank = false; // the line before this one was blank
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line.trim();
    const last = notes.length > 0 ? notes[notes.length - 1] : undefined;
    if (text === "") {
      blank = true;
      if (last !== undefined && last.bullet === true && /^\s/.test(lines[i + 1] || "")) {
        // A BLANK LINE WHOSE NEXT LINE IS STILL INDENTED IS A PARAGRAPH BREAK INSIDE THE NOTE.
        last.text += NL;
      }
      continue;
    }
    if (line.startsWith("- ")) {
      const item = line.slice(2);
      const open = item.indexOf(" (");
      const close = item.indexOf("):");
      let at = "";
      let who = "";
      let body = item;
      if (open > 0 && close > open) {
        at = item.slice(0, open).trim();
        who = item.slice(open + 2, close);
        body = item.slice(close + 2).trim();
      }
      notes.push(noteOf(at, who, body, true));
      blank = false;
      continue;
    }
    if (last !== undefined && last.bullet === false) {
      // AN OPEN PARAGRAPH TAKES EVERY LINE AS ITS OWN, indented or not: a line break in a paragraph is
      // the paragraph's, and a blank line in front of this one is a paragraph break kept as one.
      last.text += (blank ? NL + NL : NL) + line;
      blank = false;
      continue;
    }
    if (line.startsWith(CONTINUATION) && last !== undefined) {
      const rest = line.slice(CONTINUATION.length);
      last.text = last.text === "" ? rest.trim() : last.text + NL + rest;
      blank = false;
      continue;
    }
    if (line === text) {
      // A LINE AT COLUMN 0 THAT IS NOT A BULLET IS A PARAGRAPH — what a migrated record carries under
      // ## Notes, and what a reader keyed on "- " alone used to drop.
      notes.push(noteOf("", "", line, false));
      blank = false;
      continue;
    }
    // An indented line with no note above it belongs to no note, as before.
    blank = false;
  }
  return notes;
}

function fenceEnd(lines: string[]): number {
  if (lines[0] !== "---") return -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") return i;
  }
  return -1;
}

/**
 * ONE FILE AS A RECORD, OR THE REASON IT IS NOT ONE — the lenient half of the parser, and the only place
 * the two kinds of failure are told apart.
 *
 * INCOMPLETE IS NOT BROKEN. A card may carry no tags, no links, no source, no owner, no worktree and no
 * timestamps: each reads as EMPTY, which is what a hand-written or migrated card is, and this reader has
 * always read it as a card.
 *
 * UNREADABLE is a file nothing about which can be a record: no front matter block at all (a stray note, a
 * README beside the records), a front matter line that is not `key: value`, no `id`, no `title` (the row,
 * the address and the file name are all made from one), or a `state` field — the folder is the state, and a
 * second source for one fact is a record that can lie about where it lies.
 *
 * THE REASON NAMES THE FIELD and nothing else: path + reason is what a caller prints, and someone's next move
 * is to open the file and fix that field. Returning it rather than throwing is what keeps ONE wrong file
 * from standing in front of every other card on the board (t20260710-000000-0720).
 */
function reading(text: string, path: string, state: string): { record?: any; reason?: string } {
  const lines = text.split(NL).map(stripCR);
  const end = fenceEnd(lines);
  if (end < 0) return { reason: "no front matter block — a record opens with --- and closes it" };
  let fm: any;
  try {
    fm = parseFrontMatter(lines.slice(1, end));
  } catch (e) {
    return { reason: said(e) };
  }
  const unreadable = (name: string): string | undefined => {
    const value = fm[name];
    if (value === undefined || value === null || String(value).trim() === "") {
      return "no " + name + " field in the front matter";
    }
    if (typeof value !== "string") return name + " is not a string: " + JSON.stringify(value);
    return undefined;
  };
  const noId = unreadable("id");
  if (noId !== undefined) return { reason: noId };
  const noTitle = unreadable("title");
  if (noTitle !== undefined) return { reason: noTitle };
  if (fm.state !== undefined) {
    return { reason: "carries a state field; the folder is the state (" + state + ")" };
  }
  const sections = parseSections(lines.slice(end + 1));
  const rec = {
    id: fm.id,
    title: fm.title,
    state: state,
    owner: fm.owner || "",
    worktree: fm.worktree || "",
    created: fm.created || "",
    updated: fm.updated || "",
    source: {
      who: (fm.source && fm.source.who) || "",
      words: (fm.source && fm.source.words) || "",
    },
    links: fm.links || [],
    tags: asList(fm.tags),
    why: (sections["why"] || []).join(NL).trim(),
    acceptance: parseBullets(sections["acceptance criteria"] || []),
    notes: parseNotes(sections["notes"] || []),
    path,
  };
  return { record: rec };
}

/**
 * ONE RECORD OR A THROW — what a call that names ONE task uses (show, claim, update, and every re-read
 * under a lock). A caller who asked for a card by id is owed the reason that card cannot be read, so the
 * lenient shape is turned back into CORRUPT here: the blast radius of one bad file is the CALL that named
 * it. readBoard and list are the other half of that decision — they REPORT instead, so one stray file
 * cannot stand in front of every other card on the board (t20260710-000000-0720).
 */
function parseRecord(text: string, path: string, state: string): any {
  const got = reading(text, path, state);
  if (got.reason !== undefined) throw err("CORRUPT", "record " + path + ": " + got.reason);
  return got.record;
}

// ── LAYOUT: `deno fmt`, and NOT this writer ───────────────────────────────────────────────────────
//
// The writer used to re-implement fmt's rules — where a blank line goes, what column a line sits at
// — and every rule it did not reproduce was a record the pre-commit hook refused. Xiaohu,
// 2026-10-09: stop re-implementing fmt, hand it the record. Two failure shapes got there, and the
// second one cannot be copied by hand at all:
//
//   1. STRUCTURE. A paragraph with a list straight under it ("the evidence:" then "1. the first
//      one") is a list INTERRUPTING the paragraph and needs a blank line between the two; an
//      entry's continuation line at column 0 is moved to the marker's own content column.
//   2. CONTENT. `*emphasis*` becomes `_emphasis_`, and a space at the end of some `inline code `
//      is dropped. Not structure, not in `deno fmt --help` (it is dprint-plugin-markdown's taste),
//      and unknowable from here — one board record was committed, refused by the hook, and
//      hand-fixed three times in a day.
//
// So the whole record — front matter included — is handed to fmt, and fmt's bytes are the bytes
// written. Measured 2026-10-09: the front matter comes back untouched (id/title/updated/tags byte
// for byte, and a test pins it); a heading-looking line already escaped is left exactly where it
// is; and a paragraph is not reflowed (deno.json: proseWrap "preserve"). One authority instead of
// two, and it drifts from nothing.
//
// THE COST, measured on this machine 2026-10-09: ONE SUBPROCESS PER create/update. Through this
// writer, five creates in a row took 293, 293, 294, 323 and 385 ms — min 293 — and most of that is
// deno starting up, since a bare `deno --version` costs real 0.22 / real 0.22 / real 0.22 here. The same five
// measured while the box was busy (a full parallel test run) came out at 1.5-2.0 s, so read this as
// "a subprocess per write" rather than as a constant. It is paid on WRITES only — list, show and
// readBoard spawn nothing.
//
// A FAILURE IS NOT A WRITE. If fmt cannot be started, exits non-zero, or answers with nothing, this
// throws FMT and no byte is written — and for update that includes the RENAME, which place() does
// only after fmt has answered. A writer that returns "done" over an unformatted record is the same
// failure as a field silently dropped: the caller cannot see it, and someone else finds out later.
//
// AND IT IS FORMATTED BY THE CONFIG THE GATE WILL USE. `deno fmt` resolves a FILE's config by
// walking up from that file — not from the working directory — so a record in a temp directory is
// judged by the DEFAULTS (lineWidth 80, proseWrap reflowing) rather than by the repo it is going to be
// committed in. Read from stdin there is no file to walk up from, so the working directory decides —
// which is a difference a writer cannot afford. Measured here, on the same bytes, 2026-10-09: under
// the default config a note's continuation line came back MERGED onto the bullet's own line (its
// second paragraph with it), while under this repo's deno.json every line was untouched. So the
// config is
// resolved HERE — the nearest deno.json at or above the BOARD's own directory — and passed explicitly,
// which is what makes the bytes match the gate that will check them. A tree with NO deno.json at all
// gets `--no-config`: deno's DEFAULTS, which is what `deno fmt --check <record>` resolves for a FILE
// there. Before that, with no `--config` at all, the CALLER's working directory decided instead, so a
// board kept outside any repo came out in bytes the gate refuses (t20261009-201733-f0aa).
const CONFIG_NAMES = ["deno.json", "deno.jsonc"];
const NOTHING_WRITTEN = ": nothing was written.";

/**
 * The board directory as a path the walk below can climb. A caller may hand a RELATIVE dir — the
 * default "./tasks" is spelled that way — and the walk is over "/" separators, so one segment with no
 * separator in it would be the whole climb. Relative to the CALLER's working directory, which is the
 * only thing a relative dir can mean.
 */
function upward(dir: string): string {
  try {
    return Deno.realPathSync(dir); // it exists: create mkdir'd it, or place() is on a live record
  } catch {
    return dir.startsWith("/") ? dir : join(Deno.cwd(), dir);
  }
}

/** `--config <the nearest deno.json at or above the board>`, or `--no-config` when the tree has none. */
function configArg(dir: string): string[] {
  let at = upward(dir);
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const path = join(at, name);
      try {
        if (Deno.statSync(path).isFile) return ["--config", path];
      } catch { /* nothing here, keep walking up */ }
    }
    const up = at.lastIndexOf("/");
    // NOTHING FOUND IS A DECISION, not a shrug: `--no-config` is deno's DEFAULTS, which is what the
    // gate resolves for a file in this tree. Returning [] here lets the CWD's config format the record.
    if (up <= 0) return ["--no-config"];
    at = at.slice(0, up);
  }
}

/** The argv `deno fmt` is run with: the record's own config, markdown, and stdin. */
function fmtArgs(dir: string): string[] {
  return ["fmt"].concat(configArg(dir)).concat(["--ext", "md", "-"]);
}

async function formatRecord(dir: string, text: string): Promise<string> {
  // WHICH DENO: the runtime running this module. From a checkout that is the checkout's deno; a
  // shipped loom is a bundle `packaging/loom.sh` execs as `deno run <root>/loom.js`, so it is the
  // pinned CLI. Never a PATH lookup, and never a `deno compile`d artifact's own path, which has no
  // `fmt` subcommand - the same trap `deno doc` hit (loom/deno_cli.ts). The answer is CHECKED below,
  // so a wrong one refuses the write rather than landing bytes nothing formatted.
  const deno = Deno.execPath();
  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command(deno, {
      args: fmtArgs(dir),
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
  } catch (e) {
    throw err("FMT", "deno fmt could not be started (" + deno + "): " + said(e) + NOTHING_WRITTEN);
  }
  const toChild = child.stdin.getWriter();
  // fmt does not answer until it has read stdin to the end, so the whole record goes in and stdin is
  // closed BEFORE stdout is read: there is no interleaving to deadlock on, at any record size.
  await toChild.write(encoder.encode(text));
  await toChild.close();
  const done = await child.output();
  const stderr = new TextDecoder().decode(done.stderr).trim();
  if (done.code !== 0) {
    throw err(
      "FMT",
      "deno fmt refused the record (exit " + done.code + ")" +
        (stderr === "" ? "" : ": " + stderr) +
        NOTHING_WRITTEN,
    );
  }
  const formatted = new TextDecoder().decode(done.stdout);
  // An empty answer is not an answer: written, it would leave a file with no front matter, which
  // every reader calls CORRUPT. A formatter that returned nothing is refused like one that failed.
  if (formatted.trim() === "") {
    throw err("FMT", "deno fmt returned an empty record" + NOTHING_WRITTEN);
  }
  return formatted;
}

/** A failure's sentence, whether it was thrown as an Error or as something else. */
function said(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * A NOTE AS THE LINES THAT GO IN THE RECORD, in the shape it was READ in.
 *
 * A BULLET: the first line rides the bullet, every line under it carries CONTINUATION, and a blank
 * line stays blank.
 *
 * THAT IS THE READER'S MARKER, NOT LAYOUT — parseNotes reads "- " and "  " and nothing else.
 * Measured 2026-10-09, because the card expected fmt to MERGE a note's continuation lines: under the
 * DEFAULT config it does (both lines came back on one), and under this repo's deno.json it does not
 * — proseWrap "preserve" keeps a written line break a line break, which is part of why the fmt call
 * passes the config explicitly (configArg). What fmt does either way is re-indent a LAZY
 * continuation at column 0 up to the bullet's own column. A line after a
 * BLANK line is not lazy: fmt leaves that one at column 0, where parseNotes drops it and the
 * paragraph leaves the record with nothing raised. So the two spaces stay the writer's job, and
 * blank lines stay blank — which is what keeps the caller's paragraph boundaries, since their own
 * text decides them and fmt agrees.
 *
 * A PARAGRAPH — a note the RECORD carried at column 0, with no `<at>` and no `<who>` — is written
 * back as a paragraph: column 0, no header, no continuation indent, a blank line still blank. That
 * is the shape parseNotes reads back (t20261005-074713-d235), and its lines are ESCAPED the way the
 * prose in ## Why is, because a "## " at column 0 would otherwise read as the next section.
 */
function noteLines(note: Note): string[] {
  const text = String(note.text === undefined || note.text === null ? "" : note.text)
    .split(CR).join("").split(NL);
  if (note.bullet === false) return text.map((line) => escapeHeading(rtrim(line)));
  const out = ["- " + note.at + " (" + (note.who || "") + "): " + text[0]];
  for (const line of text.slice(1)) out.push(line === "" ? "" : CONTINUATION + line);
  return out;
}

function render(rec: any): string {
  const source = rec.source || {};
  const links: string[] = rec.links || [];
  const tags: string[] = asList(rec.tags);
  const notes: Note[] = rec.notes || [];
  const lines: string[] = [];
  lines.push("---");
  lines.push("id: " + yamlScalar(rec.id));
  lines.push("title: " + yamlScalar(rec.title));
  lines.push("owner: " + yamlScalar(rec.owner || ""));
  lines.push("worktree: " + yamlScalar(rec.worktree || ""));
  lines.push("created: " + yamlScalar(rec.created));
  lines.push("updated: " + yamlScalar(rec.updated));
  lines.push("source:");
  lines.push("  who: " + yamlScalar(source.who || ""));
  lines.push("  words: " + yamlScalar(source.words || ""));
  if (links.length === 0) {
    lines.push("links: []");
  } else {
    lines.push("links:");
    for (const link of links) lines.push("  - " + yamlScalar(link));
  }
  // TAGS ARE THE SAME GRAMMAR AS LINKS, and written the same way: `tags: []` when nobody tagged the
  // record, a block list of scalars otherwise. ALWAYS emitted, which is what makes an omitted field the
  // only shape that reads as absent — a record on disk from before this field existed.
  if (tags.length === 0) {
    lines.push("tags: []");
  } else {
    lines.push("tags:");
    for (const tag of tags) lines.push("  - " + yamlScalar(tag));
  }
  lines.push("---");
  lines.push("");
  lines.push("## Why");
  lines.push("");
  for (const line of String(rec.why || "").trim().split(NL)) lines.push(escapeHeading(rtrim(line)));
  lines.push("");
  lines.push("## Acceptance criteria");
  lines.push("");
  for (const item of rec.acceptance || []) {
    const entry = String(item).split(NL).map(rtrim);
    // An entry whose own first line is ALREADY a list (a migrated doc bullet, a numbered item) goes
    // under the bullet instead of after it: one marker, no "- - **...", and the text not touched.
    if (entry[0] === "" || LIST_MARKER.test(entry[0])) {
      lines.push("-");
      if (entry[0] !== "") lines.push(CONTINUATION + entry[0]);
    } else {
      lines.push("- " + entry[0]);
    }
    // Every further line of the entry goes under the bullet, which is what keeps a "## " in it from
    // reading as a heading, and what keeps the markdown structure the entry came with.
    for (const line of entry.slice(1)) lines.push(line === "" ? "" : CONTINUATION + line);
  }
  if (notes.length > 0) {
    lines.push("");
    lines.push("## Notes");
    lines.push("");
    for (const note of notes) {
      // A note is a bullet too — unless it is a PARAGRAPH the record carried, which is written back
      // as one: a blank line in front of it is what keeps two paragraphs from reading back as one,
      // and what a reader (and fmt) wants between a list and the paragraph under it.
      if (note.bullet === false && lines[lines.length - 1] !== "") lines.push("");
      for (const line of noteLines(note)) lines.push(rtrim(line));
    }
  }
  lines.push("");
  return lines.join(NL);
}

/**
 * One file on the board that could not be read AS A RECORD: where it is, which folder it sits in, and why.
 *
 * The reason NAMES THE FACT that could not be read — "no front matter block", "no id field in the front
 * matter", "no title field in the front matter", "carries a state field; the folder is the state" — because
 * the caller's next move is to open that one file and fix that field. `path` is the file as the reader was
 * given the board, so it can be opened or quoted without a second walk.
 */
export interface Broken {
  path: string;
  /** The state FOLDER it was found in — the folder is the state, so even an unreadable file has one. */
  state: string;
  reason: string;
}

/**
 * WHAT A READ OF THE WHOLE BOARD GIVES: the two halves of it, and `broken` comes FIRST on purpose — a
 * rendered answer opens with what could not be read, which is what a person has to know before they trust
 * the rows under it. `records` is every readable record, FULL, oldest first.
 */
export interface Board {
  broken: Broken[];
  records: any[];
}

/**
 * THE WHOLE BOARD, READ SYNCHRONOUSLY — and the one reader a RULES MODULE can use.
 *
 * `list` and `show` are async, and a rule module cannot await them: `app_mcp.ts` calls
 * `rules.event(name, data, state)` WITHOUT an await (`out = rules!.event(...)` in its `onFrame`), so
 * a promise returned from a rule is neither a decision nor an answer — the page silently gets
 * nothing. An app whose rules READ something therefore needs a synchronous reader, and this is it:
 * the same `parseRecord`, the same five state folders, the same `<id>-<slug>.md` suffix rule, ONE
 * implementation of the format. Only the syscalls differ, which is why this is not a second parser
 * and why an app can read a board without reimplementing the record grammar (and getting it
 * subtly wrong the day the grammar moves).
 *
 * FULL records, oldest first like `list`: a page draws its list AND its detail from one read, and a
 * search over the BODY needs the body. A board nobody wrote to is empty, not an error — and so is a
 * directory that does not exist at all.
 *
 * AND IT REPORTS WHAT IT COULD NOT READ rather than throwing on it. One file with no front matter block
 * used to make this reader — and `list` with it — throw CORRUPT for the whole board: measured 2026-11-07,
 * two files for one card (t20260710-000000-0720), the second hand-written with no front matter, and every
 * other card on that board became unlistable and unclaimable with nothing saying which file was the
 * reason. So the answer is a `Board`: `records`, every record that read, and `broken`, one entry per file
 * that is not a record — {path, state, reason} — never a throw. A card that is merely INCOMPLETE (no
 * tags, no links, no source) is a record and stays in `records`: only a file with no front matter block
 * at all, or an unreadable `id`/`title`, is `broken`.
 *
 * It is NOT a sixth verb: nothing here writes, no state is decided, and `spec` does not document it.
 *
 * THE ARGUMENT IS A DIRECTORY AND NOT A BAG, and the wrong shape is REFUSED rather than guessed at:
 * the call is `readBoard(dir)`, and `readBoard({ dir })` — the shape every VERB takes — throws INVALID
 * naming the string it wants. That is not a courtesy. `String({ dir })` is `"[object Object]"`, which
 * is a perfectly good directory NAME: every state folder under it answers NotFound, so the bag used to
 * be answered with an EMPTY BOARD — measured 2026-10-09 on this repo's board, `readBoard(dir)` returned
 * 142 records and `readBoard({ dir })` returned 0 (t20261009-203105-2327). "A board nobody wrote to is
 * empty" is a LEGITIMATE answer to this function, so nothing downstream could tell the two apart, and
 * the shape is therefore refused where it arrives — the same rule `listOf` and `onlyFields` apply to a
 * field.
 *
 * @param dir the board directory as a STRING, `readBoard("./board")`; `undefined`, `null` and `""` mean "no directory named" and read DEFAULT_DIR
 * @returns a `Board`: `{ broken, records }` — `records` is every record that could be read, FULL, oldest first; `broken` is one `{ path, state, reason }` per file that is not a record (no front matter block, no id, no title, a state field, unreadable bytes), and NEVER a throw for one of them
 * @throws INVALID when handed anything but a string: a bag belongs to the verbs — `list({ dir })`, `create({ dir, title, why, acceptance })`, `show(id, { dir })`
 */
export function readBoard(dir: string): Board {
  const base = boardDir(dir);
  const records: any[] = [];
  const broken: Broken[] = [];
  for (const state of STATES) {
    const folder = stateDir(base, state);
    const files: string[] = [];
    try {
      for (const entry of Deno.readDirSync(folder)) {
        if (entry.isFile && entry.name.endsWith(RECORD_SUFFIX)) files.push(entry.name);
      }
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) continue;
      throw e;
    }
    for (const name of files.sort()) {
      const path = join(folder, name);
      let text: string;
      try {
        text = Deno.readTextFileSync(path);
      } catch (e) {
        // A FILE THAT CANNOT BE READ AT ALL is reported with the rest: a permission bit, or a file that
        // went away under a live write, is the same blast radius as a wrong one.
        broken.push({ path, state, reason: "cannot be read: " + said(e) });
        continue;
      }
      const got = reading(text, path, state);
      if (got.reason !== undefined) broken.push({ path, state, reason: got.reason });
      else records.push(got.record);
    }
  }
  records.sort(byCreated);
  return { broken, records };
}

/**
 * The board DIRECTORY a bare-string reader was handed — the edge where a wrong SHAPE is refused rather
 * than swallowed.
 *
 * `readBoard` takes a PATH and the six verbs take a BAG, so the two are one mistake apart and the
 * mistake is INVISIBLE: `String({ dir })` is `"[object Object]"`, which names a directory the filesystem
 * is happy to be asked about — every state folder under it answers NotFound — and the caller is told the
 * board is empty. Measured 2026-10-09 on this repo's board: 142 records for `readBoard(dir)`, 0 for
 * `readBoard({ dir })` (t20261009-203105-2327). An empty board is a LEGITIMATE answer here, so no reader
 * downstream can tell the two apart, and the shape has to be refused where it arrives. The message names
 * the shape it got, the call it wants, and where the bag belongs instead — the voice `listOf` already uses
 * for a field ("is a paragraph or an array of paragraphs, not an object").
 *
 * `undefined`, `null` and `""` are NOT that mistake: they mean "no directory named" and fall to
 * DEFAULT_DIR, exactly as `dirOf` reads them for the verbs.
 */
function boardDir(dir: any): string {
  if (dir === undefined || dir === null) return trimSlash(DEFAULT_DIR);
  if (typeof dir !== "string") {
    throw err(
      "INVALID",
      "readBoard takes the board directory as a string, not " + shapeOf(dir) +
        ": readBoard(dir). The verbs are what take a bag — list({ dir }), create({ dir, title, why, acceptance }), show(id, { dir }).",
    );
  }
  const text = dir.trim();
  return trimSlash(text === "" ? DEFAULT_DIR : text);
}

// ---------------------------------------------------------------------------------------------------
// THE SIX VERBS: create, list, show, claim, release, update. Anything else a caller wants is a
// shell command over the same folder, which is what one file per task buys. `release` is the one
// exception to "no sixth": a claim with no exit tells the board a lie it cannot correct itself
// (t20261022-050953-eb3b), and it was added additively so the agents claiming live were not
// disturbed.

// ---------------------------------------------------------------------------------------------------

/**
 * The ONE shape a verb's first argument is not. `create` and `list` take the bag alone, and
 * `show`/`claim`/`update` take it after the id; a caller who hands one of them a STRING, a number or
 * an array is refused where the argument arrives, by name, and nothing is read off its shape.
 *
 * A string is the mistake that was measured, twice and differently (t20261009-212755-a15a):
 * `Object.keys("board")` is the string's INDICES, so `create(dir)` was answered with "create does not
 * take 0, 1, 2, 3, ..." — loud, and about the caller's own argument rather than the bag they forgot;
 * and on `list`, where `dir` and `state` are BOTH strings, the bare string could not be read as either
 * one, so it was ignored and the call answered about DEFAULT_DIR.
 */
function optsBag(verb: string, opts: any, call: string, hint: string): any {
  if (opts === undefined || opts === null) return {};
  if (typeof opts === "object" && !Array.isArray(opts)) return opts;
  throw err(
    "INVALID",
    verb + " takes one options bag, not " + shapeOf(opts) + ": " + call + ". " + hint,
  );
}

/**
 * The task id `show`, `claim` and `update` take positionally, refused by SHAPE where it arrives.
 *
 * `update({ id, title })` — the whole patch in the id's place — was answered with "no task [object
 * Object] in ./tasks": `String({ id, title })` is a perfectly good SEARCH TERM, so the caller was told
 * a task they never typed is missing, in a directory they never named. `undefined` and `null` are not
 * that mistake — they are a missing id, which `req` already names.
 */
function taskId(verb: string, id: any, call: string): string {
  if (id === undefined || id === null) return req(id, "id");
  if (typeof id !== "string") {
    throw err(
      "INVALID",
      verb + " takes a task id as a string, not " + shapeOf(id) + ": " + call +
        ". The bag of options goes in the second argument, not the first.",
    );
  }
  return req(id, "id");
}

/**
 * The directory a call names, or the documented default. Never a constant in the module.
 *
 * `dir` is a STRING, and the wrong shape of it is refused rather than stringified: `String({})` is
 * "[object Object]", which is a directory NAME the filesystem answers NotFound about — so
 * `list({ dir: {} })` was an empty board, and an empty board is a legitimate answer.
 */
function dirOf(verb: string, opts: any): string {
  if (opts === undefined || opts === null || opts.dir === undefined || opts.dir === null) {
    return trimSlash(DEFAULT_DIR);
  }
  if (typeof opts.dir !== "string") {
    throw err(
      "INVALID",
      "dir is the records directory as a string, not " + shapeOf(opts.dir) + ": " +
        verb + '({ dir: "./board" })',
    );
  }
  const text = opts.dir.trim();
  return trimSlash(text === "" ? DEFAULT_DIR : text);
}

function stemOf(rec: any): string {
  return rec.id + "-" + slug(rec.title);
}

/** The file a record belongs in: <dir>/<state>/<id>-<slug>.md. Callers create the folder first. */
function recordFile(dir: string, state: string, rec: any): string {
  return join(stateDir(dir, state), stemOf(rec) + RECORD_SUFFIX);
}

/** A state folder inside the board: created on demand, and tolerated when it is missing. */
function stateDir(dir: string, state: string): string {
  return join(dir, state);
}

/** The state a patch names, checked against the four, or "" when it names none. */
function stateArg(p: any, id: string): string {
  if (p.state === undefined) return "";
  const state = String(p.state);
  if (STATES.indexOf(state) < 0) {
    throw err("INVALID", "state must be one of " + STATES.join(", ") + ", not " + state, id);
  }
  return state;
}

/** One record as a summary: what a reader needs to pick a task, and no more. */
function summary(rec: any): any {
  return {
    id: rec.id,
    title: rec.title,
    state: rec.state,
    owner: rec.owner,
    worktree: rec.worktree,
    created: rec.created,
    updated: rec.updated,
    tags: asList(rec.tags),
    path: rec.path,
  };
}

/** The record files in a state folder, sorted by name. A folder nobody wrote to is EMPTY, not an
 * error. */
async function names(dir: string): Promise<string[]> {
  const out: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && entry.name.endsWith(RECORD_SUFFIX)) out.push(entry.name);
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return [];
    throw e;
  }
  return out.sort();
}

/**
 * Where an id lives: the state folder holding it, and the file itself. The id is the handle
 * everywhere, so a caller never has to know a record's state to find it — the state is read OFF
 * the folder it was found in. TWO folders carrying one id is CORRUPT rather than a tie to break: a
 * reader would have to guess which one the caller meant, and guessing is how a board starts telling
 * two different stories.
 */
async function locate(dir: string, id: string): Promise<{ state: string; path: string }> {
  const wanted = req(id, "id");
  const hits: Array<{ state: string; path: string }> = [];
  for (const state of STATES) {
    for (const name of await names(stateDir(dir, state))) {
      const bare = name.slice(0, name.length - RECORD_SUFFIX.length);
      if (bare === wanted || bare.startsWith(wanted + "-")) {
        hits.push({ state: state, path: join(stateDir(dir, state), name) });
      }
    }
  }
  if (hits.length === 0) throw err("NOT_FOUND", "no task " + wanted + " in " + dir, wanted);
  if (hits.length > 1) {
    throw err(
      "CORRUPT",
      "two records carry id " + wanted + ": " + hits.map((h) => h.path).join(", "),
      wanted,
    );
  }
  return hits[0];
}

/** A record read off disk, with the state its FOLDER gives it. */
async function readAt(path: string, state: string): Promise<any> {
  return parseRecord(await Deno.readTextFile(path), path, state);
}

/**
 * ONE FILE, READ LENIENTLY — the async twin of the line `readBoard` runs per file, and the reason `list`
 * never has to decide between the two readers: the bytes come off disk one way and the DECISION is
 * `reading` either way. A file that cannot be read at all is a reason here, not a throw.
 */
async function readOne(path: string, state: string): Promise<{ record?: any; reason?: string }> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (e) {
    return { reason: "cannot be read: " + said(e) };
  }
  return reading(text, path, state);
}

/**
 * ONE WRITE, AND THE RECORD HANDED BACK IS THE RECORD ON DISK.
 *
 * The text arrives already formatted (formatRecord, above) and is written as it is; what comes back
 * is a RE-READ of the file rather than the object in hand. That is the invariant a caller can act
 * on — what I got is what a later show gives — and it is why the two content-level rewrites fmt
 * makes (an asterisk emphasis, a space at the end of some `inline code`) are in the value the
 * caller receives instead of being discovered by whoever reads the board next.
 */
async function writeAt(
  path: string,
  text: string,
  state: string,
  createNew?: boolean,
): Promise<any> {
  await Deno.writeTextFile(path, text, createNew ? { createNew: true } : undefined);
  return await readAt(path, state);
}

/**
 * Put a record where its state says it belongs: <dir>/<state>/<id>-<slug>.md. A state change IS the
 * rename into that folder — one fact in one place, and no field left beside it to go stale. The
 * folder is created on demand, so a board grows a done/ the first time something is finished.
 *
 * fmt is asked FIRST, before the rename: a record whose formatting is refused is still where it was,
 * saying what it said, which is the only outcome a caller who was thrown at can go and check.
 */
async function place(dir: string, rec: any, state: string, from: string): Promise<any> {
  // The folder is the state, so a record that has moved says the state of the folder it went to.
  rec.state = state;
  const target = recordFile(dir, state, rec);
  const text = await formatRecord(dir, render(rec));
  if (target !== from) {
    await Deno.mkdir(stateDir(dir, state), { recursive: true });
    await Deno.rename(from, target);
  }
  return await writeAt(target, text, state);
}

/**
 * THE CRITICAL SECTION: <dir>/.claim/<id>.lock, created with O_EXCL (Deno.open's `createNew`). The
 * kernel decides the race, so of two claimers exactly one creates it and the other gets
 * AlreadyExists — the record's own state is never the thing being raced on, and there is no shared
 * index file to corrupt. It is keyed by ID rather than placed beside the record because the holder
 * RENAMES the record into another state's folder: a lock beside the record would be left behind by
 * the move it guards. The holder's name and time go INSIDE the lock, so a lock left behind by a
 * crash says who to ask.
 */
async function acquire(dir: string, id: string, holder: string): Promise<string> {
  const lock = join(join(dir, LOCK_DIR), req(id, "id") + LOCK_SUFFIX);
  await Deno.mkdir(join(dir, LOCK_DIR), { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      const file = await Deno.open(lock, { createNew: true, write: true });
      try {
        file.write(encoder.encode(holder + " " + iso() + NL));
      } finally {
        file.close();
      }
      return lock;
    } catch (e) {
      if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
      // Held. WAIT for it rather than skip it: the work behind it is milliseconds long, and a waiter
      // that gave up would report BUSY for a claim it could have lost honestly.
      let stale = false;
      try {
        const info = await Deno.stat(lock);
        stale = info.mtime !== null && Date.now() - info.mtime.getTime() > LOCK_STALE_MS;
      } catch {
        continue; // released between the open and the stat: try again now
      }
      if (stale) {
        try {
          await Deno.remove(lock);
        } catch {
          // another waiter removed it first; the retry is what decides who wins
        }
        continue;
      }
      if (Date.now() - started > LOCK_WAIT_MS) {
        throw err(
          "BUSY",
          "another writer has held " + lock + " for more than " + LOCK_WAIT_MS +
            "ms (a lock older than " + LOCK_STALE_MS + "ms is taken as stale)",
        );
      }
      await sleep(POLL_MS);
    }
  }
}

async function releaseLock(lock: string): Promise<void> {
  try {
    await Deno.remove(lock);
  } catch {
    // already gone: a stale-lock takeover, or a caller cleaned the directory out from under us
  }
}

/**
 * `create` — a new task, written into `<dir>/open/`. WHY and at least one acceptance criterion are
 * required, because the body is what a sub-agent brief is made from and a task without one is a task
 * nobody can hand over. Returns the record it wrote, `path` included.
 * ACCEPTANCE, LINKS and TAGS are each ONE PARAGRAPH or an array of paragraphs: a caller with a
 * single sentence passes a string, and the record stores the list either way. TAGS is the optional
 * one — a record nobody tagged stores an empty list.
 * THE ARGUMENT IS THE BAG AND NOTHING ELSE: `create(dir)` — a directory on its own — is refused by
 * name rather than read as a set of fields, and the refusal names the call it wants.
 */
export async function create(opts: any): Promise<any> {
  const o = optsBag(
    "create",
    opts,
    "create({ dir, title, why, acceptance })",
    "A directory on its own is not a call: dir is one field of that bag.",
  );
  onlyFields("create", o);
  const dir = dirOf("create", o);
  const title = req(o.title, "title");
  const why = req(o.why, "why");
  const acceptance = listOf(o.acceptance, "acceptance");
  if (acceptance.length === 0) {
    throw err("INVALID", "acceptance needs at least one criterion: the body is the brief");
  }
  const state = "open";
  await Deno.mkdir(stateDir(dir, state), { recursive: true });
  const now = iso();
  // The id carries the second and four random hex digits, so a collision is not EXPECTED; the O_EXCL
  // create is what makes it impossible, and this loop is where that surfaces if it ever happens.
  for (let attempt = 0; attempt < 5; attempt++) {
    const rec: any = {
      id: newId(),
      title: title,
      state: state,
      owner: o.owner === undefined || o.owner === null ? "" : String(o.owner),
      worktree: o.worktree === undefined || o.worktree === null ? "" : String(o.worktree),
      created: now,
      updated: now,
      source: {
        who: (o.source && o.source.who) || "",
        words: (o.source && o.source.words) || "",
      },
      links: listOf(o.links, "links"),
      tags: listOf(o.tags, "tags"),
      why: String(why).trim(),
      acceptance: acceptance,
      notes: [],
    };
    const path = recordFile(dir, state, rec);
    try {
      // fmt runs BEFORE the file exists, so a refusal leaves no record at all — the alternative is
      // a file on disk that says "created" to everyone who lists the board.
      return await writeAt(path, await formatRecord(dir, render(rec)), state, true);
    } catch (e) {
      if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
    }
  }
  throw err("EXISTS", "five file names in a row were already taken in " + dir);
}

/**
 * `list` — the board as summaries, oldest first, optionally filtered by state and owner. THE STATE
 * IS THE FOLDER each record was read from, so nothing can sit in one state and say another, and a
 * board nobody wrote to is empty rather than an error.
 *
 * ONE UNREADABLE FILE DOES NOT FAIL THE BOARD (t20260710-000000-0720): the answer is a `Board` —
 * `{ broken, records }` — with `broken` FIRST, so what a person (or an agent) sees before the rows is
 * which cards could not be read and why, one entry each. A broken FILE is filtered with the same state
 * the rows are; the OWNER filter never drops one, because an unreadable file cannot say whose card it is,
 * and hiding it would hide the one thing that was asked about.
 * THE ARGUMENT IS THE BAG AND NOTHING ELSE, and a bare string is REFUSED rather than guessed at: `dir`
 * and `state` are both strings, so `list(dir)` used to be answered about DEFAULT_DIR, a board the
 * caller never named (t20261009-212755-a15a). The call is `list({ dir })` or `list({ state })`.
 */
export async function list(opts?: any): Promise<Board> {
  const o = optsBag(
    "list",
    opts,
    "list({ dir }), list({ state }), list({ dir, state, owner })",
    "A bare string is ambiguous here: the directory and the state are both strings, so neither is guessed at.",
  );
  const dir = dirOf("list", o);
  const wantState = o.state === undefined || o.state === null ? "" : String(o.state);
  const wantOwner = o.owner === undefined || o.owner === null ? "" : String(o.owner);
  const states = wantState === "" ? STATES : STATES.indexOf(wantState) < 0 ? [] : [wantState];
  const broken: Broken[] = [];
  const records: any[] = [];
  // ONE PARSER, and it is `reading` rather than a second caller of `parseRecord`: `list` walks the folders
  // asynchronously and `readBoard` synchronously, and the DECISION — a record or a reason — is the same
  // function in both. Only the syscalls differ, which is what this module says about the two readers.
  for (const state of states) {
    for (const name of await names(stateDir(dir, state))) {
      const path = join(stateDir(dir, state), name);
      const got = await readOne(path, state);
      if (got.reason !== undefined) {
        broken.push({ path, state, reason: got.reason });
        continue;
      }
      if (wantOwner !== "" && got.record.owner !== wantOwner) continue;
      records.push(summary(got.record));
    }
  }
  records.sort(byCreated);
  return { broken, records };
}

/**
 * `show` — one full record, from whichever state folder holds it, its WHY and acceptance criteria
 * included: the brief, ready to quote.
 * THE ID IS A STRING AND THE BAG IS THE SECOND ARGUMENT: `show({ dir })` puts the bag where the id
 * goes, and is refused by name rather than searched for as a task called "[object Object]".
 */
export async function show(id: string, opts?: any): Promise<any> {
  const o = optsBag("show", opts, "show(id, { dir })", "The id is the string that comes first.");
  const dir = dirOf("show", o);
  const found = await locate(dir, taskId("show", id, "show(id, { dir })"));
  return await readAt(found.path, found.state);
}

/**
 * `claim` — take an open task, and be the ONLY one who can. Under the lock the record is renamed
 * into `claimed/` with owner and worktree set; a second claimer meets the state the folder now
 * says and is refused with ALREADY_CLAIMED — naming the owner and since when, so a person can decide
 * whether to wait or to `release` it. The lock is released in a `finally`, so a refusal never
 * wedges the board.
 *
 * THE OWNER IS THE WORKER WHO DOES THE WORK. A brief that starts a sub-agent claims under the
 * WORKER's name, and claims only once that worker exists, so `list` answers "who is doing this"
 * rather than "who dispatched it" and a failed start leaves no claim behind. The orchestrator
 * claims in its own name only for work it does itself. Nothing here infers that from the call — a
 * `claim` cannot see its caller — which is why it is written down instead. A claim taken and then
 * not wanted is given back with `release(id, { owner })`, and the notes survive it.
 * THE ID IS A STRING AND THE BAG IS THE SECOND ARGUMENT: `claim({ dir }, { owner })` — the bag in the
 * id's place — is refused by name, and no lock is taken to say so.
 */
export async function claim(id: string, opts?: any): Promise<any> {
  const o = optsBag(
    "claim",
    opts,
    "claim(id, { owner, worktree, dir })",
    "The id is the string that comes first.",
  );
  onlyFields("claim", o);
  const dir = dirOf("claim", o);
  const owner = req(o.owner, "owner");
  const wanted = taskId("claim", id, "claim(id, { owner, worktree, dir })");
  // NOT_FOUND before any lock is taken, so a claim on a task nobody wrote makes nothing.
  await locate(dir, wanted);
  const lock = await acquire(dir, wanted, "claim " + owner);
  try {
    // Found again UNDER the lock: whoever held it before us may have moved the record on.
    const found = await locate(dir, wanted);
    const rec = await readAt(found.path, found.state);
    if (found.state !== "open") {
      throw err(
        "ALREADY_CLAIMED",
        "task " + rec.id + " is " + found.state + ", owner " + (rec.owner || "nobody") +
          " since " + rec.updated + " — release it if that owner is gone",
        rec.id,
      );
    }
    rec.owner = owner;
    if (o.worktree !== undefined && o.worktree !== null) rec.worktree = String(o.worktree);
    rec.updated = iso();
    return await place(dir, rec, "claimed", found.path);
  } finally {
    await releaseLock(lock);
  }
}

/**
 * `update` — change what has changed: any front matter field, a state that must be one of the four,
 * and a `note` appended (never overwritten) as `- <at> (<who>): text` under `## Notes`. A field it does
 * not know is REFUSED by name, listing the ones it takes, rather than dropped in silence. A new state
 * RENAMES the record into that state's folder, which is the only place the state lives; a retitle
 * renames it too, because a folder that says <id>-first.md for a task now called Second lies.
 * THE ID IS A STRING AND THE PATCH IS THE SECOND ARGUMENT: `update({ id, title })` — the whole patch
 * where the id goes — is refused by name, rather than reported as a missing task called "[object
 * Object]" in a directory the caller never named.
 */
export async function update(id: string, patch?: any): Promise<any> {
  const p = optsBag(
    "update",
    patch,
    "update(id, { title, state, note, dir })",
    "The id is the string that comes first.",
  );
  onlyFields("update", p);
  const dir = dirOf("update", p);
  const wanted = taskId("update", id, "update(id, { title, state, note, dir })");
  const nextState = stateArg(p, wanted);
  // NOT_FOUND and INVALID are both decided before the lock is taken: neither is a race.
  await locate(dir, wanted);
  const holder = p.note && p.note.who ? String(p.note.who) : "update";
  const lock = await acquire(dir, wanted, holder);
  try {
    const found = await locate(dir, wanted);
    const rec = await readAt(found.path, found.state);
    if (p.title !== undefined) rec.title = req(p.title, "title");
    if (p.why !== undefined) rec.why = String(p.why).trim();
    if (p.acceptance !== undefined) {
      rec.acceptance = listOf(p.acceptance, "acceptance");
    }
    if (p.links !== undefined) rec.links = listOf(p.links, "links");
    if (p.tags !== undefined) rec.tags = listOf(p.tags, "tags");
    if (p.source !== undefined) {
      rec.source = {
        who: (p.source && p.source.who) || "",
        words: (p.source && p.source.words) || "",
      };
    }
    if (p.owner !== undefined) rec.owner = p.owner === null ? "" : String(p.owner);
    if (p.worktree !== undefined) rec.worktree = p.worktree === null ? "" : String(p.worktree);
    if (p.note !== undefined && p.note !== null) {
      const who = typeof p.note === "string" ? "" : String(p.note.who || "");
      const text = typeof p.note === "string" ? String(p.note) : req(p.note.text, "note.text");
      // A note THIS writer appends is a BULLET, and the marker says so rather than leaving it to be
      // guessed from `at` and `who` being empty — which is a PARAGRAPH note's shape.
      rec.notes = (rec.notes || []).concat([noteOf(iso(), who, text, true)]);
    }
    rec.updated = iso();
    return await place(dir, rec, nextState === "" ? found.state : nextState, found.path);
  } finally {
    await releaseLock(lock);
  }
}

/**
 * `release` — give a claim up: the card goes back into `open/` for whoever takes it next.
 *
 * A CLAIM THAT CANNOT BE RELEASED IS A LIE WITH NO EXIT. `claim` refuses a second claimer and
 * `update` never took an owner, so a card claimed by an agent that never started, died or was
 * stopped said it was being worked on for ever; the only way out was to move it to another state
 * and back, which reorders the notes (t20261022-050953-eb3b). Rather than widen `claim` — three
 * agents were using it live — this is ADDITIVE, and `claim` keeps its signature.
 *
 * WHAT IT DOES, in one write under the same lock `claim` takes: the record is renamed into
 * `open/`, its `owner` and `worktree` are CLEARED (an open card that still names an owner lies
 * about who is on it), and the notes KEEP THEIR ORDER and gain ONE BULLET at the end saying who
 * released it. The release is history the board can still show; nothing is rewritten.
 *
 * WHO MAY DO IT IS THE WHOLE SAFETY: `owner` is REQUIRED and must be the name the record holds, or
 * the call is refused with NOT_OWNER. Without that, one agent could free another's card and a
 * second claimer would start the same work twice.
 *
 * A card nobody claimed is refused with NOT_CLAIMED rather than "freed": `open` is already the
 * state a release asks for, and answering `ok` to a call that changed nothing is the silence this
 * module refuses everywhere else.
 *
 * THE ID IS A STRING AND THE BAG IS THE SECOND ARGUMENT, as it is for claim: `release({ dir },
 * { owner })` — the bag in the id's place — is refused by name, and no lock is taken to say so.
 */
export async function release(id: string, opts?: any): Promise<any> {
  const o = optsBag(
    "release",
    opts,
    "release(id, { owner, dir })",
    "The id is the string that comes first.",
  );
  onlyFields("release", o);
  const dir = dirOf("release", o);
  const owner = req(o.owner, "owner");
  const wanted = taskId("release", id, "release(id, { owner, dir })");
  // NOT_FOUND before any lock is taken, exactly as claim does it: a release of a task nobody wrote
  // makes nothing.
  await locate(dir, wanted);
  const lock = await acquire(dir, wanted, "release " + owner);
  try {
    // Found again UNDER the lock: the record may have been retitled, moved on or released between
    // the locate above and this one.
    const found = await locate(dir, wanted);
    const rec = await readAt(found.path, found.state);
    if (found.state !== "claimed") {
      throw err(
        "NOT_CLAIMED",
        "task " + rec.id + " is " + found.state + ", owner " + (rec.owner || "nobody") +
          ": there is no claim to release",
        rec.id,
      );
    }
    if (rec.owner !== owner) {
      throw err(
        "NOT_OWNER",
        "task " + rec.id + " is claimed by " + (rec.owner || "a record with no owner") +
          " since " + rec.updated + ", and only that owner may release it: " + owner +
          " did not claim it",
        rec.id,
      );
    }
    rec.owner = "";
    rec.worktree = "";
    rec.notes = (rec.notes || []).concat([
      noteOf(iso(), owner, "released the claim; the card is open again", true),
    ]);
    rec.updated = iso();
    return await place(dir, rec, "open", found.path);
  } finally {
    await releaseLock(lock);
  }
}

/**
 * The module documents itself. `spec` is not a seventh verb: it is the surface, and it is here
 * rather than derived from JSDoc so that a loaded module always reports its six verbs with their
 * arguments.

 *
 * NO `positional` NAMES THE OPTIONS BAG. A positional name is an argument of its own — `["id"]` for
 * `show(id, opts)` — and the bag is the object the braces render, so its members are the fields and its
 * own name is a token no caller can pass. `["id", "opts"]` printed `board.show(id, opts?, { dir? })`,
 * which reads as an argument between the id and the object it names (t20261009-185511-aee4); `create`
 * and `list` take nothing BUT the bag, so they declare no `positional` at all and print as one object.
 *
 * The derived specs agree: `docspec.ts` puts a bag parameter members in `properties` and never the bag
 * name in `positional` ("The options bag: its MEMBERS are parameters, its own name is not").
 */
export const spec = {
  create: {
    description:
      "Add a task: one file at <dir>/open/<id>-<slug>.md. WHY and at least one acceptance criterion are required.",
    returns: "the record it wrote, id and path included",
    throws:
      "INVALID for an empty title, why or acceptance, for acceptance/links/tags in the wrong shape, for an argument that is not one options bag, or for a field it does not take (the refusal names the ones it does); EXISTS when no file name is free; FMT when deno fmt cannot be run or refuses the record, and then nothing is written",
    async: true,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "what the task is, in one line" },
        why: { type: "string", description: "the reason it exists; stored as the body's ## Why" },
        acceptance: {
          type: ["string", "array"],
          items: { type: "string" },
          description:
            "what done looks like: a paragraph, or several paragraphs as an array; stored under ## Acceptance criteria",
        },
        source: {
          type: "object",
          properties: {
            who: { type: "string" },
            words: { type: "string", description: "the words that asked for it" },
          },
        },
        links: { type: ["string", "array"], items: { type: "string" } },
        tags: {
          type: ["string", "array"],
          items: { type: "string" },
          description:
            "short labels for slicing the board; a paragraph or an array, stored as a list, a " +
            "missing field reading as an empty list",
        },
        owner: { type: "string" },
        worktree: { type: "string" },
        dir: {
          type: "string",
          description:
            "records directory; ./tasks by default; its open/claimed/done/deferred/dropped folders hold the records",
        },
      },
      required: ["title", "why", "acceptance"],
    },
  },
  list: {
    description:
      "The board as summaries, oldest first, optionally filtered by state and owner. The state is the FOLDER each record was read from. A board nobody wrote to is empty, not an error, and ONE unreadable file does not fail the board: it is reported in `broken`, which comes first in the answer.",
    returns:
      "{ broken, records } — broken is one {path, state, reason} per file that could not be read as a record (no front matter block, no id, no title, a state field), and records is an array of {id, title, state, owner, worktree, created, updated, tags, path}, oldest first",
    throws:
      "INVALID for an argument that is not one options bag: a bare string is refused by name rather than read as the default ./tasks; CORRUPT is thrown by show/claim/update for a record they name, NEVER by list for one file on the board",
    async: true,
    inputSchema: {
      type: "object",
      properties: {
        state: {
          type: "string",
          description:
            "open, claimed, done, deferred or dropped: the folder the record is read from",
        },
        owner: { type: "string" },
        dir: { type: "string" },
      },
    },
  },
  show: {
    description:
      "One full record, from whichever state folder holds it, its WHY and acceptance criteria included: the brief, ready to quote.",
    positional: ["id"],
    returns: "the record",
    throws:
      "NOT_FOUND; CORRUPT when two records carry the id; INVALID for an id that is not a string",
    async: true,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "the id, as create returned it" },
        dir: { type: "string" },
      },
      required: ["id"],
    },
  },
  claim: {
    description:
      "Take an open task ATOMICALLY: the record is renamed into claimed/ with owner and worktree set, and of two concurrent claimers exactly one wins. OWNER IS THE WORKER'S NAME and not the orchestrator's — whoever hands the work to a sub-agent claims under THAT name, and loom claims only for work it does itself — because the board's job is to answer who is doing this.",
    positional: ["id"],
    returns: "the claimed record",
    throws:
      "ALREADY_CLAIMED when someone else has it; NOT_FOUND; BUSY when another writer holds <dir>/.claim/<id>.lock; INVALID without an owner, or for a field it does not take; INVALID for an id that is not a string",
    async: true,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        owner: { type: "string", description: "who is taking it: required" },
        worktree: { type: "string", description: "where they are working, if anywhere separate" },
        dir: { type: "string" },
      },
      required: ["id", "owner"],
    },
  },
  release: {
    description:
      "Give a claim up: the record is renamed back into open/, owner and worktree are cleared, and the notes keep their order and gain one note saying who released it. Only the owner the record holds may release it, and the card is then claimable by anyone.",
    positional: ["id"],
    returns: "the released record, back in open/",
    throws:
      "NOT_CLAIMED when the record is not in claimed/; NOT_OWNER when owner is not the owner the record holds; NOT_FOUND; BUSY when another writer holds <dir>/.claim/<id>.lock; INVALID without an owner, or for a field it does not take; INVALID for an id that is not a string",
    async: true,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "the id, as create returned it" },
        owner: {
          type: "string",
          description: "the owner the record holds, which is the only name that may release it",
        },
        dir: { type: "string" },
      },
      required: ["id", "owner"],
    },
  },

  update: {
    description:
      "Change what has changed: any front matter field, a state among open/claimed/done/deferred/dropped (which RENAMES the record into that folder), and a note appended under ## Notes. The file name follows a retitle.",
    positional: ["id"],
    returns: "the record as it now stands",
    throws:
      "INVALID for a state outside the five, for acceptance/links/tags in the wrong shape, for an id that is not a string, or for a field it does not take (the refusal names the ones it does); NOT_FOUND; BUSY; FMT when deno fmt cannot be run or refuses the record, and then nothing is written and the record has not moved",
    async: true,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        state: {
          type: "string",
          description:
            "open, claimed, done, deferred or dropped: the folder the record is renamed into",
        },
        title: { type: "string" },
        why: { type: "string" },
        acceptance: { type: ["string", "array"], items: { type: "string" } },
        links: { type: ["string", "array"], items: { type: "string" } },
        tags: { type: ["string", "array"], items: { type: "string" } },
        source: { type: "object" },
        owner: { type: "string" },
        worktree: { type: "string" },
        note: {
          type: "object",
          properties: { who: { type: "string" }, text: { type: "string" } },
          required: ["text"],
          description: "one line of history, appended and never overwritten",
        },
        dir: { type: "string" },
      },
      required: ["id"],
    },
  },
};

/**
 * WHAT A VERB ACCEPTS, BY NAME — because a field it does not know is a field it DROPS, silently. A
 * caller who wrote `notes` for `note` was told nothing, the record was rewritten anyway, and the text
 * they wrote is nowhere on it; refusing is the only outcome they can act on.
 *
 * The names are the verb's own schema MINUS the arguments it takes positionally, which are exactly the
 * names `help` prints inside its braces — one source for both, so a refusal and a signature cannot
 * drift apart, and a field added to the schema is offered here with no second edit.
 *
 * It sits under `spec` because `spec` is what it reads; the verbs call it and a function declaration
 * hoists. `loom/repl/js/fileverbs.ts` holds the same rule for the repl's own verbs (`onlyOptions`).
 */
function onlyFields(verb: string, opts: any): void {
  const declared = (spec as any)[verb];
  const positional: string[] = declared.positional || [];
  const allowed = Object.keys(declared.inputSchema.properties || {}).filter((k) =>
    !positional.includes(k)
  );
  const unknown = Object.keys(opts).filter((k) => !allowed.includes(k));
  if (unknown.length === 0) return;
  throw err(
    "INVALID",
    verb + " does not take " + unknown.join(", ") + ": it takes " + allowed.join(", "),
  );
}
