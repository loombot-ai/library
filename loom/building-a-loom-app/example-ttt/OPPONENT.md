# Being the opponent: the brief a player sub-agent is started with

This file is a TASK, not a skill — it is written to be handed to a sub-agent verbatim:

    const brief = await read(dir + "/OPPONENT.md", { numbers: false });
    await startWorker.agent("player", workdir, brief + "\n\nTHE APP DIRECTORY IS: " + dir);

`{numbers: false}` matters: `read()` numbers every line by default, which is what makes it right for citing code
and for `edit`, and a brief with `1:` down its left margin is the corruption this repo has logged three times
(`loom-hq/docs/tracking/bugs/deferred/writing-a-payload-in-repl-code-is-a-trap.md`). Not `Deno.readTextFile` — that has no
binary guard and decodes lossily; `read` refuses a file that is not text.

## You are the opponent. That is the whole job.

A human is playing a board game in a browser and you are the player on the other side. Do not edit files, do not
commit, do not investigate the codebase, do not start other work.

## Start the app, first thing, in one call

    await startWorker.mcp("board", "deno", ["run", "-A", "<library>/app_mcp.ts",
      "--dir",   <the app directory> + "/assets",     // what `deno task build` wrote - the page's bytes
      "--rules", <the app directory> + "/rules.ts"])   // the channel's code, at the app's top, never served

The app directory is named at the end of the message that started you. That registers the app with loombot and
creates a tab; YOU own the server, so the app id carries your name (`example-ttt@player`) and the app lives
exactly as long as your server. Do not stop it. Say it is up, in one line, and nothing else — the tab has
already opened in the human's panel (the mount's report names the tools, not a URL) — a human is waiting
to click.

## How a move reaches you, and how you answer it

The rules in the app's `rules.ts` answer everything mechanical themselves: legality, whose turn it is, win
detection, the redraw. You are asked EXACTLY ONE kind of question — which square to play — and it arrives as a
notification carrying the position (`text` is a rendered board; `cells`, `size` and `win` are the state).

The app declares its own tool for the answer, and the tool IS the app's legality check. It is called `move`, it
takes one square, and calling it is one line:

    await workers.board.move({ square: "B2" })

A square is a column letter and a 1-based row: `A1` is top-left. `move` is your whole vocabulary — there is no
other tool you need and none you should invent. The generic `send` is still on the surface and it is NOT your
door: it puts a frame in front of the page and tells you nothing about whether the move was legal.

## AN ILLEGAL MOVE IS THE TOOL'S ERROR — and the error is the whole of the answer

If the square is not playable — taken, off the board, not your turn, or the game has ended — the call FAILS.
`move` returns an MCP error whose text is the rules' own reason: `"B2 is taken, by X"`, `"Z9 is not a square on
this board — A1 to C3"`, `"O moves next, not X"`. Read it, pick a square the reason leaves alone, and call `move`
again IN THE SAME TURN.

The error is a return value of the call you made, so nothing else is coming: no frame, no notification, no
changed board. Do not wait for one and do not end your turn because of one — the position is unchanged, so the
human is still waiting on the square you were asked for. Two errors in a row is worth telling your parent about,
because it means you are misreading the board; an error that says the game is over is not a retry, it is the end.

A legal call answers at once with the square played and the board it produced, and the page redraws itself from
the state that follows. You send nothing else and wait for nothing else: your next act is `wait()`.

## PARK, DO NOT HAND OFF — the rule that costs the most if you get it wrong

After a move has been accepted, call `wait()`. Do not end your turn.

Ending a turn IS a handoff: it wakes your parent to read "idle, waiting for input" and decide nothing. A game of
forty moves would wake it forty times for no reason. `wait()` keeps your turn open and returns when the next
question arrives, so the loop is: read the position, call `move` once (twice if the first was refused, and then
only after reading the reason), `wait()`, repeat. It maxes out at 600 seconds; if it returns with nothing, call
it again.

End your turn only when something is genuinely broken and a human needs to know: a move refused twice in a row,
an error that says the game is over when you were still asked to play, a notification with no position in it, or
the app channel going away.

## Play properly, and fast

Every move of yours is a turn boundary, which a human experiences as the pause before a stone appears — two
seconds reads as thinking, thirty reads as broken. So do not deliberate in prose, do not call `state` when the
notification already carried the state, and do not write code: read the board, pick the square, call `move`. One
tool call per move.

Take a win if you have one. Block theirs if they have one. Otherwise take the centre, then a corner. Losing to an
avoidable fork is the one outcome that makes the whole demonstration pointless.
