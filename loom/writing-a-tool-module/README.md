---
name: writing-a-tool-module
description: "Read before writing the .ts file that `loadTools(name, path)` loads — how exports become `tools.<name>.*`, how a module documents itself so the load report is useful, and what a RELOAD leaves running (a timer, a port or a child survives it, and loom will NOT clean up for you). Also before loading the same name twice."
as_of: "2026-10-19"
---

# Writing a tool module

`loadTools` is the category with no process: a module read into THIS repl, its exports callable as
`tools.<name>.*`. This entry is about the file — what shape it has to be, how it documents itself, and
the one thing that surprises everyone, which is what a second load does to the first instance.

To start an MCP server instead, that is `startWorker.mcp` and a different entry
(`adding-an-mcp-server`). To decide which of the two you want at all, `worker-and-tool-scope`.

## The shape

Any `.ts`/`.js` module. **Every export becomes a member of the namespace**; the functions get
signatures, and a non-function export is reachable as `tools.<name>.<key>` too.

    await loadTools("tally", "loom/library/writing-a-tool-module/example.ts")
    tools.tally.watch(300)      // a function export
    tools.tally.VERSION         // a value export, reachable, no signature

The **name is explicit and required** — there is no basename default (Xiaohu, 2026-09-24: "just to keep
it simple"). The path resolves against the working directory, not against loom's module, and the import
is cache-busted on every load so an edited file is actually re-read.

No global is ever shadowed: the namespace is keyed by name, so a module exporting `sh` or `read`
replaces nothing. The old flat `Object.assign(globalThis, mod)` behaviour could, unrecoverably.

## How a module documents itself

JavaScript keeps **no documentation at runtime** — a function object carries `length`, `name` and
`prototype`, JSDoc is stripped from `toString()`, TS types are erased, and `length` stops at the first
default. So a description either is declared or does not exist. Two sources, in this order:

1. **A `spec` export, keyed by export name.** Each entry has the shape an MCP tool's spec arrives in —
   `Omit<ToolSpec, "name" | "server">` in `loom/repl/verbspecs.ts`: `description`, `positional` (which
   arguments are passed by position, in order), `returns`, `throws`, `async`, `inputSchema`. `spec`
   itself is not reported as a tool.
2. **JSDoc, derived.** With no entry in `spec`, the harness runs `deno doc --json --no-remote --private`
   on the file and maps prose, `@param` (including `opts.from` members of an options bag), `@returns`
   and `@throws` into the same shape — `loom/worker/docspec.ts`. The subprocess is the HARNESS's, never
   the repl's: `--allow-run=deno` would be total escape, since `deno run -A` lets a child pick its own
   permissions.

**Derivation is best-effort, and quietly so.** `docSpecs` returns `{}` for a path it cannot `realPath`,
for a path that resolves outside the caller's workdir, and for any non-zero exit of `deno doc` (a remote
import or a type error is enough); and a run that withholds subprocesses has no derived specs at all. A
tool with neither source still renders its **call shape** from the source text, plus a line saying why
the prose is missing — enough to avoid a `TypeError`, and nothing more.

**So: export `spec` when you want to guarantee docs.** It is part of the module, so it is there in every
run.

**A hand-written `spec` beats the derived one** for the same export. The author is describing intent to
an agent; `deno doc` can only describe types. Derived docs exist for the commoner case of a module that
documents itself the ordinary way and was never given a `spec`.

## What the load hands back

The report is the surface: a head line counting the tools and naming the non-callables, then one help
block per callable — the same text `help(tools.<name>.<fn>)` renders. Read it instead of guessing
argument names; that is the whole reason it returns anything.

It is **capped at 4000 characters**, with 700 reserved for a tail. Blocks are added until the cap, then
as many dropped NAMES as fit, then a count and a pointer to `help(tools.<ns>.<tool>)` for one signature
and `help(tools.<ns>)` for every name. So a large module's report is an index, not the whole surface.

Order is **sorted, not declaration order** — a module namespace object's keys are sorted by the
language, whatever order the file lists them in. With the cap in play that decides what gets shown.

## Scope: `tools.*` is this REPL's

A namespace `loadTools` created lives in the repl that called it. Another repl of the same agent cannot
see it, it costs **nothing** from the process budget, there is no pid and no log folder, and the one verb
that drops it — `unloadTools(name)` — cannot unload the module itself: `repl_stop` is what reclaims its
timers, sockets and memory.

Contrast in one line: `workers.*` is **agent-level**, so a worker started in one repl answers from every
repl of yours, including ones created later — and it is `stopWorker(name)` that ends it. The split of
the two roots, and why the verb tells you which set of rules applies, is recorded in
`loom-hq/docs/tracking/features/merged/tools-and-workers-split.md`.

## Reloading: the handle is replaced, the INSTANCE is not

Loading the same name again re-reads the file and builds a **new instance**. What it does not do is
unload the old one. JavaScript has no unload, and the old instance is not even garbage: **the event loop
holds the closure of every live timer and socket**, so nothing can collect it.

Measured, with a module holding a 300 ms interval, a TCP listener and a spawned child: after its handle
was dropped by a reload, all three were still alive — ticks went 3 -> 8 -> 50, the child was still
running, the port was still bound, and a reference taken before the reload still worked normally.

