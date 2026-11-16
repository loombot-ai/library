/**
 * `channel.ts`: THE APP CHANNEL, written once.
 *
 * An app's channel is everything that happens between a loom app's MCP server and loombot — and it is the
 * same in every app, because loombot is the same. It was implemented TWICE (`app_mcp.ts`, the rules engine;
 * `viewer_mcp.ts`, the file viewer) and the cost was paid per PROTOCOL CHANGE rather than per app: the
 * reconnect-on-clean-close fix, the `say why the socket closed` plumbing and the announcement when the
 * last browser left each had to be made in two files in one evening (`tracking:one-channel-two-apps`,
 * which carries the line-for-line measurement). This module is the fix: a protocol change is now one
 * edit here.
 *
 * ## What is IN, and it is exactly what both copies duplicated
 *
 *     registration with loombot         `POST /app/register` — what it wants, and what re-registering means
 *     the one socket, and `?player`   the credential registration handed back; a wrong one is a plain 401
 *     the page's credential           GONE WITH THE PAGE'S SOCKET (card t20261024-022904-fb60): a page is
 *                                     one `POST __event` on its session cookie. THE PAGE CONTRACT below.
 *     clean close vs abnormal         a 1000 gets a straight redial (nothing failed); anything else = the ladder
 *     whether anyone is LOOKING       a page's request says yes, and NOTHING ever says no — `watching()`,
 *                                     which `live()` cannot answer and `state()` reports as null first

 *     the retry / backoff ladder      three dials — they ride out a socket that died under a loombot that
 *                                     is STILL THERE — then the app CLOSES WITH LOOMBOT: one log line,
 *                                     one `app/closed`, exit(0). Xiaohu's ruling (card
 *                                     t20261027-030142-88f8) reverses f6b7's re-registration ladder:
 *                                     a restart takes the registration and the tab with it, so a
 *                                     process that outlived one kept a page on a strip nobody could see

 *     a page's Close                  the caller answers it, and SINCE 2026-10-27 IT ENDS THE APP under
 *                                     every kind (card t20261027-025619-fb7e): `durable` says what an
 *                                     app's records do, never whether its page may close it

 *     the run-dir log                 one sink, and the only place the layout is spelled
 *     graceful unmount                `player_left`, `close(1000, "player unmounted")`, `/app/unregister`
 *                                     and the write tail — the telling is part of the unmount, because
 *                                     EVERY ending passes through it and a name left behind is a ghost
 *     closing itself (`close`)        notify WHY, unmount (which unregisters), flush, exit — a convenience,
 *                                     not contract
 *
 * ## What is OUT, and must stay out: WHETHER THE AGENT IS ASKED, WHEN, AND ABOUT WHAT
 *
 * That is the app MODEL, and the two callers answer it differently on purpose — `app_mcp` is rules-driven
 * (a browser event goes to `rules.ts`, which answers it or declares it a decision), the viewer is
 * agent-driven (its `show` tool pushes bytes and the page is read-only). So this module has no opinion
 * about tools and no opinion about state: it knows WHEN the last page left, reports it to the log and
 * redials, and THAT IS ALL THAT HAPPENS THERE. The caller used to be CALLED at that moment — the parameter
 * named `notifyWhenIdle` — and the call is deleted (2026-10-20) with the refusal it existed to back up; a
 * page's state gates nothing, see `building-a-loom-app/README.md`, the page contract, rule 6. The asset
 * manifest is the caller's too — walking a directory is `app_mcp`'s layout convention, not loombot's.
 *
 * ## THE PAGE CONTRACT — how an app's page talks to this channel, which is NOT over this socket
 *
 * Above is the SERVER half: registration, `?player`, the retry ladder. The page's half is one `fetch` now
 * (card `t20261024-022904-fb60`): `POST __event` under the page's own address, answered by the frame the
 * page draws, and `loom/app-changed` as the page's cue to read again. A page has NO SOCKET, so the two rules
 * that used to be written in every `app.js` — derive the socket from protocol+host, present the injected
 * page token as `?cred=` — are DELETED rather than documented: there is no socket to derive and no token
 * spliced into the bytes. `loombot/routes.ts` `appPageSnippet` still injects ONE line, for the two jobs a page
 * cannot do for itself (the panel dismiss, and `loom/app-changed` as a document event).
 *
 * What is left of the old page half, and is now the only thing an app must get right about it:
 *
 *   * BUILD THE ADDRESS FROM `location.pathname`, never from `location.origin`: `origin` reads `"null"` in a
 *     document with an OPAQUE origin, and a URL built from it throws before anything is sent. `pathname` is a
 *     fact of the page's own URL, it survives that, and it spells no host — which is why the same bytes work
 *     when a publisher serves them from somewhere else.
 *   * THE CREDENTIAL IS THE SESSION COOKIE, and a page does nothing to present it. That is the one place
 *     this differs from publishing's original worry: a page served from another origin is served by
 *     something that must admit it, and loombot never sees that request at all.
 *   * THERE IS NO REDIAL, because there is no connection to drop: a re-read is one request, its failure is
 *     the page's `dead` state, and the next click or the next `loom/app-changed` is the retry. The ladder
 *     this module runs for the PLAYER socket (`MAX_RETRIES`) is the channel's own business and no page
 *     implements any part of it.
 *
 * A page also must not reach into `parent` or loombot's document: that compiles while the frame is
 * same-origin and stops compiling the day it is not. The one thing that needs the parent — shutting loombot's
 * app menu when the person clicks inside the page — is done by the injected line, which posts

 * Everything here is closures over one channel's state, so a caller may destructure
 * (`const { reply, toolResult } = ch`) without losing anything: no method reads `this`.
 */

/** A registration manifest: relative path -> text, or bytes as base64. What `/app/register` wants. */
export type Manifest = Record<string, string | { base64: string }>;
export type Rec = Record<string, unknown>;
/** Where a line goes when something looks wrong: the run-dir log file, and stderr as well. */
export type LogSink = (...parts: unknown[]) => void;

const enc = new TextEncoder();

// ── the log: one place that spells the layout ────────────────────────────────────────────────────────

