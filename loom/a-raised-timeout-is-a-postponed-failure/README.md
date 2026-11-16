---
name: a-raised-timeout-is-a-postponed-failure
description: Read before raising a timeout on a flaky test, or when a suite fails a DIFFERENT test each run under load. Contains the nine-day experiment that proves the raised ceiling does not fix anything, the measured 2-5x inflation, and what to measure instead.
keywords: 超时, deadline, 偶发
as_of: 2026-10-18
---

# A raised timeout is a postponed failure, not a fixed one

**A suite that fails a DIFFERENT test each run is not a suite with many bad tests. It is one condition,**
**and every test of a certain shape is a probe of it.** Raising the ceiling on each one in turn is how you
spend a year not measuring the condition.

Every figure below was measured on one tree between 2026-10-09 and 2026-10-19, and none of them has been
re-measured since. The tests are named by what they test rather than by their files, because what carries
to another tree is the shape; the numbers are what make it evidence.

## The nine-day experiment, unplanned

    2026-10-09  the poll helper waited 20s. A viewer-edit test timed out at 20005ms and 1644 polls under
                the 6-job suite, and PASSED IN 7s re-run alone. The fix: raise the ceiling to 60s, with
                the reasoning written down - 'a poll is a HANG DETECTOR ... the ceiling can afford to be
                generous'.
    2026-10-18  the SAME test timed out at 60002ms and 4944 polls, at default parallelism.

**Nine days, three times the ceiling, the same failure.** The reasoning in the comment was not stupid -
a poll really is a hang detector, and against a real hang a generous ceiling costs nothing. What it
missed is that the thing being waited for was NOT hanging; it was being STARVED, and a starved thing
waits forever.

## The same night, three runs, three different tests

    run 1   the client-socket test     'no event arrived within 5000ms'   (a client deadline on a server tick)
    run 2   the viewer-edit test       60002ms, 4944 polls
    run 3   the rollout end-to-end test  'a worker's children cannot outlive it' FAILED (5s)

    2157 passed, ONE failed, every time - and never the same one.

**That is the signature.** A genuinely broken test fails every run and has a name. A starved class
surfaces wherever the deadlines are tightest, so it looks like several unrelated flakes and gets fixed
several times, in several places, all by raising numbers.

## What the shape is, so the class can be found

A test that **waits for an event with its own timer** instead of awaiting a promise the code resolves:

    await until(...)          a poll loop with its own deadline       (one helper, and its callers)
    setTimeout(..., 5000)     a client deadline on a server tick
    nextEvent() with a ceiling

Search for the failure STRINGS rather than the tests - `timed out after`, `no event arrived` - and
count the files, because the useful number is how big the class is, not which member failed today.

## What to measure instead of raising the number

1. **How much did it inflate?** The poll helper records 2-5x under `--parallel` (2026-10-09). That
   number is the finding, and it was written down and never chased.
2. **What is late - the event or the deadline?** If the event is produced by a timer (a push loop, a
   process start), the inflation is in the producer. Await the producer's promise and the deadline stops
   being a guess.
3. **Does it pass alone, and pass on a second full run?** One green run is not evidence for a race;
   two consecutive greens at the real parallelism is a start, and a red in three runs is a measurement.

## Fix ONE member at a time, and find the class by shape - not by waiting for it to fail

**One at a time, because the members do not share a mechanism.** Measured on one night, one class, three
different causes behind three failures that all looked alike:

    the client-socket test     the event was SENT ONCE and the waiter was bound after it -> gone for good
                              (fix: bind before the change; the deadline was never touched)
    the viewer-edit test       the label's guard DROPPED the registration: nothing was ever late - both
                              timeouts were that same drop, and the fixed wait arrives in 23ms / 3 polls
                              at a 20s ceiling (measured 2026-10-19), where 2s is enough
    the rollout end-to-end test  a 5s FAILED - not yet explained

**A fix for one is evidence about one.** Writing 'the flaky tests' as a category and fixing it once is how
the three above become one report instead of three findings.

**And the class is BOUNDED, so it can be finished rather than chased.** Find it by SHAPE, not by waiting
for it to go red - a green run is exactly when nobody looks, and the red one only ever shows you its
current member. Measured on the same tree:

    tests that set their own deadline (`setTimeout(() => reject`)          4 files
    tests that poll through an `until(` helper                            38 files
    tests carrying one of the failure strings                            10 files

    places with a RECEIPT from raising a ceiling                           2
      the poll helper              20s -> 60s (2026-10-09), and it timed out again at 60002ms
      a rollout repl test          'inflation of an idle machine ... went red under the 6-job suite'

**The receipts are the best lead in the list.** Each one marks a place where somebody already met this and
answered it with a number; two receipts pointing at one cause is much stronger than one. Grep for the
failure strings rather than for the tests, because the strings are what survive a rename.

## And do not put the parallelism back to make it rare

Measured the same night: the gate pinned to `DENO_JOBS=2` failed the same 12 tests as the default in
three times the wall clock. A hedge like that hides a whole class the moment it is comfortable - which is
exactly what happened here, and why nobody had read these failures.
