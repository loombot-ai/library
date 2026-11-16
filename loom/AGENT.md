---
name: library
description: Read before adding, editing or deleting anything under loom/library/ - the root README.md that every agent's prompt pastes in whole, the two entry file names (README.md for using an entry, AGENT.md for changing the thing beside it) and the rule that a folder is an entry, the front-matter trap that eats the key after a description while fmt still says Checked, how the prompt and search LIST this tree, the programs beside the entries (the task board, the file viewer, the two browser helpers), and what to run before calling a change here done.
as_of: 2026-10-21
---

# `loom/library/` — the system library, and the contract it is read through

**This directory is not documentation beside the code. It IS the code**: the tree every agent's system prompt is
built from, and the tree an agent starts programs out of. The map of the harness around it is `loom/README.md`
and `loom/AGENT.md`; what is here is what a change INSIDE this tree has to know.

Two readers, two different rules, and they are not the same code — get them straight before adding anything:

| reader                                         | what it sees here                                                                                                              | today                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| the PROMPT and `read(<folder>)` (`subEntries`) | depth 1, DIRECTORIES only, ONE ROW PER ENTRY FOLDER (`path · name · description · as_of`); the root's `README.md` pasted whole | 22 rows, re-measured 2026-11-08 |
| the DOCTOR (`loadEntries`)                     | depth 1, DIRECTORIES only, counted per root into `report.json`                                                                 | 22 entries                      |
| `search` (`entryOf`)                           | any file named README.md or AGENT.md that OPENS WITH FRONT MATTER, at any depth                                                | 23 files                        |

- **`_removed/` IS RETIRED, AND SINCE 2026-10-20 NO READER OF THIS TREE READS IT** (closed by the
  2026-10-20 cleanup pass). The listing always missed that
  folder, but only BY DEPTH: `subEntries` lists the depth-1 FOLDERS, and a folder of RETIRED entries holds no
  entry file at its own top. `search` did not agree - `entryOf` recognises an entry file at ANY
  depth, so measured 2026-10-19 `search(["quoting inside repl code"], { in: loom.libraries })` returned
  `_removed/quoting-inside-repl-code/README.md` as a RANKED ENTRY. An entry is read BEFORE acting, so that is
  a retired instruction handed to an agent with no way to know it was retired: worse than no entry. The walk
  in `loom/search.ts` now skips a directory named `_removed` WHOLE, so the listing, `search`, the inventory and
  the doctor cannot disagree again, and `loom/repl/verbspecs.ts` says so in the description the model is told.
  **The way back in is a PATH** - `read()` and a shell - which is what the `REMOVED <date>` tombstone in a
  retired entry's own `description` is for. Pinned by `tests/search_test.ts` ("a retired entry under
  `_removed/` is neither an entry nor a hit line").
- **A new FOLDER here is advertised in EVERY request, forever** (`subEntries`, `loom/library.ts:530`); **a bare
  FILE here is not** — this file, `loom/library/AGENT.md`, appears in no prompt listing, and neither does the
  root `README.md` twice. That is why the listing is capped at depth 1: it grows with categories, not with the
  total number of entries.
- **The standing cost is the DESCRIPTIONS**, not the entries. The 2026-09-22 review measured the tree at 9
  entries / 998 lines / 59.5 kB / about 1,850 tokens a run; today (2026-10-21) it is 21 entry folders / 22
  entry files / 55 files, with 5,402 characters of description. **Re-measure, do not quote the old number.**
- **`AGENT.md` sits beside the code it is about** (`loom/entry_files.ts:10`, with README.md and README.md): it is
  found by `search` and never appears in a library root's listing (`loom/library.ts:101`).
- **This file's own name is `library` and so is the root `README.md`'s**, so `search({ in: "loom/library",
  depth: 1 })` returns two rows whose `lib.name` is `library`. Not a bug, and not an accident of this file: read the path. The
  `README.md` is the always-inlined guidance; this file is the contract for changing the tree.

## Editing the root `README.md`

- **Its search sentence is pinned VERBATIM.** `tests/library_test.ts:417` holds it as the `ARM_LS` constant and
  the test at `:419` asserts the prompt line EQUALS it, with no `{{ROOTS}}`-style placeholder, no `grep -rils`
  and no `readLib`. **Rewording it is a new measurement, not an edit.** To add a trigger, change the sentence
  ABOVE it (the `Consult it before …` line), which is not measured — that is how the 2026-10-11 trigger was
  added (+41 bytes, `tests/library_test.ts` green). It was reworded once, deliberately, on 2026-10-19,
  because the sentence has to name what `search` can be pointed at AND its boundary.
