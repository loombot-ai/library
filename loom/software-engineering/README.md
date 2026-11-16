---
name: software-engineering
description: "Read before changing code you did not write — how to make a fix that holds, and verify it before saying it is done; and whether to take a git worktree, because another session is probably writing the same repo"
as_of: "2026-10-10"
---

# Changing code you did not write

Every lesson here came from a change that looked finished and was not, and each one cost the work twice. None of them are about being careful in general; they are the specific places the illusion of being done comes from.

## Fix the class of bug, not the example

A report shows you one case. The defect is a mechanism, and the case is one thing the mechanism does.

Measured: a fix for subscript splitting of `ω0` handled exactly that spelling, ran the existing test file, saw it pass, and reported "Fixed." The same mechanism was broken for non-ASCII _digits_ (`w𝟙`, `ω𝟙2^3α`), which nobody had written a case for yet.

So after you have a fix, ask what else reaches the code you changed. Different alphabets, empty input, malformed input, more than one occurrence, the boundary at zero and at one. Write your own cases for those before you believe the fix — a passing run of the tests that already existed only tells you the old cases still work.

## Your fix can break something that already passed

This is the failure that costs most, because everything looks right.

Measured: a change to `modify_sys_path()` was correct — the reported bug was genuinely gone — and it broke one unrelated test, `test_jobs_score`. 121 of 122 existing tests passed. Seventeen turns of correct work had to be redone because of a test that was never run.

So before you say you are done:

- Run the whole test **file** covering what you changed, not just the case from the report.
- Notice when your diff touches something reached from many places — `sys.path`, a config default, a base class, an `__init__`, a shared helper. That is where a local fix has non-local consequences.
- If you can name a second caller of what you changed, run its tests too.

The check is cheap next to re-doing the work.

## A check you did not read is not a check

Measured: `deno lint 2>&1 | tail -1` printed `Checked 59 files` and the command exited on that line — while three `no-unused-vars` errors scrolled past above it. The change was committed as verified. The pipe that was meant to keep the output short is what hid the failure.

So when you reduce a check's output, reduce it in a way that cannot hide a failure: read the exit code, grep for the failure marker, or print the tail AND the count. `| tail -1` answers "did it finish", never "did it pass".

## Do not make the test agree with you

When a test fails after your change, the test is evidence. Editing it, loosening its assertion or skipping it converts a real failure into a hidden one, and the next person pays.

Change the test only when the behaviour it asserts is the thing you were asked to change — and say so plainly when you report, because that is a decision someone may want to reverse.

## A guard nothing can violate is not tested — break it and see

A test that passes against the fix and against no fix at all measures nothing. So **break the thing on
purpose**: revert the guard, confirm the mutant **compiles** (one that does not build is not evidence),
run the test, restore it. A mutant that survives is a defect in the **test**, not the code.

This pays in a way that is easy to underrate. Across one session, of eleven mutants written for new
guards, **four survived their first attempt**, and every survival named a real hole:

- A log assertion could not test a drain at all — the log is written whether or not anyone awaits it.
  What the await bought was _order_, which is what the assertion had to become.
- A flag set synchronously by `stop()` could not distinguish an awaited stop from a fire-and-forget one.
- A timing constant turned out **not pinnable by behaviour at all**: at 0 the code still delivered every
  line, because the promise it raced had usually already settled and won in microtask order. It became a
  range, which is honest, where an equality would have been a lie that passed.
- A containment check missed a **prefix** case: without a separator, `/tmp/granted-evil` passes for a
  grant of `/tmp/granted`.

**Mutate in BOTH directions.** Loosening the guard is the obvious mutant; also **over-tighten** it — make
it refuse something legitimate. A guard that refuses too much is a real bug and a loosening-only mutant
set cannot see it. Two of that session's mutants were over-tightenings ("also reject an absent value",
"404 for a case that is merely declined") and both caught assertions that were too weak to notice.

**Check the assertion you just added is actually there.** A `replace` that silently matched nothing, on a
line the formatter had already reflowed, is why one mutant "survived" twice: the test kept passing and
the mutant kept living, for two reasons that looked like one. Grep for the new assertion's name before
believing a mutation result.

### The five shapes of an assertion that was already true

Mutation catches these, but recognising the shape is faster than discovering it. Five times in one
session a test passed, looked like evidence, and was not — every one asserting something **already true
before the change**. Such a test is worse than none: it is counted as coverage and it makes the next
person confident.

1. **Text that was already in the file.** A prompt test checked for a string that appeared in several
   bullets already, so it passed before the change it was written to verify. Assert the phrase only the
   NEW text carries.
2. **The implementation's own oracle.** Comparing output against a value computed by the code under test.
   A bug is on both sides and cancels.
3. **A property the mutant also satisfies.** Surrogate-safety checks on a trim that slices by UTF-16 units
   where bytes were meant: it does not split characters, it OVER-cuts — valid text, every check green,
   3,795 bytes delivered where 4,045 was correct. Assert the BUDGET too; a mutant that satisfies your
   property rarely also hits your number.