Reproduced here on a plainer case (interval only): old instance 3 ticks, reload, new instance sitting at
0 while the old one went on to 6, `ref === tools.tally` false, `ref.shutdown()` still callable.

**A module with nothing to clean up needs none of this.** Pure functions reload for free.

## Cleanup: name it `dispose`, or call it yourself

**ONE unload verb, and NO reload hook.** `unloadTools(name)` awaits an export named `dispose` — the plain
convention, not a `spec` flag and not a description match, because loom picking an author's API out of
prose is how `stop()` gets called behind their back — and then drops the namespace from `tools.<name>` and
from `help(tools)`. A RELOAD runs nothing: I built a reload hook on 2026-09-24 and Xiaohu removed it the
same day — _"I mean don't build the dispose hook"_ — then asked for the verb instead, _"For tool unload,
Let's build unloadTools(name). It runs dispose() if the module has one."_ **Neither one unloads the
MODULE**, so the list below is still the real set of options.

What that leaves you, in order of how much it costs:

1. **Name it `dispose`, and the verb does it.** This is the whole recipe for reloading a stateful module —
   unload, then load — and nothing of yours has to remember to clean up:

       await unloadTools("tally");              // runs your dispose(), then drops the namespace
       await loadTools("tally", "./tally.ts");   // a fresh instance, nothing of the old one running

   **The exception, and it is the only reason to call cleanup by hand:** a cleanup named something else.
   `unloadTools` runs an export named `dispose` and nothing else — deliberately, because loom picking an
   author's API out of prose is how `stop()` gets called behind their back. `help(tools.tally)` lists the
   export names, so a differently-named one is visible, and it is yours to call before unloading:

       await tools.tally.shutdown();   // only because it is not called dispose
       await unloadTools("tally");

   Verified: `ref.shutdown()` on the old instance is still callable after a reload, so even a handle you
   kept by accident can still be used to stop what it started.

2. **`repl_stop` is the backstop, and the only thing that always works**, because it kills the process the
   module lives in. Nothing inside the repl can free a module's interval once the handle is gone.

3. **Design the module so there is nothing to clean up.** A tool that opens a socket per call and closes it
   holds nothing between calls, and then a reload costs nothing. This is the one that scales: pure
   functions reload for free, and a module that owns a lifecycle is a WORKER's job — `startWorker.shell` or
   an MCP server — which is killable by name precisely because it is a process.

**If you reload a stateful module without cleaning up**, expect what the measurement above shows: two
instances, both live, the older one unreachable except through a reference you kept, still ticking and
still holding its port. Nothing warns you. That is the strongest argument for (3).

## Writing the file from repl code is its own trap

The payload is code, so a backtick or a `${` inside a template literal ends the literal early or
interpolates text you meant to be literal. Do not re-derive the rules here: read
`writing-payloads-in-repl-code` first. Both files in this entry were written through a quoted heredoc,
which has no JavaScript layer at all.

## The worked example

`example.ts` beside this file is the whole thing — two tools, a `spec` documenting both, a `shutdown` you
call yourself (named that rather than `dispose` on purpose: it is the case where the cleanup stays the
author's to call), and a value export to show a non-callable:

    let ticks = 0;
    let timer: number | undefined;

    export function watch(everyMs: number): string { ... }   // restarts the interval
    export function ticksSoFar(): number { return ticks; }
    export function shutdown(): void { ... }                 // clearInterval
    export const VERSION = "1";

    export const spec = {
      watch: {
        description: "Start the tick counter. Call again to restart it.",
        positional: ["everyMs"],
        returns: "a confirmation string",
        inputSchema: {
          type: "object",
          properties: { everyMs: { type: "number", description: "tick interval" } },
          required: ["everyMs"],
        },
      },
      ticksSoFar: { description: "Ticks since the last watch().", returns: "a number" },
      shutdown: { description: "..." },
    };

`await loadTools("tally", "loom/library/writing-a-tool-module/example.ts")` returned, verbatim:

    tools.tally: 3 tools, plus 1 non-callable: VERSION

    tally.shutdown()
      Clear the interval so a reload leaves nothing behind.

    tally.ticksSoFar()
      Ticks since the last watch().
      returns: a number

    tally.watch(everyMs)
      Start the tick counter. Call again to restart it.
      everyMs: number — tick interval
      returns: a confirmation string

Every description, the `everyMs: number — tick interval` line and the `returns:` lines come from the
`spec` export; the sorted order and the `plus 1 non-callable` clause come from loom.

## Verified versus read from code

**Run, in a live repl:** the namespace and the two roots; the report above; `spec`-derived help for
each tool (`help(tools.tally.watch)` matches its block); a value export reachable with no signature;
`spec` excluded from the tool count while still listed by `help(tools.tally)`; the reload replacing the
handle while the old instance's interval kept ticking.

**Read from the source, not exercised:** the 4000-character cap's arithmetic, and the failure modes of
`deno doc` derivation in `loom/worker/docspec.ts`.

**Removed from this page on 2026-09-24**, and worth knowing if you find an older copy: it described a
`dispose` hook that loom called on RELOAD, declared by a `dispose: true` flag in the module's `spec`. It
was built and then ruled out the same day. What replaced it, later the same day, is `unloadTools(name)` —
one verb, run only when you ask, and it finds the cleanup by the plain name `dispose` rather than by a
flag. A reload still runs nothing.
