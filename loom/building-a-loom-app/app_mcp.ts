#!/usr/bin/env -S deno run -A
/**
 * `loom_app_mcp`: an MCP server that IS a loom app's channel.
 *   deno run -A app_mcp.ts [--dir <the app's files>] [--app <name>] [--rules <path>]
 *                          [--build "<shell command>"] [--watch <path>]... [--state <path>] [--log <path>]
 *
 * **IT REGISTERS ITSELF, and there is no other way to start it.** Started by an agent
 * (`startWorker.mcp`), it finds `LOOM_BRIDGE_URL` and `LOOM_BRIDGE_TOKEN` in its environment, hands loombot
 * the files in `--dir`, and is told back the page URL, the socket and the credential — so nothing here
 * needs loombot's port, the session id or a credential path, none of which an agent can discover
 * (`tracking:apps-register-themselves`).
 *
 * THERE IS NO ARGV THAT ADDRESSES A LOOMBOT: an app is started by an agent, receives its page URL, socket and
 * credential FROM the registration it makes over the bridge, and is the only party that knows them. A
 * hand-assembled URL was the rigidity this design removes, and loombot serves no directory - it scans for no
 * apps - so a socket pointing at one would answer for an app that does not exist.
 *
 * It holds the app's PLAYER socket open and splits the traffic on it in two:
 *
 *     a MECHANICAL event    answered HERE, in milliseconds, with no agent involved
 *     a DECISION event      pushed to the agent as an MCP notification
 *     the agent's answer    arrives through the app's OWN tool when the rules declare one
 *                           (`workers.<name>.<tool>(...)` — an illegal call is that tool's ERROR),
 *                           and through generic `workers.<name>.send({action, data})` only when
 *                           the rules declare none
 *     a page going away     NOTHING AT ALL — no frame, no notification, no close, and no log line that
 *                           claims to know: a page is a request, and a request that ends is not an event
 *     the channel ending    a notification too, so the agent can stopWorker(<name>) itself
 *
 * **That split is the whole point, and correction 1 of `loom-hq/docs/generated-ui-channel.md` is why it is not
 * negotiable:** an agent answers at TURN boundaries, and one Bedrock round trip for a move measured
 * 2.0s at its very best. Two seconds for "here is my move" is fine; two seconds for "that square is
 * taken" is indefensible. So a rule is answered by a PROCESS — this one — and a model is asked exactly
 * the questions that need judgement.
 *
 * ## How an app says what is mechanical: a rules module in the app directory
 *
 * `<the app's directory>/rules.ts` — `--dir`, or the CWD — imported at boot (override with `--rules`):
 *
 *     export const initial = {...}                      // state when there is no saved state yet
 *     export function event(name, data, state)          // a BROWSER event
 *         -> {state?, actions?}   mechanical: handled here, nothing reaches the agent
 *         -> null                 a DECISION: becomes a notification
 *     export function action(name, data, state)         // OPTIONAL: fold the agent's answer into state
 *         -> {state?, actions?} | void                  (the shape for an app that declares no tools)
 *     export const tools = [{name, description, inputSchema, run}]   // OPTIONAL: the app's OWN verbs —
 *         ONE module, two audiences: a decision answered through a tool is a call with a reply, and an
 *         illegal call is that tool's ERROR (see `AppTool`/`ToolOutcome` below)
 *
 * **Why a module in the app directory rather than a table the agent passes at start time.** Both were
 * on the table; the module wins on four counts.
 *
 *  1. **A rule is code, not data.** "Is this move legal", "is the counter at its limit" are computed
 *     FROM STATE. A JSON table of mechanical event names could only say which events to swallow, not
 *     what to answer, so every non-trivial app would end up shipping code anyway — as a string in the
 *     agent's repl, which is the worst of both.
 *  2. **An app is already a DIRECTORY** (`index.html`, `app.js`, its state). `rules.ts` is the same
 *     app's behaviour on the other side of the socket. Copy the directory, get the app.
 *  3. **The rules and `app.js` must agree**, and they drift the moment they live in different places.
 *     One `ls` apart is the shortest leash available.
 *  4. **A table at start time is context the agent must re-spell on every start**, and re-spelling from
 *     memory is how a limit becomes 10 in the page and 12 in the channel.
 *
 * The cost, stated so it is a decision and not an oversight: the server runs code from the app
 * directory. Anything that can write that directory can already write the page this server hands to loombot,
 * so this widens nothing — it is one set, not two.
 *
 * ## An app with NOTHING to decide: no rules module, and every event REFUSED
 *
 * With no `--rules` and no `<APP_DIR>/rules.ts` the app is STATIC: pages and assets, served and
 * republished, with nothing on the socket that could decide anything. Every browser event is answered
 * HERE with `{action: "reject", data: {event, reason}}` and NEVER becomes a notification; `state()`
 * says `static: true`. A web app whose logic is all client-side arithmetic (the driving case: a
 * spelling-bee trainer, timer and spaced repetition in the page) would otherwise ship a stub `rules.ts`
 * whose only job is to exist.
 *
 * **What this must NOT weaken: absent rules mean REJECT, never DECIDE.** A missing rules module used to be
 * fatal because "no rules" read as "every click is a decision", and that is still the failure to avoid.
 * So the absence is answered mechanically, the same way an unknown event is. And an EXPLICIT `--rules`
 * that is missing or broken stays FATAL: the flag says the app has rules, so a typo in it must not
 * quietly turn a game into a page that refuses every move. A `rules.ts` that exists but does not import
 * is fatal too — only ABSENCE is static.
 *
 * ## A build step, and a watch loop that republishes without the agent
 *
 * `--build "<cmd>"` runs `sh -c <cmd>` in THIS PROCESS'S CWD (the directory the server was started in —
 * the agent's workdir under `startWorker.mcp` — not `--dir`) before EVERY registration: the first one and
 * every `publish`. Its output goes to the app log. It is all-or-nothing, like the registration itself: a
 * non-zero exit at startup fails the start; on `publish` it returns a failure carrying the last 40 lines
 * and loombot keeps serving the PREVIOUS version, because nothing was registered.
 *
 * `--watch <path>` (repeatable) rebuilds and republishes on a change: debounced 300ms, coalesced, and
 * serialised with `publish` through one chain, so two builds never run at once and a change DURING a
 * build schedules exactly one more. It is MECHANICAL — it never notifies the agent; each cycle is a log
 * line, a failed one leaves the previous version serving, and `state()` reports the last outcome. That
 * is what makes "the human asks in chat, the agent edits the source, the panel shows it" cost the agent
 * no `publish` call at all.
 *
 * **THE LOOP TRAP, guarded rather than documented:** with `--build`, `--dir` is where the build WRITES, so
 * a watched path that contains `--dir` would see every build as a change and trigger the next. Events
 * inside `--dir` are therefore ignored when there is a build (and a watched path INSIDE `--dir` is
 * refused at start, since it could never trigger anything). The state directory and the log are ignored
 * always: a click persists state and every cycle writes a log line, and either would republish the page
 * under the human's hands. What is NOT guarded: a build that writes somewhere ELSE in a watched tree.
 * Build into `--dir`.
 *
 * ## THE FIRST REGISTRATION OPENS THE PANEL; nothing later does unless asked
 *
 * Starting an app server is, nearly always, somebody wanting to SEE the app, so the startup registration
 * carries loombot's reveal flag (`RegisterOptions.reveal` in `channel.ts`): a loombot page already open on that
 * SESSION mounts it in the panel with no click, and the caret stays in the composer. EVERY LATER
 * registration is sent without it — `publish`, each `--watch` cycle — because those are the agent or the
 * build pushing bytes, and a panel the human hid must stay hidden (a rule's answer to a move never
 * registers at all; it only broadcasts). ONE way to change that afterwards, and it is the caller's call:
 *
 *     publish({ reveal: true })    later: bring the app to the front again, e.g. "show me the app"
 *
 * THERE IS NO WAY TO START AN APP HIDDEN (Xiaohu, 2026-10-20: whether to reveal is LOOMBOT's business, not the
 * app's and not the agent's). `--no-reveal` was the exception to this rule; it is deleted, and an argv that
 * still spells it changes nothing.
 *
 * A RESTART of the same app is a new server's first registration, so it asks again — and it is shown
 * again, on a page that watched the first life too. loombot dropped the old registration with the old
 * server and counts from zero; the page forgets its high-water mark for an app that left the strip or
 * whose count went down (`drawTabs` in `client/conversation.js`), so the new life's 1 is an event.
 *
 * ## A PAGE'S CLOSE ENDS THE APP (card t20261027-025619-fb7e)
 *
 * The page's own Close control is an event like any other, and what answers it is the app: the rules
 * return `close`, and this server ends itself on the graceful path — `notifications/app/closed
 * {by: "user"}`, `player_left` to the page, unregister (the tab leaves the strip), exit 0. The next
 * `show` starts the app again.
 *
 * IT USED TO DEPEND ON `--durable` (card t20261025-061114-f6b7): a durable app answered `detached` and
 * stayed registered. That premise was reversed on 2026-10-27 — apps die with loombot and the agent starts
 * what it needs next — so the flag no longer changes what a page's Close does. `--durable` still says
 * what it always said ABOUT THE APP (its records outlive it; the board, the viewer) and rides the
 * registration as a fact, not a close policy.
 *
 * ## The tool surface is THREE generic tools, plus whatever the app's rules declare
 *
 *     send({action, data})   the agent's decision, to every browser on this app
 *     state()                what the rules currently hold
 *     publish()              re-read the assets and replace what loombot serves — the refine loop
 *                            ({title} renames the tab, {reveal: true} opens the panel)
 *
 * Every tool here lives in the owning agent's repl for as long as the app does. A toolbox on a
 * channel is a design failure: anything an app needs beyond these belongs in `rules.ts`, where it costs
 * no context and answers instantly. AND SINCE 2026-10-24 THAT INCLUDES TOOLS: a rules module may export
 * `tools`, and each is registered beside these three with the app's own name and schema — `move` on the
 * board, say — so the agent calls the app's verb and an illegal call comes back as THAT TOOL'S ERROR,
 * with the rules' reason, in the same call. An app that declares none gets exactly the three.
 *
 * `publish` is the one addition, and it is not app-specific: it is the machinery of the refine loop
 * (Xiaohu, 2026-09-24, "do both restart and push new assets"), and without it pushing new bytes would
 * mean stopping the server — which costs the channel, the state and the human's open page.
 *
 * ## THE PROTOCOL IS NOT IN THIS FILE: `channel.ts`, beside it
 *
 * Registration, the one player socket and its `?player`, clean-close-versus-abnormal, the retry ladder
 * and the exit a loombot that stays gone ends with, the last-page call, the run-dir log and the graceful
 * unmount
 * are `channel.ts` — one module, because the
 * file viewer speaks the same protocol and three protocol changes in one evening each had to be made in
 * two files (`tracking:one-channel-two-apps`). What is LEFT here is the app MODEL: the rules engine, the
 * three tools, the state file, and every decision about whether the agent is asked at all.
 *
 * ## WHERE THE LOG IS — read this first when something looks wrong
 *
 *     $TMPDIR/loom-app-mcp-<name>.log        (override with --log, or APP_MCP_LOG)
 *
 * loom starts a server with `stderr` going to `<agent>/mcp/<server>/stderr` at best and dropped at
 * worst, and STDOUT IS THE PROTOCOL: the stdio spec says a server MUST NOT write anything to stdout
 * that is not an MCP message. One stray `console.log` corrupts the stream and the channel dies quietly,
 * so `console` is rebound to the log file below before anything else can use it.
 */