- **The measurement behind it is `library-grep-measurement`** (personal library, 2026-09-27): a four-arm study,
  read-target 25/30 (arm a, no instruction) against 30/30 (b2, the grep sentence, and c, a `readLib({search})`
  prototype), pass 27/27 against 24/27, $0.254 against $0.173 a trial. Its DECISION — ship the grep sentence and
  build no search verb — is superseded: the tree ships `await search([...], { in: loom.libraries })` now, and
  the test above asserts the grep command is gone. Every address its evidence names is dead in this checkout:
  no branch matches `exp/libmeasure`, `git ls-tree eb3c560` answers `Not a valid object name`, and neither
  `tools/libmeasure/` nor `docs/tracking/findings/library-grep-measurement.md` exists. **The numbers stand as the
  record; the rig cannot be re-run from here.**

## What makes a file an entry, and the trap that has cost the most

- **Front matter is what makes a file an entry to `search`**: `entryOf` (`loom/search.ts:411`) returns undefined
  without a block, so a `README.md` with no `---` is an ordinary markdown file and will never be found.
- **ONE reader for every caller**: `loom/front_matter.ts` (`@std/yaml`, `schema: "core"`). It replaced three
  hand-rolled readers that had drifted — two of them answering a quoted description differently. The task board
  keeps its own `parseFrontMatter` (it must run where the dependency is not), and its two known divergences are
  pinned in `tests/front_matter_read_test.ts`.
- **THE TRAP: a colon-space inside a `description` value.** Measured 2026-10-19, step by step: `deno fmt --check`
  FAILS on the bytes as written (`Found 1 not formatted file`), `deno fmt` then INDENTS the following keys under
  the description, and from there the same check prints `Checked 1 file`. Parse the formatted file with the one
  reader and `as_of` and every key after it are GONE — `frontMatter()` returns `name` and `description` alone,
  with no error anywhere in the pipeline. Keep the sequence out of the value, or quote the whole value.
- **was, until 2026-10-19, the only automatic proof the block parsed is the read-back**:
  `search({ in: "loom/library", depth: 1 })` must return a ROW for the file whose `lib` carries its `name`, its
  `description` and its `as_of` as `asOf` (`lib` is `null` on a file that is not an entry). Nothing else notices.
- **A folder holding both `README.md` and `README.md` is legitimate** and BOTH are read and listed (one line
  each, same `name`). The folder stays the unit of naming.

## Writing an entry, and where it goes

- The name is usually the folder's; **the description is the line that gets listed** and has to read as _when to
  read this_, not as a title; `as_of: YYYY-MM-DD` belongs on a fact about the world.
- **`keywords:` is the field for the word a READER would type**, and what it buys is RANK: `search` matches
  file TEXT literally, so RECALL was never the gap — the reader's word is not
  the prose's word (presence / heartbeat / liveness / 心跳 are one subject, and an entry about presence says
  only the first). The entry ranking weighs `name` (6) > `keywords` (4) > `description` and headings (3) >
  body (1), so the field is how the entry a word is ABOUT outranks an entry that mentions it in passing.
  `frontMatterList` (`loom/front_matter.ts`) reads a YAML block list, a flow list AND a comma-separated
  string; the comma form is ONE line that `deno fmt` leaves exactly as written, which is why this tree uses
  it.
