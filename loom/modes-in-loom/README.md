---
name: modes-in-loom
description: Read before deleting or unifying a loom flag that makes one entry point behave two ways - eleven of round 1's twelve modes are FIXED (commits and replacements in the body) and only `allowSh` is still live, the one capability no container can outsource.
as_of: 2026-09-25
---

_Copied from `loom-hq/docs/tracking/findings/modes-in-loom.md` in the loom repo; the document's own headings, mode numbers, commits and measurements are unchanged._

# The modes in loom

A MODE, per the standard set for this audit: one entry point that behaves qualitatively differently depending on a flag, an argument's presence, a config value, or hidden state — where a reader at the call site cannot predict which behaviour they get. The worked example is `wait()` before `ba56a26`.

**What I started from and what survived.** Mechanical sweep over `loom/` (excluding `tests/`, `gym/`, `tools/`, `docs/`): 60 boolean fields or parameters, 20 signatures with an optional parameter, 24 `x === undefined` / `!== undefined` presence checks, 8 `Deno.env.get` reads, 33 comments saying fall back / legacy / kept because. **12 survive the filter, 9 of them accidental and 3 essential.** The providers are the cleanest part of the tree: `openai.ts` and `factory.ts` have deliberately no env fallbacks and no defaults that change behaviour, and say so in prose. `wait()`, the thing that started this, is now genuinely single-mode — I checked the post-`ba56a26` body (`agent.ts:1567-1601` at `dbc76aa`), and the clamp is unconditional.

The 12 are below in report order = ranked order, most worth unifying first. Numbers 10-12 are ESSENTIAL and are ranked last deliberately rather than omitted. Mode 3 has since been re-judged ESSENTIAL on the evidence of its own fix (see "Fixed and removed from this list"), so the standing split is 7 accidental and 5 essential: mode 9 was MOSTLY ESSENTIAL with one accidental edge, that edge is deleted (`1d64ba4`), and soft vs hard — what remains of it — was essential all along. Being ESSENTIAL is not a reason to leave an item alone: 11 was fixed WITHOUT removing its two behaviours — the three names became one pair — and 10 was fixed outright.

**Re-audit on `next`, 2026-09-25 (HEAD `b53625a`).** The Method section was re-run over `loom/` and, this time, `loombot/` as well — the daemon has grown to 6,602 lines and several of the new candidates live there. Every item below was re-read in its current file and is cited by FILE AND SYMBOL rather than by line, because every line number this audit was filed with has moved at least once. What changed:

- **All eleven fixes still hold.** Each removed identifier is still gone from `loom/` and `loombot/` (table in "Fixed and removed"), and each replacement is where its entry says it is.
- **Mode 12 (`allowSh`) is still ESSENTIAL**, with more readers than it was filed with: seven read sites, not five. The first count missed `startWorker.shell` and the repl's `sh` binding. The binding reads the GRANT (`Deno.permissions.querySync`), not the flag, which strengthens the one property the entry praised.
- **The rest of the candidates the stack added are NOT modes**, and each has its reason under "Deliberately excluded": MCP `data` from structuredContent or parsed text, image-only sends, the snapshot caps, the `from` field, the one-line stdin init, and `LOOM_PROD`. Two of them turned up defects that are not modes. They are filed in [simplification-opportunities.md](simplification-opportunities.md), whose ranking covers duplication in general: the session label ignores a request that carries an image (repro there), and `ChatMessage` is `Record<string, any>`, which is why nothing caught it.

---

## 12. ESSENTIAL: `allowSh` — the same capability switch read in seven places

**The `allowNet` half of this item was REMOVED on 2026-09-22**, and the item is rewritten rather than deleted because what the audit is worth is the record of what was decided. Xiaohu's reason: the flag was useful for benchmarks and nothing else, and loom should not maintain a feature for benchmarks only — a benchmark that must not reach the network denies it from the CONTAINER side. It was also never the boundary its name implied: the grant was narrowed to the bridge port rather than dropped (the bridge is loopback HTTP, and `tools.*`/`workers.*` die without it), the harness still fetched a `url` handed to `tools.mount.mcp` on the repl's behalf, and with `allowSh` on, `curl` reached any host. `allowSh` cannot be outsourced to a container the same way, which is the whole asymmetry: loom spawns its own subprocesses — every repl is one — so a container that denied process creation would stop the harness together with the agent. One of the pair was externally enforceable and the other was not. Everything below is about `allowSh` alone, and the MODE is unchanged in shape: one switch, read in several places (seven, on the 2026-09-25 re-read), each with one fewer consequence.

**Where, re-read on `next` 2026-09-25.** The flag is parsed in `loom/flags.ts` (`allowSh: args["repl-sh"]`, which moved there from `main.ts`) and carried by `RolloutOptions.allowSh` (`loom/worker/rollout.ts`), which hands it to every agent's `caps` in two places (the root and each child). It is read at SEVEN sites: six consequences, plus the hand-down to children. The first count said five, and missed `startWorker.shell` and the repl's own `sh` binding:

