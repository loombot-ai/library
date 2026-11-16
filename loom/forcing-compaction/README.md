---
name: forcing-compaction
description: "Read before making loom compact deterministically — for a test, a gym sample, or reproducing a context bug — and before trying to trigger compaction with a big transcript, which does not work."
keywords: 上下文, 压缩, context window
as_of: 2026-09-27
---

# Forcing compaction on purpose

> **Re-checked 2026-09-27** (loom `e2068b6`): `SOFT = 0.7`, `HARD = 0.9`, `MIN_GROWTH = 12` (`loom/worker/agent.ts`), the half-size rule (`replaced * 0.5`, `loom/compact.ts`), `opts.purpose === "compaction"` answered without a step (`loom/providers/scripted.ts`), step `usage` passed straight through, and the `--provider`/`--max-context`/`--task-ttl` flags (`loom/flags.ts`) all hold. The archive path is corrected below.

**A long transcript does NOT trigger compaction.** The trigger is declared token usage, not message count
or transcript bytes:

    used = this.#usage.lastInput          // loom/worker/agent.ts, via #maybeCompact (an estimate of
                                          //   the transcript instead, right after a compaction swap)
    SOFT = 0.7 * maxContext               // summarise in the background
    HARD = 0.9 * maxContext               // stop and wait for the summary

So 25 turns of padding compact nothing. Measured: a scripted run of 26 turns reported `input: 0` in
`meta.json` and never compacted, because the scripted provider declares no usage unless asked to.

## The recipe that works

A scripted step passes `usage` straight through, which is the hook:

```js
const steps = [];
for (let i = 0; i < 20; i++) {
  steps.push({
    tool: { name: "repl_run", args: { code: "return " + i + ";" } },
    // 2600 > 0.7 * 3000, so SOFT fires. The number is DECLARED, not measured.
    usage: { input: 2600, output: 20, cacheRead: 0 },
  });
}
steps.push({ final: "done", usage: { input: 2600, output: 20, cacheRead: 0 } });
```

    loom "<task>" --provider scripted:steps.json --max-context 3000 --task-ttl 200

Three constraints, all of which will silently stop it firing:

- **`MIN_GROWTH = 12`**: at least 12 messages must accumulate between compactions, or it declines.
  Fewer than ~14 steps and nothing happens.
- **A summary is discarded unless it is smaller than half of what it replaces.** Measured on a live run:
  summarising one message produced 1761 chars, i.e. compaction that GREW the context. So the archived
  region has to be substantial.
- **The compaction call is answered without consuming a step**, told apart by `opts.purpose ===
  "compaction"` — NOT by having no tool schemas, which is how it worked until 2026-09-21. Compaction is
  a forked sub-agent now and sends the parent's exact tool list on purpose (the prefix cache matches only
  if it does), so the payloads are identical and only the marker distinguishes them. A test double that
  keys on `tools.length === 0` will hand the compactor the ROOT's next scripted step.

## The evidence that it worked

Not the exit code, and not that the run answered. The artefact:

    <run>/root/trace/compacted-1.jsonl        the archive of what was CUT (the run layout in
                                              loom/layout.ts; it was <run>/compacted-w-1-1.jsonl until
                                              the layout change)

And the decisive check, if what you are testing is RECALL: grep the archive for the fact. Measured
2026-09-17 — the original instruction holding `QX-4417` was in the archive, meaning it had left the live
context, and the run still stated the key correctly. **That is what separates recall from re-reading:** if
the fact is still in the live transcript the test passes trivially and measures nothing.

## Why this matters for a gym sample

It makes `long-context-recall` feasible, which was not obvious. The fact must live ONLY in the
instruction — never in a file in the container — or the agent re-reads it and the sample scores
file-reading. Forcing compaction with `--max-context` plus declared usage is deterministic, needs no
real model, and takes about a second.
