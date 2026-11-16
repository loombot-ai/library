#!/usr/bin/env -S deno run -A
/**
 * `library`: a person's PUBLIC LIBRARY as three verbs - the MCP server §8 asks for, started by an agent with
 * `startWorker.mcp`:
 *
 *     await startWorker.mcp("library", "deno", ["run", "-A", "<library>/mcp/library_mcp.ts"]);
 *
 * and that is the whole command. `--share <dir>` (the published set, `~/.loom/library/share/` by default) is
 * the one flag worth passing; everything else below is a default this file supplies.
 *
 * ## The three verbs
 *
 *     list({handle?, limit?})            one person's entries, newest first: `GET /library/<handle>` (§4)
 *     get({handle, slug} | {id})         the entry's files into a temp folder, and the PATH back (§8)
 *     sync({plan? = true})              walk `share/`, refuse what the account would refuse, then
 *                                        `POST /apis/library/sync` - the plan by default (§6)
 *
 * `endorse` and `comment` are §8's, and they are NOT here: §7 deleted both verbs (a citation IS an
 * endorsement; a comment is a task card), so there is nothing to build until that table lands. Rendering,
 * the site, citations display, search and the deploy are other lanes' work.
 *
 * ## `get` returns a PATH, and that is the whole point
 *
 * §8: "`get` returning a path is what makes the file viewer the library's reader: the agent and the person
 * look at the same bytes through the same tool." So the files land under THE RUN'S TEMP DIRECTORY - never in
 * a workdir, where a fetched entry would look like part of somebody's project - and the answer is the path
 * plus the entry's three identities (`entry_id`, `id`, `name`, `published_at`). `show` that folder, `read`
 * a file in it: the bytes are the entry's own.
 *
 * ## The identity is the machine's
 *
 * A sync uses the device credential a pairing already left behind (`~/.loom/accounts/<origin>.json`, or the
 * workdir's `.loom/account.json`), sent as `Authorization: Bearer <device token>`. There is NO PUBLISH KEY
 * (§5): nothing to paste, and revoking the machine on `/account` takes publishing away. A machine with no
 * credential is refused HERE, in one sentence naming the press that fixes it, before anything is sent.
 *
 * ## `sync` is the folder's decision, and the plan is the default
 *
 * `~/.loom/library/share/` IS the published set - an entry is a folder in it holding `README.md`, and
 * `AGENT.md` and dot files are never sent. With no arguments the verb answers WHAT WOULD HAPPEN
 * (`2 new, 1 changed, 1 to remove`, the paths and their addresses) and publishes nothing; `{plan: false}`
 * applies it, and then writes each entry's `.loom-entry.json` back with the id the account minted.
 *
 * ## Flags (all optional)
 *
 *     --share <dir>      the published set            default `~/.loom/library/share/`   ($LOOM_SHARE_DIR)
 *     --origin <url>     the account service          default https://loombot.ai       ($LOOM_ACCOUNT_ORIGIN)
 *     --accounts <dir>   where machine credentials are default `~/.loom/accounts`        ($LOOM_ACCOUNTS_DIR)
 *     --workdir <dir>    whose `.loom/account.json`   default the CWD
 *     --tmp <dir>        where `get` writes           default $TMPDIR (the run's own scratch directory)
 *
 * The transport is newline-delimited JSON-RPC on stdin/stdout, one message per line - the same carriage
 * `viewer_mcp.ts`, `board_mcp.ts` and `app_mcp.ts` use, so loom talks to all four the same way.
 */
import {
  credentialOf,
  DEFAULT_ORIGIN,
  fetchEntry,
  listLibrary,
  MAX_LIMIT,
  PAGE,
  Refused,
  why,
  type Wire,
} from "./wire.ts";
import {
  answerOf,
  check,
  handleIn,
  payloadOf,
  refusalOf,
  rememberIds,
  shareDir,
  walkShare,
  wordsOf,
} from "./share.ts";

