---
name: task-board
description: Read when work has to outlive the sentence that asked for it — putting a task on disk, claiming one before starting it so two agents cannot start the same one, or handing a task to a sub-agent as a brief. Six verbs over one file per task, and a read-only page over the same records.
as_of: "2026-11-08"
---

# A task board that is a folder

Work that begins as a sentence ends up nowhere: nobody can see what is open, two agents start the same
thing, and a task handed to a sub-agent gets retyped instead of quoted. This entry is the smallest
thing that fixes that — a folder of markdown files, one folder per state, and six verbs over it.
Nothing in loom changes and nothing is installed: the module lives in this library, and the records
live in your working directory.

    await loadTools("board", "<the library root the prompt names>/task-board/tasks.ts")
    await tools.board.create({
      title: "The claim test fails one run in eight",
      why: "Two agents started the same task on 2026-10-05 because nothing owned it.",
      acceptance: ["the test fails before the fix and passes after it"],
      tags: ["reliability", "release:one"],
      source: { who: "the person who asked", words: "put it on the board" },
    })

In a loom checkout the path is `loom/library/task-board/tasks.ts`. That call writes one file,
`<dir>/open/<id>-<slug>.md`, and `ls <dir>/open` is then the list of what nobody has taken.

## The six verbs — and there is no seventh

Every verb takes the same optional `dir`, so one module serves a repo board and a machine-local one:

- `create({title, why, acceptance, source?, links?, tags?, owner?, worktree?, dir?})` — write one new
  task into `<dir>/open/`, making the folder if it is not there, and return the record it wrote, its
  `id` and `path` included. `why` and a non-empty `acceptance` are required, because the body is the
  brief. `acceptance`, `links` and `tags` are each ONE PARAGRAPH or an array of paragraphs: a single
  sentence is passed as it stands, and the record stores a list either way. `update` takes the same
  shapes, and it REPLACES a list rather than adding to it.
- `list({state?, owner?, dir?})` — the board as summaries (id, title, state, owner, worktree, created,
  updated, tags, path), oldest first, reading one state folder at a time. A board nobody wrote to is
  empty, not an error, and so is a state nobody has used yet. **The answer is `{ broken, records }`**,
  `broken` first — see "One unreadable file does not fail the board" below.
- `show(id, {dir?})` — one full record, from whichever state folder holds it, its WHY and acceptance
  criteria included: the brief, ready to quote into a sub-agent's task.
- `claim(id, {owner, worktree?, dir?})` — take an open task **atomically**: the record is renamed into
  `claimed/` with `owner` and `worktree` set, and a second claimer is refused with `ALREADY_CLAIMED`,
  whose sentence names `release` as the way out.
- `release(id, {owner, dir?})` — give a claim up, which is the ONLY exit a claim has: the record is
  renamed back into `open/`, `owner` and `worktree` are CLEARED (an open card that still names an owner
  lies about who is on it), and the notes gain ONE bullet saying who released it, in the order they had.
  `owner` is REQUIRED and must be the name the record holds, or the call is refused with `NOT_OWNER`:
  one agent must not be able to free another's card and have the same work started twice. A card nobody
  claimed is refused with `NOT_CLAIMED` rather than answered `ok`, because `open` is already the state a
  release asks for, and an `ok` to a call that changed nothing is the silence this module refuses
  everywhere.
- `update(id, {state?, title?, why?, acceptance?, links?, tags?, source?, owner?, worktree?, note?,
  dir?})` —
  change what has changed, and append a `note` (`{who, text}`) to the record's history. A new `state`
  renames the record into that state's folder, which is the only way a state changes.

The same functions are the module's exports, so a test or a script can

    import { claim, create, list, release, show, update } from ".../task-board/tasks.ts";

**One export belongs to the page and is not a verb**: `readBoard(dir)` returns every READABLE record,
full, read SYNCHRONOUSLY. A rule module cannot await `list`/`show` — `app_mcp.ts` calls `rules.event(...)`
with no await, so a promise it returns is neither a decision nor an answer — and an app whose rules
read a board must not grow a second parser to do it. `readBoard` is the same parser; only the
syscalls differ. `spec` does not document it, because nothing about it writes or decides anything.