/**
 * WHERE AN APP'S LOG IS: `$TMPDIR/loom-<kind>-<app>.log`.
 *
 * `$TMPDIR` is the RUN DIRECTORY loom gives every process it starts, so an app's log lands beside the
 * session that mounted it and goes away with it. `kind` is the server's own word for itself
 * (`app-mcp`, `viewer`) because one workspace can mount several apps and a human greps for the one that
 * is misbehaving. A caller with a `--log` flag passes that instead; this is only the default, and it is
 * the one that the SKILLs document.
 */
export function logFile(kind: string, app: string): string {
  return (Deno.env.get("TMPDIR") ?? ".").replace(/\/$/, "") + "/loom-" + kind + "-" + app + ".log";
}

/**
 * A log sink on one file. Neither write can be allowed to throw: a log that cannot be written must not
 * take a channel down with it, and stderr is kept at `<agent>/mcp/<server>/stderr` at best and dropped
 * at worst, so the file is the one a human can rely on.
 */
export function openLog(file: string): LogSink {
  return (...parts: unknown[]): void => {
    const text = parts.map((p) => typeof p === "string" ? p : Deno.inspect(p)).join(" ");
    const line = "[" + new Date().toISOString() + "] " + text + "\n";
    try {
      Deno.writeTextFileSync(file, line, { append: true });
    } catch { /* a log that cannot be written must not take the channel down */ }
    try {
      Deno.stderr.writeSync(enc.encode(line));
    } catch { /* ditto */ }
  };
}

/**
 * STDOUT IS THE PROTOCOL — so nothing may print to it.
 *
 * The stdio spec says a server MUST NOT write anything to stdout that is not an MCP message, and one
 * stray `console.log` kills the channel quietly. Every console verb is rebound to the log, and a caller
 * does this BEFORE it imports anything that could print (for `app_mcp` that is the app's own `rules.ts`,
 * which is written by a model and prints while it is being debugged).
 */
export function captureConsole(log: LogSink): void {
  for (const k of ["log", "info", "warn", "debug", "trace", "dir", "error"] as const) {
    (console as unknown as Record<string, unknown>)[k] = (...a: unknown[]) => log(...a);
  }
}

// ── the bridge: the only thing a channel is told about the world ─────────────────────────────────────

export interface Bridge {
  url: string;
  token: string;
}

/**
 * `LOOM_BRIDGE_URL` and `LOOM_BRIDGE_TOKEN`, which loom puts in every MCP server's environment
 * (`loom/session.ts`, at the mount site). The token is the SERVER's, not its agent's: it reaches
 * `/app/register` and `/app/unregister` and nothing else, and it stops working the moment loom closes
 * this connection — which is also what takes the app away.
 *
 * EMPTY MEANS THERE IS NOBODY TO REGISTER WITH, and a caller checks that itself: what to say about it
 * is a usage message listing that program's own flags.
 */
export function bridgeFromEnv(): Bridge {
  return {
    url: Deno.env.get("LOOM_BRIDGE_URL") ?? "",
    token: Deno.env.get("LOOM_BRIDGE_TOKEN") ?? "",
  };
}

// ── the notifications this protocol owns ─────────────────────────────────────────────────────────────

// ONE NOTIFICATION: an app being OVER, and nothing else. An idle notification ("the last browser left and
// the channel is still up") is not offered, because it is OPT-IN per app and NO SHIPPED APP EVER ASKED
// FOR ONE (all four shipped rules modules said no, the viewer's own `NOTIFY_WHEN_IDLE` included; Xiaohu,
// 2026-09-24: "why do we want the file viewer to notify?"), so a push there reaches nobody at all.
//
// AND NOTHING IS ASKED OF THE CALLER AT THAT MOMENT. There is no callback to hang it on, because a page's
// state gates nothing (README.md, the page contract, rule 6): a page that dies without saying `gone` leaves
// nothing the agent is turned away by, so there is nothing for a backstop to back up. What a departure
// produces is one line in the log.
/**
 * THE APP IS OVER, and `by` says who ended it. ONE method and ONE shape for every app, so an agent reads
 * the same sentence whichever app it started (`tracking:closing-an-app`):
 *
 *     by: "channel"   loombot went away and the retries ran out. The process is still running, holding
 *                     nothing, so the agent is told unconditionally — not opt-in, because it is the end.
 *     by: "user"      a PERSON pressed the app's own close control (`close()` below). Sent BEFORE the exit.
 *     by: "agent"     the agent asked the app to end itself (an `app_mcp` rule answering its action).
 *
 * `{app, by, reason, text, ...}`: `reason` is the app's own words for WHY (the button, the rule), `text`
 * the sentence a model reads, and an app may add fields of its own (the viewer names the file, and whether
 * unsaved edits were discarded). This notice says WHY; that the process exited is loom's to report, not
 * the app's (loom reporting any MCP server's exit is separate work, and nothing here depends on it).
 */
export const NOTIFY_CLOSED = "notifications/app/closed";

/** Who ended an app: see NOTIFY_CLOSED. */
type ClosedBy = "channel" | "user" | "agent";

interface ClosedFacts {
  app: string;
  by: ClosedBy;
  /** Only on `by: "channel"`, where it is true: no browser can be reached. */
  browsers?: 0;
  /**
   * WHY. For `channel`, what the last attempt failed with (the close code, or the refused handshake); for
   * `user` and `agent`, the app's own words — "the Close button", "the Quit button".
   */
  reason: string;
}

/** Options on `close()`. Every one has the default a person-pressed close button wants. */
interface CloseOptions {
  /** Who asked. Default "user": `close` exists for the app's own close control. */
  by?: ClosedBy;
  /** Extra fields for the notification's params — app facts beside `{app, by, reason, text}`. */
  data?: Rec;
  /** The sentence a model reads, when the app has more to say than `closedText` (the viewer names the file). */
  text?: string;
  /** The caller's own tail, awaited after the unregister and before the exit (`app_mcp`'s state file). */
  flush?: () => Promise<unknown>;
}