4. **The bug as the contract.** Tests written against observed behaviour pin the bug, and fail when it is
   fixed. Write against the intended contract, then falsify.
5. **Catching your own throw.** `try { … } catch` that swallows the harness's formatted failure makes the
   feature under test invisible. If the harness formats it, let it throw.

**And the mirror, which is worse because a red result feels like evidence: a negative assertion that
fails because the probe never reached the thing.** "Not found" and "never looked" are indistinguishable
unless you also assert the probe hit something — check a positive control in the same run.

### Provenance is part of the assertion

When a test encodes a number someone GAVE you — "394 tests must pass" — record that it was given. A
sub-agent spent ~10 turns and a context compaction proving its own change innocent of a stale baseline
from its brief, because the number survived in the test and the fact that it was an ASSUMPTION did not.

## Two people disagreeing about a number is a signal to measure, not to explain

When someone contradicts a number you reported, the disagreement itself is the finding — and the
temptation is to explain it. Explanations are cheap and usually wrong: in one exchange the reviewer's
count differed from mine, I proposed a mechanism (files a tool walks that a fresh checkout lacks) and
they proposed another (a tool version difference). **Both were wrong**, and the measurement that settled
it took one command: append deliberately malformed text to a file the tool supposedly checks and see
whether the count moves. It did not, which killed my theory instantly.

A number two people disagree about is nearly always cheaper to measure than to argue about. Measure
first; the explanation you were about to offer is a hypothesis, not an answer.

## A type is not a guard where the boundary is JSON

A TypeScript union constrains **the callers you wrote**. Where the real boundary is an HTTP body — a
route, a queue message, a config file — the type has already stopped being a guarantee by the time the
value arrives, and the runtime will happily accept anything the wire carried.

The cheap sweep: grep for `as unknown as` and for casts **at a route handler**. One repo had three
instances of the same shape; in the worst, an unknown `kind` field fell through an `if` to the _more
privileged_ branch, so a body naming nonsense got the powerful default. It was unreachable through the
typed client and fully reachable with one `fetch`.

Enforce it where **both** paths meet — the shared function, not the route — and test it at the untyped
surface. A test that goes through the typed client proves the client is typed, which nobody doubted.

## Are you the only writer of this repo?

You are probably not, and you cannot list the others. Measured in one repo: four concurrent agents on one
workdir, three of them invisible to the fourth, two editing it from a cwd in a different repo, HEAD moving
three times underneath the one doing the measuring, and a commit that swept somebody's uncommitted edits
into itself.

The trigger is not "I know of another writer". It is: **you are about to edit TRACKED files, and your
edits will sit uncommitted across more than one turn.** That is enough to decide on, and it needs no
second writer to be known about.

```sh
git check-ignore -v <a path you will edit>       # exit 0: a worktree WILL NOT have that path
git worktree add --detach "$TMPDIR/w-self" HEAD  # tracked files only = isolate your edits
```

- **Tracked files only** — source, tests, docs — take a worktree. A fresh worktree contains no gitignored
  path at all, which is why the check comes first: anywhere this project keeps session data, logs or a
  library under an ignored `.loom/`, a worktree has no copy of it, so a task that touches those must
  SHARE the tree instead.
- **When you do share it**: report unexpected dirt rather than reconciling or reformatting it; scope
  repo-wide gates (a formatter, a linter, a whole-suite run) to your own paths; state baselines as "the
  same count as the HEAD I started from", never as an absolute number; re-check HEAD before you commit;
  and commit each finished piece promptly, because uncommitted work across turns is exactly what gets
  swept up.
- **The honest cost of isolating**: the person you work for may be reading the MAIN tree, where your
  worktree edits are invisible — they cannot see the diff, and the file they open is the old one. Worth it
  for a long change; for a two-line fix somebody is waiting on, the confusion costs more than the
  collision. What is never right is multi-turn uncommitted edits in a tree others are committing in,
  having considered none of it.

The measurements behind this, and the traps in taking a worktree in this project, are in the sibling
entry `parallel-agents-one-repo` — read it before your first worktree rather than after.

## Check what branch you are on, before the first edit and before you report

**A session inherits whatever branch the last one left.** Nothing tells you; `git status` is not in your
face, and the work proceeds perfectly well on a branch that has nothing to do with the task. Measured
2026-09-17: a feature branch called `flags-mcp-and-provider-spec` accumulated **96 commits and 213 files
(+18,772 / −5,833)** across several sessions, covering an HTTP server, a Slack channel, gym samples and
library edits — none of which had anything to do with flags, MCP, or provider specs. `main` had not moved
in four days. Every session did clean work and none of them asked the question.

Two checks, and the second is the one that gets skipped:

- **Before the first edit**: `git branch --show-current`. If the name does not describe the task you were
  just given, say so and ask — do not silently continue. A branch named for last week's feature is a
  statement about what the diff contains, and it will be wrong.
- **Before you report done**: if the work is finished and reviewable, it belongs on the mainline. Ending a
  session on a branch nobody asked for leaves the next session to inherit it, which is how 96 commits
  accumulate one reasonable step at a time.