// ── flags ────────────────────────────────────────────────────────────────────────────────────────────

function flag(name: string): string | undefined {
  const at = Deno.args.findIndex((a) => a === "--" + name || a.startsWith("--" + name + "="));
  if (at < 0) return undefined;
  const arg = Deno.args[at];
  const eq = arg.indexOf("=");
  if (eq >= 0) return arg.slice(eq + 1);
  const next = Deno.args[at + 1];
  return next === undefined || next.startsWith("--") ? "" : next;
}

function named(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

const ORIGIN =
  (named(flag("origin")) ?? named(Deno.env.get("LOOM_ACCOUNT_ORIGIN")) ?? DEFAULT_ORIGIN)
    .replace(/\/+$/, "");
const ACCOUNTS = (named(flag("accounts")) ?? named(Deno.env.get("LOOM_ACCOUNTS_DIR")) ??
  ((Deno.env.get("HOME") ?? "") + "/.loom/accounts")).replace(/\/+$/, "");
const WORKDIR = (named(flag("workdir")) ?? Deno.cwd()).replace(/\/+$/, "");
/** The published set: a flag, else §6's folder - and `shareDir` says why when there is no HOME. */
const SHARE = named(flag("share")) ?? named(Deno.env.get("LOOM_SHARE_DIR"));
/** Where `get` writes: THE RUN'S TEMP DIRECTORY, which is what loom sets `TMPDIR` to. */
const INTO =
  ((named(flag("tmp")) ?? named(Deno.env.get("TMPDIR")) ?? named(Deno.env.get("TEMP")) ?? "/tmp")
    .replace(/\/+$/, "")) + "/library";

/**
 * EVERYTHING THIS RUN DECIDES ONCE, and the reason it is a VALUE rather than four module constants: a test
 * drives the three verbs against a stub account by passing its own `Setting`, with no flags, no environment
 * and no real credential anywhere near it. The flags above are only how a LAUNCH fills it in.
 */
export interface Setting {
  readonly origin: string;
  readonly accounts: string;
  readonly workdir: string;
  /** The published set as the caller named it; undefined means §6's `~/.loom/library/share/`. */
  readonly share?: string | undefined;
  /** Where `get` writes its folders: the run's temp directory, never a workdir. */
  readonly into: string;
}

/** What the flags and the environment resolved to, for a server launched as a worker. */
export const DEFAULTS: Setting = {
  origin: ORIGIN,
  accounts: ACCOUNTS,
  workdir: WORKDIR,
  share: SHARE,
  into: INTO,
};

function logLine(...parts: unknown[]): void {
  // STDERR, ALWAYS: stdout is the protocol, and one stray line on it is a JSON-RPC frame a client chokes on.
  console.error("library:", ...parts.map((p) => typeof p === "string" ? p : JSON.stringify(p)));
}

// ── the verbs ────────────────────────────────────────────────────────────────────────────────────────

async function wire(set: Setting): Promise<Wire> {
  const credential = await credentialOf({
    origin: set.origin,
    accounts: set.accounts,
    workdir: set.workdir,
  });
  return { origin: set.origin, session: credential.session };
}

function text(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * `list`: one person's entries, newest first. No handle means "mine", and the handle is read off the
 * `.loom-entry.json` this machine's own published entries carry - a fact on disk rather than a second
 * question to the account, and the refusal says so when nothing has ever been published here.
 */
export async function listTool(set: Setting, args: Record<string, unknown>): Promise<string> {
  const rawLimit = args.limit;
  const limit = rawLimit === undefined || rawLimit === null ? PAGE : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Refused(
      "list's limit is a whole number from 1 to " + MAX_LIMIT + "; got " +
        JSON.stringify(rawLimit) +
        ". Nothing was read.",
    );
  }
  let handle = text(args.handle).trim();
  if (handle === "") {
    handle = (await handleOnDisk(set)) ?? "";
    if (handle === "") {
      throw new Refused(
        "list needs a handle: this machine has published nothing yet, so no " +
          ".loom-entry.json in " +
          (set.share ?? "share/") +
          ' names its owner. Pass list({handle: "<your name>"}) - it is the name a ' +
          "stranger types at " + set.origin +
          "/library/<handle> - and a sync of anything in share/ publishes " +
          "under it from then on.",
      );
    }
  }
  const got = await listLibrary(await wire(set), handle, limit);
  return JSON.stringify(
    { handle: got.handle, count: got.entries.length, more: got.more, entries: got.entries },
    null,
    2,
  );
}

/** The handle this machine's published entries carry, or null. */
async function handleOnDisk(set: Setting): Promise<string | null> {
  let share: string;
  try {
    share = shareDir(set.share);
  } catch {
    return null; // no HOME and no --share: no folder, therefore no handle
  }
  return await handleIn(share);
}

/** `get`: an entry's files into a temp folder, and the path back - the answer a viewer and `read` want. */
export async function getTool(set: Setting, args: Record<string, unknown>): Promise<string> {
  const got = await fetchEntry(
    await wire(set),
    {
      handle: named(text(args.handle)),
      slug: named(text(args.slug)),
      id: named(text(args.id)),
    },
    set.into,
  );
  logLine("fetched " + got.handle + "/" + got.slug + " into " + got.path);
  return JSON.stringify(got, null, 2);
}

/**
 * `sync`: walk the published set, refuse locally what the account would refuse, then ONE request.
 *
 * THE ORDER IS THE POINT: walk, then `check`, then the credential, then the POST. A tree that would be
 * refused costs no request and no pairing check, and a machine with no credential is refused before a byte
 * of an entry's content leaves it - because the refusal a person can act on arrives fastest when nothing has
 * been sent yet.
 */
export async function syncTool(set: Setting, args: Record<string, unknown>): Promise<string> {
  const rawPlan = args.plan;
  if (rawPlan !== undefined && rawPlan !== null && typeof rawPlan !== "boolean") {
    throw new Refused(
      "sync's plan is true (the default: show what would change) or false (apply it); got " +
        JSON.stringify(rawPlan) + ". Nothing was sent.",
    );
  }
  const plan = rawPlan !== false;
  const share = shareDir(set.share);
  const walked = await walkShare(share);
  const trouble = check(walked);
  if (trouble.length > 0) throw refusalOf(trouble);
  const answer = answerOf(await post(await wire(set), payloadOf(walked, !plan)));
  const wrote = plan ? [] : await rememberIds(share, answer);
  const strayed = walked.strayed.length === 0 ? "" : "\nnot published (" + walked.strayed.length +
    "): " + walked.strayed.join(", ") + " - a file at the top of share/ belongs to no entry.";
  return wordsOf(answer, !plan, wrote) + strayed;
}

/** §6's one write door, with the machine's credential on it and the account's own refusals read back. */
async function post(w: Wire, body: unknown): Promise<unknown> {
  const at = w.origin + "/apis/library/sync";
  const call = w.fetch ?? fetch;
  let res: Response;
  try {
    res = await call(at, {
      method: "POST",
      headers: {
        authorization: "Bearer " + w.session,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    throw new Refused(
      at + " could not be reached (" + why(e) +
        "), so nothing was published - check the origin and this " +
        "machine's network, then run sync again.",
    );
  }
  const answer = await res.text();
  if (res.status !== 200 && res.status !== 201) throw refusalOfAnswer(at, res.status, answer);
  try {
    return JSON.parse(answer);
  } catch {
    throw new Refused(
      at + " answered " + res.status +
        " with something that is not JSON, so nothing here can be trusted: " +
        answer.slice(0, 300),
    );
  }
}

/**
 * §6's status table, read back: `not_a_machine`, `machine_revoked`, `no_handle`, `too_large`,
 * `not_an_entry`, `no_front_matter`, `unsupported_type`, `path_escapes`. Each one names the person's next
 * move rather than restating the code, and the account's own sentence is quoted after it - it is the same
 * rule, and this client should not be the only place a person can read it.
 */
function refusalOfAnswer(at: string, status: number, body: string): Refused {
  let error = "";
  let message = "";
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    error = text(parsed.error);
    message = text(parsed.message);
  } catch { /* not JSON: the status is all there is */ }
  const fix: Record<number, string> = {
    401: "this machine's credential did not verify - pair it again on " + ORIGIN + "/account.",
    403: "this machine was revoked on " + ORIGIN + "/account, so pair it again to publish.",
    409: "the account has not claimed a name yet - claim one on " + ORIGIN +
      "/account, then run sync again.",
    413:
      "an entry is at most 32 files, 1 MB a file and 2 MB a sync - the tree in share/ is over one of those.",
    415: "an entry is a folder holding README.md, and one in the payload held none.",
    422:
      "a file, a field or a path in share/ is one the account refuses - the front matter's name, " +
      "description and as_of, one of the five types, or a path inside the entry's own folder.",
  };
  const hint = fix[status] ?? "the account refused this sync.";
  return new Refused(
    "nothing was published: " + at + " answered " + status +
      (error === "" ? "" : " (" + error + ")") +
      (message === "" ? "" : ": " + message) + "\n" + hint,
  );
}

// ── MCP ─────────────────────────────────────────────────────────────────────────────────────────────

const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "list",
    description: [
      "One person's public library entries, newest first (docs/library.md §4): what has this person",
      "written. Each row is the entry's slug (its path inside their tree, and its address), name, the",
      "description that says when to read it, published_at, its url, and the entry_id a reference cites.",
      "No handle means YOU: the handle is read off the .loom-entry.json your own published entries carry,",
      "and the refusal names the flag to pass when nothing here has ever been published.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        handle: {
          type: "string",
          description:
            "Whose library: the name a stranger types at <origin>/library/<handle>. Omit for your own.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: "How many entries to read, 1 to " + MAX_LIMIT + " (default " + PAGE + ").",
        },
      },
      required: [],
    },
  },
  {
    name: "get",
    description: [
      "Fetch ONE published entry's files into a folder under the run's temp directory and return that",
      "PATH - so `show` puts the entry on the page and `read` reads the same bytes. The answer also",
      "carries the entry's identities: entry_id (WHICH ENTRY, the uuid a reference cites), id (WHICH",
      "VERSION, the content id), name and published_at. Address it by {handle, slug}, or by {id} when you",
      "hold a reference (loom://e/<uuid>) - the id is resolved to wherever the entry lives now, so it",
      "survives the entry being reorganised. Nothing is ever written into a workdir.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string", description: "The owner's name: /library/<handle>/<slug>." },
        slug: {
          type: "string",
          description:
            "The entry's path inside that person's tree, e.g. `relay/streams`. Slashes are kept.",
        },
        id: {
          type: "string",
          description:
            "An entry uuid (loom://e/<uuid>) INSTEAD of {handle, slug}. A content id is not one.",
        },
      },
      required: [],
    },
  },
  {
    name: "sync",
    description: [
      "Publish `~/.loom/library/share/` - THE FOLDER IS THE PUBLISHED SET: an entry is a folder in it",
      "holding README.md, AGENT.md and dot files are never sent, and an entry the account holds and the",
      "folder no longer names is REMOVED. Without arguments it answers the PLAN and publishes nothing:",
      "'2 new, 1 changed, 1 to remove', the paths and their addresses, and says what did not happen.",
      "Pass plan: false to apply it - that is the one destructive verb here, and it then writes each",
      "entry's .loom-entry.json back with the id the account minted. Before any request it REFUSES what",
      "the account would refuse, in one message listing every problem: a folder with no README.md, a",
      "README.md front matter without name, description or as_of, a file outside the five types, or the",
      "size limits. Publishing needs this machine's device credential (pair it on the account page);",
      "there is no publish key.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        plan: {
          type: "boolean",
          description:
            "true (the default) = show add/update/delete and send nothing for publishing; " +
            "false = apply it, deletions included.",
        },
      },
      required: [],
    },
  },
];

