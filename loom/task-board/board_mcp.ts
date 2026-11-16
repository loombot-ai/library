#!/usr/bin/env -S deno run -A
/**
 * `board`: the task board as a PAGE — one entry, started by an agent with `startWorker.mcp`.
 *
 *     await startWorker.mcp("board", "deno", ["run", "-A", "<library>/task-board/board_mcp.ts"]);
 *
 * THAT IS THE WHOLE COMMAND. `--board <path>` (the board to show, `board/` under the CWD by default) is
 * the one flag worth passing, and everything else below is a default this file supplies.
 *
 * ## This file is the server, and it writes no server
 *
 * An app IS an MCP server that registers its page with loombot, and that server already exists:
 * `building-a-loom-app/app_mcp.ts`. So this entry IMPORTS IT WHERE IT STANDS rather than copying it —
 * and copying is the trap, not the fast path: `app_mcp.ts` imports `./channel.ts` beside itself (the
 * app-channel protocol, shared with the file viewer, which is the other app that mounts it), so a copy
 * of it in this folder would look for `channel.ts` here and import nothing. Mount from the library, and
 * one edit to the protocol reaches every app.
 *
 * ## What this file adds: the app's own layout, as defaults
 *
 *     --dir   <this entry>/assets     what its `deno task build` wrote from src/: the bytes a browser gets
 *     --app   board                   the tab's label and the name the agent addresses in workers.board
 *     --rules <this entry>/rules.ts   the mechanical half — see its header. `.ts` is never handed to a
 *                                     browser (registration strips it), so the rules sit at the entry
 *                                     top and NOT in src/ or assets/
 *
 * A flag already on argv WINS: the defaults are appended, and app_mcp.ts's `flag()` takes the first one
 * it finds.
 *
 * ## The board, and where it lives
 *
 * `--board <path>` is read by `rules.ts` off this same argv — the rules run inside this process and
 * app_mcp has no channel to hand a rule a flag. The default is `board/` under the CWD, which under
 * `startWorker.mcp` is the agent's workdir: the repo you are working in. Nothing else locates it.
 *
 * ## What it does not do
 *
 * The page WRITES NO RECORD: it draws, searches and shows details, and every read goes through `rules.ts`
 * into `tasks.ts`. Claiming a task and changing its state stay with the agent (`tasks.ts`, as a tool),
 * which is the repo's own lesson — loombot refereed a board once and two writers corrupted one state file
 * in silence. `board/` is the only store of the RECORDS: no index, no cache, nothing under `TMPDIR` but
 * the channel's own state file — and that file now holds exactly one fact, WHICH TASK THE PAGE IS SHOWING
 * (`rules.ts`), because an action is never replayed to a page that connects later and the state is the
 * only place a late page could have learned it.
 *
 * The app lives exactly as long as this process, and three things end it: `stopWorker("board")` on the
 * agent's side, a rule's own `close` answering the AGENT's `send`, or the session ending. The page's
 * Close button does NOT (this entry starts the app durable, card t20261025-061114-f6b7): it detaches
 * that page — the page is told — and the server stays registered for the next open of the tab.
 *
 * Start it BY HAND and there is no loombot to register with, so app_mcp.ts prints its usage line and
 * exits 2 — an app is started by an agent, which is what puts the bridge in the environment.
 */
const HERE = decodeURIComponent(new URL(".", import.meta.url).pathname);
const has = (name: string): boolean => Deno.args.includes("--" + name);
const defaults: string[] = [];
if (!has("dir")) defaults.push("--dir", HERE + "assets");
if (!has("app")) defaults.push("--app", "board");
if (!has("rules")) defaults.push("--rules", HERE + "rules.ts");
// **A FIXTURE, NOT A SESSION TOY** (card t20261025-061114-f6b7): the board's records are on disk and
// outlive every page and every loombot life, so a page's Close DETACHES that page and ends nothing —
// the server stays registered, the tab stays in the strip, and the next open needs nobody. See the
// close-semantics section in `app_mcp.ts`'s header; the agent's own close still ends it.
if (!has("durable")) defaults.push("--durable");
Deno.args.push(...defaults);

// A DYNAMIC import, and that is the point rather than a style: `app_mcp.ts` runs its whole server at
// module load (flags, rules, registration, stdin), so the defaults above have to be on `Deno.args`
// BEFORE it is evaluated. A static import is hoisted above them, and the server would start with an
// `--dir` derived from the CWD instead of this entry's assets/.
await import("../building-a-loom-app/app_mcp.ts");