import {
  bridgeFromEnv,
  captureConsole,
  channel,
  logFile,
  type Manifest,
  openLog,
  type RegisterOptions,
  type Registration,
} from "./channel.ts";
// THE ONE PROCESS-TREE WALK loom has (repls, shell workers and MCP servers all use it). Imported rather than
// copied: this server is mounted from the library where it stands (it already needs `channel.ts` beside it),
// and `proctree.ts`'s own docstring is about paths getting subtly different versions of the walk.
import { descendants, killAll } from "../../proctree.ts";

/** `--flag value`, and nothing cleverer: this is a private argv between an agent and one server. */
function flag(name: string): string | undefined {
  const i = Deno.args.indexOf("--" + name);
  return i >= 0 ? Deno.args[i + 1] : undefined;
}

/**
 * WHERE THE BROWSER ASSETS ARE: the directory whose files are handed to loombot at registration.
 *
 * Defaults to the CWD, which is what makes "a folder dedicated to developing a loom app" work: run this
 * server in it and the app is that folder. `.loom/apps/<name>` is still a perfectly good place to keep the
 * source — point `--dir` at it — and it is now just a folder: loombot stopped scanning on 2026-09-24, so
 * these bytes reach a browser because this process handed them over and for no other reason. loom has no
 * opinion about the layout ("it's the MCP's business"), so the rules below are this server's own and are
 * stated where `assets()` applies them.
 */
const APP_DIR = flag("dir") ?? ".";
/** The last segment of a path, with `.` meaning the directory this process is in. */
function dirName(p: string): string {
  const abs = p === "." || p === "" ? Deno.cwd() : p;
  return abs.replace(/\/+$/, "").replace(/^.*\//, "");
}
/**
 * The app NAME — what a human reads in the tab strip and what the agent addresses.
 *
 * `--app` wins; otherwise the asset directory's own name, which needs no flag at all. (It used to read
 * the name out of a hand-given `--socket` path as well, and that flag is gone.)
 */
const APP = flag("app") ?? dirName(APP_DIR);
/** Every value of a repeatable `--flag value`, in argv order. */
function flags(name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < Deno.args.length - 1; i++) {
    if (Deno.args[i] === "--" + name) out.push(Deno.args[i + 1]);
  }
  return out;
}
/**
 * Whether rules were ASKED FOR. Kept apart from the path because the two cases differ on absence: an
 * explicit `--rules` that is missing is a typo and fatal; a default `rules.ts` that is missing is a
 * static app.
 */
const RULES_FLAG = flag("rules");
const RULES_PATH = RULES_FLAG ?? APP_DIR + "/rules.ts";
/** `sh -c` this before every registration, in the CWD. See the header. */
const BUILD = flag("build");
const WATCH = flags("watch");
/**
 * WHETHER THIS APP IS A FIXTURE — `--durable` present, and that is the whole of it: its records outlive
 * it (the board, the file viewer), which is what the registration carries as a fact (`state().durable`).
 * IT IS NOT A CLOSE POLICY ANY MORE (card t20261027-025619-fb7e): a page's Close ends the app under both,
 * because the f6b7 premise — a durable app outlives its pages — was reversed on 2026-10-27. The option
 * rides the registration (`RegisterOptions.durable` in `channel.ts`) and is carried there, never sent
 * to loombot.
 */
const DURABLE = Deno.args.includes("--durable");