/** Options on one registration: what loombot is told beyond the app's name and its bytes. */
export interface RegisterOptions {
  /**
   * PUT THIS IN FRONT OF THE HUMAN NOW — and FALSE by default, which is the half that matters.
   *
   * loombot counts reveals per app and a page acts on the count MOVING (`loombot/registered.ts`,
   * `loombot/web.ts` `drawTabs`, `loom/worker/types.ts` `AppRegistration.reveal`), so this is the one bit
   * that distinguishes an agent pushing new bytes from a PERSON having asked to see something. An app that
   * re-registers on every move must not open the panel; an app answering "show me this file" must.
   * The channel carries the flag and has no opinion about when it is true — that is the caller's.
   *
   * THE TWO CALLERS' ANSWERS: `app_mcp.ts` sets it on its FIRST registration (starting an app is somebody
   * wanting to see it, and since 2026-10-20 there is no way to start one without saying so) and on
   * `publish({reveal: true})`, never on a plain publish or a `--watch` cycle. The file viewer sets it on
   * every `show({path})` and not at boot.
   */
  reveal?: boolean;
  /**
   * THE TAB LABEL — display only; the app NAME stays the id and the URL. STICKY: a title given here is
   * sent on every later registration too, until another replaces it (`""` goes back to the name), so an
   * app that re-registers on every move does not lose it. Renaming an app is THIS, never a new name: the
   * same bytes under a new title keep loombot's version, so an open panel is relabelled and not reloaded.
   */
  title?: string;
  /**
   * WHETHER THIS APP IS A FIXTURE — false by default. True says its RECORDS outlive it (the board, the
   * file viewer): what the app holds on disk is what makes reopening it worth anything, not a property
   * of the process. **IT IS NOT A CLOSE POLICY** (card t20261027-025619-fb7e): until 2026-10-27 an app
   * registering `durable: true` answered a page's Close with `detached` and stayed registered — the f6b7
   * premise that a durable app outlives its pages. Xiaohu reversed that premise on 2026-10-27 (apps die
   * with loombot, and the agent starts what it needs next), so a page's Close ends the app under both
   * kinds, through the caller's own close decision (`app_mcp.ts` `closeApp`, the viewer's `close`
   * event). The flag stays because it is still a true fact about the app, and `state().durable` is
   * where an agent reads it.
   *
   * CARRIED BY THE CHANNEL, NOT SENT TO LOOMBOT: nothing there behaves differently. The tab leaves the
   * strip only when the app unregisters or its server dies (ruling 2), and that is true either way.
   *
   * STICKY, like the title: once true, a later registration cannot unset it.
   */
  durable?: boolean;
}

/** What loombot handed back, and what a caller could not have worked out for itself. */
export interface Registration {
  id: string;
  /** The tab label loombot stored (trimmed), when there is one. */
  title?: string;
  version: number;
  /** The page URL, so a human can open it without asking anybody. */
  page: string;
  socket: string;
  player: string;
}

/**
 * The default wording of an `app/closed`. For `channel`: loombot is gone, the app closed with it, and the
 * verb is starting it again once loombot is back. For `user`/`agent`: who closed it and why, and that there
 * is nothing left to stop — the tab is gone and the server exits right after this line; starting it again
 * is the only verb.
 */
export function closedText(f: ClosedFacts): string {
  if (f.by !== "channel") {
    return 'app "' + f.app + '" was closed by ' + (f.by === "user" ? "the user" : "you") + " (" +
      f.reason +
      "): its tab is gone and its server exits now, so there is nothing to stop. Start it " +
      "again if it is wanted.";
  }
  return 'app "' + f.app + '": loombot is gone and this app closes with it (' + f.reason +
    "). Starting it again once loombot is back is the verb — startWorker.mcp with the same command.";
}

/**
 * THREE, not for ever: a process dialling a loombot that is not answering is precisely the thing that outlives
 * interest in the app. When they run out, the app CLOSES WITH LOOMBOT (`bridgeGone` below) — Xiaohu's
 * ruling, 2026-10-27 (card t20261027-030142-88f8): a loombot restart takes the MCP and the app with it, so
 * nothing survives one by re-registering any more.
 *
 * **WHAT THREE DIALS CAN AND CANNOT DO, because "should they be longer?" is the obvious next question
 * (2026-10-10).** They ride out a socket that died under a loombot that is STILL THERE — an abnormal drop of
 * a connection whose registration is alive. They cannot, by themselves, bring an app back from a loombot
 * that was REPLACED — and nothing else here tries either: this socket redials with the credential
 * `/app/register` handed back, and a registration lives in that process's memory and nowhere else
 * (`loombot/registered.ts`: the player credential and the page token "die with the registration"). The
 * re-registration ladder that used to follow (f6b7, card t20261025-061114-f6b7) is DELETED: it re-mounted
 * an app on a loombot that had forgotten it, on a strip the restart had already emptied. An unbounded dial
 * ladder would buy nothing instead: it would keep a process alive for a conversation nobody is having,
 * which is the thing this comment has always been about.
 */
export const MAX_RETRIES = 3;
/**
 * BOUNDED, and this is the trap `tests/authed.ts` records: a REFUSED handshake looks exactly like a slow
 * one — the socket simply never opens — so an unbounded wait for `open` hangs for ever on a 401.
 */
export const HANDSHAKE_MS = 5_000;
/**
 * **HOW LONG AN ENDING WAITS FOR ITS UNREGISTER POST** (card t20261026-194612-b639).
 *
 * The order of a stop is the whole of this constant: the POST has to LAND before `Deno.exit`, or loombot
 * keeps a registration whose server is gone and the app's name is held by a corpse until loombot restarts.
 * It used to be fire-and-forget — `close()` posted and nobody waited, and the SIGTERM path did not post at
 * all — which is exactly what was captured on 2026-10-26 at 19:39: the viewer's own log said "shutting
 * down", the registry kept the app, and every re-registration after it was refused.
 *
 * Two seconds bounds a race with a teardown that must not hang: loopback answers in single-digit
 * milliseconds, and it is under the SDK's own 2s first rung between ending stdin and SIGTERM, so this
 * wait is normally invisible and a broken loombot costs a stop two seconds rather than the app's name.
 */
export const UNREGISTER_GIVE_UP_MS = 2_000;
/** 250ms, 500ms, 1s: long enough for a loombot that is restarting, short enough that nobody waits. */
export function backoffMs(attempt: number): number {
  return 250 * Math.pow(2, attempt);
}