| consequence                        | reader                                                                | spelling                                           |
| ---------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------- |
| the prompt's wording               | `buildSystem`, `loom/worker/system_prompt.ts`                         | `caps.allowSh !== false`                           |
| the verb help the prompt shows     | `verbNames` / `verbHelps`, `loom/repl/verbs.ts`                       | `caps[...] !== false` (fed `run` by `buildSystem`) |
| the repl's `--allow-run`           | `Repl`'s spawn, `loom/repl/repl.ts`                                   | `caps?.allowSh === false`                          |
| `sh` bound in the repl at all      | `loom/repl/js_repl.ts`                                                | `Deno.permissions.querySync({ name: "run" })`      |
| `startWorker.mcp` with a `command` | `#mountServer`, `loom/session.ts`                                     | `this.opts.allowSh === false`                      |
| `startWorker.shell`                | the `req.kind === "shell"` arm of the spawn, `loom/worker/rollout.ts` | `this.opts.allowSh === false`                      |
| children inherit it                | `rollout.ts`, both `caps:` blocks                                     | passed through                                     |

```ts
export function verbNames(caps: { allowSh?: boolean } = {}): string[] {
  const granted = (v: string) =>
    !(v in GATED_VERBS) || caps[GATED_VERBS[v as keyof typeof GATED_VERBS]] !== false;
  return [...BASE_VERBS, ...Object.keys(GATED_VERBS)].filter(granted)
    // `help` last: it is the one that explains the others, so it reads as the pointer it is.
    .sort((a, b) => (a === "help" ? 1 : b === "help" ? -1 : 0));
}
```

```ts
"--allow-net",
...(this.opts.caps?.allowSh === false ? [] : ["--allow-run"]),
```

