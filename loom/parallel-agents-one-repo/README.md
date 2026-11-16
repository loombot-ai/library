---
name: parallel-agents-one-repo
description: Read before editing a repo you are not the only writer of — the DEFAULT is your own git worktree, the one exception, and what sharing the tree measurably costs
as_of: 2026-09-16
---

# One repo, writers you did not start

The dangerous other writer is not one you spawned. It is one that **already existed**, that nobody
told you about, and that you have no way to list. So the default assumption is: **you are probably
not the only writer, and you cannot enumerate the others.**

Measured in one repo on 2026-09-16, while doing nothing but ordinary work in it — **four concurrent
agents on one workdir**, three of them invisible to the fourth:

| pid   | up              | cwd              | reaches this repo             |
| ----- | --------------- | ---------------- | ----------------------------- |
| 89282 | 21m             | this repo        | the agent doing the measuring |
| 70204 | 1h34m           | this repo        | yes — the one that had hung   |
| 91279 | 14m             | a DIFFERENT repo | via `--add-dir`               |
| 18237 | >24h, suspended | a THIRD repo     | via `--add-dir`               |

**Two of the four were editing this repo from a cwd in a completely different repo.** In the same
session **HEAD moved three times** underneath the measuring agent — `8bf0dad` → `27c0923` → `aaf3813`
— and a fourth commit swept its uncommitted edits into someone else's commit.

Isolation is what makes that assumption safe rather than frightening. A worktree silently omits every
UNTRACKED file, so it is not free of conditions — but that is a reason to name the exception, not a
reason to make sharing the tree the default. **Take a worktree by default.** The check below is what
tells you when you are the exception.

## Decide first: does the work touch tracked files only?

```sh
git check-ignore -v <a path you will edit>   # exit 0 means a worktree WILL NOT have it
```

- **Tracked only** (source, tests, docs) → **use a worktree. This is the default, and it is nearly
  always what you want.**