**The failure is not merge conflict.** A fast-forward merge of that branch was clean. The cost is that a
diff of 213 files stops being reviewable, so decisions made on day one get re-litigated on day four because
nobody has seen them — and any of that work that was wrong stayed wrong for four days longer than it had
to.

When you do land it, gate the merge and gate again afterwards: `git merge --ff-only` so an unexpected
divergence FAILS rather than quietly creating a merge commit, then run the suite **on the mainline**. A
merge that printed no conflict is not evidence the merged tree works.

## Verify the COMMIT, not the working tree

## Do NOT measure a baseline you were handed

**A full suite run to learn the number your brief already states is five minutes for nothing.** Xiaohu,
2026-09-24: "Do we still run a baseline test before every implementation? I think it's not needed. If a test
failed, then when we debug, we can run the failed test on the baseline. Not everything on the baseline which may
be slow."

So:

1. **No baseline suite.** Take the stated number. If nobody stated one, run the suite ONCE and say so.
2. **When a test goes red, A/B the FILE, not the tree** — that file alone on your branch, that file alone on the
   base. Two commands, under a minute, and it separates "my change" from "the machine" definitively. Measured
   twice in one night: two red gates, two different files, both green alone on both bases, both caused by another
   agent's suite running concurrently.
3. **One gate per BRANCH, at the end.** Not one per commit. Stack the commits, gate the stack. One agent spent ten
   minutes running the suite twice for two commits that landed together.
4. **Mutants run the targeted file.** A mutant whose own file's test cannot catch it is a mutant in the wrong
   place, and proving it with a whole suite hides that.

The one thing worth spending the suite on is the END: the tree you are about to hand over, clean, once.
A gate proves something about the tree it ran against. If that tree is not the commit, it proves nothing about
what you shipped. Two ways this went wrong in one day, both while following every other rule here:

- A green suite reported while **four files were still uncommitted** — a number describing a tree that would
  never exist again.
- Worse: a mutation run was mid-flight in one process while another **committed**, and the commit captured the
  MUTANT. A helper with its cookie deliberately removed went in as if it were the fix. The gate then hung for
  four minutes instead of failing, so the mistake announced itself as a timeout rather than as a wrong test.

So: `git status --porcelain` must be EMPTY when you gate, and the last thing you read before reporting is
`git log --oneline -1` — not your memory of what you committed.

## A mutation run owns the tree

Mutate, run, restore, and **verify the restore** in ONE action, with nothing else writing that tree until it
finishes. The discipline of breaking a guard to prove a test is worth keeping is already here; what it needs
is exclusivity, because a half-finished mutation is indistinguishable from a bug you introduced on purpose.

If a mutant leaves the suite HANGING rather than failing, that counts as killed — but fix the hang too, for
the reason in the next section.

## A workaround in a TEST deserves the same scepticism as one in production code

Measured: a 181-line loopback proxy existed in a test suite because "the client cannot send that header". One
live probe against the real thing showed the constructor takes an options bag and sends the header in it. The
proxy was careful, well commented, and unnecessary.

**Measure the constraint before you engineer around it.** And note why the tests could not have told you: a
workaround that works looks exactly like a workaround that was needed. Nothing about the suite passing is
evidence either way — only going and checking the claim is.

## A test that HANGS is worse than one that fails

`await new Promise((r) => sock.addEventListener("open", r))` has no bound, and a test runner usually has no
default timeout either. So a REFUSED connection is indistinguishable from a slow one: the suite prints "has
been running for over 4m" and names nothing. A failing test tells you what is wrong; a hanging test tells you
only that someone must eventually kill it.

Every wait gets a bound, and the bound's message names the likely cause — "never opened within 5000ms; a
REFUSED handshake looks like this". Measured after adding one: the same defect that hung for four minutes
failed 8 tests in 60 MILLISECONDS.

## Two failures that never throw

Neither announces itself: there is no exception to read, and a wrong result has exactly the shape of a
right one.

- **Driving a browser through an external driver (WebDriver / safaridriver).** The script handed to
  `execute/sync` is wrapped as a function BODY, so an IIFE with no outer `return` comes back as `null` —
  which reads as "that element is not there". Three Safari runs were spent on a panel that was present the
  whole time. Read `driving-a-browser-over-webdriver` before you believe a driver's negative.
- **A module imported by URL is cached for the life of the PROCESS.** After an edit, re-importing it in
  the same process serves the bytes from before the edit: your fix measures as not working and the harness
  serves the old page. Read `a-module-imported-by-url-is-cached` for the fixes that work and for the
  freshness flag to return beside every measurement.

Both are caught the same way — measure something whose answer you already know, before you believe the
part you do not.

## Say what you verified, not that you verified

"Fixed" is not a report. What holds up is: the change, what you ran, and what you did not check.

> Fixed `split_super_sub` to handle non-ASCII digits. Ran `sympy/printing/tests/test_conventions.py`
> (34 pass) and the pretty-printer file (142 pass). I did not run the full `printing/` suite —
> `latex` imports this path and I have not checked it.

That last sentence is worth more than the rest. It tells the reader exactly where to look if the fix turns out to be incomplete, and it stops a confident summary from standing in for evidence.