/**
 * Where the rules' state lives: `TMPDIR`, WHICH WE ALREADY INHERIT.
 *
 * **PER-RUN STATE IS TEMP BY DEFINITION** (Xiaohu, 2026-10-01, `tracking:one-library-and-sessions-instead-of-workspaces`).
 * Anthropic's channel-state guarantee is one line — survives a page reload, dies with the session — and both
 * halves are now a property of the filesystem rather than a promise about a variable: `TMPDIR` is the RUN's
 * own scratch directory (`<runDir>/tmp`, `loom/session.ts`), so state written there outlives every page
 * reload, dies with the session, and is swept with the run by `prune_runs`. `LOOM_APP_STATE_DIR` was the old
 * spelling of this and is GONE: a per-run directory needs no name of its own when the standard one is already
 * pointed somewhere private, and if state must outlive the run then it was never per-run state — see
 * `LOOM_APP_DATA_DIR` below.
 *
 * **IT WROTE INTO THE SOURCE TREE UNTIL 2026-09-24** — `<the app's dir>/channel-state.json` — and two of
 * those directories SHIP inside the loom repo (`example/`, `example-ttt/`), so playing the board dirtied a
 * working tree and `deno fmt --check` then reported a mid-game write as unformatted. It was papered over with
 * a `.gitignore` entry; the fallback below is the fix, and that entry went with it.
 *
 * BELOW THE HARNESS there are two fallbacks, for a server a person starts BY HAND: `--state` wins outright,
 * and with neither the state lands under `Deno.cwd()` — which is the workdir loom starts a server in, the
 * same fact `--dir` leans on by defaulting to `.` and the file viewer leans on for its `--root`. `TMPDIR`
 * is inherited by any process, harness-started or not, so the hand-started server gets per-run scratch too.
 *
 * ONE DIRECTORY PER APP NAME, so two apps in one run cannot share a file. The directory is created at boot
 * and a failure to create or write it is LOGGED, never fatal: an app with no persistence still works, it
 * just forgets.
 *
 * THE NAME is unchanged, and the reason it is not `state.json` is worth keeping: loombot owned
 * `<app>/state.json` while it refereed a board ("the board, written ONLY by loombot, which is what makes a lock
 * unnecessary"), and a channel server writing the same name made that claim false — silently in both
 * directions. The referee left loombot on 2026-09-22 (`loombot/game.ts`, deleted) and the scan went on
 * 2026-09-24, so the collision cannot happen now; the name still says which process writes the file.
 */
const STATE_PATH = flag("state") ??
  (Deno.env.get("TMPDIR")
    ? Deno.env.get("TMPDIR")!.replace(/\/$/, "") + "/" + APP + "/channel-state.json"
    : Deno.cwd().replace(/\/$/, "") + "/.loom/app-state/" + APP + "/channel-state.json");

/**
 * WHERE DURABLE DATA LIVES, WHEN THE APP DECLARED THAT IT KEEPS SOME: `~/.loom/app-data/<app>`, a sibling of
 * `library/`, handed over by the harness as `LOOM_APP_DATA_DIR`.
 *
 * **IT ONLY EXISTS BECAUSE THE MOUNT ASKED FOR IT** —
 * `startWorker.mcp(name, command, args, { data: true })` — and THE VARIABLE'S ABSENCE IS THE ANSWER: an app
 * that keeps nothing across runs has nothing to write, so there is no path to invent and no directory for
 * loom to make. A device preference belongs in the page's `localStorage` and what the AGENT should remember
 * in the library; neither is this. The harness creates the directory, because it is the only side that can
 * promise it exists.
 *
 * READ, NEVER MANAGED: this server neither writes nor tidies it — the state above is per-run and this is not,
 * so cleaning up on exit would delete exactly what it exists to keep. An app whose rules module keeps
 * something durable reads this and writes there only when it is present.
 */
const DATA_DIR = Deno.env.get("LOOM_APP_DATA_DIR");
const LOG_FILE = flag("log") ?? Deno.env.get("APP_MCP_LOG") ?? logFile("app-mcp", APP);

const logLine = openLog(LOG_FILE);

// STDOUT IS THE PROTOCOL. Rebound before the rules module is imported, so app code that prints cannot
// corrupt the stream — and app code is written by a model, which prints while it is debugging.
captureConsole(logLine);

// WHERE THIS APP'S TWO HOMES ARE, said once and in its log — the file a person reads when a board forgets
// itself or a leaderboard cannot be found. `TMPDIR` always answers (it is inherited, and the per-run state is
// under it); the durable path answers ONLY when the mount declared one, and the difference between "this app
// never asked for durable data" and "the harness lost it" is the whole reason to print both.
logLine(
  "per-run state:",
  STATE_PATH,
  "| durable data:",
  DATA_DIR ?? "(none: nothing durable was declared where this server was mounted)",
);

// ── the app's rules: the fast layer ──────────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;
/**
 * What a rule did: a new state, and actions to put in front of the page that asked. All optional.
 *
 * **AN ACTION IS DELIVERED ONLY AS THE ANSWER TO A REQUEST, and this is the one place the mechanism is
 * said.** A frame a rule produces while a page's request is being handled is that page's ANSWER, so its
 * `action` name reaches a page that asked for it, in `handle`. A frame produced when NOBODY is waiting —
 * the agent's `workers.<app>.send(...)`, a rule answering an event that arrived with no request behind it —
 * is a PUSH: loombot turns it into "this app changed", every open page reads again, and the action NAME
 * reaches nobody. So a push's action is a name for the re-read and never a message: state is what a page
 * learns from it, and `case "whatever_the_agent_sent":` in an `app.js` is a branch that cannot run.
 */
interface Handled {
  state?: unknown;
  actions?: { action: string; data?: Rec }[];
  /**
   * **WHICH PARTS OF THIS APP'S STATE THIS RESULT CHANGED** — `["list"]`, `["shown", "card"]` — the app's
   * own answer to a question only the app can answer (card t20261024-061052-2740). The names go onto the
   * frame this result produces (`channel.ts` `named`), and a page re-reads only what it draws among them.
   *
   * ABSENT and EMPTY are different answers, and both are needed. ABSENT means "I name no parts", so every
   * page reads everything it draws — the behaviour every app had before this existed, and the safe
   * default for a rule written without thinking about parts at all. EMPTY means "I name parts and this
   * result changed none", which is what a rule that answers the same selection again is saying, and it
   * must not send a page looking.
   *
   * It is read even with no `state`: a part is not always in this process (`task-board`'s `list` is the
   * records on disk, and the board's `refresh` changes it by telling the pages the agent wrote one).
   */
  parts?: readonly string[];
  /**
   * END THE APP, and this string is WHY ("the Quit button"). So an agent-written app can quit with no
   * server code: the state is saved and the actions broadcast FIRST, then `ch.close` — the agent gets
   * `notifications/app/closed {app, by, reason, text}` (`by` is "user" from `event`, "agent" from
   * `action`), the page gets `player_left`, the tab leaves the strip, and this process exits.
   */
  close?: string;
}
// The state is the APP's own shape, which this server never knows; `any` is honest about that, and
// every app is free to declare its own type in its own rules module (the example does).
// deno-lint-ignore no-explicit-any
type State = any;

/**
 * ONE TOOL THE APP DECLARES, and the answer to the thing an agent could previously only guess. It is
 * declared in `rules.ts` — beside the rules it enforces — and registered here beside `send`, `state` and
 * `publish`, so ONE module serves two audiences: the page's clicks and the agent's calls go through the
 * same `legal()`/`commit()`.
 *
 * **AND AN ILLEGAL CALL IS THE TOOL'S ERROR** — `ok: false` with the rules' own reason. That error is a
 * RETURN VALUE of the call the agent made, so it learns in the same breath and retries in the same turn;
 * nothing is pushed to the page and no notification is written. It replaces the old shape, where an
 * `illegal` action was broadcast while no request was being answered — loombot turned it into "this app
 * changed" and delivered it to nobody, so the agent was told only that its move had been sent.
 *
 * `run` may be async (a tool that reads a file), but the RULES stay synchronous: `event` is called
 * without `await` (see the header of README.md), and that rule is unchanged.
 */
interface AppTool {
  name: string;
  description?: string;
  /** JSON Schema, passed to `tools/list` unchanged — this is how the agent learns the arguments. */
  inputSchema?: Rec;
  run(args: Rec, state: State): ToolOutcome | Promise<ToolOutcome>;
}

/**
 * What an app-declared tool answers with. THE DISCRIMINANT IS `ok`, and the two halves mean different
 * things to the dispatcher rather than two flavours of success:
 *
 *     { ok: false, error }        AN MCP ERROR RESULT. Nothing is applied, nothing is pushed, nobody is
 *                                 notified — `handled` is ignored even if the rules supplied one.
 *     { ok: true, text?, handled? }  the call succeeded: `handled` is adopted, persisted and broadcast
 *                                 exactly as a browser event's result is, and `text` is what the agent
 *                                 reads back.
 */
type ToolOutcome =
  | { ok: true; text?: string; handled?: Handled }
  | { ok: false; error: string };

