---
name: repeated-work
description: "Read when something has to be waited on, polled, or done more than once — which shape to use, and why waiting is usually the WRONG move when other work is pending"
keywords: heartbeat, liveness, 心跳, 存活, 轮询
as_of: "2026-11-06"
---

# Work that repeats, and waiting for work that has not finished

A `repl_run` sends **one value, when its body ends**. So a callback cannot report for you: by the time a `setTimeout` fires, the body that scheduled it has already returned and there is nothing left to send. Everything below follows from that.

Six shapes, and the FIRST one is the one most often missed. Read the table, then the section.

| You want                                           | Use                                       |
| -------------------------------------------------- | ----------------------------------------- |
| **other work is pending and something is running** | **do the other work — see below**         |
| to come back to something later                    | `wait(seconds)`                           |
| to know when a long thing finishes                 | just run it — it is promoted, and reports |
| to watch something until it changes                | a loop inside ONE `repl_run`              |
| a side effect on a schedule, no wake               | a background process (`sh` + `&`)         |
| to be woken on a schedule                          | `await startWorker.shell(name, cmd)`      |

## FIRST: is waiting your last move?

**Before calling `wait`, ask what else you were asked to do.** A promoted `repl_run` keeps running whether you
wait for it or not, so waiting buys nothing that carrying on does not also buy — and carrying on answers
something in the meantime. `wait` is correct only when you genuinely have no other move.

This is the failure mode, and it is easy to miss because **every individual `wait` looks reasonable**: a long
job is running, you have nothing to add about it, so you wait. Do that ten times and the person who asked you
three questions an hour ago still has no answers, while the job would have finished at exactly the same moment.

**Measured, one session:** 21 `wait` calls, **110 minutes** of wall clock, of which **64 minutes across 7 calls**
ran the full ceiling with nothing arriving. One returned early. The eval being waited on was untouched by any of
it. During that time four separate questions sat unanswered — and the person had to say _"why not answer my last
question in the meanwhile?"_, which is the tell that this had gone wrong rather than a preference about style.

### The check, in order

1. **Is a question outstanding?** Answer it. Research, read code, write the doc — none of that competes with a
   subprocess for anything but your own turns.
2. **Is there independent work on the task?** A fix in another file, a test to write, a commit to prepare.
3. **Can the waiting itself be folded in?** Put one status check at the END of a `repl_run` that does something
   useful, and you learn where the job is _and_ make progress in one turn.
4. **Only now**, if none of those apply, `wait`.

### What it looks like done right

```js
// A 40-minute eval is running. Rather than wait on it, do the real work and take its
// pulse in the same turn — the status line costs one extra `sh` and no extra turn.
const [answer, status] = await Promise.all([
  researchTheQuestionThatWasAsked(),
  sh("kubectl exec pod -- tail -1 run.log"),
]);
return { answer, jobStatus: status.stdout.trim() };
```

**The exception worth naming:** when the next thing you do genuinely depends on the result — you cannot write
the fix until you see which test failed — then waiting IS the work, and `wait` is right. The question is
whether the dependency is real or merely tidy.

## Come back later — `wait(seconds)`

`wait` is a **native tool, not something you call in a `repl_run`** — there is no `wait` in the repl, so `wait(300)` inside a body is a `ReferenceError`. Call it the way you call `repl_run`, with `seconds: 300`.

`seconds` is a **ceiling, not a timer**: it gives up after that long **even with nothing else running**, but returns the moment anything arrives — a message, or a `repl_run` in the same turn answering. So it never costs you news, and it is never a way to sleep for a fixed time. Use it instead of sleeping inside a `repl_run`: a sleep holds the turn open and buys nothing.

`wait()` with no argument is a different request: "wait for work I already started". It returns at once if none is running, because then nothing is coming.

## A long thing — do nothing special

Run it. If it outruns its window the `repl_run` is **promoted**: the tool result says it is still running, you carry on with other work, and the value arrives later as a `[loom] repl:<name>` message. You do not have to poll, and you must not — `wait()` is there for when you have nothing else to do.

## Watch until it changes — one `repl_run`, one return

The loop goes INSIDE the `repl_run`, and it returns **when there is news**:

```js
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 30_000));
  const s = await check(); // whatever "check" means here
  if (s.changed) return s; // ← the only thing worth waking for
}
return "no change after 10 minutes";
```

This is better than a timer that reports every tick: you are woken because something **happened**, not because thirty seconds passed. Nineteen quiet ticks cost nothing at all.

Give it its own repl — call `repl_run` with `name: "watch"` and `create: true` alongside the `code` — so your main one stays free while it runs.

**Bound the loop.** An unbounded one holds a process until the run ends. Prefer a generous iteration count to `while (true)`.

## A side effect on a schedule — a background process, no wake at all

