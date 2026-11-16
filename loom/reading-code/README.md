---
name: reading-code
description: "Read before reading an unfamiliar file or codebase you do not want to pull into context"
as_of: "2026-10-10"
---

# Reading code without paying for it twice

Everything you `return` stays in your context for the rest of the session, re-read on every later turn. A file you dumped once is a file you pay for a hundred times. Everything you keep in a repl **variable** costs nothing.

In a real session this was 40% of all context: an 8 KB source file, an 8 KB README, 6 KB of `git status`, 3 KB of type definitions from `node_modules`.

## The order to work in

1. **Locate before reading.** Find the few lines that matter, and return only those.

   ```js
   const src = await Deno.readTextFile("loom/cli/tui.tsx"); // in a variable: free
   const hits = src.split("\n")
     .map((l, i) => [i + 1, l])
     .filter(([, l]) => l.includes("useInput"));
   return hits.map(([n, l]) => `${n}: ${l}`).join("\n"); // in context: a few lines
   ```

2. **Ask the shape first**, not the contents. Sizes, symbol names, exports, a function's line range — that is usually the whole question.

   ```js
   const src = await Deno.readTextFile(f);
   return {
     lines: src.split("\n").length,
     exports: [...src.matchAll(/export (?:function|const|class) (\w+)/g)].map((m) => m[1]),
   };
   ```

3. **Read a range, not a file**, once you know where to look: `return src.split("\n").slice(180, 240).join("\n")`

4. **Keep it in a variable across turns.** A bare assignment persists between `repl_run`s; `const` and `let` do NOT. `src = await Deno.readTextFile(f)` survives, so later turns can slice it again without a re-read and without another copy in context.

5. **Never return machine output whole** — `git status`, `git diff`, test runs, `node_modules` type definitions. Filter to the lines that answer the question: `return out.split("\n").filter((l) => l.startsWith(" M ")).join("\n")`

6. **Several answers, one value.** A `repl_run` returns once, so gather what you learned and return it together: `return { lines, exports, callers }`. Do not make a second `repl_run` just to send a second finding you already have.

## The one case for dumping a whole file

You are about to rewrite it and need to reason about all of it at once. Even then, prefer reading it into a variable and editing with `replace`, which needs no copy in context at all.

## NEVER write a file from what `read()` returned

`read(path)` returns lines with **line numbers on them**, for your eyes. Write that back and you have replaced source code with a numbered listing of itself.

Twice in one day, both by sub-agents mid-task, both silent:

    1,001 lines of tests/mcp_test.ts rewritten as a numbered listing
      257 lines of tests/compact_test.ts deleted by string surgery on the whole file

Neither failed loudly. The first was caught by `deno fmt` refusing the file, the second by a test count that had dropped — and both cost a `git checkout` and a redo of work that was already correct.

So:

- **To change a file, use `edit(path, old, new)`.** It matches exact text and fails loudly when the anchor is wrong, which is the behaviour you want: an edit that cannot find its place should not happen at all.
- **If you must have the raw text**, use `Deno.readTextFile`, which returns the bytes. `read()` is for READING; `readTextFile` is for processing.
- **After any whole-file write, check what you did**: `wc -l` before and after, or `git diff --stat`. A line count that moved by 900 is not a formatting change.
- **Recovery is `git checkout -- <path>`** if it was committed, which is one more reason to commit before a risky edit rather than after.

## If you hit "[output truncated]"

You returned more than the cap and only got a head+tail preview — a wasted round trip. The marker names a log file you can read with code, but the better move is to return less next time.