interface AppRules {
  initial?: unknown;
  /** `null` (or nothing) means THIS IS A DECISION — the agent is asked, and only then. */
  event(name: string, data: Rec, state: State): Handled | null | undefined;
  action?(name: string, data: Rec, state: State): Handled | null | undefined | void;
  /** THE APP'S OWN MCP TOOLS. Absent means the fixed three and nothing else — the declared-no-tools shape. */
  tools?: readonly AppTool[];
}

let rules: AppRules | undefined;
let state: State;
/** No rules module at all: every browser event is refused, and none is ever a decision. */
let isStatic = false;
/** The reason a static app gives the page, verbatim. */
const STATIC_REASON = "this app has no rules, so it answers no events";

/** Whether anything is at `p`, a dangling symlink included. Any error but NotFound is thrown. */
async function present(p: string): Promise<boolean> {
  try {
    await Deno.lstat(p);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

/**
 * Load `rules.ts` and the persisted state.
 *
 * A BROKEN rules module is fatal, and so is a MISSING one that `--rules` named: limping on would leave
 * an app whose rules the agent believes are running. Failing the handshake makes the start report it.
 *
 * An ABSENT default `rules.ts` is the one exception, and it is not "no rules, so ask the agent" — that
 * would make every click a notification and the app a chat box with a picture of an app, the failure
 * this server exists to prevent. It is STATIC: every event is refused mechanically (`onFrame`).
 * `lstat`, not `stat`: a dangling symlink named `rules.ts` is a rules module that is broken, not absent.
 */
async function loadApp(): Promise<void> {
  if (RULES_FLAG === undefined && !(await present(RULES_PATH))) {
    isStatic = true;
    state = {};
    logLine("no", RULES_PATH, "and no --rules: a STATIC app, so every browser event is refused");
    return;
  }
  // THE STATE DIRECTORY, MADE HERE AND NOT ASSUMED: the run's `TMPDIR` exists before we are started, but the
  // app's OWN directory under it does not — and a bare `--state`, or a fallback to the CWD's `.loom/`, can
  // point anywhere at all. This must work in a directory nobody prepared. Recursive, so it is idempotent.
  //
  // NOT FATAL. An app that cannot persist still answers every click; it forgets across a restart, which is a
  // smaller loss than a mount that refuses to start. `persist()` logs a failed write for the same reason, and
  // between them that is the whole of the promise: state is best-effort, the channel is not.
  const stateDir = STATE_PATH.replace(/\/[^/]*$/, "");
  if (stateDir && stateDir !== STATE_PATH) {
    await Deno.mkdir(stateDir, { recursive: true }).catch((e) =>
      logLine("state directory", stateDir, "could not be created, so this app will not persist:", e)
    );
  }
  const mod = await import("file://" + await Deno.realPath(RULES_PATH)) as Partial<AppRules>;
  if (typeof mod.event !== "function") {
    throw new Error(RULES_PATH + ": a rules module must export `event(name, data, state)`");
  }
  // THE APP'S OWN TOOLS ARE VALIDATED HERE, AND A BROKEN DECLARATION IS FATAL — the same standard a
  // broken `event` gets. Silently dropping one would be the third mutant this file is tested against:
  // a rules app whose tools vanish from the surface while the rules module that declared them looks fine.
  // A tool that would shadow one of the fixed three cannot be dispatched either (the fixed names are
  // matched first), so it is refused rather than half-registered.
  if (mod.tools !== undefined) {
    if (!Array.isArray(mod.tools)) {
      throw new Error(
        RULES_PATH + ": `tools` must be an array of {name, description, inputSchema, run}",
      );
    }
    const taken = new Set(TOOLS.map((t) => t.name));
    mod.tools.forEach((t, i) => {
      const what = RULES_PATH + ": tools[" + i + "]";
      if (!t || typeof t !== "object") throw new Error(what + " is not an object");
      if (typeof t.name !== "string" || !t.name) throw new Error(what + " has no name");
      if (typeof t.run !== "function") {
        throw new Error(what + " (" + t.name + ") has no run(args, state)");
      }
      if (taken.has(t.name)) {
        throw new Error(what + " is named " + t.name + ", which this server already exposes");
      }
      taken.add(t.name);
    });
  }
  rules = mod as AppRules;
  // ABSENT is the normal first boot; UNPARSEABLE is a loss, so it boots on `initial` (an app must not
  // be unplayable) but SAYS so — the next persist replaces the file, and without this line the old state
  // vanished with nothing anywhere recording that it had existed.
  const saved = await Deno.readTextFile(STATE_PATH).then(JSON.parse).catch((e) => {
    if (!(e instanceof Deno.errors.NotFound)) {
      logLine(
        "saved state",
        STATE_PATH,
        "could not be parsed, so this app boots on `initial` and the next write replaces it:",
        e instanceof Error ? e.message : e,
      );
    }
    return undefined;
  });
  state = saved ?? structuredClone(rules.initial ?? {});
  logLine(
    "rules loaded from",
    RULES_PATH,
    "state file:",
    STATE_PATH,
    "state:",
    JSON.stringify(state),
  );
}

/**
 * Persist state, serialized through one chain — and RETURNED, because every ack awaits it.
 *
 * Correction 3 of the channel doc: nothing behind an app may outlive interest in it, so the app must be
 * able to STOP — and stopping is only cheap if the next connect resumes rather than restarts. Written
 * via a temp file and renamed: a half-written state file would read as a corrupt app on next boot.
 *
 * **It was fire-and-forget until 2026-09-22, and that was a durability window, not an optimisation.**
 * The chain serialised the writes but nobody awaited it, so a frame telling the page "count: 10" went out
 * while write 8 was still queued. Measured, not theorised: under a full-suite load `app_mcp_test.ts`
 * read `{count: 8}` off the disk in the same moment the browser's last frame said 10, and alone the
 * same test passed ten times out of ten — it needs contention, which is exactly why it survived review.
 *
 * Durability BEFORE the ack is the right standard here, and not because a write is cheap. This app's own
 * promise is that stopping is safe, and the page is the thing the human believes: if a kill can arrive
 * while writes are queued, then events the page was TOLD were applied are gone on resume, and the file
 * the next connect reads disagrees with what the human last saw. Nothing else in the surface can close
 * that gap — the `state` tool, a resume, and anything else that reads the file all see the stale
 * version — so the window has to be closed here rather than waited out by whoever is looking.
 *
 * It costs a temp write and a rename before each ack: microseconds, against this app's own 100ms
 * mechanical budget and the 2026ms floor of one model round trip. This file SHIPS as the example every
 * generated app is copied from, so it models the property its comment claims.
 *
 * The BOUNDARY, because a guarantee has one: a write that FAILS is logged and the app keeps serving on
 * the state it holds in memory. What awaiting this removes is the window in which the page is told a
 * state the disk has not finished with — not the disk being broken, which no ordering can fix.
 */
let stateTail: Promise<unknown> = Promise.resolve();
function persist(): Promise<unknown> {
  const text = JSON.stringify(state ?? {}, null, 2) + "\n";
  stateTail = stateTail.then(async () => {
    const tmp = STATE_PATH + ".tmp";
    await Deno.writeTextFile(tmp, text);
    await Deno.rename(tmp, STATE_PATH);
  }).catch((e) => logLine("state write failed:", e));
  return stateTail;
}

// ── MCP: stdout is the protocol ──────────────────────────────────────────────────────────────────────

const PROTOCOL_VERSION = "2024-11-05";
/** A DECISION. loom has never seen this method, which is the point: an unknown method reaches the
 * owning agent through `fallbackNotificationHandler` as `[loom] mcp:<name>`. */
const NOTIFY_EVENT = "notifications/app/event";

const TOOLS = [
  {
    name: "send",
    description: [
      "Send one action to this app: this is how a DECISION you were asked for reaches the page — as the",
      "app's STATE, when the rules.ts folds it in and every open page reads again, and never as a frame the",
      "page's app.js handles by that name (see `Handled.actions`). The fold is what keeps the page and the",
      "channel from disagreeing about what you decided. Mechanical rules answer themselves; they never",
      "need this.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "The action name the page's app.js handles." },
        data: { type: "object", description: "Its payload. Whatever the page expects." },
      },
      required: ["action"],
    },
  },
  {
    name: "state",
    description: [
      "Read what the app's rules currently hold, plus whether the channel is live. A decision",
      "notification already carries the state, so this is for a turn that starts without one -- after a",
      "compaction, or when you want to check what your last send did.",
      "It also carries `watching`: whether a page has ever spoken to this app, which is a different fact",
      "from `live` and the one an app cannot work out for itself. true once a page has, and null before",
      "that — unknown, which is not NO. There is no false: nothing in loombot counts pages, so read true as",
      "'somebody has been here' and never as 'somebody is looking now'.",
    ].join(" "),
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "publish",
    description: [
      "Push this app's CURRENT files to loombot, without restarting anything: read the asset directory",
      "again, replace what loombot is serving, and bump the version so every open page reloads itself.",
      "This is how you refine a UI -- edit index.html or app.js, call this, look at the page. Restarting",
      "the server does the same thing, and costs the channel and its state. If the server was started",
      "with --build, the build runs first, and a failing build publishes NOTHING: the result carries the",
      "last 40 lines of its output and the previous version keeps serving. With --watch you rarely need",
      "this: a change to a watched path rebuilds and republishes by itself. RENAMING the app is this call",
      "with a title: the tab shows the title, the name stays the id and the URL, and when the files did not",
      "change the open panel is relabelled without a reload. The title sticks until the next one; an empty",
      "string goes back to the name. Never restart under a new NAME to rename: that is a different app.",
      "A publish does NOT open the app's panel (starting the server did that once); pass reveal: true when",
      "the human asked to see the app, to bring it to the front of their loombot page.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "The label the tab shows (at most 64 characters). Omit to keep the current one.",
        },
        reveal: {
          type: "boolean",
          description:
            "true: also OPEN this app in the panel of every loombot page open on the session it is registered with (no click; the caret stays in the chat). Default false: the bytes change and a hidden panel stays hidden.",
        },
      },
    },
  },
];

