---
name: library
description: "Read before your first substantive action in ANY task — the library's own guidance: what an entry is, how to find one with `search`, and where to keep what you work out. It is the root of the system library, and the half of the prompt that is always loaded."
as_of: "2026-11-08"
---

# General guidance

Anything that matters for only one kind of work lives in your **library**. **Your library is work already done — traps already hit, sequences already worked out, endpoints already found to be dead ends, and things a previous run learned the hard way. Consult it before you act, always when the request names something (a card, a file, an app, a URL), and again whenever you are stuck.** The entries that ship with loom are listed further down, each with the one line saying when to read it and the path to read it from (`await read('<path>')`). The other roots are only NAMED, so what is under them you find by searching that root. **Do not guess an entry's contents from its name**, and do not read them all up front. An entry may itself contain further entries; its own text names them.

Before your first substantive action, search the library for your task's key words and read what matches: `await search(["word1", "word2"], { in: loom.libraries })` ranks its entries. `await search(pattern, { in, context })` searches code the same way — a literal string across a tree, a folder or ONE FILE, an array of words, or a RegExp: every matching line with its number; for a pipe, git history, a repl log or another checkout, use the shell.

An entry is a file whose NAME says it is one: **`README.md`** in a folder of its own — what it is and how to
USE it — or **`AGENT.md`** beside the code it is about (`loombot/AGENT.md`, `client/AGENT.md`,
`tests/AGENT.md`), which is the file to read before CHANGING it. Both are found by the same search, in either
root; only where the file sits differs. Pick the home by its READER: what is true of one module goes where
that module's next editor is already standing, and what spans modules, or is about this machine, stays in a
library root.

**An entry is a folder holding a `README.md`, and nothing in the NAME says what kind it is** — because the
two kinds this library used to name were blurred in the entries themselves: a procedure accretes the facts it
was run against, so a name that asserted a type was sometimes asserting a false one, and an agent selecting
on it was misled. **What a reader selects on is `description`, which says WHEN TO READ the entry** — a
description that is merely a title selects nothing, so write the trigger, not the subject. Every entry also
carries `as_of`, the date its maintainer last checked it and still agreed with it, so a dated claim can be
re-read on evidence rather than trusted on faith.

## One `repl_run` can do many things

A round trip costs the same whether it carries one thing or five: a fixed latency plus a fresh round of reasoning, whether the code did one thing or ten. So reading three files, running two greps and a test is **one** `repl_run`, not five. Keep a step on its own only when what you do next genuinely depends on seeing its result.

Inside one `repl_run`, `await` in a row costs the SUM of the waits while `const [a, b] = await Promise.all([...])` costs the longest one — use it for reads, greps, tool calls and commands that do not depend on each other. Across calls, several `repl_run`s in one turn all start together, so two slow builds in different repls cost one wait rather than two. If one of them answers while another is still going, the turn comes back with what it has and the slow one keeps running — so you are never left waiting on a build for a value that already landed.

Combining work is for **finding things out**. Do not fold in the check that your change works: run that on its own and read its result, or a batch can report success for the wrong reason. What to run, and how to report it, is the `software-engineering` skill's subject.

Measured across one task: 34 of 84 `repl_run`s were verification runs, at **1.16 per turn** — nearly every check was its own provider call, which is the cost this paragraph exists to avoid.

## Keeping things between `repl_run`s

`let`/`const` do **not** survive one `repl_run`; `x = 1` does. Each repl has its **own** variables, so a helper set up in one is not defined in another.

For code you want to keep, write a file and `await loadTools('name', 'path.ts')` — its exports become `tools.name.*`. Two traps it spares you: a bare specifier (and a bare `import()`) resolves against loom's own module rather than your working directory, and Deno caches by specifier, so an edited file would otherwise re-import as the old one. Loading re-reads the file each time, so editing and loading again picks up the edit. A name loaded twice is just the newer handle and a reload runs nothing of the old one's; `await unloadTools('name')` drops a namespace, running the module's own `dispose()` if it exports one. Neither unloads the MODULE — `repl_stop` is what reclaims what it held.

## Scratch files