- **ONLY INTERNAL REPETITION IS REFUSED** (owner's correction, 2026-11-07). A subject word MAY repeat the
  body's prose — that repetition is the whole point, and the stricter "a keyword must not appear in the body"
  never shipped and must not come back. Two guards, both in `keywordProblems` (`loom/library.ts`) through
  `frontMatterProblems`, so the suite (`tests/library_keywords_test.ts`) and the pre-commit tool
  (`tools/entry_front_matter.ts`) refuse the same thing: the same word twice inside the field, and a copy of
  the entry's own `name` — the name already ranks above every keyword, so a copy adds nothing, and an EXACT
  repeat never reaches the guard because `frontMatterList` folds it into one word. It is NOT in
  `FRONT_MATTER_FIELDS` — that list is the one-line fields, and a list reads back as `""` there. **Most
  entries get none**: a keyword every entry carries stops distinguishing anything.
- **A CJK keyword is ONE TOKEN on both sides**: `tokens()` (`loom/search.ts`)
  split on `[^a-z0-9]+`, so `心跳` tokenized to `[]` — `search(["心跳"])` found its rows and ranked none of
  them, while `search("心跳")` ranked them 5, 1, 1. The split is `[^\p{L}\p{N}]+` now, and a CJK word is
  never split into characters.
- **A run writes into the PERSONAL root (`~/.loom/library`), not into this tree.** This one is edited with the
  code, and a change here ships to every agent. The full statement of the two kinds and the layout rule is
  `loom/library/README.md` itself — read it before re-writing it.
- **When the thing a lesson was about has been fixed, the entry is DELETED**; a refutation belongs in the
  `AGENT.md` for the code it was about, with the dated evidence left where it is. That is what the tail of this
  file is for.

## The programs in this tree (they are not entries)

`file-viewer/` (`viewer_mcp.ts`, `render.ts`, `files.ts`, `src/`, `assets/`, `vendor/`), `task-board/` (`tasks.ts`,
`rules.ts`, `board_mcp.ts`, `src/`, `assets/`), `building-a-loom-app/` (`app_mcp.ts`, `channel.ts`, `example/`,
`example-ttt/`), `browser-for-online-tasks/` (`safari.ts`, `chrome.ts`),
`writing-a-tool-module/example.ts`, `writing-payloads-in-repl-code/payload.ts`, `mcp/`
(`library_mcp.ts`, `wire.ts`, `share.ts` — the public library's `list`/`get`/`sync`).

- **They are launched by agents**, from these paths: `viewer_mcp.ts` (the file viewer), the task board's and the
  app server's MCP processes the same way. That is why the path matters more than the prose around it.
- **The trees are read IN PLACE, on every layout**: a checkout, `deno install` and the shipped bundle's
  tarball all carry `loom/library/` as real files, beside the rest of `loom/` that these programs import
  from. That on-disk-ness is load-bearing: an agent starts `viewer_mcp.ts` with `deno run`, and a child
  process can only open real paths - a path inside a `deno compile`d artifact's embedded filesystem is
  readable by the artifact's own Deno and by nothing it SPAWNS, which cost the viewer and both servers a
  `Module not found` on a release before that flavour was deleted (`docs/release.md`). Nothing copies this
  tree, and nothing may: `tools/package.ts` `RUNTIME_FILES` is the list of what ships.

- **A NEW PROGRAM IN THIS TREE IS THREE GATES, AND ONE RUN FINDS ALL THREE** (measured 2026-11-08, adding
  `mcp/library_mcp.ts`): (1) `tests/system_programs_test.ts` walks the program's real VALUE-import graph and
  reds on any `loom/` file `tools/package.ts` `RUNTIME_FILES` does not carry — a bundled release answers
  `Module not found` for it, so the choice is "add the file" or "do not import it", and importing a big module
  for one three-line helper is the wrong side of that trade; (2) `tests/rollout_surface_test.ts` requires the
  entry folder's own `README.md` to be listed in the prompt, and the listing's bullet is the front matter's
  `name` — so a NEW entry's `name:` must EQUAL its folder name (`name: mcp` for `mcp/`), or the prompt holds a
  bullet the test cannot find; (3) the entry file needs `name`, a `description` that OPENS with "Read when"
  and an `as_of`. The gates are named rather than the fix, because the same run will find whichever of the
  three a new program happens to miss.

- **`browser-for-online-tasks/{safari,chrome}.ts` are excluded BY NAME from `deno check`** (plain JavaScript in a
  `.ts` file, which `loadTools` imports dynamically). `tests/check_tree_test.ts` asserts each exclusion still
  exists and still fails `check`; the typecheck that makes every other file a root is `tools/AGENT.md`'s half.
- The file viewer's `vendor/` is the bulk of this tree (CodeMirror, vendored with its own LICENSE, lock and
  `build.sh`) — the model for "hand the format to the real library rather than hand-roll it".

## The task board, because six entries in this area are about it

- **The board IS the directory**: `DEFAULT_DIR = "./tasks"` (`task-board/tasks.ts:75`), passed as
  `--board <path>` to `task-board/board_mcp.ts` (the one flag worth passing). `board_mcp.ts`'s own header still
  says `board/` under the CWD — the records moved, the comment did not.
- **`claim()` is ATOMIC**, and its lock is `<dir>/.claim/<id>.lock` — keyed by ID and **NOT placed beside the
  record**, because the holder RENAMES the record into `claimed/` (`tasks.ts:11-14`).
- **HAND A CARD OVER AND CLAIM IT IN THE SAME BREATH.** The `claimed` group is the live picture of what is in
  flight; a board of untouched `open` cards while eight agents work is a lie the board tells by omission. It has
  failed twice, and the second time is why this is here: 2026-10-09 (nobody had ever claimed) and 2026-10-19
  (three cards left in `open/` while agents worked them — ef88, 1632, c662). Sweep BOTH directions before you
  stop: work in flight still under `open/`, and finished work still under `claimed/` (d4fc, d344, 1780).
- **A CARD OPENS IN THE BOARD APP; A FILE OPENS IN THE VIEWER.** `workers.board.select({id})` to the board
  worker is the agent's own action — the app's DECLARED tool (`rules.ts` `tools`); it is folded into the
  app's state, so calling it BEFORE a page is connected still works — `ready` hands the selection back. An
  id the board does not hold is the call's ERROR, naming the ids the last read held. Use the FULL id from
  `readBoard(dir).records`, never a remembered prefix. A viewer can see a record's markdown and nothing
  else: not its `state`, not its `links`, and editing one there bypasses the board's tools and the fmt judge.
- **The writer resolves its own config.** `formatRecord` / `configArg` / `upward` (`tasks.ts:578/587/609`) hand
  the whole record to `deno fmt`, walking UP from the BOARD for the config and passing `--no-config` when that
  tree has none — because a FILE argument makes fmt resolve from the FILE's tree while STDIN makes it resolve
  from the CWD, so writer and gate were reading different configs. Pinned by `tests/task_board_test.ts:1178`.
- **The shape guards exist because the wrong shape answers "empty".** `readBoard(dir)` is the one export taking
  a PATH while the verbs take an options bag, and `String({ dir })` is a perfectly good directory NAME, so a
  misplaced bag answered 0 records with no error. `optsBag` / `taskId` / `dirOf` (`tasks.ts:855/872/891`) refuse
  by SHAPE and name the call they want. **The tests assert a DISJUNCTION** ("refused OR the same board"), so a
  guard that is simply GONE still passes them: RUN THE MUTATION (4 for 4 on 2026-10-09, one filtered
  `deno test` each, about a second).

## What to run before calling a change here done

- `deno fmt <the file>` BEFORE `git add`. The pre-commit hook runs fmt on STAGED markdown, and hand-aligned
  tables are not what it produces — a commit that skips this is either refused or rewritten under you.
- `deno fmt --check` and `deno lint` over the tree.
- **The named tests**, by what you touched: loader, listing and front matter —
  `deno test -A tests/library_test.ts tests/front_matter_read_test.ts tests/library_read_test.ts tests/doctor_library_test.ts`;
  the board — `deno test -A tests/task_board_test.ts tests/board_page_test.ts`; the two browser helpers —
  `deno test -A tests/check_tree_test.ts`.
- **The read-back**: `search({ in: "loom/library", depth: 1 })` returns the changed file as an ENTRY with a name
  and a description.
- **A scratch script run from `$TMPDIR` against these modules dies `Import "@std/path" not a dependency`** —
  measured 2026-10-19 while writing this file. Deno resolves the config from the ENTRY FILE's own directory, not
  the CWD (the same rule `deno-fmt-and-markdown-facts` states for `fmt`), so run it as
  `deno run -A --config <repo>/deno.json <script>`, or keep the script inside the tree.

## Refuted, and where each one went

Each of these is a library entry whose fact is no longer what it says. THE RULE CHANGED ON 2026-10-20: an entry whose SUBJECT is gone is now RETIRED - MOVED to `~/.loom/library/_removed/`
with a `REMOVED <date>` tombstone in its `description` that names where each still-true piece lives - and an
entry that is merely stale PROSE is CORRECTED here rather than there. It is a MOVE and not a delete because
`~/.loom/library` is not a git repo, so a delete there is unrecoverable; and the tombstone is safe to rely on
only because no reader reads `_removed/` any more (the paragraph above).

- **`landing-freeze-root-refs` - RETIRED 2026-10-20.** The one entry in this list whose whole SUBJECT is gone
  rather than merely mis-cited: it is about `landing/build.ts`, deleted from this repo on 2026-10-17. NOTHING
  GENERAL WENT WITH IT - the shape underneath (a root-absolute audit is fail-closed, and it needs a SECOND set
  for the refs the ORIGIN answers rather than this script writes) is the paragraph below, and the dated
  evidence is under `_removed/`.

- **`landing-freeze-root-refs`** is about `landing/build.ts`, and **that file was deleted from this repo on
  2026-10-17** (`47fad72`, "landing, dev_stack and the edge are gone from here" — `landing/build.ts` 1045 lines,
  `landing/png.ts` 307, its `PROVENANCE.json` and `README.md` with it). `git ls-files landing` is empty here,
  the repo that depends on this one has no `landing/`, and only an untracked `landing/dist/` is left in the main checkout. Its whole
  subject is gone.
- **`long-lived-processes-run-old-code`** recommends "a new process, or a URL with a query string" as the cure
  for Deno's module cache. The second half of that is REFUTED by the entry that replaced it,
  `a-module-imported-by-url-is-cached` — "A query string does NOT fix it… the whole tree has to be somewhere
  new". Its surviving halves (restart the app worker after a merge that touched its rules; a stale CHECKOUT
  behind a fresh process) are the harness's subject, not this directory's, and `loom/AGENT.md` is where the
  runner/dial-out half belongs.