/**
 * THE WHOLE SURFACE: the fixed three, then whatever the app's rules declare. The declared ones are
 * mapped rather than passed through so `run` (a function, and the app's own code) never travels the
 * wire, and a tool with no schema of its own still lists as a legal empty-object call.
 */
function allTools() {
  return [
    ...TOOLS,
    ...(rules?.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema ?? { type: "object", properties: {} },
    })),
  ];
}

// ── registration: how this app becomes VISIBLE, and where its socket comes from ───────────────────────

/**
 * THE BRIDGE — the only thing this server is told about the world it is in, and it is told it by loom.
 *
 * `LOOM_BRIDGE_URL` and `LOOM_BRIDGE_TOKEN` are in every MCP server's environment since 2026-09-24
 * (`loom/session.ts`, at the mount site, for the same reason `TMPDIR` is there). The token is this
 * SERVER's, not its agent's: it reaches `/app/register` and `/app/unregister` and nothing else, and it
 * stops working the moment loom closes this connection — which is also what takes the app away.
 */
const bridge = bridgeFromEnv();

/**
 * Extensions that travel as TEXT. Anything else goes as base64, so a png or a font needs no second
 * mechanism — though a big one wants loombot's follow-on pull-on-demand manifest rather than this body.
 */
const TEXT_EXT = new Set([
  "html",
  "htm",
  "js",
  "mjs",
  "css",
  "json",
  "svg",
  "txt",
  "md",
  "map",
  "webmanifest",
]);

/** base64 in chunks: `String.fromCharCode(...bytes)` on a whole file overflows the argument list. */
function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/**
 * The app's browser assets, as the registration manifest.
 *
 * **These rules are THIS SERVER'S, not loom's.** loom holds whatever it is handed and has no layout
 * convention at all (Xiaohu: "it's the MCP's business"), so the three exclusions below are choices this
 * file makes and states:
 *
 *   a DOTFILE            never part of a page, and `.git`/`.env` are exactly what must not be served
 *   a `.ts` FILE         the CHANNEL's own code (`rules.ts`), which no browser can run
 *   `node_modules`, `.tmp`  build noise; a manifest is what the page needs, not what built it
 *
 * Everything else in the directory, at any depth, with the relative path as the key — so `sub/x.css` is
 * fetched from `sub/x.css` and a page needs no rewriting to be served this way.
 */
async function assets(dir: string): Promise<Manifest> {
  const out: Manifest = {};
  const walk = async (rel: string): Promise<void> => {
    for await (const e of Deno.readDir(rel ? dir + "/" + rel : dir)) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const path = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory) {
        await walk(path);
        continue;
      }
      if (!e.isFile) continue;
      if (e.name.endsWith(".ts") || e.name.endsWith(".tmp")) continue;
      const ext = e.name.includes(".") ? e.name.slice(e.name.lastIndexOf(".") + 1) : "";
      const bytes = await Deno.readFile(dir + "/" + path);
      out[path] = TEXT_EXT.has(ext) ? new TextDecoder().decode(bytes) : { base64: toBase64(bytes) };
    }
  };
  await walk("");
  return out;
}

// ── the channel: `channel.ts` owns the protocol, this file owns the app ──────────────────────────────

/**
 * THE ONE CHANNEL, and everything loombot-facing is the module's: registration, the socket and its
 * `?player`, a clean 1000 versus the retry ladder and the exit a loombot that stays gone ends with, the
 * idle facts, the log, the graceful unmount.
 *
 * THE TWO THINGS THIS FILE STILL DECIDES, which is why they are arguments and not the module's
 * business: WHAT a frame from a browser MEANS (handed to this app's `rules.ts` as `onFrame`), and
 * WHAT the bytes are (`assets` below applies THIS server's layout rules, which loom does not have).
 */
const ch = channel({
  app: APP,
  log: logLine,
  bridge,
  // Read again on every registration, which is what `publish` IS: the refine loop serves the bytes that
  // are on disk now.
  files: () => assets(APP_DIR),
  onFrame,
  // AND NOTHING IS HANDED OVER FOR THE LAST PAGE LEAVING. An app_mcp app's state is the state FILE, written
  // by every ack, and whether a page is open has nothing to do with it — so there is no per-page memory to
  // drop, and nothing is passed for that moment: this app has none, and neither has the file viewer
  // (`viewer_mcp.ts`, "NO `notifyWhenIdle` AND NO `idleHint` HERE").
});
// The MCP wire is the channel's too: ONE serialized writer for stdout, and `notify` is the only path
// from this process to a model. Destructurable because no method of a channel reads `this`.
const { notify, reply, send, toolResult } = ch;

/**
 * One frame from a browser — THE HOT PATH, and the reason this process exists.
 *
 * The rules answer or they do not. When they answer, nothing here touches the agent: no notification is
 * written, so no turn boundary is paid and the page sees its answer in about a millisecond. When they
 * return `null` the event is a DECISION and the agent is woken with the state it needs to decide.
 */