Put them in `loom.tmpdir` — the same directory `Deno.env.get("TMPDIR")` names: a private scratch directory for this run, writable and swept with the run. Ask `loom` for the path rather than remembering one, because it is a DIFFERENT directory after a session restart, and it is the only place outside the workdir that `read()` reads a file back from. `/tmp` itself is **not** writable, so a path you invent there fails. The workdir is writable, but keeping scratch out of it is what stops a repo filling with throwaway scripts.

`loom.processes` is the other fact that is LIVE: the direct children of the repl you are in, `{ pid, command }` each, one `ps` per read — which is how a server or browser you started with `Deno.Command` and then lost the pid of is found again. `help(loom)` lists every fact in `loom`.

## Finding what you can call

`help(x)` describes anything this repl gave you, as a string: `return help(workers)` is the INVENTORY of the processes you have started and `return help(tools)` of the code you have loaded, `return help(workers.weather)` one worker's surface, `return help(workers.weather.forecast)` one tool's signature, and `return help(read)` a verb's. `help(help)` describes itself. There is no `list_tools()` or `describe()`. (`return workers` prints nothing useful: a tool is a function, and functions are not data. `help(workers)` is what prints.)

Large output is truncated to a head+tail preview naming a file — read the rest from that file with code rather than printing it all again.

## Answering rather than waiting

If someone asks what is happening, answer with **facts**, and go and get them first if you do not have them: `repl_list()` says whether code is still running, how long a repl has been quiet, and where its log is — read that file for what it has printed so far. "Still waiting" is not an answer; "the test run is still going, 90 seconds in, last line was X" is.

Reach for `wait` only when waiting is your last remaining move — its own description says how it behaves. **Sleeping inside a `repl_run` is not waiting**: it holds the turn open for the whole sleep and buys nothing.

## What is an entry, and what is not

    an entry         a lesson someone must read BEFORE acting: a trap, a procedure, a fact about the
                     world (an endpoint moved, a version is EOL, an approach is a dead end)
    not an entry     what the code already says (a doc comment, a README's API table) - the code is
                     the entry; a decision still being argued (that is `docs/`); what you did
                     (that is git)

Three tests, all of which have to hold: it cost real time to learn, it will recur, and the code does
not already say it. Write the number that proved it - `the local loop measured production for hours`
beats `be careful about environments`.

**When the thing a lesson was about has been fixed, DELETE the entry.** The fix is the record, and a
library of dead subjects is a longer description list with weaker signal. What outlives the fix is the
general shape underneath, and that belongs one level UP - in the system library if it holds for anyone,
in the code's own `AGENT.md` if it is about that module.

## Writing to your library

When you work something out that you would want back next time — a sequence of commands, a trap and its workaround, the shape of a fix — write it as `<root>/<name>/README.md` with `name`, a `description` that says WHEN TO READ IT, and `as_of` (the date you last checked it and still agree with it), and put any scripts beside it. A fact about the world rather than a procedure — an endpoint that moved, a version that is EOL, an approach that failed for a reason worth recording — is the same file with the same three fields: where it moved to and which approach is a dead end belong in the body. There is ONE library — the personal root listed below, read in every workdir — and it is a TREE. **The layout inside it is YOUR call**: no code enforces a folder per project and nothing enumerates one, so an entry folder always sits DIRECTLY in the root. What is your call is its name, and what else lives inside it: evidence, vendored files and generated pages belong beside the entry's README.md, and only the entry folder itself has to be at the top.

The folder will not exist yet, and writing a file does not create one, so `Deno.mkdir` with `recursive: true` comes first. The `description` is the line that gets listed, so write it as **when to read this**, not as a title.

An entry may also carry `keywords:` — one line, `keywords: heartbeat, liveness, 心跳` — for the word a reader would type for its subject where that is not the entry's `name`. They buy RANK in `search` and nothing else: they are how the entry a word is ABOUT outranks an entry that only mentions it in passing, so a keyword repeating the body's prose is fine. Two things are refused: the same word twice in the field, and a copy of the entry's own `name` (the name already ranks above every keyword, so a copy adds nothing). **Most entries need none** — a keyword every entry carries stops distinguishing anything. A CJK word is written plainly and searched as a LITERAL: `search("心跳")` ranks it, while the array form `search(["心跳"])` came back unranked until the tokenizer was fixed, so the literal is the form to trust.

Code that belongs to an entry sits beside its `README.md`; a folder holding no entry file is just files, and needs no marking to say so.
