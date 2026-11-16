---
name: mcp
description: "Read when a person wants to publish what is in ~/.loom/library/share/, list somebody's public entries, or fetch one into a folder the viewer and `read` can open — the three verbs of `loom/library/mcp/`, the wire they speak, and the refusals they give instead of sending."
as_of: "2026-11-08"
keywords: library, publish, share, sync, entry, list, get
---

# The library MCP server

`library_mcp.ts` in this folder is the agent's side of the public library (`docs/library.md` §8): **three
verbs and no UI**. A person's entries are read at `https://loombot.ai/library/<handle>`, and writing happens
through `loom` — never in a browser.

    await startWorker.mcp("library", "deno", ["run", "-A", "<this library>/mcp/library_mcp.ts"]);

That is the whole command. `--share <dir>` is the one flag worth passing; the rest below are defaults.

## The three verbs

| verb   | args                       | does                                                                                                                                                                                                                        |
| ------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list` | `{handle?, limit?}`        | one person's entries, newest first — `GET /library/<handle>`. No handle means YOU, read off the `.loom-entry.json` your own published entries carry.                                                                        |
| `get`  | `{handle, slug}` or `{id}` | the entry's files into a folder under **the run's temp directory**, and returns that **path** plus `{entry_id, id, name, published_at}`. `{id}` is a `loom://e/<uuid>` reference, resolved to wherever the entry lives now. |
| `sync` | `{plan?}`                  | walks `~/.loom/library/share/`, refuses locally what the account would refuse, then `POST /apis/library/sync`. `plan` is the DEFAULT and publishes nothing; `{plan: false}` applies it.                                     |

`endorse` and `comment` are §8's table and NOT here: §7 deleted both verbs (a citation IS an endorsement, a
comment is a task card), so there is nothing to build until that table lands.

## `get` returns a PATH, and that is the point

§8: "`get` returning a path is what makes the file viewer the library's reader: the agent and the person
look at the same bytes through the same tool." So the files land in `<TMPDIR>/library/<handle>/<slug>/` —
never in a workdir, where a fetched entry would look like part of somebody's project — and the answer is the
folder, the three identities, and one row per file with its byte count. `show({path})` puts it on the page;
`read(path + "/README.md")` reads the bytes.

An existing folder is REMOVED before the files are written: a version of the entry that dropped an image
must not leave the old image readable as if it were this one.

## The identity is the machine's credential, never a key

§5: a bound machine publishes with the credential it already holds, and there is **no publish key** —
nothing to paste, nothing to show once, and revoking the machine on `/account` takes publishing away in the
same press that takes the tunnel away. `wire.ts` reads that credential from:

- `<workdir>/.loom/account.json` — what a pairing writes today (`loombot/account.ts` `accountPathOf`), then
- `~/.loom/accounts/<origin>.json` — the machine-level slot §5 names (`https://loombot.ai` is
  `https-loombot.ai.json`; the scheme keeps its prefix and every `:` and `/` after it becomes `-`),

and takes the first whose own `origin` matches. A file for another stack is not this stack's.

**With no credential, nothing is sent.** The refusal is one sentence naming both paths and the press:

> this machine is not bound to https://loombot.ai, so nothing was sent: no device credential is at
> `<workdir>/.loom/account.json` or `~/.loom/accounts/https-loombot.ai.json`. Pair this machine on the
> https://loombot.ai/account page - Connect this machine, with loom running there - and run this again.

## `sync` is the folder's decision

**`~/.loom/library/share/` IS the published set** (§6). An entry is a folder in it holding `README.md`, and
the slug is the path inside the folder, so `share/relay/streams/README.md` is
`/library/<handle>/relay/streams` — a sub-entry is its own entry at its own path, and a folder in the middle
of the tree that holds no `README.md` is just a nesting level.

**Never sent:** `AGENT.md` (the file beside CODE, read before changing it — a fact about the private folder,
not about the entry a stranger reads) and every dot file. `.loom-entry.json` is the one dot file that is
READ: `{entry_id, handle}`, written the first time an entry is shared, and what lets a re-sync keep an
entry's identity instead of minting a new one.

**The wire** is §6's, one request:

```json
{
  "sync": false,
  "entries": [
    {
      "path": "relay/streams",
      "entry_id": null,
      "files": [
        { "path": "README.md", "type": "text/markdown", "content": "<base64>" },
        { "path": "diagram.png", "type": "image/png", "content": "<base64>" }
      ]
    }
  ]
}
```

`sync: false` is the DRY RUN the plan is made of: the account computes add/update/delete from the tree and
writes nothing (its own suite asserts the emptiness, not the answer). `sync: true` applies it — **that is the
one destructive verb**: an entry the account holds and the folder no longer names is DELETED.

## It refuses locally what the account would refuse, before any request

A sync is all-or-nothing, so the local answers are §6's table read first — and they arrive as ONE message
listing every problem, because one attempt should be one fix list:

| trouble in `share/`                                                                   | the sentence names                                                             |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| a folder holding files and no `README.md`                                             | the folder, its files, and that they would never be published (`not_an_entry`) |
| `README.md` front matter without `name`, `description` or `as_of`                     | the file and each missing field (`no_front_matter`)                            |
| a file outside `text/markdown`, `text/plain`, `image/png`, `image/jpeg`, `image/webp` | the file and the five (`unsupported_type`)                                     |
| more than 32 files an entry, 1 MB a file, 2 MB a sync                                 | the file or the tree and the limit (`too_large`)                               |

A file at the TOP of `share/` is named and skipped rather than refused: the top of that folder is not an
entry and could never be one, so a note kept there is not a mistake about publishing.

The account's own refusals are read back with the press that fixes them — `401 not_a_machine` (pair the
machine), `403 machine_revoked` (pair it again), `409 no_handle` (claim a name on `/account`), and the three
422s with the field, the type or the path.

## The plan is words a person can act on

    $ sync                      2 new, 1 changed, 1 to remove

      new      relay/streams      https://loombot.ai/library/<handle>/relay/streams
      new      where-loom-runs    https://loombot.ai/library/<handle>/where-loom-runs
      changed  loom-itself        https://loombot.ai/library/<handle>/loom-itself
      remove   old-thing          https://loombot.ai/library/<handle>/old-thing

    nothing was published: this was a plan. It is one dry-run request (`sync: false`) - the account
    computed these counts from this tree and wrote nothing, and no entry id was written here. Press
    sync({plan: false}) to apply it.

An apply says the same thing in the same order and adds how many ids it wrote back.

## The read side is HTML today, so this client reads HTML

`GET /library/<handle>` and `GET /library/<handle>/<slug>` are §3/§4's addresses and the deployment answers
them with the site's own pages. `wire.ts` ASKS for JSON (`accept: application/json`) and falls back to the
markup `entryRow`/`entryPage` emit — pinned to those two functions and to nothing else. The day the
deployment answers JSON, the JSON branch runs and the markup readers are dead code rather than wrong code.

Two facts are only in the markup in that mode, and the answer is honest about it: `entry_id` and
`published_at` come back `null` from an HTML page (the page names neither), while the content id `id` is read
off the `?v=` every asset URL carries.

## Tests, and what they pin

`tests/library_mcp_test.ts`: 26 tests against a local stub account that records every request and answers
§6's shapes. The claims that matter are ABSENCES — the plan is one request with `"sync": false` and the
account's store still empty; a folder with no README, a bad front matter, a bad type and a missing credential
each produce ZERO requests; `AGENT.md` appears in no payload; a `get` writes a folder whose `README.md` reads
back byte for byte.