async function onFrame(text: string): Promise<void> {
  let msg: { event?: unknown; data?: unknown };
  try {
    msg = JSON.parse(text);
  } catch {
    logLine("bad frame (not JSON):", text.slice(0, 200));
    return;
  }
  const name = typeof msg.event === "string" ? msg.event : "";
  const data = (typeof msg.data === "object" && msg.data !== null ? msg.data : {}) as Rec;
  if (!name) {
    // Not an event at all. Actions are OURS, so one arriving here is the page echoing or a bug; either
    // way answering it would be answering ourselves.
    logLine("frame with no event, ignored:", text.slice(0, 200));
    return;
  }
  if (isStatic) {
    // NO RULES IS A REFUSAL, NEVER A DECISION: answered here, like an unknown event, and nothing is
    // written to stdout. A notification from this branch would be the chat-box failure by the back door.
    ch.toBrowsers("reject", { event: name, reason: STATIC_REASON });
    return;
  }
  let out: Handled | null | undefined;
  try {
    out = rules!.event(name, data, state);
  } catch (e) {
    // A THROWING RULE IS NOT A DECISION. Waking the agent because app code has a bug would teach it to
    // answer a broken rule by hand for ever; the page is told and the log holds the detail.
    logLine("rules.event threw on", name + ":", e instanceof Error ? (e.stack ?? e.message) : e);
    ch.toBrowsers("error", { event: name, reason: "the app rules threw; see the app_mcp log" });
    return;
  }
  if (out === null || out === undefined) {
    // THE DOOR THE AGENT ANSWERS THROUGH IS THE APP'S OWN, when it declared one: an app whose rules
    // declare `move` does not want its player told to `send` — and the sentence says what an illegal
    // answer does, because the brief that told agents to wait for an `illegal` frame was the lie this
    // whole mechanism exists to correct.
    const own = rules!.tools ?? [];
    const answer = own.length
      ? own.map((t) => "workers." + APP + "." + t.name + "({...})").join(" or ")
      : "workers." + APP + ".send({action, data})";
    notify(NOTIFY_EVENT, {
      app: APP,
      event: name,
      data,
      state,
      text: 'app "' + APP + '" needs a DECISION on event "' + name + '": ' + JSON.stringify(data) +
        ". State: " + JSON.stringify(state) + ". Answer with " + answer +
        (own.length
          ? " — an illegal answer is that tool's ERROR, returned by the same call; no frame follows it."
          : " — the page is waiting and its rules could not decide this one."),
    });
    return;
  }
  const closing = await apply(out);
  if (closing) await closeApp(closing, "user");
}

/**
 * A rule's result: adopt the state it returned, get it ON DISK, and only then broadcast what it asked for.
 *
 * The await is the whole of the durability rule (see `persist`): **no frame may claim a state that is not
 * yet durable.** The state itself is adopted synchronously above it, so the NEXT event's rule still reads
 * what this one decided — rule evaluation is unchanged, only the ack moves.
 */
async function apply(out: Handled): Promise<string> {
  if (out.state !== undefined) {
    state = out.state;
    await persist();
  }
  // **THE APP'S NAMES COME FROM ITS RULES AND NOWHERE ELSE** (card t20261024-061052-2740). `parts` is the
  // app's own answer to "which piece of my state did this touch", read here — the one place a rules app's
  // state is adopted — so no app's `rules.ts` has to touch the channel, and every path (a browser event,
  // the agent's `send` folded in by `rules.action`) gets the same treatment.
  //
  // IT IS READ EVEN WHEN NO STATE COMES BACK: `refresh` on the board writes no state and changes `list`,
  // because the records are on disk and the app is the only thing that knows a write happened. And NAMING
  // NOTHING (`parts: []`) is a rule saying "this changed nothing" — a click on the card already open —
  // which is why an absent list (no names: a page reads what it draws) and an empty one (nothing moved)
  // are different answers.
  //
  // RENAMED BEFORE EVERY FRAME: a push is one frame and its names go with it (`channel.ts` `toBrowsers`),
  // so a rule with three actions would otherwise have only the first one named — and the rest would read
  // as "no names", which a page must treat as "read everything".
  //
  // AND IT MOVES THE APP'S NUMBER WHEN THERE IS A CHANGE TO NUMBER: a state adopted, or a part the app
  // named. A result that names nothing and states nothing — an `ack` for a click on the card already open
  // — moves neither, so the pages that follow are not sent looking either.
  if (out.state !== undefined || (out.parts !== undefined && out.parts.length > 0)) ch.touched();
  if (out.parts !== undefined) ch.named(...out.parts);
  for (const a of out.actions ?? []) {
    if (out.parts !== undefined) ch.named(...out.parts);
    ch.toBrowsers(a.action, a.data ?? {});
  }
  // THE CALLER CLOSES, not this function: a `send` must answer its tool call before the process goes.
  return typeof out.close === "string" && out.close ? out.close : "";
}

// ── build, publish, watch: ONE chain, so two builds never run at once ─────────────────────────────────

/** How much build output a failed `publish` carries back. The whole of it is in the log. */
const BUILD_TAIL_LINES = 40;
/** Quiet time after the last change before a watch cycle starts: an editor's save is several writes. */
const DEBOUNCE_MS = 300;
/** How long output may keep arriving after the build EXITED before the pipes are let go of. */
const PIPE_GRACE_MS = 500;

/** The build in flight, so a shutdown can stop it rather than orphan it. */
let building: Deno.ChildProcess | undefined;

/**
 * Run `--build` once: `sh -c`, in the CWD, every line to the log, the last 40 kept for a failure.
 *
 * stdout and stderr are pumped separately into one tail, so their interleaving is by chunk rather than
 * exact — good enough to show the error, which is all the tail is for.
 */