Its argument is a DIRECTORY AND A STRING — `readBoard("./board")` — and that is the one export that
takes a bare string where the verbs take a bag, so a wrong shape is refused at BOTH edges rather than
read:
`readBoard({ dir })`, the shape `create`/`list`/`update` take, throws `INVALID` naming the string it
wants. `String({dir})` is `"[object Object]"`, which is a directory NAME the filesystem answers
NotFound about, so the bag used to come back as an empty board — measured 2026-10-09 on this repo's
board: 142 records for `readBoard(dir)` and 0 for `readBoard({ dir })` (t20261009-203105-2327).
`help(tools.board)` may not print this one at all (the module report is capped, and `readBoard` is the
export that falls off the end), so ask for it: `help(tools.board.readBoard)` prints
`board.readBoard(dir)`, which is the call.

THE MIRROR IS REFUSED TOO. A verb takes exactly the arguments its printed line names, so a positional
where the bag goes — `list(dir)`, `create(dir)` — and a bag where the `id` goes — `show({dir})`,
`update({id, title})`, `claim({dir}, {...})` — throw `INVALID` naming the shape they got and the call
they take. They used to be ANSWERED instead: `list(dir)` ignored the path and read the default `./tasks`
(a different board, with no error at all), `create(dir)` came back as `create does not take 0, 1, 2, ...`
(the string's own indices), and the id mistakes as `NOT_FOUND: no task [object Object] in ./tasks`
(t20261009-212755-a15a). `dir` must be a string in the bag too: `list({ dir: {} })` is refused rather
than read as a folder literally named `[object Object]`.

## One unreadable file does not fail the board

**A record the reader cannot parse is REPORTED, never fatal** (card t20260710-000000-0720). The reader
answers a `Board` — `{ broken, records }` — for `readBoard(dir)` and for `list({ dir })`, and `broken`
comes FIRST because a rendered answer should open with what could not be read:

    { broken: [ { path: "board/open/t20260710-000000-0720-a-note.md",
                  state: "open",
                  reason: "no front matter block — a record opens with --- and closes it" } ],
      records: [ /* the cards that DID read, full, oldest first */ ] }

One entry per bad file, `reason` naming the field so the fix is opening that one file: `no front matter
block`, `no id field in the front matter`, `no title field in the front matter`, `carries a state field;
the folder is the state`, `front matter line is not key: value: <the line>`, `cannot be read: <the error>`.
`list` prints the `broken` entries at the top of its answer; a page is sent them in the `board` frame and
says them in its note line; and `claim`, `create`, `show` and `update` keep working, because they read the
one record they were asked for.

**INCOMPLETE IS NOT BROKEN.** A card with no `tags`, no `links`, no `source`, no `owner`, no `worktree` and
no timestamps is still a card — those fields read as EMPTY, which is what a hand-written or migrated record
is. Only a file that cannot be a record at all goes to `broken`: no front matter block, an `id` or `title`
that is missing or not a string, a `state` field, or bytes nothing can read.

The CALL that names a bad record still refuses loudly (`show(id)` is `CORRUPT`, and its sentence carries
the reason), because a caller who asked for one card is owed that card: the blast radius of a wrong file is
that file, never the board.

## One record format, one folder per state

One file per task, at `<dir>/<state>/<id>-<slug>.md` with `<state>` one of `open`, `claimed`, `done`,
`deferred`, `dropped`: the library's own front matter convention, then the body a brief is made from. The lock a
claim takes lives in `.claim/`, beside the state folders and never inside one.

    board/
      open/
        t20261005-041253-baa3-docs-tracking.md
      claimed/
        t20261005-040310-98f6-agent-stopped.md
      .claim/
        t20261005-040310-98f6.lock          only while a claim is in flight

    ---
    id: t20261005-014121-b7c2
    title: "The claim test fails one run in eight"
    owner: ""
    worktree: ""
    created: 2026-10-05T01:41:21.000Z
    updated: 2026-10-05T01:41:21.000Z
    source:
      who: the person who asked
      words: "put it on the board"
    links: []
    tags:
      - reliability
      - "release:one"
    ---

    ## Why

    Two agents started the same task because nothing owned it.

    ## Acceptance criteria

    - the test fails before the fix and passes after it

    ## Notes

    - 2026-10-05T02:10:00.000Z (agent-a): claimed in the worktree at /w/task-board

The state is the FOLDER and is not written in the file at all, so the two cannot disagree. A record
carrying a `state` field is refused at read time as `CORRUPT` rather than ignored: a second source for
one fact is a record that can lie about where it lies. `## Notes` appears only once someone has added
one. The id is the handle everywhere; the slug is for the reader, and `update` moves the file when a
title changes.

**`tags` is the one optional field, and it is a LIST of scalars written the way `links` is** — a block
list, quoted like every other scalar, so a tag holding a colon (`release:one`) round-trips and a
hand-edited file stays readable. A record with no `tags` line READS AS AN EMPTY LIST rather than
failing, which is why records written before the field existed needed no migration; `create` and
`update` accept one paragraph or an array, and the writer emits `tags: []` for a record nobody tagged.

### One line of the body is structure, and everything else is content

A body line that begins at column 0 with `##`, a space and text is a SECTION — and that is the whole
of the body's structure. So the two ways a criterion can carry text that looks like one are the two
markdown itself has, and the writer emits both:

- A criterion's further lines sit INDENTED under its bullet, line break and all. A criterion holding
  an embedded `## SEQUENCING` line therefore keeps it — the indentation is what makes it content, to
  this module, to `deno fmt`, and to any markdown reader — and a criterion that is itself a list (a
  migrated doc bullet, or a numbered item) is written under the entry's bullet rather than after it,
  so the file never carries `- - **...`.
- A heading-looking line in the `## Why` PROSE has no bullet to sit under, so it is escaped:
  `\## SEQUENCING` is the text `## SEQUENCING`, and it is also what it renders as.

An earlier version lost the whole tail of a record this way — 32 of one record's 44 criteria — and
raised nothing. Records now come out `deno fmt`-clean as well, because this repo's pre-commit hook
refuses a file it would rewrite, and a board whose records cannot be committed is not a board.

## State changes are renames

The questions worth asking are answered by `ls`, without opening anything:

    ls <dir>/open/        what nobody has taken
    ls <dir>/claimed/     who is on what
    ls <dir>/done/        what landed

A state change is a rename — `update(id, {state: "done"})` here, `git mv` by hand — and git sees a
rename on its own. Nothing has to be kept in step, and nothing can be left behind: a record found in
`done/` IS done.

## Where the records go — the one trade-off

The default is `./tasks`, relative to the working directory: it travels with the repo, which is what
makes a board visible to two writers in the same checkout. `.loom/tasks` does not travel, and is right
for work that is machine-local. One format and one tool either way — the location is the caller's
choice, passed as `dir` on each call, and the five state folders are made inside it as they are needed.
The records are never written into the library.

Check the name before you trust the default. `tasks/` is an obvious word for other things — a benchmark
rig keeps its evaluation tasks under exactly that name — and two meanings in one folder read as one
broken board. The loom repo keeps its own records in `board/` for that reason. Pass `dir` on every call
once you have chosen, so nobody has to remember the default.

And every `.md` under a state folder is a record: a stray README beside them is REPORTED at read time as
a file with no front matter block, one entry in `broken`, and the rest of the board reads normally (it
used to stop the whole board — card t20260710-000000-0720). Write the explanation somewhere else anyway:
a board whose answer opens with a broken file is a board nobody trusts.

## Claiming is atomic, and its lock is not beside the record

`claim` takes the lock `<dir>/.claim/<id>.lock`, created with `O_EXCL` (`Deno.open`'s `createNew`), so
the kernel decides the race: of two or twenty concurrent claimers exactly one creates it, and the others
either wait for it or meet the state the winner wrote. The loser is told `ALREADY_CLAIMED` — a code,
with the current owner in the message — rather than being left to guess from prose. The lock is keyed by
the ID, in its own directory and never beside the record: the winner RENAMES the record into `claimed/`
while holding it, so a lock beside the record would be left behind in the folder the record just left,
which is a board nobody can claim from again. There is deliberately **no shared index file**: an index is
the one thing that would corrupt, and one file per task is the whole reason this can be atomic. A lock
left behind by a crash is taken as stale after a minute, and a live holder is waited for rather than
skipped (`BUSY` after five seconds).

And a claim has an EXIT, which is what `release` is for. The LOCK expires after a minute, but a claim in
a folder does not: a card claimed by an agent that died, was stopped or never started would say it is
being worked on for ever, and the workaround — move it to another state and back — reorders the notes.
`release` renames the record back into `open/`; the notes are the history and keep their order.

## When it refuses

Every refusal carries a code, so a caller branches instead of parsing prose: `INVALID` (a required
argument is missing, a state outside the five, or an `acceptance`/`links`/`tags` value that is neither
a paragraph nor an array of paragraphs), `NOT_FOUND`, `ALREADY_CLAIMED`, `NOT_CLAIMED` (a `release` of a
card nobody claimed) and `NOT_OWNER` (a `release` by a name the record does not hold), `CORRUPT` (a file
that is not a record, two records carrying one id, or a record carrying a `state` field), `BUSY` (another
writer held the lock too long), `EXISTS` (no free file name — not expected).

## The page: `board_mcp.ts`, `rules.ts`, `src/` and `assets/`

An agent can put ONE PAGE in front of a board, out of the same entry:

    await startWorker.mcp("board", "deno", [
      "run", "-A", "<the library root the prompt names>/task-board/board_mcp.ts",
      "--board", "board",          // optional: `board/` under the CWD is the default
    ]);

`board_mcp.ts` is the app's server and writes none of it: an app IS an MCP server that registers its
page with loombot, and that server already exists. So this entry IMPORTS
`../building-a-loom-app/app_mcp.ts` WHERE IT STANDS — copying it would leave the `./channel.ts` it imports beside itself dangling — and adds
this entry's own layout as DEFAULTS: `--dir <entry>/assets`, `--app board`, `--rules <entry>/rules.ts`. A
flag already on argv wins, which is what makes the call above the whole command.

`rules.ts` is the mechanical layer, and it is the whole reason a page turn is never a turn of the
agent's: it reads the board by importing `tasks.ts` BESIDE IT — one parser, no second implementation of
the record format anywhere in a browser — and answers `ready`, `reload` and `refresh` with every record
in one action. There is no event that writes a RECORD. Claiming a task and changing its state stay with
the agent (`claim`/`release`/`update` above), which is also the repo's own lesson: loombot refereed a board
once, and two writers corrupted one state file in silence.

**The one thing it remembers is WHICH TASK IS SHOWING**, and that is what makes the panel follow the app
instead of following the last action: a `select` reaches whoever is connected at that instant and is never
replayed, so a task pointed at while the human had another app in the panel used to open on nobody's screen.
The fact now lives in the app's state and travels BOTH ways:

    await workers.board.select({ id })      // the agent points — checked against the board, opens it AND remembers it
    await workers.board.refresh()           // the agent moved a RECORD: every page re-draws a fresh read, NO version bump
    a click on a row in the page            // the human's own choice: sends `showing`
    (await workers.board.state()).data      // ...and `showing` is what the app remembers

*** THE AGENT'S DOOR IS THE APP'S OWN TOOLS, AND AN ILLEGAL CALL IS THE TOOL'S ERROR (1aeb; card
t20261024-183002-8072, audit 097b). *** `rules.ts` declares `select({id})` and `refresh()` as the app's own
mcp tools (`AppTool[]`, the way example-ttt declares `move`), registered beside the three GENERIC tools every
app_mcp surface carries — `send`, `state`, `publish`, which is the whole surface an app that declares NO
tools is left with. A tool's run goes through the same `readBoard`/`remember` the page's own `showing` fold
takes — one rules module, two audiences — and the answer is the TOOL RESULT: an id the board does not hold
is `select`'s error, naming the ids the last read held, and NOTHING moves (no fold, no frame, no parts
broadcast, no notification); a board that cannot be re-read is `refresh`'s error, and the pages keep the
read they have. The generic `send` stays on the surface and is NOT the door: its answer ("sent select to
the app; rules.action folded it into state") is written before anyone asks what the fold did.

*** AND `refresh` IS NOT `publish`, WHICH IS THE ONE MISTAKE THAT COSTS A READER THEIR SCREEN (Xiaohu, 2026-10-20,
with a screenshot: "task 更新后看板会空掉，我必须点击刷新按钮才能重新显示"). *** `publish({})` RE-REGISTERS the app —
it bumps the version, every open panel reloads its page, and a reload MINTS A FRESH PLAYER CREDENTIAL, so there
is a window where the page is up and its first read has not been answered yet. A page asks for the board the
moment it loads, nobody can answer in that window, and THE BOARD STAYS EMPTY UNTIL SOMEONE PRESSES REFRESH. Use
`publish` when the app's BYTES change (a UI edit) and `refresh` when a RECORD does; only one of them is a code
change, and only a code change has any business reloading the page.

**THE PAGE HAS NO SOCKET, AND BOTH OF THOSE REACH IT AS A RE-READ** (card t20261024-022904-fb60).
The page asks its own app one question at a time — `POST __event` under its own address — and the answer is
the frame it draws. So `select` is not a frame the page receives: the tool folds it into STATE
(`remember` — the same fold a page's own `showing` takes), loombot tells the panel the app said something, the
panel posts one message into the frame, and the page reads again — the same `board` frame, now carrying the
new `showing`. `refresh` is the same shape, and it is why neither of them is a code change. One consequence
to know rather than discover: an id that is NOT on the board is `select`'s ERROR, said to the agent that
made the call and to nobody else — nothing is applied, nothing is pushed, and the card a person was reading
simply stays. The page still says `no task <id> on the board that was last read` for its OWN paths (a link
in a record, a pasted address, a Back): two audiences, two channels.

Every `board` frame carries `showing` beside the ROWS, which is the whole of how a page that connects
LATE, reloads, or is swapped back into the panel opens the same task rather than the list. A selection that
is not on the board is not remembered: the id is checked against `board/` when the app is told, from either
side. `state()` answers the other half of "has anyone been looking" too — `watching` is `true` once a page
has spoken to the app and `null` before that, and there is no `false` (card t20261024-022904-fb60: a page
is a request, loombot counts no pages, and the close that used to say the last one left went with the page's
socket). `live` is the different fact: it is about the socket to loombot, and that stays up while nobody is
watching.

**A CLICK IN ONE PAGE DOES NOT MOVE ANOTHER PAGE**, and that is a decision rather than an omission (card
t20261009-193432-d5f1; the `showing` event above answers with no action for exactly this reason). It is
also not a move a rule HAS: a rule's frames are ANSWERS to the request that produced them — each carries
that request's `reply` id and reaches the page that asked — so the only frame every open page answers is a
PUSH, which is the agent's `select`/`refresh` and never a rule's reply. (The two kinds of frame are stated
once, where `rules.ts` documents its `event()`.) What follows is why it would not be wanted even if a rule
could do it — it would move every page to the task one reader just opened:

- **a second page is not a stale copy of the first.** The panel shows one app at a time, so a second page
  is one somebody opened ON PURPOSE elsewhere — another device — and the two
  are two readers at two places. Moving one of them mid-read is an interruption with no way back (the
  panel keeps no history), and it makes a second tab useless for holding a second card at all;
- **what it costs not to is bounded, and it heals.** `showing` is what the app REMEMBERS — the last place
  a click, an agent `select` or a pasted address pointed — not a census of what each page is drawing, and
  both of its jobs still hold: a page connecting late opens it, and `state()` tells the agent where the
  human was last taken. Any page that reloads, reconnects or hits Refresh syncs to it;
- **the two directions are deliberately different.** The AGENT's `select` reaches every page, because
  pointing the page at a task is the agent's act, not a reader's — the tool folds it and every page
  follows; a `refresh` re-reads the board for all of them for the same reason. A reader's click is the
  reader's;
- **the honest cost**: two pages can show two tasks while the state names one. The FILE VIEWER answers the
  same question the other way, and the difference is what each app IS: there, the file on show is the
  app's identity — the tab is titled after it, so two pages showing two files are two tabs lying about
  what this is — while a card open on one page of a board is a reader's place inside a document.

`src/` holds the hand-written half (`index.html`, `app.js`, `board.css`) and `assets/` is what `deno task build` writes from it — what `board_mcp.ts` registers: grouped by state with open and claimed expanded and the older
states one click away, a search over id, title and body, and a click for the detail — title, why, the
acceptance criteria, links, tags, owner, worktree, where it came from and the two times. The page reads
nothing itself, keeps no index and no cache, and draws the selection from the frame: `board/` is the only
store of the records, and Refresh re-reads it.

**THREE REQUESTS, BECAUSE THE LIST MUST NOT CARRY THE CORPUS** (card t20261024-052218-0bb3). Measured on
Xiaohu's own board on 2026-10-24 — 164 cards, 1.5 MB of text, of which the FRONT MATTER is 4.6% — every
re-read sent every card's body, and a click did not ask for a row: `showing` folded the state and the page
drew the detail out of the frame it already had. So a re-read cost 1,977,123 bytes on a 259-card board and
93.8% of it was text nobody had opened. The three reads now:

    board    `ready`/`reload`/`refresh`   a ROW per record: id, title, state, tags, owner, worktree,
                                          updated. No `why`, no `acceptance`, no HTML, no `path`.
    card     the page opens one            THAT card, whole — rendered beside its own text (`rendered`).
    search   the page types                the IDS that match the query, from `matches` over the record
                                          read off disk: the filter still reaches the BODY, which is on
                                          this side of the wire.

WHAT THAT COSTS, stated because it is not free: one request per card opened and one per narrowing keystroke,
and each of them a synchronous `readBoard` — measured at 19-31 ms for 259 cards (81-126 ms with the machine
at load average 34), against the old frame's 247-289 ms, which also RENDERED every one of the 259 bodies. So
the list's frame is now 34x smaller AND about 8x cheaper to build. A cache keyed on mtime and size would make
the re-reads cheap as well and it is deliberately NOT here: the server still re-reads every file per re-read,
it is independent of the bytes on the wire, and two changes in one commit cannot be measured apart. The page keeps what a row draws, plus the one card it opened and the ids
of its current query — never a corpus nobody asked for.

**A LINK IN A RECORD IS TEXT, AND A CLICK THAT NAVIGATES HAS NO WAY BACK.** The board is served into
loombot's app panel — a sandboxed frame — and a link there is not an ordinary link. Measured in headless
Chrome on 2026-10-09, against a frame with that exact `sandbox` attribute: a RELATIVE href pressed inside
the frame navigates the FRAME ITSELF, and so does an ABSOLUTE `http(s)` URL (an absolute URL is not the
safe half of this); `target="_blank"` opens nothing at all, because the sandbox has no `allow-popups`; and
loombot's tab strip does not reload a frame it already has, so the panel offers no way back. So the page
draws every link value as TEXT a reader can copy, and the ONE value it makes clickable is a value that
names a task on the board: that opens the task's detail in the page, through the same path
`action: "select"` takes, and touches no location. Nothing on the page follows a URL: the panel's **↗**
item, which loaded the app in its own browser tab, was deleted on 2026-10-24 (card t20261024-open-in-tab)
and nothing replaced it, so the value stays text, to read and to copy.

**To put the person in front of one task**, point the page at it:
`await workers.board.select({ id: "<the task id>" })`. The detail opens as a click on the row would — the
fold is the same `remember` the click takes — and the call replies `showing <id> — <title>`: the app
REMEMBERS it, so a page that is not connected right now opens the same task when it arrives. An id the
board does not hold is the call's ERROR, naming the ids the last read held, and nothing moves: read the
ids, pick again, call once more in the same turn.

**The same card can be HANDED OVER as a URL**, which is the only move for a person who is not looking at the
panel: the page's own address takes `?id=<task id>` (`#<task id>` is read too), so
`page + "?id=" + id` opens the app AT that card — its group expanded and its detail showing. `page` is what
`(await workers.board.publish({})).data.page` hands back — the only call that returns it — and it is worth
taking ONCE and keeping: a publish re-registers the app (the warning above), the URL is the app's name and
survives every publish, so a second hand-over needs no second publish. That address is a VIEW of the same
selection the paragraph above sets, not a second
one: `select` wins over it, every change of the selection is written back (`pushState` for a card a human
picked, `replaceState` for one that arrived), and Back and Forward move between cards. What writing an
address inside the panel's frame is allowed to be — and the assignment to `location` that is not an address
write but a document load — is measured in `src/app.js`.
**The app lives exactly as long as its server, and nothing restarts it for you.** After
`stopWorker("board")`, the page's own Close, or the session ending, start it again with the
`startWorker.mcp` call above — or ask, and the agent does.

## This tree is read-only

The system library is read where it lies, and this module never writes beside itself: the records go
where the caller names. To change the module, copy this folder into your personal library — by default
under your home directory at the `.loom` library path, or wherever a `--library` flag points — and edit
that copy; the system tree itself is replaced when loom is updated.