- **`a-gate-can-be-red-from-someone-elses-half-written-tree`** dates its evidence to a file that was untracked
  at the time (`loom/library/browser-for-online-tasks/safari.ts`, `??` in `git status` on 2026-10-12). **That
  file is tracked** — committed the same day in `2621943` — so the example reads as a mystery to anyone who
  checks it. The rule (a red gate is a claim about a shared tree; name what it refused) is still true and is the
  `a-red-gate-is-a-question`'s subject.
- **`deno-fmt-and-markdown-facts`** ends with "in the loom repo, `board/` records are guarded verbatim, 52
  records, 52/52". **`board/` is not in this repo**: `DEFAULT_DIR` is `./tasks` (`tasks.ts:75`) and the records
  live in `tasks/`. The rest of that entry — config resolved from EACH FILE's directory, what the markdown
  formatter rewrites, the structure-line trap — is right and is carried in the sections above.
- **`library-grep-measurement`** carries the numbers behind the root sentence (MOVED above) and a decision that
  the tree has since reversed, plus four addresses for its own evidence that no longer resolve. Quoted as the
  record, never as a rig.

Filed here by a citation, and about something else: **`workdir-is-a-worktree`** (the harness's workdir and
Deno's sandbox boundary — landed here because one example `cd`s to `loom/library/task-board/tasks.ts`),
**`hand-rolled-vs-the-real-thing`** (a repo-wide audit; its one library-relevant finding, that front matter had
three drifting readers, is the section above), **`loom-vs-claude-code`** (a benchmark of the harness's own
scaffolding, landed here because one sentence credits `software-engineering/README.md`),
**`git-add-all-in-a-checkout-shared-with-agents`** (already carried by `parallel-agents-one-repo`,
which prices `git worktree add` and names `git add -A` as the thing that sweeps a peer's work in), and
**`sea-visitor-pass`** (a live portal and its rules — task knowledge, not this tree).

## The 2026-10-21 audit of the entries the prompt carries

**The measurement the card was built on is wrong, so it is the first thing to correct.** `libraryContext()`
on this checkout is **18,408 B and 22 entry lines** (reproduced exactly, 2026-10-21). It splits:

    10,622 B  58%  the root `README.md` pasted whole, plus the two root paths and the section headings
     6,125 B  33%  the 22 DESCRIPTION lines  — 278 B each, NOT the card's "about 830 bytes each"
     1,659 B   9%  the 22 absolute PATHS, one line each

So **one entry costs about 350 B of block** (its description plus its path), and **58% of the block is one
file that is not an entry**. A deletion buys ~350 B; nothing about 22 × 830. If the block's SIZE is what
matters, the two levers are that pasted `README.md` (its measured sentences are pinned by
`tests/library_test.ts`, so it is a measurement, not an edit) and printing the system root once instead of
22 absolute FOLDER paths (~1.6 kB, a change to `subEntries`), neither of which is an entry.

**Measure it in the checkout the number was taken in**: the same tree read from a worktree is 391 B larger,
because the 22 absolute paths and the two root lines each carry 11 more characters — 18,761 B there against
18,370 B here after this audit, 18,799 against 18,408 before it, with identical descriptions.

**Method, and what it does not cover.** All 22 entry files were read and each one's checkable claims were
verified against this checkout — the file a body cites, the symbol, the flag, the test, the program beside
it, and (for the browser and web entries) this machine and a live fetch. Prose sentences that assert a
practice were judged, not measured. **The PERSONAL root was not audited entry by entry**: 404 folders /
**417 entry files**, and **none of them appear in the prompt block** — only the system tree is listed
(`loom/library.ts`, `subEntries`) — so none of the block's bytes are theirs. A mechanical pass over them
(cited loom paths that no longer exist) flagged 200 of 417, which is too noisy to be a verdict: many cite
sibling-repo and `relay` paths that were never in this repo. The personal entries this file already records as
refuted have a `CORRECTED <date>` header in their OWN body, which is where a reader meets it; one of them
still carried the refuted cure in its imperative lines, and that is fixed below.

**The verdicts.** KEEP = the thing it describes still exists and the entry still tells a reader what to do.
No entry in this tree earned a DELETE, and that is the finding, not an omission: every one of the 22 has a
subject that is still in this checkout.

- `a-module-imported-by-url-is-cached` — KEEP. Deno's registry is keyed by URL; no code claim in it to rot,
  and it is now the authority that REFUTES the query-string cure in the personal entry
  `long-lived-processes-run-old-code`.
- `a-raised-timeout-is-a-postponed-failure` — KEEP. `tests/poll.ts` (5,262 B) is still the poll loop it
  measures; `app_viewer_edit_test.ts` and `rollout_e2e_agent_test.ts` are still the examples.
- `a-red-gate-is-a-question` — KEEP. Its central claim is a fact about this repo's own commands: `deno task
  check` is fmt + lint + `check_tree` + test, `deno task test` is the suite alone (`deno.json:11/24`).
- `briefing-a-subagent` — KEEP. `startWorker.agent(name, dir, task, { loomDir })` is current
  (`loom/repl/js_repl.ts:1792`, `loom/worker/rollout.ts:357`), including the absolute-only rule it states.
- `browser-for-online-tasks` (SKILL) — KEEP. Every export the recipe names is in `safari.ts`
  (`open/newSession/goto/js/text/click/type/shot/close/dispose`) and `chrome.ts`
  (`launch/attach/goto/ev/wait/shot/close/dispose`).
- `browser-for-online-tasks` (MEMORY) — KEEP. Its census still describes this machine: Safari 26 +
  `safaridriver` at `/System/Cryptexes/App/usr/bin/safaridriver`, Chrome installed, no `chromedriver` on
  PATH. Chrome is now 155.0.8059.85 (it said 154.x on 2026-10-12) and nothing in the entry turns on that.
  Its three cross-references (`headless-chrome-cdp-page-check`, `safari-rig-blocked-by-a-peer-use-chrome-cdp`,
  `loopback-is-a-secure-context`) all still exist in the personal root.
- `building-a-loom-app` — KEEP. `app_mcp.ts` and `channel.ts` are both present and the entry's launch line is
  the one that works; its `startWorker.mcp` claim is real code (`loom/repl/js_repl.ts:1513` refuses a command
  ending `.ts`/`.js`/`.mjs`/`.tsx`/`.jsx`), `{ data: true }` → `LOOM_APP_DATA_DIR` is current
  (`loom/session.ts`), and `tests/app_mcp_test.ts`, `app_e2e_test.ts`, `app_ttt_test.ts` and
  `channel_test.ts` all exist.
- `driving-a-browser-over-webdriver` — KEEP. The `execute/sync`-wraps-your-body trap is a property of the
  protocol, and its positive control is still the right cure.
- `file-viewer` — KEEP. `viewer_mcp.ts`, `render.ts`, `files.ts`, `src/` and `assets/` are all here, `NOTIFY_WHEN_IDLE`
  survives only as the history the entry tells, and the rig it cites
  (`~/.loom/library/loombot-page-in-real-chrome/viewer_header_rig.ts`) is still on disk.
- `forcing-compaction` — KEEP, still exactly true: `SOFT = 0.7` / `HARD = 0.9` / `MIN_GROWTH = 12`
  (`loom/worker/agent.ts:426-436`), `SUMMARY_MAX_FRACTION = 0.5` (`loom/compact.ts:203`), `purpose ===
  "compaction"` answered without a step (`loom/providers/scripted.ts:38`), `--provider` / `--max-context` /
  `--task-ttl` (`loom/flags.ts:35/51/53`), and the archive at `<run>/root/trace/compacted-<n>.jsonl`
  (`loom/layout.ts:18`).
- `modes-in-loom` — **REWRITE, done 2026-10-21.** Eleven of its twelve modes are fixed, which is what its own
  "Fixed and removed from this list" section records; the one live fact is `allowSh`, still ESSENTIAL and read
  in more places than when it was filed (`loom/repl/verbs.ts:28` `GATED_VERBS`, `loom/session.ts:697`,
  `loom/worker/rollout.ts:1238`). The description was a museum label ("the ranked 12 modes of round 1 … and
  which 11 are FIXED on which commits") and now leads with the live rule; 290 → 252 chars, so the block moved 18,408 → 18,370 B. **Its body is
  49 kB of which most is the fixed record** — the next pass should decide whether those sections belong in
  `docs/` rather than here, which is a separate call from this card.
- `parallel-agents-one-repo` — KEEP. `.loom/` is ignored (`.gitignore:14`) and this very worktree has none, so
  its central warning and the `git worktree add --detach` recipe are both still true.
- `prompt-cache-cost-and-ttl` — KEEP, and it matches the code: `cachePositions` (last message, the message
  before the newest assistant turn, the newest stride multiple) is `loom/providers/cache_points.ts` and both
  providers put points at those places (`bedrock.ts:453`, `anthropic.ts:294-302`). Its two rigs
  (`ttl_sim.mjs`, `ttl_live_check.mjs`) are gone and the entry says so in its own last lines.
- `reading-code` — KEEP.
- `repeated-work` — KEEP. `sh` reports once when its body ends, a shell worker speaks per line, and `wait` is
  outside the repl: all three still the case.
- `software-engineering` — KEEP.
- `task-board` — KEEP. `tasks.ts` exports `create/list/show/claim/release/update/readBoard` (VERSION 4) as its
  invocation says, `board_mcp.ts` + `rules.ts` + `src/` + `assets/` are beside it, and `tests/task_board_test.ts` +
  `board_page_test.ts` exist.
- `terse-turns` — KEEP.
- `test-it-in-a-browser-you-can-see` — KEEP.
- `web-research` — KEEP, re-probed live 2026-10-21: Wikipedia's `rest_v1` summary answers 200, the YouTube
  results page (1.4 MB) still carries the `videoRenderer` JSON, and DuckDuckGo's html endpoint answers a
  challenge page with no result links — a 202, where the entry says 403, and the same outcome it teaches.
- `writing-a-tool-module` — KEEP. A module's `spec` is typed `Record<string, Omit<ToolSpec, "name" | "server">>`
  (`loom/repl/js_repl.ts:1106`) exactly as the entry says, and `example.ts` beside it is the module it quotes.
- `writing-payloads-in-repl-code` — KEEP. `literal` is a formal parameter of the compiled body and per call
  (`loom/repl/repl.ts`), and `deno task census:repl-payloads` still exists (`deno.json:14`).

**The one change outside this tree (personal root, rewritten and not deleted).**
`long-lived-processes-run-old-code` was told in a `CORRECTED 2026-10-20` header that its query-string cure is
refuted, and then still prescribed it in the body ("换一个进程 … 或换一个带查询串的 URL"). The imperative now
points at the refutation. Nothing was deleted there.

**The honest check on the deletes this audit did not make.** Nothing was deleted, so the check is that the
topics still land, run 2026-10-21 over both roots (`in: loom.libraries`) — an array of WORDS, not a phrase,
because an item with spaces in it is matched as a literal:
`["module","cached","url"]` → `a-module-imported-by-url-is-cached` first, `["compaction","deterministic"]`
→ `forcing-compaction` first, `["allowSh","mode","flag"]` → `modes-in-loom` first. A REWRITE is the one
verdict that can lose a topic silently, and that is why the live half (`allowSh`) leads the new description
rather than sitting in the commit.
