---
name: briefing-a-subagent
description: "Read before handing work to a sub-agent — what a brief must contain to come back verified rather than plausible, and when delegating costs more than doing it yourself"
as_of: "2026-11-06"
---

# Briefing a sub-agent

The prompt already tells you the **mechanics**: `await startWorker.agent(name, dir, task)`, that it reports on
its own, that `stdin` redirects it without losing what it learned, that it costs process budget — and
that **every worker the child STARTS costs a slot too**, so a brief that tells it to start a channel
server and also run code has to leave it room (`DEFAULT_SUB_BUDGET`, or `procBudget` if you set one). None of
that is the hard part. The hard part is that a sub-agent is the only tool you have whose output you
cannot inspect — you get prose, and prose is exactly what a language model produces when it has not
done the work. **A brief is the only lever you have on that.**

Measured across four sub-agents in one session, all four returned work that passed a gate I then
re-ran myself. Two of them corrected me on something I had asserted. What follows is what those briefs
had in common.

## Do not delegate to save yourself thinking

Delegate for **wall-clock parallelism** or for **context you do not want to spend**. Not to avoid
understanding the problem: you cannot write a brief for a problem you have not framed, and a vague
brief comes back as a vague answer that you then have to redo. The four that worked were all framed
first — I had reproduced the bug, or measured the failure, or named the exact files, before writing a
word of the task.

**The cheapest test: if you cannot say what evidence would prove it done, you are not ready to
delegate it.**

## Resolve the ambiguity first, then hand it over

Xiaohu, 2026-10-02: "You should delegate sub tasks to subagents once you resolved the ambiguity."

The framing test above ("can you say what evidence would prove it done?") is necessary and not sufficient:
what makes a brief delegable is that **the decisions are already made**. A brief that carries an open design
question hands over the thinking, and the child answers it — plausibly, and without the context that made it
a question in the first place. So the parent resolves and the child implements:

- **The design settled, in the brief's own words.** Measured 2026-10-02: the `loom` object is documented as
  "facts, never verbs" and is frozen, so `loom.processes` had to be a GETTER reading `ps`, not a verb — a
  decision the child could not have made well, and once made, three lines of brief instead of a debate.
- **The measurements already taken**, as measurements with their method, so the child falsifies them
  instead of re-deriving them.
- **The traps it would otherwise pay for**: the module cache that serves pre-edit bytes; a test file that
  pins the same string the change edits; which lane failure is a known flake, and the line it fails on.
- **Boundaries by path** — and with several children running at once, ONE WRITER PER FILE, because the
  second writer to a hunk destroys the first one's work.
- **What you will check yourself**, so the report is shaped like the verification: the exact test files,
  whose exit codes the parent re-runs rather than reads.

What the child gets in exchange is a task with no open question to resolve badly — which is also why the
brief can be short about everything else. Across four briefs written this way in one afternoon, every result
passed the parent's own re-run, and two came back correcting the parent: one found a test that named a
label the change had renamed and would have failed the lane, the other found that the parent's own new
tracking doc broke `deno fmt --check` and was blocking it. Neither correction was in the brief; both were
possible because the brief said what "done" meant.

## Six things a brief needs

**1. What you already measured, so it is not re-derived.** This is the highest-value paragraph and the
one most often left out. Every number you hand over is a probe the sub-agent does not have to run, and
more importantly it is a claim it can _falsify_ — which is how you find out you were wrong. State them
as measurements with their method, not as conclusions. When what you measured is a PICTURE — the mockup,
the broken render — hand it over rather than describing it: a task is a list,
`startWorker.agent(name, dir, [brief, await read("shot.png")])`, and the child sees it in its first request.

**2. The traps you already hit.** Verbatim, with the symptom. Mine, from one session: `deno task test`
writes its summary to **stderr**, so `| grep` on stdout returns nothing silently — I lost four runs to
that before writing it down. `btoa` is Latin1-only, so an em-dash in a probe throws. `/tmp` is not
writable but `$TMPDIR` is. macOS has no `timeout` binary. Each of those costs a sub-agent a cycle to
rediscover, and a cycle is minutes plus a chance of a wrong conclusion.

**3. What "done" means, as a command with an expected output.** Not "make sure tests pass" — the exact
invocation, the baseline number, and the instruction to **read the exit code rather than parse text**.
Give the count: "baseline is 482 passed / 0 failed / 4 ignored; do not change that number unless you
are adding a test, and say so if you do."

