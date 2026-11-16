---
name: a-red-gate-is-a-question
description: Read when a gate goes red - a test suite, a type check, a lint - and the first instinct is to run it again, or under different conditions. Three numbers from one night, all from ONE root, and why running it a different way is the most expensive way to not fix it.
as_of: 2026-10-18
---

# A red gate is a question, not an inconvenience

**When a gate goes red, read the failure. Do not run it again under different conditions.** The second
run is not a stricter investigation - it is a way to stop reading. It produces a NUMBER where the first
run produced a REASON, and now there are two numbers and still no reason.

## One night, three numbers, one root

    98 failed    the suite, run while the tree was being written
    80 failed    the suite, run serially instead (a different command, chosen to 'get a clean read')
    12 failed    the suite, run with the parallelism the gate is configured for

Each number was taken as information, and each re-run was framed as care: _I should check this under
cleaner conditions_, _I should make sure it is not a concurrency artefact_. The actual root, when somebody
finally read a failure, was one line:

    tests/fixtures/loombot_page.ts:344   `return { ..., base: base, ... }`
    - a name deleted from the client that the page fixture still asked for, so EVERY page test threw
      `ReferenceError` and 41 of the failures were that same line.

**The three numbers were never three problems. They were one problem, counted under three conditions, by
a person who preferred counting to reading.** And two of the three conditions were invented by that
person - the gate's own command was never the one being run.

## Why 'let me just check it differently' is the expensive move

- A suite takes minutes. Reading a failure takes seconds. The re-run is the slow way round.
- Each re-run ADDS a discrepancy that now needs its own explanation (`why 80 and not 98?`). The numbers
  start to feel like evidence, and none of them is a reason.
- A condition you invented is a condition you can keep inventing: there is always a `--parallel` to try,
  a subset to isolate, a cache to clear. The search space is unbounded because none of it is aimed.

## The two things that ARE worth doing, and neither is a re-run

**Read one failure to the end.** The message usually names the line, the file, or the missing thing. In
the night above, the first failure read would have said `base is not defined` and named a fixture nobody
was looking at.

**Ask whether the gate's OWN command is what you ran.** That is a fact about your command, not a new
experiment: `deno task check` is not `deno test`. Measured the same night: the two differ in three ways,
and the whole 'why do I keep getting different failure counts' question was partly this.

## The exception, stated so it is not a loophole

A test that fails ONLY under a condition is real, and finding it may need a second run - but the ORDER is
what matters. **First get the failure's reason under the condition you are in.** Then, if the reason is
'these two tests share a resource', the second run is there to CONFIRM a mechanism you can already name,
not to look for a greener number. 'It went green that time' is not a finding.
