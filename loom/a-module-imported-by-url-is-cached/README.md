---
name: a-module-imported-by-url-is-cached
description: Read before measuring an edited file in a process that already imported it — Deno caches a module by URL for the LIFE of the process, so a re-import after the edit returns the bytes from before it and a good fix measures as not working; the fresh-process and new-directory fixes, and the freshness flag to return with the numbers
keywords: 热更新, hot reload, 缓存
as_of: 2026-10-02
---

# A module imported by URL is cached for the life of the process

Deno's module registry is keyed by URL and lives as long as the process does. Edit the file, then
`await import(url)` it again in the same process, and you get the module that was registered before the
edit — no error, no warning, just the old bytes, with everything measured through them a measurement of
the old file.

## How it presents

Neither symptom is an exception, which is what makes it expensive:

- **"My fix measured as not working."** The edit is real — a grep finds it, the tests agree — and the
  measurement comes back identical to the baseline. A CSS fix was measured as having no effect this way;
  the fix was correct and the page was the pre-edit module. What you conclude is that your fix failed.
- **"The harness served the old bytes."** A before/after table in which every cell is unchanged, in a file
  whose diff you can read, is the signature.

Measured 2026-10-02, twice in one session by the same agent: once as a fix that measured as not working,
once inside a probe where it nearly produced a wrong conclusion. The change under test was correct both
times.

## The fixes that work

**A fresh process.** Write the script to a file and run it — `deno run -A <script>` — or use a new repl.
The cache belongs to the process, and a process that has never imported the URL reads the current file.
One command, nothing to reason about, and the first thing to reach for.

**A directory no import has used yet.** Copy the changed directory somewhere this process has not imported
from (a copy under the temp directory works), symlink the other top-level entries of the repo beside it so
its relative imports still resolve, and import THAT. Keep a second copy of the pre-edit version under its
own name when the point is an A/B.

**A query string does NOT fix it.** `import(url + "?v=2")` makes the entry URL new, but its relative
imports still resolve to the cached URLs, so the modules you changed are still the old bytes. The whole
tree has to be somewhere new.

## Carry a freshness flag in the result

Staleness looks exactly like a measurement, so make it a value in what you return:

```js
// a token that exists ONLY in the new bytes
const fresh = source.includes("--fs-ui");
return { fresh, rows };
```

The probe that could be trusted returned `fresh: true` beside its numbers, and that flag is the only reason
its conclusion was allowed to stand. Pick a string the old bytes cannot contain and return it with every
result — a run reporting `fresh: false` is a measurement of the old file, whatever its numbers say.
