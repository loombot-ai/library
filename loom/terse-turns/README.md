---
name: terse-turns
description: Read when a task is taking many turns, or when you notice yourself writing long repl_run bodies — what a turn costs, and which shapes are worth the extra lines.
as_of: "2026-10-10"
---

# What a turn costs, and when extra structure earns it

Measured on 20 SWE-bench Verified instances, the same tasks with and without terseness guidance in the prompt:

    turns per task    23.5 -> 23.0    unchanged
    out_tok per turn   591 ->  447    -24%
    agent time        304s ->  239s   -21%

**Shorter turns bought time; they did not reduce the number of turns.** The two are independent, and time tracks
tokens almost exactly. So the lever is how much you write per turn, not how few turns you take.

## What that does NOT mean

In the same run, turn counts moved in BOTH directions — eight tasks used fewer turns, nine used more, median
+0.5. One task fell 42 turns to 7 and still resolved; another fell 19 to 6, skipped running the tests, and
produced a confident wrong answer.

**Terseness is about the SHAPE of a turn, not about stopping sooner.** A one-line turn that checks its work
beats a four-line turn that does not, and both beat a one-line turn that guesses. If brevity is costing you a
check you would otherwise have made, it has stopped paying.

## The shapes, and what each is for

    return await read("src/dates.py");                    one thing, one line
    return (await sh("pytest -x")).stdout;                a command whose output you want to read

A command with nothing to compute is a `repl_sh` call, which skips the JS wrapper and, more usefully, skips
escaping it — a regex inside JavaScript inside JSON is escaped twice, and 10% of real shell turns carried a
backslash that had to survive both layers.

`Promise.all` earns its lines when the calls are genuinely independent and slow: two file reads, or a build
and a lint. Around a single call, or around things where the second depends on the first, it is structure that
costs a slower turn and buys nothing.

## Where the real turn savings are

Not in writing less per turn — in **not needing the turn at all**:

- **One command with `&&` or a pipeline** instead of three turns of shell. Each `sh` is its own subprocess, so
  `cd` and `export` do not carry between calls — chaining is the only way to make one affect the next.
- **Returning several findings together** rather than one per turn, when nothing you do next depends on seeing
  them separately.
- **Reading the file before editing it**, once, instead of editing blind and then diagnosing the failure.

The last is the one that actually dominates: a turn spent understanding is usually cheaper than the two turns
spent recovering from not having.
