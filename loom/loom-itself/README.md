---
name: loom-itself
description: Read when someone asks what loom IS - its two entry points and which one they want, how a session differs from a browser tab, where the library sits, and what the pieces on the wire are called. The facts a loom agent needs to answer questions about loom without guessing.
keywords: what is loom, loombot, loom CLI, entry points, session, self
as_of: 2026-11-08
---

# loom, and the two ways in

**`loom` and `loombot` are two ENTRY POINTS to the same harness, and they differ in exactly one
respect: how many sessions they hold.**

**Both are BINARIES a person installs and runs** (owner, 2026-11-08: `loom和loombot两个二进制命令`) -
`loom` in a terminal, `loombot` for the browser UI. Neither is an internal nickname for a subsystem: each
is a command on a person's machine - in the installer, in the launchd/systemd unit, in the release
artifacts and in the auto-update check. **0.3.5 RENAMED the second one.** Before it, the browser-UI binary
carried a daemon suffix; that word leaked onto the homepage, the account pages, the relay's pages, the
error text and the install output, so a person met three words for one harness. The retired word is now
what `tests/retired_name_gate_test.ts` refuses (the needle is assembled in `tools/retired_name_gate.ts`,
so no file exempts itself), and the gate covers `loom-hq` too - which is why no later entry may write the
old name even to explain the rename.

|                | `loom` (the CLI)                                                                      | `loombot` (the browser UI)                                             |
| -------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| how it runs    | one process, your terminal                                                            | one process, serving a page                                            |
| sessions       | **exactly one**, and it ends with the process                                         | **many**, each its own session with its own repl                       |
| input          | a task (solves it and exits) or a conversation (a line is a message, Ctrl-D finishes) | the page: several sessions side by side, each with its history on disk |
| reachable from | nowhere else - it is yours in that terminal                                           | another device, through the relay (phone, another machine)             |
| named by       | `--provider`, `--library`, `--add-dir`, `--task-ttl`                                  | the page, plus a pairing code for a second device                      |

So: **a question about one conversation in a terminal is `loom`; a question about switching between
sessions, or reaching this machine from a phone, is `loombot`.** Neither is a subset of the other in
capability - both run the same harness - but only `loombot` keeps sessions alive after you stop
typing, and only `loombot` is reachable off the machine.

## What one session is

- **A repl** - a persistent JavaScript process the agent writes into, with `read`, `search`, `edit`,
  `sh`, `loadTools`, `startWorker.*` in scope and nothing else.
- **A workdir** and a **library** (`~/.loom/library` by default, `--library` to move it).
- **On disk** under `~/.loom/sessions/<scope>/`: the conversation log, the repl's log, the trace.
  That is why a session survives a page reload and a killed browser.
- **The session LIST is the DISK** (2026-11-08): a session IS a folder under `<workdir>/.loom/sessions/`,
  and that is what the panel lists - there is no index, so no file can be empty over the list. The one file
  kept is the RETIRED ids, `<workdir>/.loom/sessions/retired.json`, inside the workdir so a moved or removed
  workspace takes them with it. `~/.loom` itself did NOT move in the binary's rename: a directory of a
  person's data is not a name, and the daemon's directory inside it now carries the device table and the
  shutdown log and nothing about which sessions exist.

## The words on the wire (so an answer does not invent one)

- **relay** - `relay.loombot.ai`, a Durable Object per device; it carries bytes and never parses them.
- **account** - `loombot.ai`, who you are, your devices, your entitlement.
- **tunnel** - the connection `loombot` holds to the relay; the phone reaches this machine through it.
- **pairing** - the one-time code that lets one more device in.

## The honest limits to say out loud

- `loom` cannot be reached from another device: there is no relay link in a CLI run.
- `loombot`'s sessions live on THIS machine; the page on a phone is a window onto them, not a copy.
- Two `loombot` processes sharing one `~/.loom` share one device identity, and the relay keeps ONE
  socket per device, so the second steals the first's (`device replaced`). A test daemon must be
  unpaired: a HOME with no `account.json`.