export async function tool(
  set: Setting,
  args: Record<string, unknown>,
  name: string,
): Promise<string> {
  if (name === "list") return await listTool(set, args);
  if (name === "get") return await getTool(set, args);
  return await syncTool(set, args);
}

const enc = new TextEncoder();
let tail: Promise<unknown> = Promise.resolve();

function send(msg: unknown): void {
  const line = JSON.stringify(msg) + "\n";
  tail = tail.then(() => Deno.stdout.write(enc.encode(line))).catch((e) =>
    logLine("stdout write failed:", why(e))
  );
}

function reply(id: unknown, result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}

function toolResult(id: unknown, text: string, isError = false): void {
  // A JSON OBJECT goes as `structuredContent` too, which loom hands the agent as `data` - so
  // `(await workers.library.get({...})).data.path` needs no JSON.parse. MCP requires that field to be an
  // object, which is why the plan's words (prose) stay text only.
  let data: unknown;
  try {
    const v = JSON.parse(text);
    if (v && typeof v === "object" && !Array.isArray(v)) data = v;
  } catch { /* prose: the plan's own words */ }
  reply(id, {
    content: [{ type: "text", text }],
    isError,
    ...(data !== undefined && !isError ? { structuredContent: data } : {}),
  });
}

async function handle(set: Setting, msg: Record<string, unknown>): Promise<void> {
  const id = msg.id;
  const method = msg.method;
  if (method === "initialize") {
    reply(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "loom-library-mcp", version: "1" },
    });
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
  const name = text(params.name);
  if (!TOOLS.some((tool) => tool.name === name)) {
    return toolResult(
      id,
      "unknown tool: " + name +
        "; this server exposes list({handle?, limit?}), get({handle, slug} or " +
        "{id}) and sync({plan?})",
      true,
    );
  }
  try {
    return toolResult(id, await tool(set, params.arguments ?? {}, name));
  } catch (e) {
    if (!(e instanceof Refused)) {
      logLine(name + " failed:", e instanceof Error ? (e.stack ?? e.message) : e);
    }
    return toolResult(id, e instanceof Refused ? e.message : name + " failed: " + why(e), true);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────────

function usage(): void {
  console.error(
    "library: a person's public library as three verbs - list, get and sync - over JSON-RPC on stdin\n" +
      '  await startWorker.mcp("library", "deno", ["run", "-A", "<library>/mcp/library_mcp.ts"])\n' +
      "flags: --share <dir> --origin <url> --accounts <dir> --workdir <dir> --tmp <dir>\n" +
      "origin=" + ORIGIN + " accounts=" + ACCOUNTS + " share=" +
      (SHARE ?? "(default ~/.loom/library/share)") +
      " into=" + INTO,
  );
}

if (import.meta.main) {
  if (Deno.args.includes("--help") || Deno.args.includes("-h")) {
    usage();
    Deno.exit(0);
  }
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    Deno.addSignalListener(sig, () => {
      logLine("stopped by " + sig);
      Deno.exit(0);
    });
  }
  logLine(
    "up: origin=" + ORIGIN + " share=" + (SHARE ?? "(default)") + " into=" + INTO + " pid=" +
      Deno.pid,
  );
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of Deno.stdin.readable) {
    buf += dec.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line === "") continue;
      try {
        await handle(DEFAULTS, JSON.parse(line));
      } catch (e) {
        logLine("bad frame:", why(e), line.slice(0, 200));
      }
    }
  }
  // STDIN CLOSED: the client is gone, which is the first half of what stopWorker does.
  logLine("stdin closed, so the server ends");
  Deno.exit(0);
}