```ts
if (s.command && this.opts.allowSh === false) {
  throw new Error(
    `mcp server "${name}": starting a \`command\` needs subprocesses, which this run denies ` +
      `(--no-repl-sh) — the child would be spawned by the harness at -A, past the flag. A remote ` +
      `server still works: startWorker.mcp("${name}", "https://…").`,
  );
}
```

```ts
if (Deno.permissions.querySync({ name: "run" }).state === "granted") g.sh = sh;
```

**The behaviours.** Granted: `sh` is bound, the repl process gets `--allow-run`, `startWorker.mcp` may start a local server, and `startWorker.shell` may start a process. Denied: `sh` is **not in the prompt's verb help and not bound at all** (so calling it is a `ReferenceError`). The repl has no `--allow-run`, and a `command` mount and a shell worker are both refused with a message naming the flag. The network is in neither column any more: every repl gets an unrestricted `--allow-net`.

**What selects.** One tri-state with two spellings. Wherever a PROMPT is built it is written `!== false` (`verbs.ts`, `system_prompt.ts`), and wherever something is REFUSED it is written `=== false` (`repl.ts`, `session.ts`, `rollout.ts`). Undefined means granted everywhere, consistently. One reader is NOT the flag, and it is the better design: the repl child binds `sh` by asking Deno whether it holds the `run` permission, so the binding cannot disagree with the grant. `repl.ts`'s spawn comment records the `LOOM_ALLOW_SH` env var it replaced.

**Judgement: ESSENTIAL.** This is a sandbox boundary, and the repo already pays the price that makes it honest: the prompt is built from the same `caps` (`buildSystem(caps, ...)`), so the surface advertised equals the surface held. Unifying it would mean either always granting subprocesses or never, and `session.ts` records what happens when a flag is documented but not enforced — two comments claimed that route enforced an `allowSh` rule that no code implemented.

**The one thing worth noting** — it is a REPEATED mode, in the sense the brief asks about: seven readers of one switch (five when first filed), each deciding a different consequence, none of them adjacent. The mitigation already in place is that the prompt and the grant are derived from the same value, so they cannot disagree.

**Blast radius** — seven read sites in six files. `allowSh` appears in `tests/rollout_surface_test.ts`, `tests/rollout_e2e_agent_test.ts`, `tests/mcp_test.ts`, `tests/rollout_batch_shell_test.ts`, `tests/loombot_loom_args_test.ts` and `tests/run_layout_test.ts` (plus `tests/rollout_fixtures.ts` and `tests/README.md`), so the split is thoroughly pinned. Still not worth touching.

---

# Fixed and removed from this list

Eleven items are gone because they are FIXED on main, not because they were reconsidered. Kept here as a record so
the numbering gaps are not read as omissions — and note the numbering of everything else is unchanged, so
"mode 7" still means what it meant.

**Re-verified on `next`, 2026-09-25 (HEAD `b53625a`).** Each fix was checked for two things: that what it removed is still absent (by `grep -rn` over `loom/` and `loombot/`), and that its replacement is still where the entry says. The records below quote line numbers as of their own commits. The current anchors are these:

| #    | removed — still absent?                                                                                                   | replacement, where it is now                                                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | the discarded return value — yes                                                                                          | `Rollout.#makeRoom` pushes to `parent.harnessNotices` (`Worker.harnessNotices`, `worker.ts`), and `AgentWorker` drains it into `meta.harness`                                                           |
| 2    | the `!wake \|\|` arm — yes                                                                                                | `Repl.run(code, id, { wake, waitMs = REPL_WAIT_MS, maxWaitMs = REPL_MAX_WAIT_MS })`, `repl.ts`                                                                                                          |
| 3    | `after?`, `whenNewerThan` — 0 hits                                                                                        | `Worker.read(awaitUser = false)`, parking on `InputQueue.whenMatching`. 4 call sites in `agent.ts`, one passes `true`: the same count as filed                                                          |
| 4    | the two defaults — yes                                                                                                    | nothing left to replace: the flag, `DEFAULT_GLOBAL_UPDATE` and `Rollout.#globalUpdate` all retired 2026-10-05 (`flags.ts`), and `--library` replaces the personal library rather than sitting beside it |
| 5, 6 | `SSEClientTransport` — only in a comment. The positional array — yes, pinned by `@ts-expect-error` in `tests/mcp_test.ts` | `mountMcpServer(bridge, name, spec, opts)`, `mcp.ts`.                                                                                                                                                   |
| 7    | `#known` — only in the comment recording it                                                                               | `Repl`'s `onDied` (`repl.ts`) and the owner's drop (`agent.ts`); the two refusals ("Pass create: true …") are in `agent.ts`                                                                             |
| 8    | `--resume`, `last` — gone as flags (comments only)                                                                        | `sessionPath(spec, workdir, mode)`, `sessions.ts`, contains no `throw`                                                                                                                                  |
| 9    | `maxContext ?? 0` — only in the comment recording it                                                                      | `maxContext: number` on `RolloutOptions` and `AgentWorkerInit`, refused unless positive in the `Rollout` constructor; `if (this.init.purpose === "compaction") return` in `#maybeCompact`               |
| 10   | the silent degrade — yes                                                                                                  | the three-state explanation on the `help()` path in `js_repl.ts` (the comment beginning "`docSpecs` … returns `{}` for every failure it meets")                                                         |
| 11   | `interactive: boolean` — only in the comment recording it                                                                 | `RunMode` and `DEFAULT_RUN_MODE = "task"` in `rollout.ts`, normalised into `Rollout.#mode`; `fatalOnProviderError` read at `agent.ts`'s fatal branch                                                    |

    1.  Eviction on spawn killed an idle child and discarded the notice.   FIXED 5c2866b
        The message existed and was dropped on the floor: `#makeRoom` RETURNED it and the one caller
        ignored the value. Now pushed to `parent.harnessNotices` and drained into `meta.harness`, so the
        parent is told exactly once. Two tests, both mutation-verified. A second defect fell out of the
        same reading: the budget-exhaustion message advised "purge a finished child", which can never
        help, because `procSpent` counts only `!c.terminal` children — a finished child has already
        released its budget. That advice is gone and a test forbids its return.

    2.  `Repl.run()` promoted on the clock or on a reason, by argument count.          FIXED 71a49a2
        `wake?` was not an option, it was the whole promotion policy: omitting it made the FIRST look
        promote, abandoning the value to arrive later as a message — the pre-measurement behaviour the
        function's own comment says was removed, still reachable, and only from two tests. It is now
        REQUIRED and NAMED: `run(code, id, {wake, waitMs?, maxWaitMs?})`, with the `!wake ||` arm
        deleted, so the second policy no longer exists rather than merely having no caller. Named and
        not just required because the position was half the problem — at the one production call site
        ~30 lines of comment sit BETWEEN the 3rd and 4th argument, so nothing about the call was
        readable in place; the two direct-`Repl` tests came out SHORTER than before the fix.

        Two things the entry had not asked for. `timeoutMs` is renamed `waitMs`: it has not been a
        timeout since promotion became reason-driven, nothing is killed at it, and it is the interval
        between LOOKS — the name now matches `REPL_WAIT_MS` and `replWaitMs`, which always fed it. And
        the two NUMBERS keep their defaults but are defaulted ONCE. Neither was ever agent-facing
        (`repl_run`'s generated schema is `{code, name, create}`), and the premise that loom sets them
        only in tests is the reverse of the truth: production ALWAYS passed both, because
        `AgentWorker`'s constructor resolved `init.replWaitMs ?? REPL_WAIT_MS` at construction — so
        `run()`'s default was unreachable in production and what is test-only is the OVERRIDE. The `??`
        pair is gone, the agent passes `init.*` straight through as `number | undefined` (no opinion),
        and both defaults live on `run()` beside the constants and the measurements that justify them.
        One number defaulted at two layers is exactly how mode 4 came to behave oppositely at its two
        doors.

        Left out of that commit and DONE in `04529f4`: the `Number.isFinite(waitMs)` guard, which
        armed no timer at all for a non-finite wait, so such an exec could never be promoted and
        `run()` waited for ever — a hang held in defence of a call nobody makes. Xiaohu's call,
        2026-09-22: loom never passes a non-finite wait (every value is a constant or a test seam, no
        CLI flag feeds it, and the only `Infinity` nearby is the interactive rollout TTL, a different
        knob with its own guard), so the branch goes rather than being turned into a throw. The comment
        in its place says why it is absent, so it is not reinstated as an obvious omission. One
        behaviour now; `Math.max(0, waitMs)` stays, since a NEGATIVE wait is a different question. Evidence for what DID land: `deno fmt --check` and `deno lint` clean (0 problems, 114
        files), `deno task test` 624 passed / 0 failed / 4 ignored — equal to main measured in the same
        worktree before the change — and the two seam tests that would catch a lost ceiling pass
        (`hang_backstop_test` at `replMaxWaitMs: 400`, `rollout_batch_shell_test` at `600`, the only
        test that exercises the backstop AS a behaviour and the reason the parameter was kept rather
        than hard-wired to the constant).
    3.  `Worker.read(after?)` — the argument's presence disabled draining.            FIXED a78f477
        Gone from main the day after this audit, and the fix went FURTHER than the entry proposed:
        there is no seq watermark left to split into a second method. `after?: number` and
        `InputQueue.whenNewerThan` are deleted, replaced by `read(awaitUser = false)` parking on
        `whenMatching((m) => this.#fromPrincipal(m))` — WHO has to speak, not what ordering. That
        kills the defect the entry was really about: parking for anything newer than everything
        queued also skipped what the user typed BEFORE pressing Ctrl-C, stranding it until something
        newer arrived. `whenMatching` tests the queue as it stands (`while (!this.#q.some(match))`),
        so already-typed input resolves the park at once, and the drain on wake takes everything.
        What REMAINS is a boolean flag on one method: `worker.ts:344`, decided at `360` and `423`,
        with 4 call sites and exactly one passing it (`agent.ts:1029`, `1151`, `1173`, `1252`) — the
        same count as when this was filed. Re-judged ESSENTIAL rather than accidental. One
        requirement (Ctrl-C must reach the prompt) needs two waits; the parameter now NAMES the
        behaviour it selects instead of hiding it behind an ordering filter; and BOTH paths return
        everything queued once woken, so neither leaves work behind — which was the half of the old
        mode that could actually cost you a turn. The two-method spelling (`read()` /
        `readAfterInterrupt()`) is now cosmetic, not a mode.

    4.  `allowGlobalUpdate` defaulted OPPOSITE ways at the two doors.        FIXED cc310c8 + 724d5b7
        Fixed 96 minutes after this audit was committed, and merged in `53348d7` — this entry's
        claim that the fix was unmerged and its default under review was true for one evening and
        stale by morning. The capability itself is gone: `--global-update`, `--no-global-update`,
        `DEFAULT_GLOBAL_UPDATE` and `Rollout.#globalUpdate` all retired on 2026-10-05 (`flags.ts`),
        because the isolation a measured run needs is `--library`, which REPLACES the personal library
        rather than sitting beside it — so there is nothing left for a grant/deny switch to decide.
        `tests/global_update_test.ts` now pins `--library` isolation at both doors.

    5.  A remote server connected over Streamable HTTP, or SSE if the first handshake threw. FIXED 773919a
    6.  `mountMcpServer(spec)` also took a legacy positional array.                          FIXED 773919a
        One commit, because both were the same function's front door. The SSE fallback is DELETED
        rather than tested: Streamable HTTP is what the spec has specified since its 2025-03-26
        revision, nothing in this repo has ever mounted an SSE-only server (loom's own servers are
        stdio; no config, gym task or fixture names one), and the second path was selected by a REGEX
        over `retry.ts`'s deadline text — a coupling that file carried a comment to protect. It also
        charged a refused endpoint a SECOND 15s handshake before the caller heard anything.

        What replaced it is a REPORT, which is the part that made deleting safe: a refused handshake
        now names the two causes the reader is choosing between (not an MCP endpoint, or a server
        offering only the deprecated HTTP+SSE transport, which needs a proxy), while a fired deadline
        keeps its own wording — decided by `instanceof TurnDeadlineError`, the distinction that class
        exists to make, instead of a substring. `retry.ts`'s must-not-change note is correspondingly
        gone. If an SSE-only server ever turns up it returns as an explicit field on the spec, spelled
        at the call site, with a fixture behind it. Xiaohu's call, 2026-09-22.

        The array form went with it. Its `env` and `cwd` came from `opts` INSTEAD of the spec, so the
        two shapes took their environment from different places; no production caller passed one, and
        the 8 test call sites now pass `{command, args}` — behaviour-identical, because `opts.env` is
        layered under the spec's own for object specs too.

        Two pins, both mutation-checked. A 405 endpoint must fail with loom's refusal wording and NOT
        the deadline's: with the wrapping removed the new test fails, restored it passes. And a
        `@ts-expect-error` line fails `deno check` if the union comes back, so the shape cannot be
        readmitted silently. Gate: baseline at main 633 passed / 0 failed / 4 ignored, branch 634 —
        the one added test — with `deno fmt --check` and `deno lint` clean.

    7.  `repl_run({name})` reused a repl or silently started a new one, by hidden history. FIXED 67ee368 + dd9f532
        Two commits, because the finding's own recommendation (do not change the spawn rule, make it
        visible) turned out to be the smaller half of the answer. Xiaohu's reading, 2026-09-22: if a
        dead repl is released, then a stopped-or-crashed name is in exactly the position of a name
        never used — so it should be treated as one, and `create` should mean what it says.

        `67ee368` — RELEASE. Nothing removed a dead repl: `#dead` was a flag and the entry sat in
        `#repls` until the name was used again, so a crashed repl kept holding a `procBudget` slot
        (`replCount` is `#repls.size`), was listed by `repl_list` as an ordinary idle repl (`running`
        is `busy`, which a corpse also is not), and leaked its two `LogSink` fds — the death path
        never called `close()` and the lazy replacement deleted the entry without closing it. `Repl`
        now fires `onDied` once, after every exec is settled and every line flushed, and the owner
        drops and closes it, guarded by identity so a replacement is never deleted by an older
        incarnation's death. `repl_list`'s empty answer stopped saying "no repls YET", which a death
        had made false.

        `dd9f532` — THE RULE. A named repl is usable without `create` exactly while `repl_list` lists
        it; never started, stopped and crashed are one case, because all three hand back an empty
        namespace and the caller cannot see which it is getting. The `#known` set — every name ever
        used — is deleted, so `#repls` is the only thing granting an exec. Two refusal messages, since
        the fixes differ: a name never used is a typo or the wrong repl, while a name that HAD a
        process tells the agent its variables are unrecoverable.

        `default` is the one exception, and it is FORCED. Nothing is listed at the start of a session,
        so requiring `create` for it would make every run's first exec a refusal — 48 bare call sites
        in the suite and 142 doc mentions write it unconditionally — and spawning it eagerly to satisfy
        the rule literally would cost a subprocess for every agent that never runs code, including each
        compactor fork, whose whole `procBudget` is 1 and which typically runs none. It is also the one
        name that cannot be typed wrong, which is what the rule protects against. So `meta.namespace`
        from the first commit stays: `default` is the only name that can still respawn silently.

        Agent-facing text is the interface and all of it agrees now: `create`'s schema, `repl_stop`'s
        schema, and `repl_stop`'s reply — name-aware, because telling a named repl's owner to "exec
        again" would have walked it into the refusal one call later. loom-design §4 and §5 updated.

        Tests: the one pinning the old silent re-create is INVERTED and quotes the old assertion as the
        reason it exists; the `default` reset tests are untouched, which is what proves the exception.
        Six mutants across the two commits, all caught — release disabled, `fresh` hard-wired either
        way, a spawned name let through without `create`, the two messages collapsed into one, and the
        `default` exception dropped. Gate: 633 -> 637 passed, 0 failed, fmt and lint clean.

    8.  `--resume X` — resume, mint, take-as-path-and-create, or refuse.        FIXED a4515c1
        Four behaviours from one string, with PUNCTUATION deciding which: `--resume notes` was refused
        while `--resume ./notes.jsonl` silently started an empty conversation, and `runDir` keyed on the
        same string's shape so the second form put its traces in `.loom/runs` while a named session kept
        them beside the conversation — the two answers to "where are the logs" that having a session at
        all was supposed to remove.

        One rule now, and `sessionPath` CANNOT THROW: a name resumes if it exists and starts if it does
        not, a path does the same wherever it points, and no flag means the newest conversation here. The
        try/catch in `main.ts` went with the two throws it existed for. `runDir` derives from the
        session's own folder, so every spelling lands in one place; the legacy flat `<id>.jsonl` keeps the
        `.loom/runs` fallback because its parent is shared by every conversation.

        The PRODUCT decision that shaped it, Xiaohu 2026-09-22: one agent per workspace. Interactive loom
        continues where you left off, a second conversation costs a name, and there is deliberately no
        `--new` — parallel work belongs to sub-agents inside one agent, not to two agents sharing a
        directory. A TASK run does not inherit, which is the one asymmetry and is load-bearing: a trial's
        transcript must be a function of its prompt, and with no `--new` a gym would otherwise have no way
        to ask for a clean slate. `--resume` and `last` are gone; an old spelling fails as an unknown
        flag, this CLI's standing answer to a rename.

        Two additions the rule needed. `/clear` empties THIS conversation and carries on in it, archiving
        to `cleared-<stamp>.jsonl` the way compaction archives the head it replaces — starting a second
        session instead would leave the old one as the newest thing in the workdir for everything else to
        resume. And the reply SAYS which happened: a resumed name prints its message count, a started one
        names itself and its neighbours, so `--session notse` reads as a correction rather than as lost
        history. That is mode 7's lesson reused — do not refuse the ambiguous case, say which one it was.

        Pins: the two tests that asserted the removed throws are inverted and quote the old assertions as
        the reason they exist; `runDir` has one answer for every spelling; and an end-to-end test spawns
        the real CLI for started-then-resumed, a task run not inheriting, and `--resume` exiting 2. Three
        mutants caught: the task default inheriting, the announcement removed, `runDir` back to keying on
        the filename. Gate: 642 -> 646 passed, 0 failed, fmt and lint clean.

    9.  Compaction was OFF unless somebody remembered to pass a window.             FIXED 1d64ba4
        `#maybeCompact` opened with `const max = this.init.maxContext ?? 0; if (!max) return;`, so
        whether a run compacted AT ALL was decided by an option three layers up at whatever door built
        the rollout — and the default was the dangerous answer. This entry called that an accidental EDGE
        on an essential mode. It was live: `loombot`'s `sessionOptions` named `workdir`, `provider`, `task`
        and `mode`, so every workspace session the daemon opened ran with no compaction at all, growing
        until the provider refused the request — and a context-length error is not transient, so retry
        cannot help and the session is what is lost.

        Xiaohu went further than the recommendation above, which was to default the option once: "I
        actually don't understand why do we need a never compact mode. Let's remove the never compact
        mode, --max-context has to be positive." So the fix is a DELETION, not a default. `maxContext` is
        required and positive on `RolloutOptions`, on `SessionOptions` — where it was restated as
        optional, which is exactly what let a Session be opened without one — and on `AgentWorkerInit`;
        `Session.contextLimit`'s `?? 0` went with it, since it reported 0 for a session that can no
        longer exist. 0, a negative and NaN are refused by the constructor and by the CLI (exit 2, on the
        `--task-ttl 0` precedent: somebody who types 0 means something, and substituting a window would
        be a different run than they asked for). NaN mattered as much as 0 — `Number("abc")` is not
        nullish, so it sailed through `?? 0` and then made every threshold comparison false.

        THE FORK'S RECURSION GUARD WAS THE SAME LINE AS THE MODE, which is why this could not be a
        rename. A compactor is spawned with the slice it must summarise as its history, so it is over the
        SOFT mark on its first turn by construction, and what stopped it summarising itself was
        `maxContext: 0` at the spawn — the config switch doing duty as a guard. The fork now inherits the
        rollout's window like every other worker, and `#maybeCompact` returns on
        `purpose === "compaction"`, the marker it already carried for the provider. A compactor that does
        not compact is a property of BEING a compactor.

        Soft/hard and the `#hardTried` override are untouched: measured trades, and this entry's own
        judgement of them stands. Only (a) went.

        WHAT THE TYPE CHANGE TOUCHED, which is the most interesting thing the fix produced: 86 sites the
        compiler found — 84 in tests, plus `loombot/serve.ts` (the live defect) and
        `tools/shutdown_profile.ts` — and FOUR it could not, all `new Rollout({...} as any)` in tests
        whose fixture provider does not implement `Provider`. The cast hid a missing REQUIRED field, and
        only the constructor's runtime refusal caught them: four failures in a suite that had just
        type-checked clean. That is the argument for keeping the guard as well as the type, and it is
        written at those four sites.

        Pins: the default window compacts; 0 is refused at both doors (0, -1, NaN, and `Session.open`);
        `--max-context 0`, `=-5` and `abc` are exit 2 while a SMALL window and an omitted flag still run
        — small, because a small positive window is how the gym and the docs trigger compaction in a
        second. Two tests that pinned the old mode are INVERTED rather than deleted: `status_tree`'s
        "compaction disabled means no denominator" now asserts the row always has its mark, and
        `rollout_e2e`'s "no compaction when it is not asked for" becomes "while the run still fits its
        window" (900k of usage against 2M). `status_test`'s hand-built `contextLimit: 0` is removed with
        the reason in its place, because nothing can produce that value now — and `formatStatus`'s two
        branches for it are gone. Six mutants, all caught: the constructor guard deleted, the CLI refusal
        disabled (still exit 2 from the constructor, with the wrong message — which is why that test
        reads the message), the CLI over-tightened to refuse OMISSION, the `purpose` guard deleted
        (caught by the fork test's archive ownership: the fork had compacted itself),
        `DEFAULT_MAX_CONTEXT = 0`, and the status row dropping its denominator. Gate: 654 -> 656 passed,
        0 failed, 4 ignored; fmt, lint and check clean.

    10. `help()` on a mounted module degraded without saying WHY.          FIXED ca59d49
        And the audit entry's premise was WRONG, which the fix had to establish first: `docspec.ts:248`
        writes an entry for every function symbol regardless of JSDoc (`doc.doc` gates only the
        DESCRIPTION), the sole skip is `if (!def?.params) continue`, and `docSpecs` returns `{}` at eight
        sites rather than throwing. So "succeeded with no entry" does NOT mean the author wrote no JSDoc —
        it means the export is a shape `deno doc` cannot describe (a class, a `.bind()` result, a factory
        result), for which writing JSDoc cannot help. Three states now, not two, and the only one that
        blames unreadable source offers it rather than asserting it.

    11. ESSENTIAL: interactive vs one-shot — one mode with THREE names.                    FIXED f42861b
        The MODE STAYS, which is what makes this entry unlike the others: a person at a keyboard and an
        unattended trial genuinely want different lifetimes, different error recovery and different
        output channels. What was accidental was the vocabulary — `interactive: boolean` at the CLI, in
        `RolloutOptions`, `Session` and loombot; `endOnIdle: !interactive` at the worker, which is where
        the decisions actually READ it; and "one-shot" in 36 code comments and 15 doc lines. Xiaohu's
        call, 2026-09-22: keep both modes, unify the names — interactive mode and task mode.

        `RunMode = "interactive" | "task"` is the one word at every door now, and `DEFAULT_RUN_MODE =
        "task"` the single default, normalised once into `Rollout.#mode` exactly as `#globalUpdate` was
        for mode 4 — three sites read the old boolean for themselves, so an absent option was a decision
        in three places. The CLI never reads that default: it DERIVES the mode (a task argument, or no
        task plus a TTY), the one door where the hidden state is deliberate and has no override by
        design.

        `endOnIdle` survives and is NOT a third name for it: worker-scoped, false for every child
        whatever the run's mode, and `Session.end()` sets it on a live interactive root to mean "no more
        input is coming". Calling that field `mode` would tell a reader children carry the run's mode.
        Its doc now says what it is derived from, and where.

        `fatalOnProviderError` is the arm this entry itself said to look at, and it is now named. A 503
        that outlived its retries was fatal or recoverable according to `endOnIdle` — an error policy
        keyed on a lifetime flag, so two runs of one task differed on a rate limit with nothing in the
        code calling that a decision. Derived beside `endOnIdle`, readonly, read at `agent.ts`'s fatal
        branch.

        Pins: 35 `interactive: true` call sites converted; `hang_backstop`'s mode loop now loops over
        `["task", "interactive"]` and is the pin on `fatalOnProviderError`; plus a DIRECT pin on
        `DEFAULT_RUN_MODE`, because the mutant that flips it makes task-mode tests wait out the TTL
        instead of failing — the suite reported a 300s hang rather than a wrong default. Measured that
        way once; the new test fails in 13ms. Both mutants caught. Gate: 637 -> 641 passed, 0 failed.

# Ranked, most worth unifying first

Order is (how confusing it is) x (how cheap the fix is). Items 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 and 11 are FIXED — see the
section above. They stay numbered here so nothing is renumbered under a reader who remembers a number.

1. **Eviction on spawn kills an idle child and the notice is discarded** (`rollout.ts:338-353` + `:406`) — a worker disappears with no message; the message exists and is dropped. 1 call site, 0 tests.
2. **`Repl.run()` promotion policy depends on whether `wake` was passed** (`repl.ts:633`) — 5s-and-abandon vs 120s-and-deliver; the second policy is reachable only from 2 tests. FIXED in `71a49a2`; `wake` is required and named, and the wait numbers are defaulted in one place.
3. **`Worker.read(after?)` — the argument's presence disables draining** (`worker.ts:338`) — returns queued work vs ignores it and parks. 4 call sites, 1 passes it. FIXED in `a78f477`; the method is now `read(awaitUser = false)` and what is left is judged essential.
4. **`allowGlobalUpdate` defaults opposite ways at the CLI and programmatic doors** (`main.ts:287` vs `rollout.ts:222`) — the agent can or cannot write `~/.loom/library`, and the prompt changes with it. FIXED in `cc310c8` + `724d5b7`; the flag, the constant and `Rollout.#globalUpdate` retired on 2026-10-05 (`flags.ts`).
5. **Streamable HTTP with an untested SSE fallback keyed on an error-message regex** (`mcp.ts:230-238`) — exactly the two-paths-and-the-second-rots shape. FIXED in `773919a`; one transport, and the refusal is reported.
6. **`mountMcpServer` accepts a legacy positional array** (`mcp.ts:172-175`) — no production caller; 9 test call sites, mechanical to delete. FIXED in `773919a`, with a `@ts-expect-error` pin.
7. **`repl_run({name})` silently starts a fresh process for a stopped or dead name** (`agent.ts:827-850`) — reuse and reset are indistinguishable in the reply. FIXED in `67ee368` + `dd9f532`; a dead repl is released, and a named one needs `create` unless it is listed.
8. **`--resume X`: a slash makes it create, a bare id makes it refuse; and `runDir` moves the run's artifacts with it** (`sessions.ts:41-47`, `60-65`). FIXED in `a4515c1`: one flag `--session NAME`, one rule, no throws, and `/clear` for a fresh context.
9. **Compaction disabled entirely when `maxContext` is omitted** (`agent.ts:1211-1212`) — same door-dependent default as 4. Soft vs hard, in the same function, is ESSENTIAL. FIXED in `1d64ba4`: the never-compact mode is DELETED — `maxContext` is required and positive at every door, 0 is refused rather than honoured, and the fork's recursion guard is `purpose: "compaction"` instead of a window of zero.
10. **`help()` on a mounted module degrades silently when `/doc` fails** (`js_repl.ts:943-963`) — cheap, small.
11. **ESSENTIAL — interactive vs one-shot**, renamed to `endOnIdle` downstream and mutated at `session.ts:426`. Keep; the arm worth naming separately is fatal-vs-recoverable provider errors at `agent.ts:1051`. FIXED in `f42861b`: both modes KEPT, one vocabulary (`RunMode`), and that arm is now `fatalOnProviderError`.
12. **ESSENTIAL — `allowSh`**, seven read sites (five when filed). Keep; it is the one capability whose prompt and grant are derived from the same value. Its `allowNet` twin was REMOVED on 2026-09-22 — a flag maintained for benchmarks only, and one a container can enforce from outside — see the item above, which is kept for the record.

---

# Deliberately excluded, with the reason

These came out of the sweep and are NOT modes by the standard set. Listed so the absence is a decision rather than an omission. Re-cited on `next` 2026-09-25 by file and symbol. The entries marked NEW are the candidates the stack added since the first audit.

- **`edit(path, old, new, {all})`** (`edit`, `loom/repl/js/fileverbs.ts`) — without `all`, two matches THROW. One behaviour plus an error path, and `all` is stated in the signature.
- **`sh(cmd, {killAfterSec})`** (`sh`, `loom/repl/js_repl.ts`; it was `timeout` when this was filed) — the kill is armed only when the parameter is given, but that is the parameter doing what its name says.
- **`read(path, {from, to})`** (`read`, `loom/repl/js/fileverbs.ts`) — bounds clamp; the whole-file case is the default value of a range, not another algorithm.
- **Prompt caching** (`cachePoint` in `loom/providers/bedrock.ts`, `cache: args.cache !== false` in `loom/flags.ts`) — `--no-cache` changes cost, not the answer. A behaviourally identical optimisation.
- **Provider spec dispatch** (`loom/providers/factory.ts`) — `scripted:` / `openai:` / `bedrock:` is polymorphism over a declared prefix with one surface, and the lazy imports are a measured startup optimisation.
- **`kind: "agent" | "shell"`** (the spawn in `loom/worker/rollout.ts`) — two different products, but the agent surface spells them as two verbs (`startWorker.agent`, `startWorker.shell`), so the choice IS visible where it is written. An unknown kind is refused rather than defaulted, deliberately.
- **`STALL_MS` (90s per attempt) plus `TURN_STALL_MS` (whole call)** (`retry.ts`) — two bounds at different scopes, both ending the same way. Nested deadlines, not two behaviours.
- **SDK retry with backoff** (`ATTEMPTS`, `retry.ts`) — same request, same answer, later.
- **`OpenAIProvider` and `NO_KEY`** (`loom/providers/openai.ts`) — a placeholder so the client can be built; the request shape is identical and the file explicitly refuses env-var fallbacks for the endpoint.
- **The 5s idle flush in `ShellWorker.#pipe`** (`IDLE_FLUSH_MS`, `loom/worker/shell.ts`) — one delivery rule with a deadline for a line that never ends, not two ways of delivering.
- **`readLib(path)` accepting an entry file or its folder** (`loom/library.ts`) — input normalisation to ONE behaviour; it is a mode being removed, not one being added.
- **`OutputBuffer` truncation marker with and without a `LogSink`** (`loom/worker/output.ts`) — the notice names a file when there is one. Same truncation, one sentence longer.
- **`NO_COLOR` / plain markdown** (`plainByDefault`, `loom/cli/markdown.ts`) — presentation, at the edge, to a standard environment variable.
- **`bridge.mcp?` unset means the `/mcp/*` routes refuse** (`loom/worker/bridge.ts`, the `"no mcp layer in this run"` 409s) — borderline, and I came down on excluding it: with no Session installed the routes refuse, which is an error path, and the indirection is what keeps `bridge.ts` ignorant of MCP.
- NEW **MCP `data` from `structuredContent` OR the text parsed as JSON** (`McpConnection`'s result shaping and `jsonOf`, `loom/mcp.ts`) — two SOURCES for one field, but one meaning ("the result as structure, if it has any"), and the call site handles both the same way: `data` is optional either way, and `text` is always the string and never replaced. The server's own structure wins when it sends one. The prose-shaped-like-JSON edge is guarded (`jsonOf` requires matching brackets and a clean parse). Input normalisation, like `readLib`.
- NEW **Image-only sends** (`render` in `loom/worker/agent.ts`, the `content` helper in `toMessages`, `loom/providers/openai.ts`, `nonBlank`, `loom/providers/bedrock.ts`) — one rule, "never a blank text part", applied at the layer that knows the wire. Not two behaviours: a message with words and one without produce the same shape, minus the empty part the providers refuse. It is enforced in three places (see the simplification doc), but that is duplication, not a mode.
- NEW **The snapshot caps** (`MAX_PER_REPLY = 16`, `MAX_BYTES`, `loom/shown.ts`) — a bound, like `STALL_MS`: past it, an image reference stays literal markdown, and the reason goes to the log. No flag, deliberately, and nothing reaches the model either way.
- NEW **The `from` field** (`Author`, `isAuthored`, `loom/provenance.ts`) — a MODE REMOVED: authorship used to be inferred from a `[loom]` text prefix, and is now a field. The loader REFUSES a conversation without it (`UnconvertedConversationError`, naming `deno task convert-conversations`) rather than falling back to the prefix, which is the non-mode answer. Worth noting, but not a mode: two fields in the codebase are called `from` with unrelated types, `Message.from: WorkerId | "user"` (the SENDER, `loom/worker/types.ts`) and the stored message's `from: "human" | "agent" | "tool" | "loom"` (the AUTHOR). `stored()` in `agent.ts` builds the second from a message carrying the first.
- NEW **The one-line stdin init** (`Proc.#hello`, `loom/repl/proc.ts`; `connect`, `loom/repl/js/wire.ts`) — a mode REMOVED: configuration used to arrive partly in env vars that every grandchild inherited. Now there is one channel, one JSON line and then EOF. `setChildLimits` treats a malformed `limits` as none, so the child does not pre-check a `read()`, and the harness still refuses the payload (`Repl.#overLimit`). That is two layers enforcing one rule, and the outcome is the same.
- NEW **`LOOM_PROD`** (`resolveProd`, `loom/flags.ts`) — borderline, excluded, and SMALLER since 2026-10-29: it no longer adds a prompt paragraph (the "do not disclose how you are built" section was deleted with the wiring that fed it, `loom/worker/system_prompt.ts`, `loom/worker/rollout.ts`), so what is left is one answer loombot reads twice — the release half of the page (`loombot/page_assets.ts`) and whether the dev-only `/apis/close` is registered at all (`loombot/routes.ts`). Only the exact string `"1"` enables it, silence means `BUNDLED`, and the CLI's `--prod` flag retired 2026-10-02, so the variable is the only channel (`flags.ts`); `tests/rollout_surface_test.ts` pins both rules by name. It is a deployment's config channel, like `NO_COLOR`, not a behaviour a caller has to guess.

## Method

Greps over `loom/**` excluding `tests/`, `gym/`, `tools/`, `docs/`: optional-parameter signatures, `: boolean` fields and parameters, `=== undefined` / `!== undefined` presence tests, `Deno.env.get`, `??` / `||` defaults, and comments matching fall back / fallback / legacy / kept because / unless / only when. Every entry above was then read in its own file with its surrounding comment. Call-site and test counts come from `grep -rn` over `loom/` and `tests/`, excluding `.loom/worktrees/`. The first pass was cut at HEAD `dbc76aa`.

**Re-run on `next` at `b53625a`, 2026-09-25**, over `loom/` (excluding `loom/library/`, whose `.ts` files are shipped skill code rather than loom) and, new this time, over `loombot/`. The exact patterns, with `grep -rnE --include='*.ts' --include='*.tsx' --include='*.js'`:

    : boolean                                                       loom 95   loombot 18
    (function|async|^\s*(#|[a-z])\w*\().*\w\?:                      loom 45   loombot  4   optional params
    [!=]== undefined                                                loom 80   loombot  4
    Deno\.env\.get                                                  loom  8   loombot  3   (lines)
    \?\?                                                            loom 289  loombot 69
    (//|\*).*(fall ?back|legacy|kept because|unless|only when)       loom 87   loombot 16

The first pass did not record its patterns, so these numbers are not comparable one-for-one with its 60 / 20 / 24 / 8 / 33. The growth is real in direction: `loom/` excluding the library is 21,858 lines now. Two sweeps were added for the new candidates, and both feed the simplification doc as well:

- **Option fields nobody passes**: every optional field of an `*Options` / `*Init` / `*Opts` / `*Spec` / `*Config` type in `loom/` and `loombot/`, with its set sites counted in production and in `tests/` + `tools/` + `gym/`. This found the test-only seams listed in the simplification doc.
- **Exports only tests reach**: every `export` of a production file, with references counted in its own file, in other production files, and in tests. Two exports are referenced only by tests: `recordSpawn` in `loom/doctor.ts`, and `THEME_VARS` in `shared/theme.ts`.

Every surviving and excluded entry was then read in place, and each claim about behaviour was checked against the code rather than the comment above it.