async function runBuild(cmd: string): Promise<{ code: number; tail: string[]; ms: number }> {
  const t0 = performance.now();
  const tail: string[] = [];
  const keep = (line: string) => {
    logLine("build|", line);
    tail.push(line);
    if (tail.length > BUILD_TAIL_LINES) tail.shift();
  };
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  const pump = async (s: ReadableStream<Uint8Array>) => {
    const dec = new TextDecoder();
    let buf = "";
    const r = s.getReader();
    readers.push(r);
    for (;;) {
      const { value: c, done } = await r.read().catch(() => ({ value: undefined, done: true }));
      if (done || !c) break;
      buf += dec.decode(c, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        keep(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    }
    buf += dec.decode();
    if (buf) keep(buf);
  };
  const child = new Deno.Command("sh", {
    args: ["-c", cmd],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  building = child;
  try {
    const pumped = Promise.all([pump(child.stdout), pump(child.stderr)]);
    const status = await child.status;
    // THE BUILD IS DONE WHEN IT EXITS. A process it backgrounded (a dev server, a stray `&`) inherits
    // the pipes and holds them open, and waiting for EOF waited for THAT — registration hung for as long
    // as the grandchild lived (`tests/app_mcp_build_test.ts`, "a background process"). So: a short grace
    // for output already in flight, then stop reading and say so.
    let grace: ReturnType<typeof setTimeout> | undefined;
    const drained = await Promise.race([
      pumped.then(() => true),
      new Promise<boolean>((r) => (grace = setTimeout(() => r(false), PIPE_GRACE_MS))),
    ]);
    clearTimeout(grace);
    if (!drained) {
      logLine(
        "build exited",
        status.code,
        "but something it started still holds its output;",
        "not waiting for it (its later output is not logged)",
      );
      for (const r of readers) r.cancel().catch(() => {});
    }
    return { code: status.code, tail, ms: Math.round(performance.now() - t0) };
  } finally {
    building = undefined;
  }
}

/**
 * Kill the build in flight AND EVERYTHING UNDER IT.
 *
 * Signalling `sh` alone was the bug: `sh -c "sleep 37 && true"` SIGTERMed left `sleep 37` running with
 * ppid 1 (measured 2026-09-25), so any compound build — `npm run build`, `a && b`, a pipe — outlived the
 * app. Deno has no setpgid, so there is no group to kill; the tree is walked instead.
 *
 * ORDER IS THE FIX: the tree is read BEFORE `sh` dies, because the moment it does its children are
 * re-parented to init and no walk can find them again. Then top-down — `sh` first, so it cannot react to
 * a child dying by starting the next command of an `a; b` — and every collected pid after it.
 */
async function killBuild(): Promise<void> {
  const top = building;
  if (!top) return;
  const under = await descendants(top.pid);
  try {
    top.kill("SIGKILL");
  } catch { /* already exited */ }
  killAll(under.reverse());
}

let publishChain: Promise<unknown> = Promise.resolve();
/** The outcome of the last build-and-register, for `state()`: the watch loop reports nowhere else. */
let lastPublish: Rec | null = null;

/**
 * Build (if `--build`), then register — ALL OR NOTHING, and serialised.
 *
 * Every registration goes through here: the first, every `publish`, every watch cycle. A failed build
 * throws BEFORE `register`, so loombot is never handed a half-built directory and keeps serving what it
 * had. The chain is what makes "never two builds at once" true across the two callers: a `publish`
 * during a watch cycle waits for it rather than racing it into the same output directory.
 */
function publishNow(why: string, opts: RegisterOptions = {}): Promise<Registration> {
  const run = publishChain.then(async () => {
    if (ch.unmounting()) throw new Error("the app is shutting down");
    if (BUILD !== undefined) {
      const b = await runBuild(BUILD);
      logLine("build for", why, b.code === 0 ? "ok" : "FAILED, exit " + b.code, "in", b.ms + "ms");
      if (b.code !== 0) {
        throw new Error(
          "the build exited " + b.code + " (sh -c " + JSON.stringify(BUILD) + "). Its last " +
            b.tail.length + " lines:\n" + b.tail.join("\n"),
        );
      }
    }
    return await ch.register(opts);
  });
  const at = () => new Date().toISOString();
  publishChain = run.then(
    (r) => (lastPublish = { why, at: at(), ok: true, version: r.version }),
    (
      e,
    ) => (lastPublish = {
      why,
      at: at(),
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }),
  );
  return run;
}

let watcher: Deno.FsWatcher | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined;
let cycling = false;
/** A change arrived while a cycle ran: exactly ONE more cycle follows it, however many changes. */
let again = false;
let cycles = 0;
/** Prefixes a change is ignored under — the loop guards (see the header). Absolute and real. */
const ignoredUnder: string[] = [];

function ignored(p: string): boolean {
  // An ANCESTOR too: making the state directory creates `.loom/` and `.loom/app-state/` on a fresh
  // directory the app watches, and those events name the parents, not the ignored path. Measured: one
  // spurious cycle.
  return ignoredUnder.some((d) => p === d || p.startsWith(d + "/") || d.startsWith(p + "/"));
}

/** A change: restart the quiet period. */
function poke(): void {
  if (debounce !== undefined) clearTimeout(debounce);
  debounce = setTimeout(watchCycle, DEBOUNCE_MS);
}

/** One rebuild-and-republish. MECHANICAL: it logs, and it never notifies. */
async function watchCycle(): Promise<void> {
  debounce = undefined;
  if (cycling) {
    again = true;
    return;
  }
  cycling = true;
  const n = ++cycles;
  try {
    const out = await publishNow("watch cycle " + n, { durable: DURABLE });
    logLine("watch cycle", n, "published version", out.version);
  } catch (e) {
    logLine(
      "watch cycle",
      n,
      "FAILED, still serving version",
      ch.version() + ":",
      e instanceof Error ? e.message : e,
    );
  } finally {
    cycling = false;
    if (again) {
      again = false;
      poke();
    }
  }
}

/** `p` made absolute and real, as far as it exists: a path the watcher reports is a real one. */
async function realish(p: string): Promise<string> {
  const abs = p.startsWith("/") ? p : Deno.cwd() + "/" + p;
  try {
    return await Deno.realPath(abs);
  } catch {
    const cut = abs.lastIndexOf("/");
    return cut <= 0 ? abs : (await realish(abs.slice(0, cut))) + abs.slice(cut);
  }
}

/** Start the watch loop, if asked. Throws — so the start fails — on a path that is missing or useless. */
async function startWatch(): Promise<void> {
  if (WATCH.length === 0) return;
  const paths = await Promise.all(WATCH.map((p) => Deno.realPath(p)));
  if (BUILD !== undefined) {
    // realish, not realPath: before the first build `--dir` may not exist yet — the build makes it.
    const dir = await realish(APP_DIR);
    for (const p of paths) {
      if (p === dir || p.startsWith(dir + "/")) {
        throw new Error(
          "--watch " + p + " is inside --dir " + dir + ", where --build writes: its changes are " +
            "ignored to stop every build triggering the next, so it could never trigger anything. " +
            "Watch the build's SOURCES.",
        );
      }
    }
    ignoredUnder.push(dir);
  }
  ignoredUnder.push(
    await realish(STATE_PATH.replace(/\/[^/]*$/, "") || "."),
    await realish(LOG_FILE),
  );
  watcher = Deno.watchFs(paths, { recursive: true });
  logLine("watching", paths.join(" "), "ignoring", ignoredUnder.join(" "));
  const w = watcher;
  (async () => {
    try {
      for await (const ev of w) {
        if (ev.kind === "access" || ev.paths.every(ignored)) continue;
        poke();
      }
    } catch (e) {
      if (!ch.unmounting()) logLine("the watcher ended:", e);
    }
  })();
}

// ── MCP dispatch ─────────────────────────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function handle(msg: any): Promise<void> {
  const { id, method } = msg;
  if (method === "initialize") {
    reply(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "loom-app-mcp", version: "1" },
    });
    // Only NOW. A notification pushed before the handshake settles races the client transport, and the
    // first thing lost would be the first thing the user did.
    ch.connect();
    return;
  }
  if (typeof method === "string" && method.startsWith("notifications/")) return;
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") return reply(id, { tools: allTools() });
  if (method === "tools/call") {
    const name = msg.params?.name;
    const args = (msg.params?.arguments ?? {}) as Rec;
    if (name === "state") {
      return toolResult(
        id,
        JSON.stringify({
          app: APP,
          live: ch.live(),
          // HAS A PAGE EVER SPOKEN — which `live` cannot answer: the socket to loombot stays up (and redials
          // in milliseconds) while nobody is on the page. null = nothing to go on yet, not NO, and there is
          // no FALSE: loombot counts no pages, so nothing can say the last one went.
          watching: ch.watching() ?? null,
          // A static app has no rules: every event it is sent is refused, and none will ever wake you.
          static: isStatic,
          build: BUILD ?? null,
          watch: WATCH,
          // THE CLOSE SEMANTICS THIS APP RUNS UNDER. A loombot that goes away ends this app with it — the
          // channel logs the reason, tells the agent and exits (Xiaohu's ruling, 2026-10-27) — so a
          // `live: false` that lasts is a process on its way out, not a state to wait out.
          durable: ch.durable(),
          lastPublish,
          state,
        }),
      );
    }
    if (name === "publish") {
      // No "you have nothing to publish" branch any more: this server cannot have started without
      // registering (see main), so there is always a registration whose bytes this replaces.
      try {
        // A TITLE is passed through untouched: loombot checks it (a string, trimmed, at most 64) and a refusal
        // comes back below as "publish failed" with loombot's own sentence.
        // REVEAL ONLY WHEN ASKED, and only the literal true: a publish is the refine loop by default, and
        // the refine loop must not reopen a panel the human hid.
        const opts: RegisterOptions = { reveal: args.reveal === true, durable: DURABLE };
        if (args.title !== undefined) opts.title = args.title as string;
        const out = await publishNow("publish", opts);
        return toolResult(
          id,
          JSON.stringify({
            app: APP,
            id: out.id,
            version: out.version,
            ...(out.title ? { title: out.title } : {}),
            page: ch.page(),
            live: ch.live(),
          }),
        );
      } catch (e) {
        // NOTHING CHANGED, and saying so is the point: loombot validates the whole manifest before it swaps
        // anything, so a refusal leaves the version that was serving exactly as it was.
        return toolResult(
          id,
          "publish failed: " + (e instanceof Error ? e.message : String(e)) +
            " -- nothing changed; the app is still serving version " + ch.version() + ".",
          true,
        );
      }
    }
    // AN APP-DECLARED TOOL, before the fixed vocabulary gets a say: these names belong to the rules
    // module, and its `run` IS the app's answer — legality included. The three shapes it can come back
    // in are ordered by what they may touch:
    //
    //   a THROW       logged, answered as an error, nothing else. A broken tool is not a decision and
    //               not a state change.
    //   `ok: false`   THE ERROR RESULT, and it is the WHOLE result: the reason goes back to the agent
    //               that made the call and nothing else in the process moves. No `apply`, so no state
    //               is adopted, nothing is persisted, no frame is pushed and no page is told — the page
    //               has nothing to learn from an answer the agent is about to correct. No notification,
    //               because an error result is a return value, not an event.
    //   `ok: true`    the same path a browser event's result takes: `apply` adopts and persists the
    //               state, then broadcasts, and only then is the tool answered — so the result never
    //               claims a state the disk has not finished with.
    const appTool = rules?.tools?.find((t) => t.name === name);
    if (appTool) {
      let out: ToolOutcome | undefined;
      try {
        out = await appTool.run(args, state);
      } catch (e) {
        logLine("tool", name, "threw:", e instanceof Error ? (e.stack ?? e.message) : e);
        return toolResult(id, "the app's tool threw; see the app_mcp log", true);
      }
      if (!out || out.ok !== true) {
        const reason = out && typeof out.error === "string" && out.error
          ? out.error
          : "the app's tool answered neither a result nor a reason";
        logLine("tool", name, "refused:", reason);
        return toolResult(id, reason, true);
      }
      let closing = "";
      if (out.handled) closing = await apply(out.handled);
      toolResult(id, out.text ?? "done", false);
      if (closing) await closeApp(closing, "agent");
      return;
    }
    if (name !== "send") {
      return toolResult(
        id,
        "unknown tool: " + name + "; this server exposes " +
          allTools().map((t) => t.name).join(", "),
        true,
      );
    }
    if (typeof args.action !== "string" || !args.action) {
      return toolResult(id, "send needs action (a string); data is optional", true);
    }
    const data = (typeof args.data === "object" && args.data !== null ? args.data : {}) as Rec;
    // The action goes out FIRST and unconditionally: that is what `send` means, and the agent has
    // already spent a turn boundary getting here.
    const delivered = ch.toBrowsers(args.action, data);
    // Then the rules get to fold the decision into state. Without this the channel and the page would
    // disagree the moment a decision CHANGES anything — the agent raises a limit, and the next
    // mechanical check still refuses against the old one.
    let folded = "";
    let closing = "";
    if (rules?.action) {
      try {
        const out = rules.action(args.action, data, state);
        if (out) {
          // Awaited for the same reason a browser frame is: this tool RESULT is an ack, and it tells the
          // agent the decision was folded into state. Saying so before the write lands would be the same
          // lie in the other direction.
          closing = await apply(out);
          folded = "; rules.action folded it into state" +
            (closing ? " and CLOSED the app (" + closing + "): it exits now" : "");
        }
      } catch (e) {
        logLine("rules.action threw:", e instanceof Error ? (e.stack ?? e.message) : e);
        folded = "; rules.action THREW — state unchanged, see the app_mcp log";
      }
    }
    toolResult(
      id,
      delivered
        ? "sent " + args.action + " to the app" + folded
        : "NOT DELIVERED: no live channel — the app has no player socket right now" + folded,
      !delivered,
    );
    // AFTER the answer: the tool call must not hang on a process that is gone.
    if (closing) await closeApp(closing, "agent");
    return;
  }
  if (id !== undefined && id !== null) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: "unknown method: " + method } });
  }
}