export interface ChannelInit {
  /**
   * The app NAME: the id, the URL, and what the agent addresses. A registration may relabel the tab
   * (`RegisterOptions.title`); until one does, the tab shows this.
   */
  app: string;
  log: LogSink;
  /**
   * The app's browser assets, READ AGAIN on every registration — boot, and every re-publish. A function
   * rather than a value because that is what re-registering MEANS: the caller decides what the bytes are
   * (a directory walk, a rendered view held in memory) and loombot swaps them atomically.
   */
  files: () => Manifest | Promise<Manifest>;
  /** One frame from a browser, raw. What it means is the caller's whole business. */
  onFrame?: (text: string) => void | Promise<void>;
  /**
   * The wording of an `app/closed`, when an app has more to say than `closedText()` does.
   *
   * NOTHING IS ASKED OF THE CALLER WHEN A PAGE GOES, and the callback that would have been asked is gone:
   * `notifyWhenIdle` was called at that moment until 2026-10-20, when it went with the refusal it backed up
   * (a page's state gates nothing; `building-a-loom-app/README.md`, the page contract, rule 6). What is left
   * of a page going is the log line in `connect()`'s close handler — nothing is called, nothing is told.
   */
  closedText?: (f: ClosedFacts) => string;
  /** Defaults to the environment loom mounted this server with. */
  bridge?: Bridge;
  /**
   * Where MCP messages go. Defaults to this process's stdout, which is the protocol; a test passes a
   * collector instead, and being able to is why the channel can be asserted without spawning a server.
   */
  out?: { write(p: Uint8Array): Promise<number> };
  maxRetries?: number;
  handshakeMs?: number;
  /**
   * How the channel ends the process — `close()`, and the exit a loombot that stays gone ends with
   * (`bridgeGone`). Defaults to `Deno.exit`; a test passes a recorder.
   */
  exit?: (code: number) => void;
}

/**
 * One app's channel. Methods only — the mutable state is closed over, because two channels in one process
 * (a test, or an app that grows a second page) must not share a socket by accident.
 */
export interface Channel {
  readonly app: string;
  /**
   * HAND THE APP TO loombot and take back the page URL, the socket and the credential.
   *
   * Called at boot, and AGAIN for every re-publish: a running app replaces its own bytes without the
   * channel going anywhere (loombot swaps the assets atomically, bumps the version and tells every open
   * page). A re-registration mints a fresh player credential, which the next `connect()` uses — so the old
   * one is revoked by this call and by nothing else.
   *
   * THROWS if loombot refuses (the size cap, a name it will not serve, no index.html). Nothing changed when
   * it does: loombot validates the whole manifest before it swaps anything.
   */
  register(opts?: RegisterOptions): Promise<Registration>;
  /** Open the player socket, and keep it open for the life of the process. Safe to call twice. */
  connect(): void;
  /** Is there a socket to loombot right now? What every `live` field an agent reads comes from. */
  live(): boolean;
  /**
   * HAS A BROWSER EVER SPOKEN TO THIS APP? `undefined` until one has, then TRUE — and FALSE is not one of
   * the answers (card t20261024-022904-fb60). A page is a request, loombot keeps no count of them, and the
   * clean close that used to say "the last one left" went with the page's own socket; the type says
   * `true | undefined` so an assignment that says otherwise cannot compile.
   *
   * `live()` cannot answer this one, and the two facts are different: the socket to loombot stays up (and
   * redials within milliseconds) while nobody at all is on the page. A page's FIRST REQUEST is the only
   * signal there is, and it is positive only — so read TRUE as "somebody has been here", never as
   * "somebody is reading this now".
   */
  watching(): true | undefined;
  page(): string;
  version(): number;
  socket(): string;
  /** Whether this app is a fixture whose records outlive it (a registration fact, not a close policy). */
  durable(): boolean;
  /**
   * WRITE ONE FRAME ON THE PLAYER SOCKET. `false` means there was no channel to send it on.
   *
   * WHAT A PAGE GETS FROM IT IS NOT THE FRAME. A frame written while a page's request is being answered is
   * that page's ANSWER; a frame nothing is waiting for — a rule's `actions`, the agent's `send` — is a
   * PUSH, and loombot turns it into "this app changed", which makes every open page read again. So an action
   * name reaches a page only in an answer it asked for, and a page that never asked never sees one.
   */
  toBrowsers(action: string, data?: Rec): boolean;
  /**
   * THE APP'S STATE MOVED — one call where the caller adopts a new state, and nowhere else.
   *
   * It moves the ONE number every frame carries (`rev` below), which is what a page compares to decide
   * whether a change is one it has already handled. A read must never call it: a page that read would then
   * find its own read "already handled" and skip the next change.
   */
  touched(): number;
  /**
   * NAME THE PARTS OF THE APP'S STATE THIS FRAME CHANGES — one call, before the frame it is about.
   *
   * `part` is a piece of the app's state with its own reason to change: `file`, `tree`, `cursor`, `shown`
   * for the viewer; `list`, `card`, `shown` for the board. Call it where the change happens — never on a
   * read, which changes nothing and therefore names nothing — and the next frame (`toBrowsers`, or the
   * `ack` a request gets when it wrote no frame) carries `parts: [...]`.
   *
   * An app that never calls it sends no names, and a page in front of it reads everything it draws on
   * every change: exactly what it did before any of this existed. See `parts` below, and
   * `building-a-loom-app/README.md`, THE PAGE CONTRACT, rule 7.
   */
  named(...which: string[]): void;