**4. Where the boundary is.** Which files and directories are yours, which belong to other agents, and
that it must not touch them. With more than one writer this is not politeness — a sub-agent that edits
a file another one is mid-refactor on destroys both efforts. Name the paths.

The LIBRARY boundary is set at spawn, not in the brief: a child's workdir library is
`<loomDir>/library`, and `loomDir` defaults to YOUR loom folder — so a child in a worktree already
reads and writes your project's entries, and needs no absolute path to `working-in-this-repo` pasted
in. Pass `startWorker.agent(name, dir, task, { loomDir: "/abs/.loom" })` only to give it a different
one; a relative `loomDir` is refused.

**5. Permission to disagree, and it has to be explicit.** "Tell me if you conclude I am wrong; I would
rather be corrected than agreed with." Two of four came back correcting me — one showed my proposed
deadline was **below** a floor that made it actively wrong, the other showed a guard I called redundant
was the only enforced one. Neither would have said so unquestioned: the default posture of a sub-agent
is to deliver what was asked for.

**6. The standard of evidence.** "Numbers, not adjectives." And for anything touching a guard: **break
it, confirm the mutant COMPILES, run the test, restore it** — a mutant that does not build is not
evidence, and a surviving mutant means the guard is untested. Ask for the survivors by name; they are
the most useful thing in the report.

## Deliberately leave the answer open where it is not yours to fix

If you are unsure of a value, **do not supply it**. Ask for the measurement first and the decision
second, and say that "no evidence yet, so leave it unchanged" is an acceptable answer. I asked for a
timeout to be lowered from 600s to 180-240s; the brief said to record per-turn latency first and _then_
choose. It came back with 600s unchanged and the arithmetic showing my range was below the layer
beneath it — the right answer, and a brief that had specified the number would have got the wrong one
implemented cleanly.

## Verify the report before you relay it

A sub-agent's report is a **claim**, and relaying it as fact is how a plausible-sounding number reaches
whoever asked you. Every time: re-run the gate yourself, in its tree. Today one reported three clean
suite runs and my own run of the same tree failed twice — the difference was real (a load-dependent
flake) and worth knowing about before I repeated the claim.

Two specific checks worth doing every time:

- **Re-run the gate in its worktree**, reading exit codes.
- **Merge dry-run before merging** (`git merge --no-commit --no-ff`), then look for the _interaction_
  rather than the conflict. Two changes that both touch an abort path can auto-merge cleanly and still
  defeat each other; git will not tell you.

## When a sub-agent stalls

It reports on its own, so **do not poll it**. If it has genuinely wedged — check `workers.<name>.status()` for
status and quiet time, and read its worktree for progress before deciding — send it a message. Killing
and re-spawning throws away everything it has learned. One of mine lost a turn to a provider wedge with
68 lines of uncommitted work in its tree; a two-sentence message resumed it, and it finished. **Tell it
to commit as it goes**, so a wedge costs a turn rather than the work.

## HANDING OVER: THE WORK IS A CARD, AND THE REPORT IS AN AUDIT (2026-11-06)

Measured on 2026-11-06: one sub-agent got **six rounds** of instructions - a brief, then five `stdin`
follow-ups while it worked. It reported green gates, mutations and screenshots, and had **silently
dropped items from rounds three and four**; the owner found them one at a time on the deployed page.
Neither cause is carelessness: **a follow-up is not in the brief the agent is working from**, and **the
agent's success criterion IS its brief**, so a dropped round is invisible from inside.

- **The card is the brief.** Numbered acceptance items, the owner's words verbatim, and the reason for
  each. Every later instruction is an UPDATE to the card, and the message says so: `card <id>, new item
  N: ...`. One list, growing in one place.
- **The report ends with a table**: `item | done? | where (file:line or test) | evidence`, one row per
  numbered item **including the ones added mid-flight**. An agent asked for that table finds its own
  gaps; an agent asked for a summary does not.
- **Number the items.** "Delete the developer block and the phone" is two items, and the second is the
  one that gets lost.
- **Say which items are decisions.** "Check whether the consent flag is really read; if it is, stop and
  tell me" is not "delete the consent control" - only one survives contact with the code.
- **Do not stack a seventh round on an agent that has not audited six.** Ask for the table first.

AND WHEN THE WORK IS SMALL, DO NOT DELEGATE: one or two copy deletions cost more in brief, wait,
audit and fix than the edit itself. Delegation pays for work with its own gates - a check run, a
browser rig, a deploy.