// ── shutdown: the page is TOLD, never left hanging ───────────────────────────────────────────────────

/**
 * Stop, and tell the page why.
 *
 * `stopWorker(<name>)` closes the transport, which ENDS OUR STDIN and then sends SIGTERM (the SDK gives a
 * child 2s before escalating), so both arrive here and both do the same thing — the page cannot tell them
 * apart and should not have to. The farewell frame, the close and the write tail are `channel.ts`'s
 * (`unmount`); what is left here is the tail only this file knows about, the STATE chain, and the exit.
 */
let shuttingDown = false;
/** The teardown only this file knows: false if one is already under way. */
async function quiesce(): Promise<boolean> {
  // Its own flag, not just `ch.unmounting()`: the tree walk below awaits a `ps`, and the SIGTERM that
  // follows a stdin close must not start a second teardown inside that window.
  if (shuttingDown || ch.unmounting()) return false;
  shuttingDown = true;
  // THE WATCH LOOP DIES WITH US, deliberately: a watcher and a pending timer are exactly what outlives a
  // careless stop, and a cycle firing mid-unmount would re-register an app that is leaving.
  if (debounce !== undefined) clearTimeout(debounce);
  try {
    watcher?.close();
  } catch { /* already closed */ }
  await killBuild();
  return true;
}
async function shutdown(why: string): Promise<void> {
  if (!(await quiesce())) return;
  await ch.unmount(why);
  await stateTail;
  Deno.exit(0);
}
/**
 * A RULE ENDED THE APP (`Handled.close`) — the page's own Close OR the agent's — the same teardown for
 * both: `ch.close` notifies the agent BEFORE anything else, unmounts (the page gets `player_left`),
 * unregisters so the tab leaves the strip, flushes the state and exits.
 *
 * **A PAGE'S CLOSE ENDS THE APP, DURABLE OR NOT** (card t20261027-025619-fb7e, Xiaohu reversing the f6b7
 * premise on 2026-10-27: apps die with loombot, and the agent starts what it needs next). The old branch
 * answered `detached` — "the honest answer to end the app", which was NO — and left the server registered;
 * measured twice on his phone as a Close button that did nothing. The `detached` frame keeps its honest
 * job (a page that lost its server is told so) and is no longer a refusal of this button.
 */
async function closeApp(why: string, by: "user" | "agent"): Promise<void> {
  if (!(await quiesce())) return;
  await ch.close(why, { by, flush: () => stateTail });
}

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  Deno.addSignalListener(sig, () => {
    shutdown("the agent unmounted this app (" + sig + ")");
  });
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────────

// **THERE IS ONE WAY TO BE STARTED: by an agent, with the bridge in the environment.** Nothing on a command
// line names a loombot or a `.player`: the bridge says where to register and what credential to use, and loombot
// scans nothing.
if (!bridge.url || !bridge.token) {
  logLine(
    "usage: no LOOM_BRIDGE_URL/LOOM_BRIDGE_TOKEN in the environment, so there is nobody to register " +
      "with and this app would have no page. Start this server from an agent " +
      'with startWorker.mcp("<name>", "deno", ["run", "-A", "app_mcp.ts", "--dir", "<the app\'s files>"]), ' +
      '[--build "<shell command, run in the CWD>"] [--watch <path>]... [--state <path>] [--log <path>]',
  );
  Deno.exit(2);
}
await loadApp();
// THE WATCHER BEFORE THE FIRST BUILD, so an edit made while it runs is not lost; its output lands in
// `--dir`, which the watcher ignores when there is a build. A bad `--watch` fails the start here.
try {
  await startWatch();
} catch (e) {
  logLine("--watch refused, so this app does not start:", e instanceof Error ? e.message : e);
  Deno.exit(2);
}
// REGISTERED BEFORE THE HANDSHAKE, so the app exists the moment the agent's `startWorker.mcp` returns —
// and so that a refusal (the size cap, a name loombot will not serve, no index.html) kills the mount rather
// than leaving a server whose page never appears. The reason is on stderr as well as in the log, because
// stderr is what loom keeps at `<agent>/mcp/<server>/stderr` for exactly this.
// With `--build`, the build runs first and a failing one fails the start the same way.
try {
  // THE ONE REGISTRATION THAT ASKS TO BE SEEN, and since 2026-10-20 the ONLY way to start an app: whether
  // to open the panel is LOOMBOT's business, not the app's and not the agent's ("THE FIRST REGISTRATION OPENS
  // THE PANEL" in the header, and `loom/worker/types.ts` `AppRegistration.reveal` for the rule itself). The
  // `--no-reveal` exception that used to sit here is deleted; a start always asks.
  await publishNow("startup", { reveal: true, durable: DURABLE });
} catch (e) {
  logLine("registration FAILED, so this app has no page:", e instanceof Error ? e.message : e);
  Deno.exit(2);
}
logLine("app_mcp up: app=" + APP + " socket=" + ch.socket() + " pid=" + Deno.pid);

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
      // One bad frame must not kill a channel, and there is no id to answer on.
      logLine("bad frame:", e instanceof Error ? e.message : e, line.slice(0, 200));
    }
  }
}
// STDIN CLOSED: the client is gone. This is the first half of what `stopWorker` does.
await shutdown("the agent unmounted this app (stdin closed)");
