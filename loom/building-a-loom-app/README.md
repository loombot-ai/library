---
name: building-a-loom-app
description: "Read BEFORE building a loom app — a page in the browser with an agent behind it — or writing a generated UI, or starting an app channel: an app is FETCH-FIRST and has no socket, and this says how a page reads its data, when it re-reads, what it cannot do (streaming), what belongs in the app's own rules (instant) and what is a decision worth a turn boundary."
as_of: "2026-11-08"
---

# A loom app: an MCP server that hands loombot a UI, and a rule about who answers what

**An app IS an MCP server.** You write the files anywhere you like, start the server, and it REGISTERS
them with loombot — which then holds the bytes and serves the page. Xiaohu, 2026-09-24: "Loom app is a
special mcp. When the mcp start... the loom app mcp will register itself to loombot. This way, loombot does not
need to scan the .loom/apps folder. Since it is a mcp, it can be anywhere."

So there are **four files to write and one command**, and **no directory is special**:

    <anywhere>/src/index.html      what the browser loads
              /src/app.js          its behaviour — sends EVENTS, renders ACTIONS
              /src/<name>.css      its own LAYOUT (every colour is /theme.css's)
              /rules.ts            what is MECHANICAL: answered without you, in ms
              /build.ts            `deno task build`: src/ -> assets/, minified and measured

**`assets/` IS ONLY WHAT `deno task build` WRITES, and it is the folder the app REGISTERS.** So the start is
`--dir <your app>/assets` (and `--rules <your app>/rules.ts`, because the rules sit at the app's top: a `.ts`
is never handed to a browser). One shape for every app in this tree — `loom/library/file-viewer`,
`task-board` and both examples — and it is a GATE rather than a habit: `deno task app-shape` refuses an app
that went back to a `page/` folder, a hand-written `<style>` block, or no build at all. `example-ttt/build.ts`
is the one to copy, and `loom/library/build_step.ts` is the size table, the minification signatures and the
write/prune step all four share.

**A RULE MUST ANSWER WITH A VALUE, NOT A PROMISE OF ONE, because a promise is taken FOR an answer.**
`app_mcp.ts` calls `rules.event(...)` without `await`, then tests the result with `out === null || out === undefined`
to decide whether this was a DECISION worth waking you for. An `async` rule returns a promise, which is neither `null`
nor `undefined` — so it is not treated as a decision, the agent is NEVER asked, and the page waits for an answer that
never comes. Not a refusal, not an error: silence, which reads as a broken page. Read files synchronously
(`Deno.readTextFileSync`) and keep every rule synchronous.

**AND NOTHING TYPE-CHECKS IT FOR YOU.** `app_mcp.ts` loads your module through `as Partial<AppRules>` — a cast — so an
`async` method typechecks perfectly where it stands and `deno check` says nothing. There is no type-level guard behind
this rule: the whole defence is keeping every rule synchronous, which is why this paragraph is here rather than in a type.
`rules.ts` is optional in exactly one way: an app with NOTHING its page sends that needs deciding — every behaviour
is arithmetic in the page — leaves it out and is a **static app** (below). Absent rules mean every browser
event is REFUSED, never that every event becomes your decision.

THREE files you write, and **nothing generated lands among them**: the rules' state goes under `TMPDIR` —
`$TMPDIR/<name>/channel-state.json`, `TMPDIR` being the RUN's own scratch directory — written by the server,
never by you, and `--state` moves it. It defaulted to `<the app's own dir>/channel-state.json` until
2026-09-24, which put a generated file inside whatever directory you kept the app in; two of those ship inside
the loom repo, so playing the example dirtied a git tree. PER-RUN STATE IS TEMP BY DEFINITION, so it lives in
the one directory that is temp and dies with the run. Something that must OUTLIVE the run is durable data
instead, and that has its own path — see `{ data: true }` below.

Registration hands over that folder MINUS anything a browser cannot use: dotfiles, `.ts` (your `rules.ts`
is the channel's code, not the page's) and `node_modules`. `index.html` is required, because it is the
file the page loads. Up to 256 files and 16 MiB; past that the start FAILS, naming the limit.

**THAT FOLDER IS THE PAGE'S CODE — AND THE FILES IN IT ARE TOO.** A registration is posted once and held in
memory for the app's life, which makes it the wrong place for anything large or perishable: the two library
examples are 7.7 KB and 10.9 KB, and the app that hit this limit hit it with 107 JSON WORD FILES, which is data
rather than code. *** DATA BELONGS IN THE APP'S OWN DIRECTORY, BEHIND THE CHANNEL: *** the page asks (an event)
and the server reads and answers, which is how `file-viewer` hands its page a file's bytes today. An app has no
HTTP surface of its own for a page to `fetch` from, so a page that wants data asks for it — and what HAS been
measured over the channel is a file up to 2 MiB. Nothing larger has ever been sent, so nothing larger should be
assumed.

**What you do NOT need to assemble:** loombot's port, the workspace id, a credential file, a URL. The
registration answers with the page URL, the socket and a credential minted for it, and the server uses
them itself; the one address an AGENT ever reads back arrives in a tool result that carries it
(`publish`'s `page`), never one you built. An app also lives exactly as long as its server: `stopWorker`
and the tab goes.

`.loom/apps/<name>/` is still a fine place to KEEP the files — point `--dir` at it — but it is now an
ordinary folder: loombot scanned it for apps until 2026-09-24 and does not any more, so a directory nobody is
running is not an app and gets no tab. There is no `--socket`, no `--token-file` and no `.player` file;
assembling `ws://127.0.0.1:<port>/a/<id>/app/<name>/ws` by hand was the rigidity this design removed, and
the flags that took it are deleted.

**Every file in there is YOURS.** loombot owned `<app>/state.json` while it refereed a built-in board — two
writers on one filename, corrupting each other in silence — and that board moved out to `example-ttt/` on
2026-09-22 (`loombot/game.ts`, deleted). It RESERVES no event name either (`move` used to be the referee's
and never reached a channel), and under registration it does not even read your folder: it holds a copy of
what it was handed. The state file is still called `channel-state.json` — the name says which process writes
it — and it no longer lives among your files at all: `$TMPDIR/<name>/channel-state.json`, with `--state` to
move it.

    GET /a/<id>/app/<name>        the page (browser: the signed session cookie, as everything else)
    GET /a/<id>/app/<name>/ws     the channel, and the OWNER's socket: `?player=<credential>`. That is the
                                  only end left — a page has no socket (see "An app is FETCH-FIRST").
    POST /a/<id>/app/<name>/__event   a page's DATA: `{event, data}`, answered by the frame it draws,
                                  ON THE SESSION COOKIE like any other request from a browser.

A SUB-AGENT's app is served at `/a/<id>/app/<name>@<agent>/` instead, so two agents may own an app of one
name and neither serves the other's bytes. You never build the URL: the one you can read back comes in a tool result that carries it (`publish`'s `page`), suffix included.

**Two working examples sit beside this file, and they are two halves of the same lesson.** Copy one,
rename the events, keep the comments:

    example/       a tally: a validated limit, enforced locally; RAISING it is the agent's judgement
    example-ttt/   a board: legality and win detection are arithmetic; the OPPONENT'S MOVE is the agent's

The tally is the smaller read. The board is the one that shows the interface under load — it was loombot's
own referee until 2026-09-22, and porting it out is what turned up the `null`-is-exclusive rule below.

## The one rule that is not negotiable: never put a model in the path of a rule

**An agent answers at TURN boundaries.** Measured (`loom-hq/docs/.md`): one Bedrock round trip
asking for a chess move is **2,026ms** at its absolute best — "reply with ONLY your move" — and **7,412ms**
when the prompt invites commentary. That 2s is the FLOOR, before loom's own turn boundary, the transcript
and the tool schemas.

So:

| the click                            | who answers    | what it costs                          |
| ------------------------------------ | -------------- | -------------------------------------- |
| legality, limits, redraw, whose turn | `rules.ts`     | about a millisecond, no agent involved |
| a judgement with no rule behind it   | you, the agent | one notification and a turn boundary   |

Two seconds for "here is my move" reads as thinking. Two seconds for "that square is taken" reads as
broken. **An app whose every click needs the model is a chat box with a picture of an app** — and the split
is asserted, not hoped for: `tests/app_mcp_test.ts` fails if a mechanical event produces any notification
at all.

## An agent-owned app wants its brief IN A FILE, not in the call

`example-ttt` has an opponent: the agent that owns the app. `rules.ts` answers everything mechanical and asks one
question — which square to play — so the player can be a SUB-AGENT, and then the app id carries its name
(`example-ttt@player`) and the board lives exactly as long as that child's server.

Start it by reading the brief from disk:

    const dir = "<this library>/example-ttt";
    const brief = await read(dir + "/OPPONENT.md", { numbers: false });
    await startWorker.agent("player", Deno.cwd(), brief + "\n\nTHE APP DIRECTORY IS: " + dir);
    // ...and the app the child starts registers dir + "/assets", NOT dir: src/ is the hand-written half and
    // assets/ is what a build made (OPPONENT.md says so in the child's own words).

**`{numbers: false}` is the point.** `read()` numbers every line by default — which is what makes it right for
citing code and for a follow-up `edit` — and a brief with `1:` down its left margin is the corruption logged
three times in `loom-hq/docs/tracking/bugs/deferred/writing-a-payload-in-repl-code-is-a-trap.md`. Do NOT reach for
`Deno.readTextFile` instead: it has no binary guard and decodes lossily (10 bytes of PNG header come back as
three replacement characters and re-encode as 16), while `read` refuses a file that is not text. The unnumbered
read belongs on the verb that still refuses.

Two things this buys, and the second is the one worth designing around (Xiaohu, 2026-09-24):

- **The brief is maintainable.** It is reviewed, versioned and fixed in git rather than retyped from memory at
  every spawn. Every correction a player ever needed is already in `OPPONENT.md` — including the one below, which
  cost three wasted parent turns to discover.
- **It never enters the PARENT's context.** The text goes from the file into the child through a repl variable, so
  the parent spends no tokens holding a brief it wrote for someone else. A 60-line brief costs the parent one line
  of code. That is the general shape: a repl is where data can flow without passing through a transcript.

The cost, stated plainly: the parent's transcript no longer shows what the child was told, so reviewing a
misbehaving child means reading the file — and the file may have changed since. The child's own trace still holds
the exact words it was given.

### The rule that brief exists to carry: a player PARKS, it does not hand off

After sending its move, a player calls `wait()` instead of ending its turn. Ending a turn IS a handoff — it wakes
the parent to read "idle, waiting for input" and decide nothing. Measured the first time this was played by a
human: three moves, three pointless parent turns. At Gomoku's forty moves it would be forty. `wait()` holds the
turn open and returns when the next question arrives, which is exactly what a player wants and costs the parent
nothing.

## Start it

    await startWorker.mcp("tally", "deno", [
      "run", "-A", "<loom>/loom/library/building-a-loom-app/app_mcp.ts",
      "--dir", "<your app>/assets", "--rules", "<your app>/rules.ts",
      "--app", "tally",
    ]);

That is the whole of it. **There is no port and no id to assemble**, and nothing in loom could have told
you either: loombot's port is not published to a session, and a workspace id is a slug of the last path
segment with a collision suffix. The server finds `LOOM_BRIDGE_URL`/`LOOM_BRIDGE_TOKEN` in the environment
loom gives every MCP server, registers through them, and is told the rest.

**AN APP THAT KEEPS SOMETHING ACROSS RUNS SAYS SO AT THE MOUNT** — a fourth argument:

    await startWorker.mcp("bee", "deno", ["run", "-A", ".../app_mcp.ts", "--dir", dir, "--app", "bee"],
      { data: true });

Only then does loom create `~/.loom/app-data/<name>` — a sibling of `library/` on this machine rather than in
your workdir — and pass it as `LOOM_APP_DATA_DIR`. **OMIT IT AND THE VARIABLE IS ABSENT**, which is how the
app is told it keeps nothing durable; per-run state (`TMPDIR`) needs no declaration at all. Your `rules.ts`
reads the path itself and writes there only when it is present. A device preference belongs in the page's
`localStorage`, and what the AGENT should remember in the library — neither is this.

**`app_mcp.ts` imports `channel.ts` beside it**: the app-channel protocol — registration, the player socket and
its `?player`, the retry ladder, the idle facts, the log, the graceful unmount — which the file viewer shares, so
a protocol change is one edit. Mount it from the library where it stands; copying `app_mcp.ts` on its own leaves
that import dangling.

**`startWorker.mcp` REFUSES a command ending in `.ts`** — that suffix is `loadTools`' argument, and
the check exists so the wrong verb reads as the wrong verb instead of a 15s handshake timeout. So the
command is `deno` and the script is an argument. Optional flags:

    --app <name>         otherwise the asset directory's own name
    --dir <path>         the files handed to loombot; otherwise the CWD
    --rules <path>       otherwise <dir>/rules.ts — and if THAT is absent the app is static (below).
                         Named explicitly and missing or broken, the start FAILS: a typo is not static.
    --build "<cmd>"      sh -c <cmd> in the SERVER'S CWD (your workdir, not --dir) before EVERY
                         registration; a non-zero exit registers nothing
    --watch <path>       repeatable; a change rebuilds and republishes on its own (below)
    --state <path>       otherwise $TMPDIR/<app>/channel-state.json — TMPDIR being the RUN's scratch dir
                         (a server you start BY HAND, with no TMPDIR, falls back to <cwd>/.loom/app-state/)
    --log <path>         otherwise $TMPDIR/loom-app-mcp-<app>.log

**A registration that is refused kills the start**, on purpose: the cap, a name loombot will not serve, a
manifest with no `index.html`. The reason is in the log (below) and on the server's stderr, because the
alternative is a mount that "worked" and a tab that never appears.

### Refining it: edit, `publish`, look

    await Deno.writeTextFile(dir + "/app.js", better)
    await workers.tally.publish({})     // loombot swaps the bytes, bumps the version, tells open pages

Both halves of the loop work (Xiaohu: "do both restart and push new assets"). `publish` keeps the channel
and the state and is what you want mid-conversation; restarting the server re-registers from scratch and
costs both. Either way an open page is TOLD, and the telling is the PANEL's act: it reloads the frame when
the version moves. **AND THE VERSION MOVES ONLY WHEN THE BYTES DO** (2026-10-25, card t20261025-051703-9964):
a `publish` that changed no file, and a restart that re-registered the same files, move nothing and reload
nothing — a version is the number of your app's assets, not of its registrations
(`loombot/registered.ts` `register`). A page is never sent anything about a publish — there is nothing to push
at one, and `app_replaced` (a frame on a page's socket) is deleted with the socket.

The start REPORTS what it added — both signatures, every argument with its own line — so what `send`
takes arrives with the call that started the channel rather than from a follow-up `help`.

You get the three GENERIC tools, plus whatever the app's own `rules.ts` declares:

    await workers.tally.verdict({ outcome: "granted", limit: 25 })   // the app's OWN decision tool
    (await workers.tally.state()).data                               // what the rules hold now
    await workers.tally.publish({})                                  // re-register the assets
    await workers.tally.publish({ reveal: true })                    // ...and open the panel

The notification that asks a decision NAMES the tool that answers it, and the reply comes back in the
same call: the tally example declares `verdict` (its one decision), the board example `move`. An
illegal answer is that tool's ERROR, so you correct yourself in the turn you are already in — no frame
follows it and the page is told nothing:

    await workers.board.move({ square: "B2" })   // the app's own tool; an illegal call is ITS error

An app that declares NO tools is answered through the generic `send`, and its `rules.action` folds the
answer into state (both below, under "Writing `rules.ts`"):

    await workers.<app>.send({ action: "granted", data: { limit: 25 } })

Every MCP tool returns `{ text, files, data? }` — `data` is a JSON object result, parsed. Parenthesise
before reading a field: `(await workers.tally.state()).data`; `await workers.tally.state().data` reads
`.data` off the PROMISE.

**`state()` is also the only place "has anyone looked?" is answered.** `live` says the channel to loombot is
up, and it IS up while nobody is on the page, because the channel dials straight back in after a page stops
asking. `watching` says whether a BROWSER has spoken to your app: `true` once a page has, and `null` when
none has — UNKNOWN, which is not the same word as NO. **It no longer says FALSE, and nothing can make it**
(card t20261024-022904-fb60): the `false` came from loombot seeing the last browser's socket close, and pages
have no socket, so loombot sees nothing at all. Read it as "a person has been here", never as "somebody is
looking now"; the cost of a wrong guess is a turn spent on nothing.

Every tool a channel adds lives in your repl for as long as the app does. Anything an app needs beyond
these belongs in `rules.ts`, where it costs no context and answers instantly.

### Renaming it: a TITLE, never a new name

Asked to "rename the app" (or "call the tab X"), re-register under the SAME name with a title:

    await workers.tally.publish({ title: "Budget planner" })   // the tab reads "Budget planner"

The NAME is the id, the URL and the worker you address; the title is only what the tab
shows. So a rename keeps the URL, and when the files did not change it keeps loombot's version too — an open
panel is relabelled in place, NOT reloaded, and loombot's version does not move. That is now the general rule
and not a rename's exception: ANY re-registration of the same bytes keeps the version, under any title
(`loombot/registered.ts` `register`, 2026-10-25). The title sticks across
later publishes; `publish({ title: "" })` goes back to the name. loombot trims it, refuses anything that is not
a string or is over 64 characters (the publish fails with its sentence and nothing changes), and renders it
as text, never markup. Restarting under a new NAME is not a rename: it is a second app with a new URL, and
the old tab goes when its server does. From your own channel code it is `ch.register({ title })`
(`channel.ts`, `RegisterOptions.title`), or `title` in `channel({...})` for the first registration.

### Where your app shows up: the top row

**Starting the server OPENS the app** in the panel of any loombot page already open on the workspace — no
click, and the caret stays in the composer. Only that FIRST registration does it: a `publish`, a `--watch`
rebuild and a rule answering a move change the bytes and leave the panel as the human left it, so a panel
they hid stays hidden. `publish({ reveal: true })` is how you bring it back to the front when they ask to
see it; THERE IS NO WAY TO START AN APP HIDDEN -- whether to reveal is loombot's business, not the app's and
not the agent's, so a start ALWAYS asks (Xiaohu, 2026-10-20: `--no-reveal` is deleted).
A RESTART of the same app is a new first registration, so it opens again on a page that watched the first
life: loombot counts the new life from zero, and the page forgets an app's reveal mark when the app leaves the
strip or its count goes down (`drawTabs` in `client/conversation.js`). On a phone the app covers the conversation,
so the composer is hidden while it is open; the draft is kept. The mechanism is loombot's per-registration
reveal count (`RegisterOptions.reveal` in `channel.ts`); `app_mcp.ts` is only deciding when to set it.

loombot's conversation page has ONE bar across the top (`loombot/web.ts` `#top`, 2026-09-27): the workspace-list
control (☰) at its left end, one tab per app, then **↗** (open the app on screen in a new browser tab — a real
link, so cmd- and middle-click work) and **–** (hide the panel; the app keeps running) at its right end, shown
only while an app is open. What that means for you:

- **The tab reads your `title`, else your name — at every width.** Keep a title short and about the CONTENT
  (the file viewer's is just the file, `README.md`); loombot names the app in the tab's tooltip
  (`viewer — README.md · 1 viewer`), so repeating your own name in the title only costs width, and on a
  phone most of the tab.
- **A tab only opens or switches.** Clicking the selected tab does nothing WHILE IT IS SHOWING YOUR PAGE; –
  is the only way to hide the panel, and it is a HIDE, not a close: the frame stays LOADED (reopening is
  instant), so a hidden panel's app is still running, still connected and still counts as a viewer. Stopping
  an app is `stopWorker`.
- **A frame that has left your page is brought home by that same tab (2026-10-09).** If the frame is no
  longer at your app's URL — a form submit (`allow-forms` is in the sandbox), a `location.assign`/hash write
  in your own code, or a page you navigated to — clicking the app's tab loads your entry page again. So a
  navigation inside the frame is no longer a ONE-WAY trip for a human, but it is still the wrong way to move
  in a panel: it looks like your app died, and the only recovery is that click. The multi-page case costs a
  page nothing extra now that there is no socket: a page you navigate TO is another ordinary request,
  carrying the same cookie.
- **↗ opens the app PAGE**, `/a/<ws>/app/<id>/`, not the asset it happens to be showing — which asset is
  your state, and loombot does not know it. It lives in loombot's page because your frame is sandboxed without
  `allow-popups`: a `target=_blank` link or `window.open()` inside your app opens nothing. If a page of
  yours must open a URL, ask the panel instead — `parent.postMessage({ type: "loom/open-url", url }, origin)`
  — and it opens a tab of the real browser for http(s)/mailto, with your frame left exactly where it was
  (the file viewer's markdown links do this since 2026-11-02; `client/conversation.js` is the listener).
- **On a phone (≤ 720 px) your app takes the whole screen under the top row**, which stays in view, so the
  way back (–) and the other tabs are always one tap away. Do not draw a close or back control of your own.

### An app with nothing to decide, a build step, and a page that follows your edits

The first real app ported to loom (a spelling-bee trainer: 5 Jinja2 pages, 14 ES modules, 107 JSON word
files) has NO agent decisions in it — timer, letter diff and spaced repetition are arithmetic in the page —
and its HTML is rendered by python3 into a build directory. Three flags cover that shape:

    await startWorker.mcp("bee", "deno", [
      "run", "-A", "<loom>/loom/library/building-a-loom-app/app_mcp.ts",
      "--dir", "build", "--build", "python3 render.py --out build", "--watch", "templates", "--watch", "static",
    ]);

- **No `rules.ts` and no `--rules`: STATIC.** Every browser event gets `{action: "reject", data: {event,
  reason}}` from the server and NO notification; `state()` says `static: true`. Do not write a stub
  rules module whose only job is to exist.
- **`--build` is all-or-nothing.** A failing build at start fails the start; on `publish` the result
  carries the last 40 lines of its output and the PREVIOUS version keeps serving. The full output is in
  the app log.
- **`--watch` makes the dev loop cost you no tool call**: the human asks in chat, you edit the source, the
  panel reloads. Debounced 300ms, coalesced, serialised with `publish` (never two builds at once; a change
  during a build is exactly one more). It NEVER notifies you — a failed cycle is a log line and
  `state().lastPublish`, and the old version keeps serving. So after an edit, check `lastPublish` (or the
  log) before telling the human it is live.
- **Build INTO `--dir`, and nowhere else in a watched tree.** Changes under `--dir` are ignored when there
  is a build, as are the state directory and the log, so `--watch .` does not trigger itself; a watched
  path inside `--dir` is refused at start. A build that writes a lock, a cache or a temp file elsewhere
  under a watched path WILL loop — found writing this feature's own test, whose lock sat in the root.
  (Python's `__pycache__` beside an imported module is one spurious cycle, then quiet.)
- **Rules are resolved at start, BEFORE the first build**, so `rules.ts` cannot be a build product; keep it
  in `--dir` by hand or pass `--rules`.

## Assets are cached by content, never by time

loombot serves every registered file with `cache-control: no-cache` and a strong ETag, the SHA-256 of its
bytes. A reload or a navigation revalidates each file and gets a 304 for anything unchanged, so a multi-page
app can share modules and css across pages freely, and republishing the WHOLE app to change one file is
cheap: only that file's ETag moves. Do not add version query strings (`app.js?v=3`) to force freshness —
loombot already guarantees it, and a query string defeats the 304s. There is no `max-age`, on purpose: a
stale `app.js` across a publish is the page-and-server drift registration exists to prevent.

**The version is what an open page is reloaded BY, and so it is the BYTES' number.** The panel reloads a
frame whose app's version moved (`client/conversation.js`), which is right for new bytes and wrong for
anything else — so a re-registration of the same files keeps the version it had (2026-10-25, card
t20261025-051703-9964). An MCP server is restarted by things that never touched a file, and before that rule
every such restart threw away what every open page of that app was showing.

**Types come from the extension, case-insensitively**: html, js/mjs, css, json/map, webmanifest, txt, md, csv,
xml, wasm, svg, png, jpg/jpeg, gif, webp, avif, ico, woff/woff2/ttf/otf, mp3/wav/ogg/m4a, mp4/webm, pdf.
Anything else — including a name with no dot — is `application/octet-stream`, which Chrome DOWNLOADS rather
than renders. A missing type belongs in `TYPES` in `loombot/apps.ts`, not in a `blob:` workaround. Not
supported yet: HEAD and `Range` requests, which matters for seeking in long audio or video.

## Make it LOOK like loombot: one line, and no colours of your own

    <link rel="stylesheet" href="/theme.css">

loombot serves its own palette there (`shared/theme.ts`), same origin as your app's assets, above the cookie
gate — so it works inside the panel's iframe and in a standalone tab, before first paint, with no JS. Then
spend the variables: `--bg --fg --panel --line --dim --danger-fg --notice --ok`, and `--str --kw --num --fn`
for code. Both shipped examples here do exactly that, and `Canvas`/`CanvasText` fallbacks on `body` keep a
page readable if the stylesheet ever fails to load.

**Do not write a hex code, and do not ask the browser which theme it is in.** An app that guesses will
sometimes guess differently from the panel around it: on 2026-09-24 the file viewer came up dark inside a
light loombot, because Firefox tells a framed document that its preferred scheme is its EMBEDDER'S used
scheme (Chromium tells it nothing of the kind, which is why only one browser showed the bug). The link
inherits both the variables and the `color-scheme` declaration, so there is nothing left to disagree about.
There is no theme toggle in loombot and an app must not invent one — see `foldApp` and `#appclose` in `client/conversation.js`.

## An app is FETCH-FIRST and has no socket

**Decided by Xiaohu, 2026-10-24 ("I want simple and efficient"), and it is the contract you write against.**
An app's DATA comes over the same carriage as its ASSETS: one `fetch`. There is no WebSocket in an app's page,
and there is no transport for a page to choose or to fall back to.

WHY IT IS THIS AND NOT A SOCKET, in one paragraph: a published app is served through a service worker at the
edge, whose scope covers `/d/<device>/a/<session>/app/<name>/` — so its HTML, its CSS, its `app.js` and its
DATA are one mechanism. Before this, the bytes had four carriages and the app's SOCKET had none: a socket
through the edge got a `101` naming a subprotocol the page never offered, and then 99 bytes it could not
answer (card `t20261024-000321-5391`, measured). An app that opens no socket cannot have that bug.

### The one call

The page asks its own app, at an address under its own document. `__event` is RESERVED: `registered.ts`
refuses it as a file name, so it can never be shadowed by one.

    async function ask(event, data = {}) {
      let res;
      try {
        res = await fetch("__event", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ event, data }),
        });
      } catch (e) {
        throw new Error((e && e.message) || "the app did not answer");   // never a bare network error
      }
      if (!res.ok) {
        let why = "";
        try {
          const said = await res.json();
          why = said && said.reason ? String(said.reason) : "";
        } catch { /* a refusal with no body is still a refusal */ }
        const err = new Error(why || ("the app answered " + res.status));
        err.status = res.status;        // 404 IS the app being over — see the next section
        throw err;
      }
      return await res.json();          // {action, data} — the frame a socket used to carry
    }

    // a read, and the whole of a page's start-up. EVERY call ends in these two handlers: a page that
    // swallowed a failure is a page that looks alive and answers nobody.
    ask("ready").then((frame) => draw(frame.data), unreachable);

`"__event"` is RELATIVE ON PURPOSE: the document is at `/a/<session>/app/<name>/` on the machine and at
`/d/<device>/a/<session>/app/<name>/` at the edge, and a relative URL is the same one in both. Do not build an
absolute one, and do not spell a host, a port or a device id — the page's own address is the only thing that
knows where it is.

THE ANSWER IS THE APP'S OWN FRAME, `{action, data}`, exactly what `ch.toBrowsers(action, data)` and a rule's
`actions` produced before. Your `onMessage` becomes a switch on `action` and nothing else changes: the drawing
half of an app is untouched by this.

### FAILURE IS THE ONLY WAY A PAGE LEARNS ITS APP IS OVER

`channel.ts` `unmount` writes `player_left` **while it is answering the request that caused it** — any frame
written inside a handler carries `reply`, which is what makes it that request's answer. So the farewell
reaches a page ONLY as the answer to its own Close/Quit. **`stopWorker`, a crash and the session ending leave
no frame at all**: the registration is gone, and the page's next `POST __event` is answered
`404 no such app: <name>` (`loombot/routes.ts`). A `503` is the third case and a DIFFERENT fact: the app is
still registered and nobody answered the event.

**A KILLED PROCESS IS THE ONE ENDING THAT TELLS NOBODY**, and it is why loombot reaps on its own: the app's
own socket closing is evidence a server died, and a registration that outlives it by `APP_REAP_MS`
(`loombot/routes.ts`) is dropped. A page sees the same `404` — it just arrives a few seconds later.

So a page has FOUR states and no more, and the difference between the last two is the status code:

    answering      a request was answered. Say NOTHING about the channel — that silence is the healthy
                   case's signature, and it is what keeps a page that never read from looking like one.
    thinking       the app answered `ack` (a decision it put to the agent), or a change is on its way. Draw
                   the wait from that `ack`; never hold the request open for a model.
    not answering  a 503, or the fetch threw. RETRYABLE: say it, and say when it tries again.
    over           a 404. TERMINAL: the app is not slow, it is gone. No retry, and one move offered.

**A 404 IS THE APP BEING OVER. A 503 IS NOT.** Draw them alike and a stopped app is reported as a temporary
fault: the file viewer said "Saving is not possible until it is back" and re-read every 15s for an app that
was gone until somebody started it again, and the task board said "the board below is the last read and stays
readable" about a channel that would never answer. That is the whole reason `ask` keeps `res.status`.

**WHAT THE PAGE DOES NEXT IS ONE MOVE, because there is only one**: the app has to be started again, and then
the page reloaded. Say that, and do not offer a retry that cannot land. **AND A BUFFER OUTLIVES THE APP**: a
page holding unsaved edits keeps them and says they were NOT saved, telling the person to copy them before
reloading — throwing a half-written file away because a _request_ failed is a different act, and the one this
contract forbids.

`example-ttt/app.js` `unreachable`/`ended` is the shortest copy of it. **EACH of the four shipped pages has
a test per status**, asserting the sentence a person reads AND whether a retry is scheduled:
`tests/app_ttt_page_test.ts`, `tests/app_viewer_edit_test.ts`, `tests/board_page_test.ts`,
`tests/app_tally_page_test.ts`.

### When it re-reads: one message, no protocol

An app has nothing to be pushed down, so a change arrives as **"look again"**:

    document.addEventListener("loom/app-changed", () => ask("ready").then(draw));

The PAGE says that, and the page is the only thing that can: it already holds the session socket, loombot tells
it an app has something to say (`loombot/routes.ts` `CLIENT_EVENT_APP`), and it posts one message into the frame
(`{type:"loom/app-changed", parts}`, no data, no id, no app name). The injected line `loombot` splices into
every app page turns that into the document event above, and validates both halves on the way in — so your app
never parses a message and never checks an origin. The one thing it carries is `parts`: the NAMES of the
pieces of the app's state that changed, and rule 7 of the page contract below is what to do with them —
**a page reads only the parts it is drawing, and a name it does not know means read everything.**

**A PUSH IS A REFETCH, AND THAT IS THE DESIGN RATHER THAN A GAP.** `workers.<app>.send({action, data})` still
does what it says — the app's `rules.action()` folds it into state, and every open page re-reads and sees the
new state. One extra round trip, and for a board the round trip is already open.

### What an app CANNOT do, said here rather than discovered

- **NO HIGH-FREQUENCY STREAMING.** A log tail, a canvas, a live cursor, a "typing" indicator per keystroke:
  none of these are reachable. A push is a refetch — one request down the tunnel per read — and the page only
  says "changed" when loombot has something to say. An app that needs 20 frames a second needs something else,
  and building it against this contract will fail slowly and blame the network. Nothing shipped needs it.
- **A DECISION IS NOT ANSWERABLE IN A REQUEST.** When a rule returns `null` the event becomes the agent's, and
  the fetch is answered AT ONCE with `{action: "ack"}` — "taken, and nothing to add" (`channel.ts`
  `answering`, which answers every request even when the app has nothing to say). The agent's answer then
  arrives as a re-read, which is why a page draws "waiting for the agent" from its own `ack` and never waits
  for the decision in the answer. The `503 … did not answer in time` after ten seconds (`app_channel.ts`
  `APP_CALL_MS`) is a DIFFERENT fact: the app never answered at all — a wedged or missing server — and a page
  must not treat it as one either.
- **AN APP IN ITS OWN TAB WORKS, AND HEARS NOTHING.** The worker's scope covers `/d/<device>/`, so a tab
  opened on an app's address loads and fetches as a framed one does — that is the capability the socket design
  could not give. What it does not get is `loom/app-changed`, because there is no panel to say it: such a tab
  is current at load and at every press a person causes, and stale in between.
- **NO SERVICE WORKER, NO APP.** A browser that cannot start one is told so IN THE PANEL and given no frame
  (`client/platform.relay.js` `assetUrl` refuses rather than producing a `blob:`), because a `blob:` document
  has an opaque origin and is a third kind of app — the one thing this design does not allow.

### The old contract is GONE, and both apps have moved

**Nothing opens a socket any more.** `task-board` moved first (card `t20261024-022904-fb60`, commit
`c9f4e20`), `file-viewer` followed in the same card, and with the viewer's page the last of it went: the
page token, the redial, the frame decoder and the page's half of the socket route are DELETED from
`loombot` rather than left serving nobody. `loom/library/file-viewer/src/app.js` is the fullest example of
the shape — it is the page with a dirty buffer, a save in flight, and a change that has to wait for a
person — and `example/app.js` beside this file is the one to copy for anything simpler.

If you are reading an app written before that, the conversion is four mechanical steps, and the tests are
what say whether it held: the data layer becomes `ask()` (one `POST`, one frame back), the old `onMessage`
becomes the answer's `switch`, `onopen`'s `hello` becomes one `send("hello")` at the end of the file, and
the `onclose`/`player_left` dead state becomes the `catch` on a failed request — **which must read the
status**: a 404 there is the app being OVER and a 503 is a channel to retry (see "FAILURE IS THE ONLY WAY A
PAGE LEARNS ITS APP IS OVER"). A `catch` that treats every failure alike is the bug that whole section is
about, and it shipped twice.

## The page contract: what a page must not get wrong

**This is what makes your page work when it is served from somewhere else** — which is what publishing an
app means, and it is why these rules exist now rather than later. **Both examples beside this file obey all
of them**, and the `catch` in each one reads the STATUS: a 404 is said as an app that is OVER and a 503 as
a channel that is not up yet, which is the difference between a page a person reloads and a page that
retries itself. Copy the board's `app.js` when the page holds anything worth keeping, and the tally's for
anything simpler.

**1. Build the address from `location.pathname`, NEVER from `location.origin`.**

    const ENDPOINT = location.pathname.replace(/\/+$/, "") + "/__event";

`location.origin` is the ONE fact a frame with an OPAQUE origin cannot give you: it reads `"null"`, and a
URL built from it THROWS before anything is sent (measured, headless Chrome, 2026-09-23). `pathname` is a
fact of the page's own URL and it survives that. It is also the seam publishing moves along: while loombot
serves your page, the page IS at loombot, so `pathname` reaches the app — and a publisher serves these same
bytes from somewhere else and supplies the page's address, which is why NO host and NO port may be spelled
in your code.

The same lesson is why a _scheme_ is never spelled either: `location.protocol` decides `https`/`wss` for
you, and a page that hard-codes one breaks behind a TLS proxy, a tunnel, or `tailscale serve`.

**2. Your credential is the SESSION COOKIE, and you do nothing to present it.** The browser sends it for
you because the page was served from the address it is asking. Nothing is spliced into your bytes, so there
is no token to read, store, hand on, or forget — and a page you navigate TO is an ordinary request that
carries the cookie like any other. (The app's OWN SERVER still presents `?player=<credential>` on the
player socket; that half is `channel.ts`'s business and nothing on a page touches it.)

**3. Never reach into `parent`, or into loombot's document.** `parent.document` is readable while your page is
same-origin and is `null` the day it is published, so anything built on it breaks on a configuration change
rather than on an edit. The two things that genuinely need the parent are done FOR you by the injected
line: a pointer down inside your page makes it post `{type:"loom/panel-dismiss"}` (it reports the press and
nothing else — it prevents nothing and swallows nothing, so your click handlers still run), and a change the
app has is posted in as `{type:"loom/app-changed"}`, which `routes.ts` turns into a DOCUMENT EVENT so your
page listens with `document.addEventListener("loom/app-changed", reRead)`.

**4. No placeholders, no build step.** The line is added as loombot serves the page, so the file in your
folder and the page in the browser are the same bytes plus that one line — there is no template to fill in
and no commit step to forget. (One exception, and it is about YOUR markup rather than loombot's: the injected
line is an inline `<script>`, so a page that ships a `Content-Security-Policy` meta with a restrictive
`script-src` must allow it — no shipped app does, so this has never bitten, but it is the one way the line
can be refused.)

**5. Say when your channel is down, because that is where the person is.** A request that cannot be
answered is the page's whole knowledge that something is wrong, and both examples say it the same way: the
`catch` on `ask` puts a `dead` class on `<body>`, dims the page and says what is wrong AND what it does
about it — the reload is the move for a 404, a counted retry is the move for a 503; any answer takes the
class off again, so a page that comes back is alive without a reload.
**AND SAY WHICH OF THE TWO IT IS**: a 404 is the app being OVER — `no such app`, so nothing is listening and
the reload is the only move — while a 503 or a failed connection is a channel that is not answering yet, and
only that one is retried. Four states, two of them faults, and the status code is the difference.
**Why it is not optional:** the strip that leads here draws ONE dot with two states — the app's channel is
up, or it is not, orange when it is not (`client/conversation.js`) — and it stops there. The person who
followed that dot arrives at YOUR page, and a page that keeps rendering a live-looking UI whose buttons
answer nobody is the same defect as a page re-reading a 401 for ever. Say it, dim it, and stop pretending
to be interactive.

**6. A page's state never gates another page's action, and never the agent's.** What is open, typed,
selected or half-done in one page is a fact about THAT page. So a change pushed to the app — the agent's
`show` in the file viewer, any action that reaches every browser — is NEVER refused because a page is
holding something. **The page that has unsaved work keeps it, SAYS that a change is waiting, and applies it
at the human's pace:** the viewer's page keeps its buffer, names the file the agent showed in its status
line, keeps the frame, and draws it when the person presses **Save** or discards the edit — which is the
whole of what the page has to build for it (a `pending` variable, one notice, one call where the buffer is
resolved).

**Why this is a rule and not a taste.** Measured in the file viewer on 2026-10-20, before this: with several
pages open, ONE tab's unsaved buffer refused the agent's `show` for every one of them, and a Close from a
clean page was refused on a dirty page's behalf — and a page that had CRASHED without saying `gone` refused
the agent for ever, in a sentence telling it to ask somebody who was not there. And the refusal was never
protecting anything: the person's text is ALSO a draft in `localStorage`, offered back on the next show, so
there was a copy the whole time.

The same rule, said from the other side: **do not make one page's undo someone else's brake.** An app that
wants a decision from the person asks the page holding the state, which is the only page that can answer.

**7. A change NAMES THE PARTS it changed, and carries ONE NUMBER for how new it is.**

    // what THIS page is drawing right now, and every part it has ever heard of (the board's, as an example)
    const KNOWN = ["list", "card", "shown"];
    const drawn = () => selectedId ? ["card", "shown"] : ["list", "shown"];

    function mustRead(parts) {
      if (parts === null) return true;                       // NAMES NONE: read everything you draw
      if (parts.length === 0) return false;                  // named, and nothing a page can see moved
      return parts.some((p) => KNOWN.indexOf(p) < 0 || drawn().indexOf(p) >= 0);
    }

    let held = null;                                         // the `rev` this page's last ANSWER carried

    document.addEventListener("loom/app-changed", (e) => {
      const d = (e && e.detail) || {};
      if (typeof d.rev === "number" && held !== null && d.rev <= held) return;   // the echo of its own save
      if (mustRead(Array.isArray(d.parts) ? d.parts : null)) read();
    });

    // …and in the ONE place answers arrive — for the viewer and the board, that is `answered(frame)`:
    if (typeof frame.rev === "number") held = frame.rev;

`parts` is **the NAMES of the pieces of the app's state that changed** — `["list"]` when the agent moves a
task between states, `["shown", "card"]` when it points a page at a task. `rev` is **ONE monotonic number for
the whole app**, which answers only "is this newer than what I handled". Split your state where it has its own
reason to change — the viewer's are `listing`, `file`, `cursor`, `shown` (`tree` became `listing` when the
tree screen did, card t20261026-023551-35ae — a rename is FREE in the safe direction, because a name a page
does not know is a read); the board's are `list`, `card`, `shown`
— and call `channel.named("list")` and `channel.touched()` where the change happens. A page reads only the
names it is DRAWING, and skips a change that is not newer than the number its own answer carried. Both fields
travel on every frame an app writes, answers and `ack`s included — which is what makes a save cost ONE
request instead of two: the answer to the page's own POST carries the number, so the push that follows the
same change is an echo.

**THE POINTER IS ITS OWN PART, and it is the rule that matters most.** Which card or file is on screen is
`shown`, and a status change names `list`, never `shown` — so a change to the data can never move a page off
what its reader is reading. That is not a rule to remember or a guard to write: the thing that would have to
move the page is not in the list of names.

**AND A NAME IS SAFE WHERE AN ACTION IS NOT, WHICH IS THE WHOLE POINT.** A name is a fact ("this part
changed"), and the reader treats a name it does not know as _changed_ — so the page that has never heard of
`q`, and the page older than your app, both read. The page also reads EVERYTHING IT DRAWS when a push names
nothing at all. So a forgotten name, a wrong name and an older loombot each cost a request; none of them can
cost an update nobody sees. An action would have been an instruction, and an instruction can be obeyed
wrongly — that is the difference, and it is why this is a list of names rather than a message.

**AND KNOW WHAT THE NUMBER CANNOT DO, so that nothing is built expecting more of it.** One number for the
whole app cannot certify WHICH PARTS a page already holds: when a part is named and the number is newer, the
page READS it. `rev` collapses duplicates and echoes — the same change announced twice, and the push that
echoes the answer you already have — and it licenses nothing else. That is why both fields exist and why the
names are never skipped on the strength of the number.

Every combination keeps working, and that is what makes both fields an OPTIMIZATION rather than a
requirement: an app that names nothing sends no `parts`, one that keeps no counter sends no `rev`, a page that
ignores both reads on every notice, and a loombot older than this carries neither — all of them behave exactly
as they did. **If you write your own app server**, call `channel.named(...)` and `channel.touched()` where the
change happens — never on a read, which changes nothing and therefore moves nothing. A rules app gets this for
free: `rules.ts` returns `parts` (`{"state": …, "parts": ["list"]}`) and `app_mcp.ts` puts them on the frame
and moves the number.

**8. THE LAST READ OUTLIVES THE DOCUMENT** (card t20261025-051703-9964, reported from a phone). Your page is
reloaded by something that is not a person finishing with it: the panel reloads an open frame when the app's
version moves (`client/conversation.js` `drawTabs`), and a restart of your MCP re-registers — so the reload
lands while somebody is reading. A page whose only copy of its data is a variable draws an EMPTY screen and
then asks a server to fill it, and when that request fails the report is "the app is not answering — retrying
in 8s" over nothing, which is exactly what a page that read an empty list looks like.

So keep the last read, and **PAINT IT BEFORE THE FIRST FETCH**:

    const MINE = /\/a\/([^/]+)\/app\/([^/]+)/.exec(location.pathname);  // the session and the app
    const KEEP = MINE ? "app:" + MINE[1] + ":" + MINE[2] + ":read" : null;

    function keep(data) {   // a successful read, and only one
      try { localStorage.setItem(KEEP, JSON.stringify({ v: 1, records: data.records })); } catch { /* full */ }
    }
    function remembered() { /* read it back, CHECK THE SHAPE, and null for anything that is not a read */ }

    remembered() && paintIt();   // first paint, from storage
    fresh();                     // and then the ask

Three rules make it safe, and `task-board/src/app.js` is the copy of it (the section "the last read, kept
across a reload"):

- **ONE KEY PER APP AND SESSION, from the ADDRESS** — `/a/<session>/app/<name>/` on the machine and
  `/d/<device>/a/<session>/app/<name>/` at the edge. A key that did not name the session would paint one
  session's data into another's page; a key that took the WHOLE URL would lose the read on every version
  bump, because the bump IS a new `?v=` on the same path.
- **WRITTEN ON A SUCCESSFUL READ AND NEVER OTHERWISE** — not by a failure, not by an empty answer — and
  replaced only by a newer one (the frame's `at`, if it keeps one), so two tabs of one app cannot make it
  go backwards.
- **A FAILED READ NEVER EMPTIES THE SCREEN.** The failure is said BESIDE the last read — the board's
  sentence is "the app is not answering (…) — retrying in 1s. The board below is the last read and stays
  readable." — and the rows stay. The same holds for a read the app answered and then failed: `rules.ts`
  sends `records: []` WITH its `error`, and a page that assigns that frame like any other has thrown away
  the one thing its reader could still see.

**AND KEEP THE VIEW WITH THE ROWS, because the reload is not only a version bump.** The panel re-points the
frame at the app's ENTRY page whenever the frame has walked away — and a fold and re-open goes through the
same `openApp` — so a page somebody was reading comes back as a NEW document by design ("the tab means show
me this app", `client/conversation.js` `openApp`). That reload is not a defect to fight; what must not
survive it is a page that forgot where it was. So the record carries, beside the rows:

    showing    which card is open — the app's own fact, restored only when the painted rows still hold it,
               and the card's BODY is still a request: what the detail draws until it answers is the row's
               own facts, which is exactly the state a click leaves the page in.
    expanded   which groups the human had open, so a restored list is the list they were reading.
    scroll     how far down — AIMED at on the first paint, and applied again after each answer until it
               lands, because a painted detail is the row's facts and is SHORTER than the card the read
               brings back. It stops the moment it is reached or the reader moves: a page that yanks the
               scroll out from under a person is the defect this rule exists against.

The board's page is the copy of all of it (the section "the last read, kept across a reload", and the
browser rig `test/browser-test/board_keeps_its_read.ts` measures a fold and a re-open end to end: the same
card, the same place, no answer needed for the first paint).

**THE VIEWER IS THE SECOND COPY OF THE RULE, and what differs is the SIZE** (card t20261025-061113-3784;
`file-viewer/src/app.js`, the section "the last read, kept across a reload"). Its read is BYTES — a whole
file, and for markdown its rendering besides — so the same shape carries a CEILING the board never needed,
and the ceiling is MEASURED, not guessed: `localStorage` is about 5 MB of characters for the whole origin
(`unsent-bytes-do-not-fit-in-sessionstorage`), and the records themselves were measured with the app's real
`files.ts` and `render.ts` — a source file at the server's own 2 MiB ceiling keeps to a record of 2,098,213
characters, a 457 KB markdown document to 1,532,672 with its rendering (the HTML is 2.2× its source), one
level of a directory tree to 2,772. The ceiling is `KEPT_MAX`, 2 MiB of characters — a record no bigger
than the biggest file the server shows whole, ~40% of the origin — and a read past it is not dropped
silently: the record DEGRADES to the path, the facts line and a `stale` note, and the page paints the
header and says the bytes were too big to keep while it re-reads. What that costs, measured: markdown past
~600 KB of source, and a source file within ~3 KB of the ceiling (the frame's own wrapper is the
difference). The same measurement is what the keep is FOR: the reload re-reads the whole frame — 10.5 ms of
server work for the 2 MiB source file, 238 ms for the markdown document (the rendering is the cost), plus
the frame itself on the wire — and the screen was blank for all of it, and stayed blank when the read
failed. Three more things differ, and none of them is the rule:

    key         the read key keeps the `@agent` suffix the page's DRAFT key strips (`app:<session>:<app>:read`):
                a draft carries the base hash it was made against and checks itself; a kept read has nothing
                to check itself against, so two agents' apps of one name must not share one.
    newer       the comparison is the app's `rev`, not a timestamp — the frame has no `at`. Captured at the
                ANSWER (`answered`), before the draw that keeps it, or the draw labels its frame with a
                rev an answer that landed mid-draw carried.
    paint       the paint goes through the page's own `draw`, which is ASYNC (the editor bundle imports on
                first text) — so "painted before the first fetch" is "STARTED before the first fetch": the
                header and the listing are synchronous, the text fills when the bundle lands, and the
                connecting line is said AGAIN after the draw, because the draw's own lines would have
                cleared it. And the paint runs at the file's END, beside the ask: a synchronous call from
                higher up reaches the page's own later declarations (`view`, `list` among them) in their
                temporal dead zone, which is the same throw the rule about `fresh` being last warns about,
                one section earlier.
    view        WHICH VIEW is up is the kept frame's own `kind` — a listing repaints as a listing, a file
                as a file, and the record holds no separate screen field to disagree with it (card
                t20261026-023551-35ae) — and the scroll is
                AIMED at after every draw of the same file — the board aims after each answer; the viewer
                aims after each draw, because a re-read of the file the reader is reading is the common
                case, and the editor fills async. A scroll write is DEBOUNCED TRAILING (one stringify of
                the whole record per pause — 2.5 ms at 2 MiB, measured), not once per 300 ms of a burst:
                at the board's 90 KB that distinction is nothing; at 2 MiB it is a hitch every 300 ms.



    notifications/app/event    a DECISION: the event, its data, and the state to decide with
    notifications/app/closed   the app is OVER — `by` says who: "user" (its own Close/Quit, on an app
                               that is not durable), "agent" (a rule answering your send), "channel"
                               (loombot is gone — a restart takes the registration and the tab with it,
                               and the app closes with it; starting it again once loombot is back is
                               the verb)

Answer the first through the tool the notification names — the app's own verb when it declares one
(`workers.tally.verdict({outcome, limit})`, `workers.board.move({square})`; an illegal answer is that
tool's error), or `workers.<name>.send(...)` when it declares none. Either way the page is waiting and
its own rules could not decide it.

**THERE IS NO NOTICE THAT NOBODY IS LOOKING, AND THE ONE THERE WAS IS DELETED (2026-10-20).** It was
`notifications/app/idle`, opt-in per app as `export const notifyWhenIdle = true`, and NO SHIPPED APP EVER
ASKED FOR IT — 2026-09-24, Xiaohu: "the mcp can decide whether or not notification is needed for each loom
app", and then "why do we want the file viewer to notify?" about the one app that had tried it. The reasons
apply to almost any app, so read them before you want one back:

- **zero browsers cannot be interpreted.** A tab switch, a folded panel, a reload and a person walking away
  are the same signal. loombot names the one case it causes itself and nothing else announces anything.
- **the cost is usually trivial** — a process of tens of MB in a session that lasts hours, and every app dies
  with its session anyway.
- **the notice costs a TURN**, and the most obvious action in that turn is to destroy something the human is
  still using. A viewer's owner did exactly that, off a tab switch.

**AND "IS ANYBODY THERE?" IS STILL A QUESTION YOU CAN ASK**, which is the part worth keeping: the server
stays connected whatever the pages do — a page is a request, and loombot closes nothing when one ends — so a
human who comes back finds the app they left, and `workers.<name>.state()` answers **`watching`** — true once a page has
spoken to this app, and null when nothing has. **THE `false` HALF IS GONE** (card t20261024-022904-fb60): it
came from loombot closing the page's socket when the last browser left, there are no browser sockets, so there
is no last one and nothing to see. A field that stays true for ever after the first page is still worth
asking — true means a person HAS been here — and it must not be read as "somebody is looking now". That is a
tool call, not a notification you wait for. **`stopWorker("<name>")` is the ONLY teardown**
(a global verb, not a member of `workers`): call it when you do not expect the tab back, and leave it running
when you do. Nothing behind an app may outlive interest in it — that is a rule about this PROCESS, and an
idle socket is not a process anyone waits on. The state is under `TMPDIR`, so a restarted SERVER resumes
rather than restarts within the same run.

**IF YOU REMEMBER ANYTHING PER PAGE, THERE IS NO CALL INTO YOUR APP AND NO PARAMETER LEFT TO TAKE ONE.**
`notifyWhenIdle` was that parameter, and it is DELETED (2026-10-20, with the `show` refusal it backed up):
nothing reads its answer, and `channel.ts` declares no such field. **AND ITS TRIGGER IS GONE TOO** (card
t20261024-022904-fb60): it fired when loombot closed the player socket because the last browser left, pages
have no socket, and loombot counts no browsers — so the departure it existed for cannot be observed at all.
A per-page fact therefore has to be re-stated by the page that owns it, on its next request, and nothing in
loombot can tell you that a person has gone. The file viewer needed it for one thing — a remembered "the page is dirty" left behind by a
page that vanished — and that fact is gone too: an unsaved buffer lives in the page's own `ask` cycle now
and dies with the page, so there is nothing to clear. Keep per-page state that a page can re-state, not
per-page state you must be told about.

`app/closed` with `by: "channel"` is the other one: the channel could not be re-established at all, so there
is nothing left to hold and `stopWorker` is the only sane answer. With `by: "user"` or `"agent"` the app
ended ITSELF — the tab is already gone and the process is exiting, so there is nothing to stop; start it again
if it is wanted.

## Two pages on one app: what an action reaches, and what a page keeps to itself

loombot delivers each page's event TO YOUR APP. What a rule writes back goes one of two ways, and which one
is decided by whether a request is open: a frame written while a page's request is being answered carries
that request's `reply` and reaches ONLY the page that asked; a frame written when nobody is waiting is a
PUSH, which loombot turns into "this app changed", and every open page answers it with a re-read. `send` is
the push shape — the agent's act folds into state and every open page re-reads, even when only one page is
looking.
When the event is a page's OWN act (a click, a scroll, a search box), that has three consequences worth
deciding out loud rather than discovering:

- **state is what a page syncs to.** Keep the selection in the app's state and hand it out with the frame
  a page connects with, so a late page, a reload or a swapped-back tab opens where the app remembers the
  person was. This half is not optional: an action is never replayed (that is the bug the board's
  `showing` was invented for).
- **a page's own act is usually NOT for the other pages.** Moving another page's screen under its reader
  is an interruption nothing takes back — the panel keeps no history — while the disagreement it leaves is
  bounded and heals: the state says what the app remembers without claiming to know what every page is
  drawing, and any page that reloads or refreshes comes back in step. The board chose this; the reasoning
  is in `task-board/README.md` (2026-10-09).
- **the exception is what the app IS.** If one value is the whole of what the app shows and its identity —
  the file viewer's file, whose name is the tab's label — then that value IS a thing to broadcast, and a
  page with something to lose says so instead of being redrawn (the viewer's dirty page keeps its buffer and
  says a change is waiting; it never REFUSES the push — the page contract's rule 6). Know which of the two
  your app has. And a per-page act needs no extra mechanism in a rules app either: the answer half above is
  already the reply to the page that asked — return the action and fold nothing into state. The viewer's
  `goto_anchor` is that from its own server — a scroll stays one page's while the file is state every page
  reads.

## Letting the person close it: the app draws its own control

loombot's top row is LAYOUT only (the apps menu, with – hide inside it); it never draws a close, because
only an app knows what closing costs (`loom-hq/docs/tracking/features/open/closing-an-app.md`). To loom an
app is just an MCP server it starts and stops, so an app that may be closed by its person draws the control
itself and ends itself. The
convention, so apps feel alike without loombot enforcing it:

**FIRST, WHOSE CLOSE ENDS WHAT (card t20261025-061114-f6b7).** A page's Close is an event, and what
answers it is the app — two semantics, and the registration carries the choice (`RegisterOptions.durable`
in `channel.ts`; `--durable` for an `app_mcp` app):

- **Not durable (the default; a game, a one-off tally)** — the tab IS the app. A page's Close ends it:
  the shape below, exit and all, and starting it again is the agent's verb.
- **Durable (`--durable`; the board, the file viewer)** — the app is a FIXTURE backed by records that
  outlive it. A page's Close DETACHES THAT PAGE: the page is answered `detached {reason}` and says so
  ("this page is detached; the app stays running"), while the server stays registered, the tab stays in
  the strip, and the next open of the tab needs nobody. Nothing is notified — a page going away is
  nothing at all. THE AGENT'S OWN CLOSE IS THE SAME UNDER BOTH: a rule answering a `send`, and
  `stopWorker`, end any app. Whether a durable app should even OFFER a close is a question for the tab,
  not the panel.

- **Where:** at the end of the app's own header or button row — the viewer puts **Close** after Edit/Save/
  Cancel, the tic-tac-toe example puts **Quit** after its game buttons.
- **What it is called:** **Close** for a tool that shows something (a viewer, an editor), **Quit** for a game
  or a session, **Done** for a task. An app that must not be closed by its person draws NOTHING.
- **Confirm only when something is lost — and on a durable app, nothing is.** The viewer asked (inline —
  the panel frame has no dialogs) only with unsaved edits; the board asks never, because its state is on
  disk. On a durable app a Close ends nothing, so it asks never; on a session app a close from one page
  ends the app for every page — but the check belongs WHERE THE STATE IS KNOWN, which is the page
  holding it and never another one: a close is not refused because some other tab is mid-edit (page
  contract rule 6), and the text there is not lost anyway, because the browser keeps it as a draft.
- **Notify BEFORE exiting, with one shape:** `notifications/app/closed {app, by, reason, text, ...your
  fields}` — `by: "user"`, `reason` your own words ("the Quit button"), `text` the sentence the agent reads.
  Before, because a notice still queued when the process exits is lost; the notice says WHY, and that the
  process went is loom's to report, not yours.

How, in the two kinds of app:

    rules.ts (app_mcp)      return { close: "the Quit button" }     from event: by "user"; from action: by "agent"
                            state is saved and actions sent FIRST, then the close; a send is answered first
    your own server         await ch.close("the Close button", { data: { file }, text?, by?, flush? })

`ch.close` (`channel.ts`) is a convenience, not contract: notify (and wait for it to be on stdout), then
`player_left` + socket 1000, then the `POST /app/unregister` that takes the tab out of the strip, then your
`flush`, then `exit(0)`. The example's Quit is ONE line of `example-ttt/rules.ts` and no server code.

**THE UNREGISTER IS EVERY ENDING'S, NOT THE CLOSE BUTTON'S** (card t20261026-194612-b639). It lives in
`unmount`, bounded at 2s, so a SIGTERM, a stdin close and a rule's close all tell loombot the app is gone
BEFORE the process ends — the order is the whole point, because the process that would have corrected the
registry is the one going away, and a registration left behind refuses the app's own name to every server
started after it ("it is already registered by MCP server ...") until loombot restarts. If you write an app
that does NOT come through `channel.ts`, end it the same way: announce, close, `POST /app/unregister`,
exit. loombot reaps what a killed process leaves (ten seconds after its socket closes), and a fresh server
of the same owner takes a dead one's registration over at once — but neither is a reason to skip the POST.

## Writing `rules.ts`

    export const initial = { count: 0, limit: 10 }         // used when there is no channel-state.json
    export function event(name, data, state) {             // REQUIRED in a rules module (no module: static)
      // return {state?, actions?}  -> MECHANICAL: handled here, the agent never hears about it
      // return {..., close: why}   -> and then END THE APP (a Quit button): see "Letting the person close it"
      // return null                -> a DECISION: one notification, and you are asked
    }
    export function action(name, data, state) {            // OPTIONAL — for a generic `send`, and only that
      // fold the agent's answer into state. The action NAME reaches no page: a frame with no request
      // waiting on it is a push, a push's name is delivered to nobody (`app_mcp.ts`, above `Handled`),
      // and the fold's state is the whole of what a page learns. Prefer a tool, below: a decision is a
      // request, and a request deserves a reply.
    }
    export const tools = [{                                // OPTIONAL — the app's OWN verbs
      name: "move", description: "...",                    // listed beside send/state/publish, as-is
      inputSchema: { type: "object", properties: {...}, required: [...] },
      run(args, state) {
        // return { ok: false, error }   -> THE TOOL'S ERROR: the agent reads it in the same call it
        //                                  made; nothing is applied, pushed or notified
        // return { ok: true, text, handled } -> applied, persisted and broadcast like any rule's result
      },
    ]
    // The tool is how an app gives the agent a VERB with the rules' own validation behind it: one rules
    // module, two audiences (the page's click and the agent's call through the same checks). An illegal
    // call is the tool's error and nothing else — never a frame the agent must wait for. AND A DECISION
    // IS A VERB WITH A REPLY: declare the answer as a tool (the tally's `verdict`, the board's `move`)
    // rather than teaching an agent to `send` a frame whose name reaches nobody. Generic `send` plus
    // `action` is the shape for an app that declares no tools, and for nothing else.

A plain Deno module with **no import of loom**, so it type-checks on its own and the directory can be
copied anywhere. Five things about it are worth knowing before you write one:

- **A state change and a decision are EXCLUSIVE, and a board is how you find out.** `null` means the agent
  is asked and NOTHING is applied — so one event cannot both commit something and ask about it. A game
  needs exactly that: the human's stone must appear now, and only then is there a position to ask about. So
  the page sends TWO events (`example-ttt/rules.ts`): `play` commits mechanically, `opponent` is the
  question. One extra request on a carriage that is already warm costs microseconds. The alternative — returning `null` on the
  click and applying both moves when the answer comes — makes the human's OWN move wait on a model, which
  is the exact failure this whole design exists to prevent.

- **A decision that CHANGES something needs a fold: its own tool, or `action` under a generic `send`.**
  Without one of the two, the channel and the page disagree: the agent raises the limit to 25, the page
  renders 25, and the next mechanical check still refuses against 10 — a bug that looks like the model
  lying. Both shipped examples fold through a tool they declare (the tally's `verdict`, the board's
  `move`), which gives the decision a reply in the call that made it; an app that declares no tools
  exports `action` and is answered through the generic `send`. ONE fold, whichever shape — never both.
- **An unknown event is not a decision.** Return an `error` action. Waking a model for a typo in your own
  page teaches it to debug your JavaScript one turn boundary at a time.
- **A throwing rule is not a decision either.** The server tells the page and logs it; it does not ask you
  to hand-answer a broken rule for ever.
- **One owner per rule.** `app.js` must not enforce the limit as well. The day the two copies disagree the
  page shows a number the channel refuses.

## Traps already paid for

- **STDOUT IS THE PROTOCOL.** The stdio spec: a server MUST NOT write anything to stdout that is not an
  MCP message. `app_mcp.ts` rebinds `console` to its log file before it imports your `rules.ts`, so a
  debug print in app code cannot kill the channel. Your log is `$TMPDIR/loom-app-mcp-<name>.log`, and it
  is the first place to look, because a mounted server's stderr may be discarded.
- **A refused socket handshake looks exactly like a slow one** — the socket simply never opens. A wrong or
  missing `?player` is a plain 401, and an unbounded wait for `open` hangs for minutes (`tests/authed.ts`
  records the four minutes this cost). Every wait for an open socket is bounded, here and in tests.
- **The credential is never yours to handle.** The player token is minted by loombot, handed back to the
  server that registered, and written nowhere — so there is nothing to leak and nothing to cache, and
  revoking it is stopping the server. (It was a `.player` file at 0600 in the app directory until
  2026-09-24, which meant anything that could read the workspace could play the app.)
  Never pass the loombot master token to anything: it would hand over every workspace.
- **loom never opens a browser WINDOW.** Starting the app shows it in the panel of a page the human already
  has open (above), and that is all; put the link in your reply for anyone who has no page open. An agent
  that opens browser windows while someone is working is hostile.
- **An ACTION is never replayed.** A push reaches the pages that are open at that instant as one "look
  again", and the panel shows ONE app at a time — so a "show this task", a "raise the limit", a "point at
  this file" pushed while the human is looking at another app is GONE from the page they are on, not queued,
  and the app looks broken from your side because `send` answers "sent" the moment the fold is done. Four
  `select`s in one afternoon
  opened a task on nobody's screen (2026-10-09, the task board). **What a page can be given LATER is
  STATE**: put the fact in your `rules` state, fold the page's own answer into it (`event(name, data,
  state)`), and answer the page's FIRST frame (`ready`) with it — then a page that connects late, reloads
  or is swapped back into the panel lands where the app thinks it is, and `state()` is what YOU read.

## Where the proof is

**`tests/app_e2e_test.ts` is the one that says the halves MEET** — real loombot (`serveRegistry`, a real
token, a real workspace, the real `?player` verification, the real broadcast), the real agent verb
`startWorker.mcp` inside a real turn, and a Deno socket carrying the session cookie as the browser. It
walks the seven steps of `loom-hq/docs/tracking/features/merged/loom-apps-as-mcp.md` and adds the delegation case: a
sub-agent starts the channel and the CHILD is the one woken.

**`tests/app_ttt_test.ts` is the BOARD example's own test**, and it is unit-level on purpose: the mechanics
are pure functions of a position, so a socket would add a process and two timeouts per assertion and prove
nothing more. It asserts the split as a FACT — across a whole game, `opponent` is the only event that ever
returns `null` — which is the one assertion worth copying into your own app's test.

`tests/app_mcp_test.ts` stays, against its fake route, and is not redundant: it localises a fault to the
server, and it is the only place that can assert the player socket's CLOSE CODE AND REASON
(`{code: 1000, reason: "player unmounted"}`) — the distinction between a clean shutdown and a process
that vanished, which loombot exposes to no client at all.

### What USING it found, which every green suite missed

Two bugs shipped through three green suites and were found by a human USING the app. They are the reason
two of the rules above are spelled the way they are:

- **The channel STAYS UP when the last browser leaves** (and dials back in if loombot closed it), because a
  server that went dead on that signal left a page that looked alive and answered nothing. **Nobody is told
  about it** — the `app/idle` notice that used to be the point of this close was deleted on 2026-10-20,
  because no shipped app ever asked for one. What you ask instead is `workers.<name>.state()`, which answers
  `watching`; and `stopWorker` is the answer when you do not expect the tab back. The test that was missing
  is the one that matters: a browser leaves, A SECOND ONE CONNECTS, and the app still works.
- **`channel-state.json` under `TMPDIR`, never `state.json` beside your files** — `loombot/apps.ts`
  owned that name while it refereed a board,
  and two writers on it corrupted each other with no warning from either side. The second writer is gone
  now (that board is `example-ttt/`), so this is history rather than a live hazard — kept because the
  SHAPE recurs: an app directory has several writers, and a filename is a claim on one of them.

### What the end-to-end test found, which two green suites did not

Three defects, each one a half that could not reach the other half. Worth knowing because each is the
shape of bug that only a whole-path test can see:

- **loombot relayed nothing.** `GET /a/<id>/app/<name>/ws` was the built-in board referee and only that:
  the page's `{event:"hello"}` came back as `{action:"reject", reason:"unknown event hello"}`, and the
  agent's `send` was rejected to the agent. It now relays — a player's frame to every browser, a browser's
  event to the player, and NOTHING is reserved: `move` was the referee's name until the referee moved out
  (2026-09-22), and a browser event with no player connected is refused at once rather than left waiting.
- **The notification arrived empty.** loom rendered any `params.data` with `String()`, which is right for
  a log record and deletes everything else: an app event reached the agent as `[object Object]` — no
  event name, no state, not even the tool to answer with.
- **A sub-agent's server belonged to the root.** Its log folder and its pushes both went to the root, so
  a parent that delegated an app was woken for every decision its child was given the app to make. A
  server now belongs to the worker that mounted it.