  send(msg: unknown): void;
  reply(id: unknown, result: unknown): void;
  /** A tool failure goes in the RESULT with `isError`, not as a JSON-RPC error: that is the spec. */
  toolResult(id: unknown, text: string, isError?: boolean): void;
  /** Wake the agent. The only path from this process to a model. */
  notify(method: string, params: Rec): void;
  /** Everything written to stdout has landed. */
  tail(): Promise<void>;
  /**
   * Stop, and TELL THE PAGE WHY — then wait for the write tail, so nothing the agent was told is lost.
   *
   * A socket that simply vanishes leaves a page rendering a live app that answers nothing, so the farewell
   * comes first and the close frame is queued after it. Bounded: a half-dead socket must not hold up a
   * stop. It does NOT exit the process — the caller has its own tail to flush (state, in `app_mcp`'s case)
   * and owns the exit. Two signals arriving together get ONE farewell and the same promise.
   *
   * **AND IT UNREGISTERS** (card t20261026-194612-b639), bounded by `UNREGISTER_GIVE_UP_MS`, as the last
   * thing it does. That is the fix for the ghost registration: `app_mcp`'s SIGTERM path and its
   * stdin-closed path both end HERE and nowhere else, and they used to exit without telling loombot while
   * `close` — the one caller a human asks for — did the telling. The registration is loombot's memory of the
   * app, and the process that would have corrected it is the one going away.
   */
  unmount(why: string): Promise<void>;
  unmounting(): boolean;
  /**
   * END THE APP FROM INSIDE — what an app's own Close / Quit button calls. A convenience, not contract: to
   * loom an app is an MCP server it starts and stops, and this is only the app choosing to stop itself.
   *
   * In this order, and the order is the point:
   *
   *     1. notify   NOTIFY_CLOSED `{app, by, reason, text, ...data}` — FIRST, while stdout is still read:
   *     2. unmount  `player_left`, then the socket closes 1000 — the page says so honestly. **That frame is
   *        the ANSWER to the request this close is handling**, so it is what the page that pressed the
   *        button gets and nothing more: a page learns of any other ending from a `404 no such app`.
   *     3. flush    the write tail, then the caller's `opts.flush`
   *     4. exit(0)
   *
   * (The unregister is step 2's, inside `unmount`: every ending needs it, so it lives where every ending
   * passes rather than in the one caller a human pressed — see that doc.)
   *
   * A failed unregister is logged and the exit goes ahead: the process ending takes the app with it anyway,
   * and a close button that leaves the process running because loombot hiccuped is worse. Idempotent: a
   * second call returns the first's promise.
   */
  close(reason: string, opts?: CloseOptions): Promise<void>;
}

/**
 * Build one channel. Nothing happens until `register()`: a caller registers BEFORE it answers the MCP
 * handshake, so the app exists the moment `startWorker.mcp` returns, and connects only AFTER it, because a
 * notification pushed before the client transport settles races it and the first thing lost would be the
 * first thing the user did.
 */
