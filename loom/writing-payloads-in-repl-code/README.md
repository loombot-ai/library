---
name: writing-payloads-in-repl-code
description: Read BEFORE writing a file, a commit message, a brief or a sub-agent message whose text holds backticks, `${...}`, quotes or a backslash — `repl_run`'s `literal` argument carries it as a TOOL ARGUMENT, so it never enters the JS literal at all. The array-of-lines rule and the read-the-anchor rule below are the FALLBACK for the verbs that take text and are NOT `repl_run` (`repl_sh`, `edit`, `board.create`, `workers.x.stdin`). Also where `shq` (tools.payload) comes from.
as_of: "2026-10-19"
---

# Payloads inside `repl_run`

Text you generate that itself contains code passes through the JS literal you write it in, and then
through whatever consumes it. Each is a chance to escape wrongly — and the measured failures cluster
almost entirely in the first.

## The answer, when it applies: `literal`

**`repl_run({ code, literal })` carries the payload as a TOOL ARGUMENT**, and the body reads it as the
variable `literal`:

    repl_run({ code: "await Deno.writeTextFile('notes/plan.md', literal); return 'wrote ' + literal.length;",
               literal: <the text, exactly as it should land> })

Nothing is escaped, quoted or re-parsed on the way. The value is one string field of the exec request
(`{op:'exec', id, code, literal}` in `loom/repl/repl.ts`) and one FORMAL PARAMETER of the body's compiled
`AsyncFunction` (`loom/repl/js/compile.ts`), so it never enters the source the repl compiles. The failure
class this entry is about — a JS literal that ended early, a closing quote lost on a line whose last
character is 「」 — is structurally unavailable rather than carefully avoided.

Three things to know:

- **Do not declare `literal` in the body.** A parameter cannot be redeclared, so `const literal = ...`
  fails to PARSE: one loud failed call, nothing runs, and the harness prints the body back with line
  numbers. It is the price of a name that is rare as a local, and the reason `env`, `text` and `payload`
  were not chosen.
- **It is PER CALL**, like every argument: `globalThis.saved = literal` is how to keep it, and the next
  body that passes no `literal` sees `undefined`.
- **A value is a string, and nothing re-parses it.** Pass JSON as its text if you want structure.

**WHEN IT DOES NOT APPLY.** `repl_sh`, `edit`, `board.create`, `workers.x.stdin` and every other verb
whose TEXT argument is written inside a JS literal still need the rules below. The parameter removes the
PAYLOAD class — text that must survive as bytes — and NOT the CODE-SHAPE class: an unbalanced paren in a
body you are writing still costs you the call.

## Not rare: 390 parse failures in 35,489 calls (1.10%)

Counted 2026-10-19 over the whole corpus with `deno task census:repl-payloads --json` — 4 sessions trees,
714 trace files, 726 MB, 2026-09-29 to 2026-10-19:

    35489 repl_run calls        390 that never PARSED — 1.10%, about 20 a day
    366 of those 390 carried a quote in the body that died

Three readings of the same corpus, and only the first measures this class:

| counting rule                                                     | count | what it really counts       |
| ----------------------------------------------------------------- | ----- | --------------------------- |
| the harness's parse sentence, with a `SyntaxError:` line above it | 390   | a body that did not parse   |
| `SyntaxError` AND `js_repl.ts` (this entry's old rule)            | 109   | NOT this class at all       |
| the bare word `SyntaxError`                                       | 1514  | every result that quotes it |

**The old rule cannot see a parse failure, which is why the rate read so low.** `syntaxReport`
(`loom/repl/js/syntax.ts`) formats `"SyntaxError: " + message` and then prints the submitted body with
line numbers — it never emits the STACK — so the text a parse failure arrives in holds no `js_repl.ts`
to find. That rule counted runtime `SyntaxError`s (a `JSON.parse`, a `new RegExp`) plus results that
merely quote both words; the census's own note measures 58 of those as THIS entry being read, and the
bare word is worse still — reading `syntax.ts` matches it.

So count by the pair the harness actually writes: `SyntaxError: <message>` with `[loom] This is a parse
error in the code YOU submitted` immediately below it. The old 0.03% figure (4 in 11723, one session's
trace files) was an artifact of the wrong rule on a small sample, not a smaller problem.

The same pass found `edit: no match` in 7 results, 6 of them real: an anchor whose bytes are not in the
file is a RUNTIME refusal (that call writes nothing), at the same order of frequency. Cheap insurance is an
anchor READ FROM THE FILE rather than retyped — see "The rule" below.

**Of the 6 hand-sourced incidents of 2026-09-16, 4 were one typo** — a doubled backslash where a single one was meant:

```js
// In a template literal, ONE backslash before a backtick escapes it — the payload gets a backtick.
// TWO escape the BACKSLASH, so the backtick stays live and ENDS the literal: everything after it is
// reparsed as JavaScript, which is why the reported error appears far below the real fault.
//
// Not shown as runnable lines on purpose: the broken form is a SyntaxError, so any file holding it
// does not parse — and a formatter can rewrite the quoting of an example and INVERT what it teaches.
```

The doubled backslash consumes itself, so the backtick stays live and **ends the literal**. Everything
after it is reparsed as JavaScript.

**So the reported error location lies.** It is `missing ) after argument list` or `Invalid or unexpected
token`, pointing far below the real fault, because the parser has been reading prose as code for twenty
lines by then. Do not study the line it names — look ABOVE it for an unbalanced backtick.

## The predictor: payloads that EXPLAIN something

3 of the 5 sourced incidents had the backtick inside a **comment in the payload** — prose naming `out`,
`status`, `shell:burst`. The payload was not data, it was prose about code, and naming code means
backticks.

**The risk signal is not that a payload holds shell metacharacters. It is that the payload explains
something.** A well-commented insert is the dangerous case, and the pull toward writing one is strongest
exactly when the change deserves it.

## The rule, for every verb that has no `literal`

`edit`, `board.create`, a `repl_sh` command line, a text argument anything else owns. **Build a payload
as an ARRAY OF LINES, joined.** One level of escaping instead of two, and a stray
backtick breaks one array element instead of the whole call:

```js
const lines = [
  "// a comment naming `out` and `status`",
  "const x = 1;",
];
await Deno.writeTextFile(path, lines.join("\n"));
```

**The trigger for choosing, in one line: if the text you are about to write CONTAINS A BACKTICK (prose
naming code, a markdown code span), do not write it as a template literal.** A backtick is an ordinary
character inside `"..."` or `'...'`, so the array form above costs nothing to switch to, while the
template-literal form needs two escape rules at once and its failure mode is the one that hides.

Better still where it applies: **`edit` with anchors read from the file** — the payload never enters a
literal at all, which is zero levels of escaping rather than one.

## `${...}` is the other one: the LITERAL, not the JSON

A template literal containing `${m.source}` throws `ReferenceError: m is not defined`, because
**JavaScript** interpolates it at execution time.

**The JSON layer is NOT where this comes from, and it is not a hazard worth removing.** Measured across
1847 native tool calls — 719 carrying a backtick, 376 carrying `${...}` — **ZERO had unparseable
arguments**: providers escape JSON string payloads correctly (`loom/providers/factory.ts`). Fenced
`repl_run` blocks used to sit in front of that layer and were REMOVED on 2026-09-20, because they cost
something instead: 5 malformed fences and 4 SILENT STALLS per 100 trials, turns that ended having done
nothing, exit 0. The layer that breaks is the PAYLOAD's own literal.

Measured 2026-09-17: an unescaped backtick around the word `tool` inside a
template literal (`SyntaxError: Unexpected identifier 'tool'`, code never ran), and a literal `${...}`
that closed a markdown code span and swallowed a document TITLE into the middle of a sentence — in the
paragraph explaining the `${...}` trap. A payload about the trap, broken by the trap.

For a shell string, do not use a template literal at all; for prose, escape the dollar or break the
sequence.

## The TOOL matters: `repl_sh` has no JS layer

**Since 2026-10-19 `literal` gives a `repl_run` call the same relief, so `repl_sh`'s founding reason —
a command line that must miss the JS layer — is gone** (`repl_sh` is a delete-candidate in its own
card). What survives is about the SHELL and not about JavaScript, and it applies to `sh()` inside a
body just as much.

Measured 2026-09-24, and it settles the case this entry opens with. The command that died as
`ReferenceError: dir is not defined` inside `repl_run` runs **verbatim** through `repl_sh`, `${dir}` and
all:

    grep -nE 'sessions.*[.]jsonl|[$]{dir}/|join[(]dir, "' tests/sessions_test.ts

Reproduced: 21 matching lines, no error. `repl_sh` takes a command LINE and hands it to the shell, so
there is no template literal to interpolate `${dir}` — the layer that ate the pattern is not there.

**But the SHELL's layer stays, and it fails silently.** With a file whose text contains the literal
`${dir}/x` plus one other line:

    grep -c '${dir}' q.txt    ->  1    single quotes: the pattern stays literal
    grep -c "${dir}" q.txt    ->  2    double quotes: the shell expands it to NOTHING, so the pattern is
                                       EMPTY and matches every line

Both measured, both reproduced. The second is worse than an error: `grep` exits 0 and prints a count, so
the call looks like it worked and the number is a lie.

**The rule.** A command line carrying a regex or a `$` belongs in `repl_sh`, with the pattern
SINGLE-quoted. Use `sh()` inside `repl_run` when you need the structured result (`code`, `stdout`,
`timedOut`) or want to combine the command with JavaScript — and then every rule above is back in force,
`shq()` included.

## A THIRD layer: `$` in a `String.replace` REPLACEMENT

Measured 2026-09-24, while inserting the section above into this very file. The replacement string
contained the prose `` a regex or a `$` belongs in `repl_sh` `` — and in a replacement string, `` $` ``
means **everything before the match**, so `String.replace` spliced the file's first 75 lines into the
middle of a sentence. `deno fmt` then reflowed the wreckage, and the giveaway was a heading count: two
`#` titles and five duplicated headings.

    s.replace(anchor, ins + anchor)     // `$` + a backtick, &, ' or a digit in `ins` is EXPANDED
    s.replace(anchor, () => ins + anchor)  // a FUNCTION replacement: no expansion, ever

**So use a function replacement whenever the new text is prose about code**, which is precisely when it
carries a `$` next to a backtick. And check the STRUCTURE after the write, per the section below: the write reported success, and nothing else would have caught it.

**`edit` IS a refuge from this one, since 2026-09-24.** Its replacement is spliced as bytes — `slice +
new + slice`, and `split`/`join` for `{all: true}` — so no `$` sequence in the new text is ever expanded.
It ended in `before.replace(old, new_)` until then, which corrupted exactly the edits it exists for: a
probe file's first two lines were spliced into the payload while `edit` returned the line numbers
`[3, 4, 5]` as though it had worked. The trap above is a HAND-ROLLED `String.replace`, and a function
replacement is what makes that one safe.

## `deno fmt` can INVERT an escaping example

Measured while promoting this entry. The two lines here were originally single-quoted string literals
passed to `eval`. `deno fmt` rewrote them to double quotes and the escape semantics FLIPPED, so the file
taught the exact opposite of the truth — caught by extracting both lines and RUNNING them, not by
reading them.

So: **an escaping example inside a string literal is not stable under a formatter.** Describe the rule,
or run the example and compare its output to what the prose claims. A skill about escaping is the worst
possible place for an unverified example.

**And the trap is live, not historical.** Writing this very section, the edit that added it hit the
doubled-backslash fault on its own line 15 and never ran. The harness diagnosed it correctly — "lines
15, 28 contain a DOUBLED backslash before a backtick" — and the fix was the rule below: build the
payload as an array of lines and use `String.fromCharCode(96)` for every backtick, so no
backslash-backtick sequence exists in the source at all.

## After an anchored edit on prose, verify the STRUCTURE

A `String.replace` that matches nothing **reports success**. Same for text `deno fmt` has already
reflowed. Two consequences, both measured:

- `if (mut === original) throw` before writing, whenever the edit is a mutation you intend to check.
- After editing a document, assert the structure — **one title, one of each heading** — not merely that
  the replace ran. An anchor appearing twice duplicated 65 lines of a design doc, and it was committed
  that way because "the replace succeeded" was treated as evidence.

## Levels of escaping, honestly

| approach                                  | levels | note                           |
| ----------------------------------------- | ------ | ------------------------------ |
| `edit` with anchors read from the file    | **0**  | but see the `$` section above  |
| array of lines + `Deno.writeTextFile`     | **1**  | the default                    |
| `Deno.Command` (argv, never shell-parsed) | **1**  | for commands                   |
| `sh` with `shq` around the DATA           | **1**  | `shq` does level 2 for you     |
| `sh` with hand-quoting                    | **2**  | avoid                          |
| `repl_sh`, pattern single-quoted          | **1**  | no JS layer; the shell's stays |

`shq(s)` wraps `s` in single quotes, closing and reopening around the one character single quotes cannot
hold. Inside single quotes `/bin/sh` treats every byte literally, so it is total rather than
best-effort. `JSON.stringify` merely resembles it — double quotes still expand, so it works until the
moment it matters. Measured with a payload containing a subshell, a backquoted command and a star:
passing it through double quotes RAN the subshell.

## Do not reach for base64

It is the obvious escape hatch and it has its own trap: `btoa` is Latin1-only, so an **em-dash in a
comment** throws `InvalidCharacterError`. Prose about code is exactly where em-dashes appear. The
array-of-lines pattern has no such edge.

## The shell spelling: `git commit -m "..."` is the same trap

Everything above is about backticks and `${...}` inside JavaScript. **The identical hazard exists one level out,
in a shell double-quoted string**, and it is easier to miss because no JavaScript is involved:

    git commit -m "the agent reached for the `timeout` BINARY"

Inside `"..."` the shell runs `` `timeout` `` as command substitution. Measured, 2026-09-21: this produced
`/bin/sh: timeout: command not found` on stderr and committed **"reached for the BINARY"** — the word deleted,
a double space left, and the commit created successfully. **A corrupted message is not a failure the exit code
reports**, so nothing draws attention to it.

The same call had already used a quoted heredoc for the FILE it was writing and then reached for `-m "..."` for
the commit message, which is how the guard was applied to one payload and not the other in a single command.

**Rule: any prose containing backticks goes through a quoted heredoc, whatever is consuming it.**

    git commit -q -F - <<'ENDOFMSG'
    ... prose with `backticks` and ${braces}, verbatim ...
    ENDOFMSG

`-F -` reads the message from stdin, `<<'ENDOFMSG'` (quoted delimiter) disables every expansion. Verify with
`git log -1 --format=%B | grep` for a word you expect, because the corruption is silent.

## The long form: incidents, `tools.payload`, and traps (absorbed from the global copy, as_of 2026-09-16)

Until 2026-09-27 a longer copy of this entry lived in the global root under the same name, as the pre-shipping
long form (this entry SHIPPED on 2026-09-17, shortened). It was folded in here and removed; these are the facts only it held.

**The incidents, sorted.** The 6th of the six backtick incidents is the same fact from the other side: an
**unescaped** backtick in payload prose, ending the literal early.

| context                                    | incidents |
| ------------------------------------------ | --------- |
| inserting code into a file                 | 3         |
| building a commit message or shell payload | 2         |

**Never put a backtick inside a template literal. Build the payload as an ARRAY of short single-quoted
lines, with `String.fromCharCode(96)` for each backtick, and splice by line INDEX:**

```js
const BT = String.fromCharCode(96);
const add = [
  "  // ink 7 clears on unmount, so read " + BT + "out" + BT + " first",
  "  const drawn = out;",
];
const src = (await Deno.readTextFile(p)).split("\n");
const i = src.findIndex((l) => l.includes("app.unmount();"));
src.splice(i, 2, ...add);
await Deno.writeTextFile(p, src.join("\n"));
```

A single-quoted (or double-quoted) string cannot be terminated by a backtick, so the failure mode is
structurally unavailable rather than merely avoided. This recovered both incidents it was tried on, **first
try both times**, after two failures doing it the other way. Two further reasons the array wins, both
measured:

- **Per-line quote choice.** Only the template literal spans lines, and it is also the only one that
  interpolates, so multi-line text is forced into the single hostile regime. An array lets each line pick
  its own quotes: a line needing backticks and a line needing an apostrophe then need **zero** escapes
  between them, where the two joined into one template literal need three.
- **Error locality.** A bad array element is a one-line problem the parser points at.

**The other failure: MIXED quotes on one line.** Incident 7 happened while writing the long form, and it
was not a backtick: a long assembled line opened with a double quote and closed with a single one.
Switching quote style mid-line to dodge an escape is how it happens — the choice is made for the start of
the line and forgotten by the end. **Pick one quote style per line and let the char-code constants handle
the contents.** If a line needs so much concatenation that its own quoting is hard to see, it is too long —
split it.

**Do not reach for these:**

- `String.raw` — removes backslash escaping but **still interpolates**, and still cannot hold a backtick.
- Triple-quoted strings — do not exist in JS.
- `sh` heredocs built inside a JS literal — level 2 stacked on level 1, the worst of both. (A quoted
  heredoc typed into `repl_sh`, as in the commit-message section above, has no JS layer and is fine.)
- An ARRAY handed to `sh` — it coerces with a COMMA and silently half-works. Measured:
  `sh(['echo one', 'echo two'])` printed `one,echo two`. Array-ness does not turn shell source into data.

**`tools.payload` — where `shq` comes from.** `shq` is not a repl built-in. It lives in `payload.ts` beside
this file, with `run` (a command with an argv ARRAY via `Deno.Command`, optional `stdin` text — no shell
parses anything, one level of escaping) and `writeLines`:

    await loadTools("payload", "<loom checkout>/loom/library/writing-payloads-in-repl-code/payload.ts")
    const { shq, run } = tools.payload

The file is built from char codes and contains no literal quote characters, so the quoting it implements
cannot break its own source. **Correction recorded by the long form:** an earlier version sold
`tools.payload.writeLines` as an escaping helper. It is not — measured byte-identical to
`Deno.writeTextFile` with the lines joined, no escaping advantage at all; the win belongs to the
array-of-lines pattern, not the wrapper. That version also aimed the whole entry at level 2, shell quoting,
which caused **zero** of the real failures.

**`shq` goes around the DATA, never the command** — which is also why it cannot be built into `sh`:
quoting the whole line would turn a command line with `cd` and `&&` in it into a search for a program of
that name. Only the caller knows which parts are data. It is the **third** choice: if no shell is needed,
an array of lines or argv (`tools.payload.run`, `Deno.Command`) avoids the layer entirely.

**Traps that cost real time:**

- `btoa` throws on non-ASCII (see base64 above); if you must base64, encode with `TextEncoder` first.

- `deno fmt` **reflows signatures**, invalidating an anchor placed above one, and a `deno-lint-ignore`
  comment must sit on the exact line it applies to. Locate by line INDEX after formatting, not by matching
  a multi-line literal.
- macOS `sleep` rejects a second argument, so a marker passed as one exits 1 and leaves nothing running: a
  probe asserting that nothing survived then passes while measuring nothing. Misdiagnosed as a quoting bug
  three times.
- An inline `sh -c` payload given to `startWorker.shell` is parsed TWICE and the quotes collapse. Write a
  script file and pass its path: one level, and the script can be inspected and re-run by hand.

Not carried over, on purpose: the long form's two runnable `eval(...)` lines illustrating the doubled
backslash. They are the example the "`deno fmt` can INVERT an escaping example" section above is about —
in single quotes the backslash before a backtick is dropped, so the "correct" line is itself a
SyntaxError.

## The class is bigger than backticks, and the worst case is PROSE, not code

Measured 2026-10-18, one session, one agent: **8 parse failures in one night.** (This entry's own rate
for that period read 4 in 11723 calls — a figure produced by the stale counting rule above, against a
class that is 1.10% of calls corpus-wide: the lesson is that it CLUSTERS, not that it is uniformly
rare.)

Every one of the eight was a **long message written to a sub-agent or a worker** (`workers.x.stdin`),
and none of them held a backtick or a `${}`. They held:

    - Chinese text with 「」 and full-width parentheses, MIXED WITH double and single quotes
    - an apostrophe inside an English quotation      ("the author's business to point at")
    - a line that simply MISSED ITS CLOSING QUOTE    (7 of the 8)

**The last one is the real mechanism and it is not about escaping at all**: a long array of lines is
written by hand, and the closing quote is lost on a line whose last visible character is a multi-byte
one — `**`, `）`, `」`. There is nothing to escape; there is a terminating character that stopped being
where the eye expects it.

**The fix is not care. Care is what failed eight times.** Use a transport that never enters a JS
literal — and since 2026-10-19 the direct one is `literal`:

    repl_run({ code: "await workers.x.stdin(literal); return 'sent ' + literal.length;",
               literal: <the prose> })

The message is a tool argument, so the missing closing quote has nowhere to happen. The same call used
for a file is `Deno.writeTextFile(path, literal)`.

Where a verb has no such parameter, the heredoc is the other zero-escaping transport:

    cat > "$TMPDIR/msg.txt" <<'LOOMEOF'          <- via repl_sh, which passes NO JS quoting
    ... the prose, with any quotes and backticks it likes ...
    LOOMEOF

    then, in repl_run:  const msg = await Deno.readTextFile(TMPDIR + "/msg.txt");
                        await workers.x.stdin(msg);

**A quoted heredoc (`<<'LOOMEOF'`) expands NOTHING**, so the text needs no escapes at all — not for
quotes, not for `$`, not for backticks.

**Why this is not just about shell**: the same failure lands in `edit` (the anchor's bytes have quotes),
in `board.create` (an acceptance list in prose), and anywhere else a TEXT parameter is written inside a
JS literal. The classification that predicts it is one question — **is this tool's argument text?** —
and it is yes for more tools than the backtick heading suggests.

**And it is why writing the payload into a FILE first and passing the path was worth the extra call:**
the file is written by something with no quoting rules, and the JS literal then holds only a path.
`literal` folds the two calls into one, for the verbs that have it.