- **Touches gitignored paths** (a workdir's `.loom/library`, session data, logs, local scratch) →
  **share the tree. This is the exception, and it is the only one.**

Measured in one repo: `.loom/` is ignored via `.gitignore:14`, and a fresh worktree contains no
`.loom` at all. An agent sent to audit `.loom/library/*/README.md` from a worktree finds an empty
directory, and then either invents a parallel copy that never merges back or concludes the entry does
not exist. Both are worse than the interference isolation was meant to prevent. `$HOME/.loom/library`
is an absolute path outside the repo, so a **personal** library entry stays reachable and writable
from a worktree; only the WORKDIR `.loom/` is missing. The workdir LIBRARY is the exception, for a
sub-agent: its parent TELLS it which loom folder it belongs to. `startWorker.agent(name, dir, task)`
gives the child YOUR loom folder by default, so a child in a worktree reads and writes your
project's `.loom/library` — named in its prompt by absolute path, and granted. Pass
`{ loomDir: "/abs/path/.loom" }` for a different one (absolute, inside your workdir or an
`--add-dir`). Nothing searches upward: `loom` run BY HAND from inside a worktree uses that worktree's
own `.loom/`, so start a human run from the project root.

## What a worktree does not protect

Two things survive it, both measured on 2026-10-05 in this repo while another session worked in the
main tree:

- **The merge.** A worktree isolates your EDITS, not the trunk. When the other writer has uncommitted
  changes to a file your branch also touches, git refuses your merge outright ("Please commit your
  changes or stash them before you merge") - and stashing their work is not yours to do. Rebase once
  their file is committed, or wait; do not force it.
- **Test selection run from the main tree.** `tools/test_changed.ts` selects what `git status
  --porcelain` reports, so run in the main tree it pulls the OTHER writer's half-finished files into
  your test set. Run it inside the worktree.

And the first trap in a worktree is mundane: `cd` into it. A stray `cd` to the main checkout runs the
other lane's tree, where old test names pass against the module you did not change - three writers in
one day proved nothing that way.

## Establish your OWN identity before reasoning about "other" processes

Do this first, because every later count depends on it. **Do not assume the pid you were handed, or
the pid of the thing you are debugging, is you.** Walk the ancestry from your own process up through
its parents to the run that owns you.

Measured, as a mistake actually made: an agent debugging a hung process assumed it WAS that process
(70204). Walking the chain — repl ← repl host ← the run's main ← shell — showed it was 89282. A whole
session went on attributing another agent's hang to itself, and the arithmetic built on top was wrong
too: it reported "three runs name this workdir, none spawned by me" when the count included itself.

A parent and its children share a cwd, so **anything counting processes by cwd counts your own
workers as strangers.**

## Do NOT try to enumerate the other writers

A process scan looks like the obvious move. It was tried and produced a confident wrong answer twice,
which is worth more than the command would have been:

- Scanning by CWD flagged **seven pids** as "other writers". **Five were the scanning agent's own
  children** — repls and workers, sharing its cwd.
- Two genuinely independent runs had their cwd in **other repos entirely**, while editing this one via
  `--add-dir`. So cwd does not even identify which repo a run edits: the scan missed the real other
  writers while reporting five false ones. Cwd-based detection is not merely unreliable, it is
  actively misleading.

What is cheap and exact is **the repository's own state**, sampled before you start and again before
you commit:

```sh
git rev-parse --short HEAD   # before you start, and again before you commit
git status --porcelain       # dirt you did not create is proof of another writer
```

A HEAD that moved, or dirt you did not create, is proof of another writer without naming it. Prefer
evidence you can trust over an inventory you cannot.

Two things follow, and they are what most advice on this subject gets wrong:

- **"Ask the other writer" and "coordinate with it" are not available.** There is nobody to address.
  Every defence has to work without contact.
- Isolation is not a courtesy for delegation you control. It is the **default for any tracked-file
  work that spans more than one turn.**

## A process already running cannot receive your fix

Measured: the hung run (70204) started at 12:13; the fix for its hang was committed at 13:36. It was
still frozen at zero CPU afterwards and **could not benefit** — a running process does not reload an
edited source file.

So when several agents share a workdir, "I fixed it" means **"newly started runs are fixed"**. The
ones already up need a restart. Never report a source fix as if it repaired a process that is already
running; say which of the two you mean.

## The mechanism is `git worktree`, never `clone` to a temp dir

```sh
git worktree add --detach "$TMPDIR/w-<id>" HEAD    # measured: 118 ms, 2.0 MB — shares the object store
# ... work, test, and commit onto a branch in the SAME repo
git worktree remove --force "$TMPDIR/w-<id>"
git worktree list                                  # CHECK: leaks are invisible otherwise
```

- `/tmp` is not writable in a loom run; `$TMPDIR` is, and is cleaned up per run.
- A `clone` cannot push to a non-bare checkout's current branch, so "push back" needs a remote dance
  a worktree does not. A worktree commits straight onto a branch in the same repo.
- **A worktree pins HEAD, and that is the point** — the baseline cannot move underneath you. If you
  brief someone else into one, say so, or it will "helpfully" pull and undo the isolation.
- Leave a worktree in place if someone else must integrate the branch: removing it makes the commit
  hard to find.

### Costs measured, so the trade is explicit

From one repo (a Deno codebase, ~480 tests); the shape generalises, the seconds do not.

|                                           |                                                              |
| ----------------------------------------- | ------------------------------------------------------------ |
| `worktree add`                            | 118 ms, 2.0 MB (133 ms on a second measurement)              |
| Full suite in a fresh worktree            | 66.5 s — same result, no dependency re-fetch, no extra setup |
| Two suites CONCURRENTLY (main + worktree) | 66.5 s total — parallelism is free                           |
| Do tests dirty the tree they run in?      | No — `git status` clean after                                |

Concurrent test runs costing nothing over one run is what makes this worth doing at all. In an
ecosystem whose dependencies live **inside** the checkout rather than in a shared cache
(`node_modules`, a `.venv`, `target/`), a fresh worktree pays an install and a cold build instead —
measure it once before assuming the table above transfers.

## What isolation actually fixes (counted, one session)

Four interference events in ~4 hours. None lost work; **all four were confusion about whose change
was whose**, and each cost turns:

1. A brief's absolute test count (394) went stale mid-flight because another writer committed 3
   tests. ~10 turns went on proving the agent's own change innocent. → a worktree fixes this; so does
   a relative baseline.
2. Work landed on top of someone's half-finished refactor in two files it had to read. → worktree
   fixes.
3. A whole-tree format check failed on **another writer's** in-flight hunk, polluting the verification
   gate. → worktree fixes.
4. Another writer's edits got reported as "not mine". Correct behaviour, still a cost. → a worktree
   would fix it, but that task required the workdir's gitignored `.loom/`, so it could not have one.

What isolation does **not** fix: a change broken inside its own change set (a deleted field two
importers still used, breaking `--help`). Isolation is not review.

Two writers editing the SAME file never happened — because the briefs named disjoint paths. Naming
paths is the cheap half of the fix and belongs in every brief regardless.

## When you must share the tree

- Expect that others are editing, and **report** unexpected dirt rather than reconciling or
  reformatting it. This is the behaviour that makes sharing survivable.
- **Scope the repo-wide gates.** A formatter or linter run over the whole tree turns someone else's
  work into your failure. Check the file list, and only own the paths in your brief.
- Baselines must be **relative** — "the same count as the HEAD I started from, measured per file" —
  never absolute. An absolute number is a claim about a moving tree.
- **Re-check HEAD before you commit.** If it moved, say so, and do not assume a gate result from
  before the move still describes your change.
- **Commit each finished piece promptly.** The damage measured here came from edits sitting
  uncommitted across turns, not from sharing the tree: your working-tree edits can be swept into
  somebody else's `git add -A`, and nothing warns you. A commit cannot be swept up.

## The trigger, stated without delegation in it

You are about to edit tracked files in a repo someone else may also be writing, and your edits will
sit uncommitted across more than one turn. That is enough — no second writer needs to be known about,
let alone spawned by you. Apply the `git check-ignore` test, and if the paths are tracked, take a
worktree for your OWN edits.

```sh
git worktree add --detach "$TMPDIR/w-self" HEAD   # 133 ms, measured again in the same repo
cd "$TMPDIR/w-self" && <your build or typecheck>  # clean: dependencies resolve, no extra setup
```

### The honest cost, so this is a judgement and not a rule

The person you are working for may be WATCHING the main tree. Work in a worktree and your in-progress
edits are invisible there — they cannot read the diff, and a file they open is the old one. For a long
change that is worth it; for a two-line fix they are waiting on, the collision costs less than the
confusion. What is never right is multi-turn uncommitted edits in a tree others are committing in,
having considered none of this.

## When YOU are the one handing out the work (added 2026-10-18)

Everything above is written for the agent about to edit a file. The same question has a second
audience, and it asks it EARLIER: **the one starting two sub-agents.**

Two sub-agents are two writers. Giving them one tree reproduces exactly what this entry is about, with
one extra cost - the failures they see are now about each other, and telling those apart from real
failures costs a turn each time. Measured the same night:

    sub-agent A removed a constant from a client page (all of ITS checks green)
    sub-agent B's suite then failed 15 tests, all `No matching export ... for import "base"`
    neither was wrong; the shared tree was

So: **one worktree per sub-agent, from the start.** The thing worth sharing between them is CONTEXT -
which files the other one touched, which card it holds - and context lives in an agent, not on disk.
Sharing a working directory is not sharing context; it is only sharing collisions. A group of agents
that must agree on a file should be ONE agent, because that is the only arrangement where the
agreement is free.

The trap is that the two feels like one decision. They are not: the second agent's brief should say
which paths are ITS and which it must not touch, and `git worktree add` is a line in that brief.

## Do not run a suite over a tree that is being written

A full test run is a MEASUREMENT, so it needs the same precondition as any other: the thing measured
must hold still. Two agents editing one tree means it is never still, and the result is not a weaker
signal - it is not a signal at all.

Measured 2026-10-18: a suite went 0 failed (tree quiet) -> 98 failed (two sub-agents mid-edit) -> green
again (they finished). Three runs, three numbers, and only the first and last describe the code.

    git status --short        THE READING. Before a full run: is anything modified that is not mine?
                              If yes, the run will report on work in progress.

```sh
git status --short | grep -v '^$' && echo 'someone else is mid-edit - do not read a full run as a verdict'
```

The cost is not only a wrong number: that run took **16 minutes**. A run whose result cannot be acted
on is the most expensive kind, because it looks like work.

## `git add <a directory>` is not "this change" (measured 2026-10-18, twice in one hour)

A change has a shape that a directory does not. Both halves of this happened while committing another
agent's finished, verified work:

    9aa7960  git add client/            left tests/web_test.ts behind - three assertions in it pinned
                                        the very contract the change replaced, and the file is not
                                        under client/. main then held a new shape and an old
                                        assertion, and the next full run read 98 failures that were
                                        nobody's in-progress work: they were the gap.
    bb40a59  git add client/            left relay/peer/client.ts behind - it carries the mechanism
                                        of a reading that had just been verified, and it lives under
                                        relay/. A sub-agent had to point it out.

The second one is the instructive one: the reaction was to ADD THE MISSING FILE, which fixes the commit
and teaches nothing. The question worth asking is why the file was invisible, and the answer is that the
directory was being used as the boundary of the change. It is not a boundary; it is a place.

    git status --short        before committing: are there modified files this change means?
    git log -1 --stat         after: does the stat look like the change you described in the message?

**And state the change's boundary in the commit message.** "a session switch is a navigation" names a
behaviour; the files that implement it are in client/, and the files that ASSERT it are in tests/. A
message that names the behaviour is checkable against the stat; a message that names a directory is not.

Two hazards in the same area, so they are written together:

- **A shared index is shared state.** `git commit` commits what is STAGED, and another agent's staged
  files are in there too. `git commit --only <your paths>` is the way (a sub-agent used it; unstaging
  first also works). A hook may then complain about files that are not yours - that is this trap.
- **Do not read a suite's verdict on a tree being written.** See the section above; the two are one
  habit: make the tree consistent, then make the reading believable.