export function channel(init: ChannelInit): Channel {
  const app = init.app;
  const log = init.log;
  const out = init.out ?? Deno.stdout;
  const bridge = init.bridge ?? bridgeFromEnv();
  const maxRetries = init.maxRetries ?? MAX_RETRIES;
  const handshakeMs = init.handshakeMs ?? HANDSHAKE_MS;
  const closedWords = init.closedText ?? closedText;
  const exit = init.exit ?? ((code: number) => Deno.exit(code));

  /** Filled in by registration, and by nothing else. */
  let socket = "";
  let player = "";
  let page = "";
  let version = 0;
  let appId = app;
  // The tab label, sticky across registrations (RegisterOptions.title). "" means none: the tab shows the name.
  let title = "";
  // STICKY once true (RegisterOptions.durable): the close semantics must not change under an open page.
  let durable = false;

  let ws: WebSocket | undefined;
  let connecting = false;
  let stopping = false;
  let stopped: Promise<void> | undefined;
  /** Has a page ever spoken to this app? The only two answers are YES and UNKNOWN (`watching()`). */
  let watching: true | undefined;

  // ONE writer for stdout, serialized. `JSON.stringify` cannot emit a raw newline, which is the other half
  // of the stdio spec: a message MUST NOT contain an embedded one.
  let writeTail: Promise<unknown> = Promise.resolve();
  function send(msg: unknown): void {
    const line = JSON.stringify(msg) + "\n";
    writeTail = writeTail.then(() => out.write(enc.encode(line)))
      .catch((e) => log("stdout write failed:", e));
  }
  function reply(id: unknown, result: unknown): void {
    send({ jsonrpc: "2.0", id, result });
  }
  function toolResult(id: unknown, text: string, isError = false): void {
    // A JSON OBJECT goes as `structuredContent` too, which loom hands the agent as `data` — so
    // `(await workers.<app>.state()).data.count` needs no JSON.parse. MCP requires that field to be an
    // object, which is why an array or a scalar stays text only.
    let data: unknown;
    try {
      const v = JSON.parse(text);
      if (v && typeof v === "object" && !Array.isArray(v)) data = v;
    } catch { /* prose */ }
    reply(id, {
      content: [{ type: "text", text }],
      isError,
      ...(data !== undefined && !isError ? { structuredContent: data } : {}),
    });
  }
  function notify(method: string, params: Rec): void {
    send({ jsonrpc: "2.0", method, params });
    log("notified", method, JSON.stringify(params));
  }
  const tail = async (): Promise<void> => {
    await writeTail;
  };

  /**
   * EVERY FRAME THIS APP SENDS TO A PAGE. `false` means there is no page to send it to.
   *
   * **AND WHILE A REQUEST IS BEING ANSWERED, THE ANSWER CARRIES ITS ID BACK.** An app is fetch-first: a page
   * POSTs an event to loombot (`/a/<id>/app/<name>/__event`) and loombot asks this server over the player
   * socket, so the only thing that can carry the answer is the frame this function writes. `replying` is
   * that id, set around ONE frame's handling and cleared after it - so `reply` appears on exactly the frames
   * produced while answering, and a push (`tools.<app>.send(...)`, a rule asking the agent) carries none and
   * reaches the page as "re-read" instead.
   *
   * IT IS SET HERE AND NOT IN AN APP'S `rules.ts`, on purpose: a rule answers with `actions` and with
   * `toBrowsers` calls, and asking every app to thread an id it never sees would be a protocol in every app
   * at once. loombot asks one app at a time (`app_channel.ts` `appCall`), which is what makes one context
   * enough.
   */
  function toBrowsers(action: string, data: Rec = {}): boolean {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const of = namedInFrame();
    const frame = replying === null
      ? { action, data, rev, ...of }
      : { action, data, rev, ...of, reply: replying };
    if (replying !== null) answeredThisFrame = true;
    ws.send(JSON.stringify(frame));
    // A PUSH IS ONE FRAME, so the names belong to it and go with it. Inside a request they are kept until
    // the whole frame is handled, because one change can be several frames (`answering` clears them).
    if (replying === null) parts = null;
    return true;
  }

  /** The names as they go on the wire: absent when none were given, else a copy. See `parts` below. */
  function namedInFrame(): { parts?: string[] } {
    return parts === null ? {} : { parts: [...parts] };
  }

  /**
   * **THE APP'S STATE VERSION: ONE NUMBER FOR THE WHOLE APP** (card t20261024-061052-2740).
   *
   * Every frame carries it, and a page keeps the one its last ANSWER carried. A change that is not newer
   * than that is one the page has already handled — which is what makes a save cost one request instead
   * of two: the answer to the page's own POST carries the number, so the push that follows the same
   * change is an echo and costs nothing.
   *
   * IT GROWS WHEN THE STATE IS ASSIGNED AND NEVER WHEN A REQUEST ARRIVES (`touched`, called by the caller
   * at its own assignment). A counter that grew per request would make every answer look newer than what
   * the page held, and the page would re-read for nothing.
   *
   * **IT STARTS AT THE CLOCK**, and that is a requirement rather than a flourish: a page outlives this
   * process, and a restarted app with a fresh counter starting at 1 would be ignored by every page still
   * holding 7 — a machine for missing updates. So the seed is later than any number the previous process
   * minted. `Number.MAX_SAFE_INTEGER` is 285,000 years away.
   *
   * AND IT IS NOT A LICENCE. One number cannot certify WHICH PARTS a page already holds, so a page that
   * finds a named part it is drawing and a newer number READS — the number collapses duplicates and
   * echoes, and nothing more (`README.md`, rule 7, says so in as many words).
   */
  let rev = Date.now();

  /** THE ONE CALL AN APP MAKES WHEN ITS STATE MOVES — see `rev` above. Returns the new number. */
  function touched(): number {
    rev = Math.max(rev + 1, Date.now());
    return rev;
  }

  /**
   * **THE FRAME BEING WRITTEN NAMES THE PARTS OF THE APP'S STATE IT CHANGED** (card t20261024-061052-2740).
   *
   * `ch.named("list")` then whatever `toBrowsers` call follows carries `parts: ["list"]`, and a `POST`
   * whose handler names them and writes no frame at all gets them on the `ack` — which is how the board's
   * `showing` says "the pointer moved, nothing else" without a payload.
   *
   * A NAME IS A CLAIM, NOT A NUMBER, and the reader is what makes that safe: it compares the names against
   * the parts it is DRAWING and reads the ones it does not recognise (`README.md`, the page contract, rule
   * 7). So a forgotten name costs a read, a wrong name costs a read, and neither can cost an update — the
   * failure that a version cannot have and an action cannot avoid. That is the whole reason this is a list
   * of names rather than a map of counters: there is nothing to grow, and nothing to get out of step.
   *
   * THE PARTS ARE THE APP'S VOCABULARY, and only the app can name them: `file`, `tree`, `cursor`, `shown`
   * for the viewer; `list`, `card`, `shown` for the board. `shown` is the one every app with a pointer
   * should have, and it is its own name on purpose: a status change names `list`, the pointer is not in
   * that name, so nothing about a status change can move a page off the card its reader is reading.
   *
   * NOT SET IS NOT THE SAME AS EMPTY. Unset means "this frame names nothing", and a page reads everything
   * it draws. An explicit empty list means "this frame names nothing AS CHANGED", which is a rule saying
   * the change it folded made no difference — a click on the card already open — and a page has nothing to
   * do with it.
   */
  let parts: string[] | null = null;

  /**
   * NAME THE PARTS THIS FRAME CHANGED — see `parts` above. One call, before the frame it is about.
   *
   * A register rather than an argument of `toBrowsers` because one change can be several frames (a rule's
   * actions, and the `ack` for the ones that wrote nothing) and they all describe the same change.
   */
  function named(...which: string[]): void {
    parts = which;
  }

  /** The id of the request being answered, or null between frames. See `toBrowsers` above. */
  let replying: unknown = null;
  /** Whether anything has been written under that id yet — what `answering` needs to decide about `ack`. */
  let answeredThisFrame = false;

  /**
   * ONE FRAME IN, ANSWERED UNDER ITS OWN ID. `reply` is loombot's correlation for a fetch that is waiting:
   * parsed here, in scope for the whole of the handler, and never passed on - an app's `event()` sees the
   * same `{event, data}` it always did.
   */
  async function answering(text: string): Promise<void> {
    let asked: unknown = null;
    try {
      const parsed = JSON.parse(text);
      asked = typeof parsed === "object" && parsed !== null ? (parsed as Rec).reply ?? null : null;
    } catch {
      asked = null;
    }
    replying = asked;
    answeredThisFrame = false;
    try {
      await init.onFrame?.(text);
      // **EVERY REQUEST IS ANSWERED, EVEN WHEN THE APP HAS NOTHING TO SAY.** A rule that returns only
      // `{state}` — `showing` on the task board is exactly that — produces no frame at all, and before
      // fetch-first that cost nothing: nobody was waiting. A request IS waiting now, so silence would hold
      // it until loombot gave up (`app_channel.ts` `APP_CALL_MS`) and then tell the page the app had failed,
      // for an event the app had taken perfectly. `ack` says "taken, and nothing to add", and a page draws
      // nothing for it.
      if (asked !== null && !answeredThisFrame && ws && ws.readyState === WebSocket.OPEN) {
        // AND IT CARRIES THE NAMES LIKE EVERY OTHER FRAME A PAGE GETS (`toBrowsers`, card
        // t20261024-061052-2740). An `ack` is the answer to an event that states something without saying
        // anything — a board's `showing` is exactly that — so an app that names its parts would otherwise
        // have to invent a frame just to carry them.
        ws.send(JSON.stringify({ action: "ack", data: {}, rev, ...namedInFrame(), reply: asked }));
      }
    } finally {
      replying = null;
      answeredThisFrame = false;
      // ONE HANDLED FRAME, ONE SET OF NAMES: cleared here so a change can never leak onto the next frame.
      parts = null;
    }
  }

  async function register(opts: RegisterOptions = {}): Promise<Registration> {
    // THE TITLE AND THE FLAG ARE STICKY, and both are adopted BEFORE the call: a registration that
    // fails must not make the next one forget what this app is called or how its pages close.
    if (opts.title !== undefined) title = opts.title;
    if (opts.durable === true) durable = true;
    const files = await init.files();
    const res = await fetch(bridge.url + "/app/register", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Loom-Token": bridge.token },
      body: JSON.stringify({
        name: app,
        files,
        reveal: opts.reveal === true,
        ...(title ? { title } : {}),
      }),
    });
    const body = await res.json().catch(() => ({})) as {
      ok?: boolean;
      error?: string;
      id?: string;
      title?: string;
      version?: number;
      url?: string;
      socket?: string;
      player?: string;
    };
    if (!body.ok) throw new Error(body.error ?? "/app/register answered HTTP " + res.status);
    socket = body.socket ?? socket;
    player = body.player ?? player;
    page = body.url ?? page;
    version = body.version ?? version;
    appId = body.id ?? appId;
    log(
      "registered app=" + app + " id=" + appId + " version=" + version +
        " files=" + Object.keys(files).length + (opts.reveal ? " reveal=true" : "") +
        (title ? " title=" + JSON.stringify(title) : "") +
        " page=" + page,
    );
    return {
      id: appId,
      ...(body.title ? { title: body.title } : {}),
      version,
      page,
      socket,
      player,
    };
  }

  /**
   * Open the player socket.
   *
   * The credential is whatever REGISTRATION handed back: minted by loombot per registration, held in memory
   * and written nowhere. The way to revoke it is to stop the server, which takes the app with it.
   */
  function connect(attempt = 0): void {
    // ALREADY OPEN is the third reason to do nothing: a second socket would deliver every browser frame
    // twice and leak the first (`tests/channel_test.ts`, "connect() on an open channel").
    if (stopping || connecting || ws?.readyState === WebSocket.OPEN) return;
    connecting = true;
    (async () => {
      // Read at dial time, not at construction: a re-publish mints a new credential and the next dial
      // must use it.
      const url = socket + (socket.includes("?") ? "&" : "?") + "player=" +
        encodeURIComponent(player);
      const sock = new WebSocket(url);
      const open = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), handshakeMs);
        sock.addEventListener("open", () => {
          clearTimeout(timer);
          resolve(true);
        }, { once: true });
        sock.addEventListener("error", () => {
          clearTimeout(timer);
          resolve(false);
        }, { once: true });
      });
      connecting = false;
      if (!open) {
        try {
          sock.close();
        } catch { /* never opened */ }
        return retry(attempt, "handshake refused or timed out (a wrong ?player is a plain 401)");
      }
      ws = sock;
      // THE EPISODE IS OVER: the socket is open, so whatever happens next is a fresh story — the close
      // handler below hands `retry` a 0, never a count a previous outage left over.
      log("player socket open:", socket);
      sock.addEventListener("message", (ev) => {
        // A REQUEST FROM A PAGE is the only word there is on whether anyone is looking, and it is a
        // positive one: there is no frame that says a page has gone, because a page is a request.
        watching = true;
        void answering(String(ev.data));
      });
      sock.addEventListener("close", (ev) => {
        ws = undefined;
        if (stopping) return;
        log("player socket closed:", ev.code, ev.reason);
        // WE DIAL BACK IN, WHATEVER THE CODE. A clean 1000 is the case that changed, and this is the bug
        // it fixes: A RETURNING BROWSER FOUND A DEAD APP, and nothing could tell anybody. Measured by USING
        // it: four stop-and-restart cycles in twenty minutes, one per tab that was closed. An idle socket
        // costs nothing; a dead app that looks alive costs the user everything.
        //
        // WHAT A CLEAN 1000 USED TO MEAN, and no longer does (card t20261024-022904-fb60): it was loombot
        // saying THE LAST BROWSER LEFT. A page held a socket then, so loombot saw the last one close and
        // closed the player with it (`loombot/serve.ts`: "no viewers left"); a page is a request now and
        // loombot keeps no count of them, so it closes no app socket and nothing sends this code. The redial
        // stays because it is still right for a close nothing here asked for — and `watching` is left
        // alone, because a close is no evidence about who is on the page.
        //
        // THE LADDER STAYS, for the case it was written for: an ABNORMAL close is loombot going away or
        // restarting, where the route may not be there yet. When the ladder runs out the app closes with
        // loombot (`bridgeGone`) — it does not outlive the restart (Xiaohu's ruling, 2026-10-27).
        if (ev.code === 1000) {
          // NOTHING IS ASKED OF THE CALLER HERE, and nothing is told to one. This line read
          // `announceIdle = wantsIdle()` (the value decided whether `notifications/app/idle` was pushed
          // once the socket was back), then `wantsIdle()` alone (the viewer's hook cleared a stale dirty
          // flag in it), and now there is no call at all: the push went on 2026-10-20 and the hook went
          // with the refusal it backed up. A silence that is a DECISION and a silence that is a bug look
          // identical from outside, so the line below is still the record — of the close, not of a person.
          log(
            "the player socket closed cleanly (" + (ev.reason || "no reason given") +
              ") — redialling.",
          );
          // Straight back in rather than onto the ladder: nothing failed, and the app must be alive BEFORE
          // the next browser arrives, not after its first click has been dropped.
          connect();
        } else {
          // A FRESH LADDER: this socket OPENED, so the dial that made it succeeded and the count starts
          // again. Carrying `attempt` here left a channel that survived one outage on its third dial with
          // no retries at all for the next (`tests/channel_test.ts`, "a second outage").
          retry(0, "socket closed with " + ev.code + " " + (ev.reason || "no reason"));
        }
      });
    })().catch((e) => {
      connecting = false;
      retry(attempt, e instanceof Error ? e.message : String(e));
    });
  }

  /** A few retries, then END THE PROCESS: a loombot that will not take the socket back is gone. */
  function retry(attempt: number, why: string): void {
    if (stopping) return;
    if (attempt >= maxRetries) {
      // THE LADDER RAN OUT, and a dial that cannot open on a channel whose credential was valid at
      // registration is the signature of a loombot that is gone — replaced under this process, or down.
      // Xiaohu's ruling (card t20261027-030142-88f8) is that the app closes with it rather than trying
      // to come back: the registration it would need died with the restart, and an app that
      // re-registered anyway would be a page on a strip nobody can see.
      void bridgeGone(why);
      return;
    }
    const ms = backoffMs(attempt);
    log("reconnecting in", ms + "ms:", why);
    setTimeout(() => connect(attempt + 1), ms);
  }

  /**
   * THE END OF THE LADDER, AND OF THE PROCESS: loombot is gone, and this app closes with it. Xiaohu's
   * ruling (card t20261027-030142-88f8) reverses f6b7's re-registration ladder, which tried to bring an
   * app back from a loombot that was replaced and could not win: a registration lives in loombot's memory
   * and nowhere else (`loombot/registered.ts`), so a restart takes the registration and the tab with it,
   * and a process that outlived one was re-mounting a page on a strip nobody can see — 'loombot restarts
   * and the MCP is gone with it, the app disappears'.
   *
   * **NOT AN INTENTIONAL UNMOUNT.** `stopping` is the app's own ending — the agent's stop (stdin
   * closed), a rule's close, a test's `unmount` — and `retry` never reaches here once it is set; that
   * path keeps its farewell, its unregister and its exit. This is the OTHER ending: loombot went away
   * under a live app, and nothing round-tripped.
   *
   * THE ORDER, the same discipline `close()` runs on: the reason is LOGGED and the agent is NOTIFIED
   * while stdout is still read, then the tail is flushed, then exit(0) — a clean exit, the process doing
   * what the ruling says, not a crash.
   */
  async function bridgeGone(why: string): Promise<void> {
    if (stopping) return;
    log("loombot is gone; this app closes with it (" + why + ")");
    const facts: ClosedFacts = { app, by: "channel", browsers: 0, reason: why };
    notify(NOTIFY_CLOSED, { ...facts, text: closedWords(facts) });
    await tail();
    // An unmount that arrived while the tail flushed owns the ending, as it always did.
    if (stopping) return;
    exit(0);
  }

  function unmount(why: string): Promise<void> {
    if (stopped) return stopped;
    stopping = true;
    stopped = (async () => {
      log("shutting down:", why);
      const sock = ws;
      if (sock && sock.readyState === WebSocket.OPEN) {
        // **AN APP ENDING IS A CHANGE, AND THE LAST ONE** (card t20261024-061052-2740). The farewell moves
        // the number and names a part no page knows (`app`), and an unknown name means "read what you
        // draw" — so every page looks once more and finds its app gone (a page that ignored it would keep
        // looking alive and answering nobody, which is the one thing a version must never cause).
        touched();
        named("app");
        // **AND THIS FRAME RIDES ON THE ANSWER TO THE REQUEST THAT CAUSED IT, which is the whole of why a
        // page cannot rely on it.** `toBrowsers` stamps `reply: replying` while a request is being handled
        // — and a Close/Quit IS one — so this farewell reaches a page only as that request's answer. Any
        // OTHER page is pushed it and never sees it, because a page has no socket for a push to arrive on.
        //
        // What every OTHER ending leaves is a request that FAILS: `startWorker`/`stopWorker`, a crash and
        // a session ending all unregister the app, so the next `POST __event` is answered `404 no such
        // app` (`loombot/routes.ts`) and a page must draw `over` for it. Retrying that 404 is a page arguing
        // with a fact, which is why the 503 — nobody answered at all — is the only retryable one.
        toBrowsers("player_left", { app, reason: why });
        const gone = new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 1_000);
          sock.addEventListener("close", () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
        });
        // The close frame is queued AFTER the farewell, so the page gets both in order; the wait is
        // bounded because a half-dead socket must not hold up a stop.
        sock.close(1000, "player unmounted");
        await gone;
      }
      // **THE REGISTRY IS TOLD, AND THE POST IS AWAITED** (card t20261026-194612-b639). A stop that only
      // told the PAGE leaves loombot holding the registration, because the process is about to end and
      // nothing else will ever say this app is gone: the harness may not have a record of it (it arrived
      // from a server somebody started), and a name held by a corpse is an app that can never be started
      // again under it. Bounded by `UNREGISTER_GIVE_UP_MS`, and the LAST thing this function does, so no
      // caller can exit between the farewell and the telling.
      await tail();
      await unregister();
      await tail();
    })();
    return stopped;
  }

  /**
   * ONE POST, ONCE PER LIFE: tell loombot this app is gone, bounded, and never throw.
   *
   * Why once: a SIGTERM during a stop arrives while `unmount` is still running (`app_mcp` swallows it —
   * `quiesce` answers false for a teardown already under way), and a second POST would be a second
   * deletion for a name a new server may by then be serving. `unregister` in `loombot/registered.ts`
   * refuses to drop a registration that is not this server's, and this is the other half of that: one
   * server says it once.
   */
  let unregistered: Promise<void> | undefined;
  function unregister(): Promise<void> {
    if (unregistered) return unregistered;
    unregistered = (async () => {
      try {
        const res = await fetch(bridge.url + "/app/unregister", {
          method: "POST",
          headers: { "content-type": "application/json", "X-Loom-Token": bridge.token },
          body: JSON.stringify({ name: app }),
          signal: AbortSignal.timeout(UNREGISTER_GIVE_UP_MS),
        });
        const body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
        if (!body.ok) log("unregister refused:", body.error ?? "HTTP " + res.status);
        else log("unregistered app=" + app);
      } catch (e) {
        // A FAILED UNREGISTER IS LOGGED AND THE EXIT GOES AHEAD: the process ending takes the app with it,
        // and loombot reaps what is left within `APP_REAP_MS` of this socket closing. A stop that refused to
        // end because loombot hiccuped would be worse.
        log("unregister failed:", e instanceof Error ? e.message : String(e));
      }
    })();
    return unregistered;
  }

  let closing: Promise<void> | undefined;
  function close(reason: string, opts: CloseOptions = {}): Promise<void> {
    if (closing) return closing;
    closing = (async () => {
      const by = opts.by ?? "user";
      log("closing itself, by " + by + ":", reason);
      const facts: ClosedFacts = { app, by, reason };
      notify(NOTIFY_CLOSED, {
        ...(opts.data ?? {}),
        ...facts,
        text: opts.text ?? closedWords(facts),
      });
      // ON STDOUT BEFORE ANYTHING ELSE HAPPENS: a notice still queued when the process exits is lost.
      await tail();
      // THE UNREGISTER IS `unmount`'S NOW, not a second POST here: it is one ending, and the callers that
      // do not come through this function — a SIGTERM, stdin closing (`app_mcp.ts` `shutdown`) — need it
      // just as much (card t20261026-194612-b639).
      await unmount(reason);
      await tail();
      if (opts.flush) await opts.flush();
      exit(0);
    })();
    return closing;
  }

  return {
    app,
    register,
    connect: () => connect(),
    live: () => ws?.readyState === WebSocket.OPEN,
    watching: () => watching,
    page: () => page,
    version: () => version,
    socket: () => socket,
    durable: () => durable,
    toBrowsers,
    touched,
    named,
    send,
    reply,
    toolResult,
    notify,
    tail,
    unmount,
    unmounting: () => stopping,
    close,
  };
}