If the repeating work does not need to TELL you anything — refreshing a credential, rotating a file, keeping a cache warm — background it and forget it. A process started with `&` outlives the `repl_run` that started it:

```js
await sh("nohup sh -c 'while :; do refresh-creds; sleep 3000; done' >/dev/null 2>&1 &");
return "credential refresher started";
```

Measured: it keeps running across later turns and later `repl_run` calls. It costs you **nothing** — no LLM turn per tick, no process budget, no waiting — because nobody has to wake up for it.

**The redirect is not decoration: `&` ALONE DOES NOT BACKGROUND.** `sh` reads the command's stdout to end-of-file, and a backgrounded child inherits that pipe, so the read does not finish until the child does. Measured: `sh('sleep 3 &')` returned after **3022ms** — it waited out the whole sleep — while `sh('sleep 3 >/dev/null 2>&1 &')` returned in **11ms**. Redirect both streams, every time, or you have written a slow synchronous call that looks asynchronous.

**Keep the PID if you might want to stop it**, because loom cannot see this process: it is absent from `help(workers)`, `repl_stop` will not touch it, and nothing kills it when the run ends.

```js
const r = await sh("sleep 300 >/dev/null 2>&1 & echo $!");
pid = r.stdout.trim(); // a bare assignment, so a later call still has it
```

`echo $!` still reaches you because only the BACKGROUNDED command's streams were redirected, not the shell's. Then `await sh("kill " + pid)` — measured alive before, gone after. Without the PID you are reduced to `pkill -f '<pattern>'`, which will match anything else whose command line looks similar.

**This is the case for `startWorker.shell` over a backgrounded `sh`**: a worker has a NAME, so `stopWorker("hourly")` is a real kill with nothing to remember and nothing to match on.

## Be woken on a schedule — `startWorker.shell`

A shell worker runs a command and **every line it prints reaches you as a message**, even while you are parked. That is the one thing `sh` cannot do, since `sh` reports once, when the `repl_run` it is inside ends.

```js
await startWorker.shell("hourly", "while :; do sleep 3600; echo 'check the error count'; done");
// ...then get on with other work, or wait(). Each hour, that line wakes you.
```

Two things to know:

- **It keeps the run alive only while it speaks**, exactly like a sub-agent: a run that has answered waits the quiescence grace for it — two minutes — and then ends and stops it. So `stopWorker` one you no longer need — `await stopWorker("hourly")` — or a forgotten process holds the run for its two minutes. Measured on the tree before the grace landed: a `cat` left running turned a one-second test into a thirty-second one.
- **stderr goes only to its log**, so a program that natters on stderr cannot flood your context. `help(workers.<name>)` names its log folder — the harness decided it when the worker started, so it is documentation rather than state — and `workers.<name>.status()` says whether it is still running; read the log with code if you need it. A worker that has finished still holds nothing: `stopWorker(name)` on it just drops the record that was listing it.

You can also drive it — `workers.hourly.stdin(text)` reaches the real pipe — which is what makes an interactive program (a language repl, a debugger, an ssh session) usable at all.

**Do not use a sub-agent as a timer.** It costs an LLM turn per tick, and `wait` caps at 600 seconds, so "check hourly" becomes six turns an hour spent doing nothing.

## Stopping something you started

**A promise cannot be cancelled — JavaScript has no such thing.** What it has is COOPERATIVE cancellation: the loop checks a flag, and something else sets it. That works here with nothing extra, because globals persist across `repl_run` calls and a repl runs several at once:

```js
// one repl_run: the loop
running = true; // a bare assignment, so it survives this call
while (running) {
  await new Promise((r) => setTimeout(r, 1000));
  if (await somethingHappened()) return "here it is";
}
return "asked to stop";
```

```js
// a LATER repl_run, while that one is still going
running = false;
return "told it to stop";
```

Measured: the loop ends within one tick of the flag flipping. It works because the second call really does run while the first is still alive — that is what "a repl accepts another `repl_run`" means.

**Without a flag, your only lever is `repl_stop(name)`**, which kills the whole repl and everything in its namespace. That is why a long loop belongs in its OWN repl (`name`, `create: true`): stopping it then costs you nothing you wanted to keep.

**A `startWorker.shell` worker can be killed for real** — `await stopWorker("hourly")` sends SIGKILL, no cooperation required. That is the other reason to prefer a process for anything long-lived: not just that it can speak more than once, but that it can be STOPPED without asking it nicely.

## What is NOT available

- **Reporting twice from one `repl_run`.** Gather findings and return them together (`return { found, checked, failed }`), or split into separate calls. A shell worker is the exception, and being the exception is why it exists.
- **A `setTimeout` that outlives its `repl_run`.** It will run, but it cannot tell you anything, and it does not keep you awake.
