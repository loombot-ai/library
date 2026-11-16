---
name: file-viewer
description: "Read when someone asks to SEE or EDIT a file — or a FOLDER — on screen in the loom web UI (\"show me <file>\", \"let me edit <file>\") rather than in the transcript: markdown rendered, code highlighted, a PDF, an image, and a folder as its listing, click-through built in; text is editable and you hear when they save. A picture in your reply needs none of this: `![alt](path)`."
as_of: "2026-11-09"
---

# `viewer`: one tool, the file is on the page, and the human can edit it

    await startWorker.mcp("viewer", "deno", ["run", "-A", "<this dir>/viewer_mcp.ts", "--root", Deno.cwd()])
    await workers.viewer.show({ path: "loom/session.ts" })              // editable: the human sees Edit
    await workers.viewer.show({ path: "docs/plan.md", readonly: true }) // no Edit, saves refused
    await workers.viewer.show({ path: "main.tex", line: 40 })           // scrolled to line 40
    await workers.viewer.show({ path: "docs" })                         // the FOLDER: its listing, click-through

The tab is already there (loombot registered the page when the server started); `show` puts the file — or the
folder, as its listing — on it and REVEALS the panel, and the result line carries the URL. `show` again and
the page swaps; `stopWorker("viewer")` and the app is gone from the tab strip, because an app lives exactly
as long as its MCP server (`tracking:apps-register-themselves`).

**For an IMAGE in your reply, skip the viewer**: `![alt](path)` is drawn full size in your lane of loombot's
page, snapshotted as the reply lands. The viewer shows an image too, but it is for a file the human should
READ or EDIT. (`read(path)` is the other direction: a file in front of YOU, never the human.)

## The flow, in Xiaohu's words (2026-09-25)

"User clicks Edit to go to edit mode, clicks Save to go back to viewer mode, and the agent is notified
automatically."

| the human does | what happens                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| (nothing)      | VIEW mode, the default: markdown rendered, source in CodeMirror read-only, a PDF, an image            |
| **Edit**       | the SAME file becomes an editor in place: same CodeMirror, now editable; for markdown, the source     |
| **Save**       | writes the file, returns to VIEW mode (markdown shows its new rendering), and you get the save notice |
| Cmd/Ctrl-S     | writes and STAYS in edit mode — the mid-edit habit; a run of them is one notice per burst             |
| **Cancel**     | back to view; with unsaved changes it ASKS inline (Discard / Keep editing) — never a silent discard   |

In edit mode the header holds ONLY **Save** and **Cancel** — no hint line, no Close, and no menu. Save's
tooltip carries the Cmd/Ctrl-S fact; empty header spans take no room.

**THE HEADER IS THE TITLE + THE PATH + ONE MENU BUTTON, AND THE FACTS ARE THE ROW UNDER IT** (card
t20261020-181818-5573; Xiaohu's reason is visual: FOUR BUTTONS IS TOO MANY, and one menu is simpler to look
at). `#head1` is the first row and takes the whole line (`flex: 1 0 100%`); it holds `#title` (the file's
NAME, bold), `#path` (the dim path under it, one line cut at the LEFT — `direction: rtl`, the full path in
its tooltip) and `#actions`, which in view mode holds exactly one thing: a native `<details>` whose
`<summary>` is the menu button. `#path` is the span that GIVES WAY (`flex: 1 1 0`), so a long path can never
push the button off the row. The menu holds **Refresh**, **Edit** and **Close** — every one of them ALWAYS
there, DISABLED when it cannot act (`paint` in `src/app.js`) — and the look of the panel is
`shared/theme.ts`'s `.loom-menu`, not a page's own: ONE border on the panel, plain rows inside it, hover and
focus as the affordance. `tests/app_icon_test.ts` pins it, exactly as it pins `.loom-icons`.

Measured in real headless Chrome on 2026-10-21 (`loom.tmpdir/tree_rig.ts`, the loombot stand-in this file's
own recipe describes: the real `viewer_mcp.ts`, the real page bytes, the real `sandbox` attribute, a real
mouse click per step): the header is **85.1px — two rows — at the 420px panel, at 1000px and top-level at
390x844**, where the same header took THREE rows at 390 before the menu (144px of buttons is what left
`#meta` too narrow). **IT IS TWO ROWS FOR A SECOND REASON SINCE 2026-10-29**: the type/size/lines row went
— it answered nothing a reader asked — and the CRUMB moved up out of its own band into that slot, so the
header is the title row and the crumb's row and the page is 34px taller of content at 390x844 (measured in
real Chrome, both colour schemes, old page and new side by side: `test/browser-test/viewer_crumb_row.ts`,
which also pins that the title and the path did not move by a pixel). ONE EXCEPTION, and it is the trade this card chose: a READ-ONLY file in the 420px panel
is **123.9px, three rows**, because the reason sentence ("read-only: the agent showed this file with
readonly, so it is not for editing here.") is now ON the page and wraps inside `#meta`.

PDFs and images have no edit mode. Text that cannot be edited safely is still SHOWN, with the reason in the
meta group's `#noedit` line — not valid UTF-8 (saving would rewrite every byte that did not decode), or
**A FILE THAT CANNOT BE RENDERED AT ALL**, which is not shown: binary data, or anything past the 2 MiB cap,
answers the DOWNLOAD view instead — see "Back, and the download" below. (It used to be shown TRUNCATED, with
a banner saying how much was missing; that whole branch is gone.) **AND A FILE SHOWN `readonly` SAYS SO
TOO**, which reverses the 2026-10-01 rule ("no Edit button is enough"): the Edit item is inside a CLOSED
menu now, so its absence cannot be read off the header, and the `#noedit` line is what carries the reason in
every case that has one.

## The two view kinds: a file, or a folder (card t20261026-023551-35ae)

`show` takes a FILE **or a FOLDER**, and the page draws ONE of two views at a time — decided by the
frame's own `kind`, with no screen stack and no tree screen (the tree, the `expand`/`children` protocol
and the screen machinery went with this card, and the redesign DELETED more than it added):

    show a FILE              the file view as always, plus a BREADCRUMB: the chain from the app's root
                             down, one click per folder on the way (the "where am I" the tree screen used
                             to say, said from where the reader already is)
    show a FOLDER            the LISTING view: every entry with name, kind, size and date, FOLDERS FIRST
                             and sorted, capped at `LIST_ENTRIES` (200) with a sentence that states the
                             cap and the count left out — a huge directory degrades, it does not refuse
    click a row              a file shows it; a folder opens its own listing — all ONE event
                             (`open_path`), routed by the server's lookup
    the crumb is the way up  NO `..` ROW (card t20261108-084109): the chain above a listing is the one
                             control for going up, and every segment but the one you are in is a click
    a listing says its path ONCE  the TITLE names the folder, the crumb says where it sits, and there is
                             nothing under the divider restating either (`#listdir` is GONE — Xiaohu
                             photographed "loom/cli" beneath a crumb reading "loom / loom / cli")
    Refresh / Edit / Close   act on what is on show; a folder re-lists on Refresh and offers no Edit
    Back / Download          Back is the BROWSER'S OWN HISTORY (see "Back is the browser's history" below),
                             disabled when nothing is behind this view; Download is offered only by a frame
                             that is `downloadable` — see the next section but one

**A FILE OPENED FROM THE PAGE REPLACES THE ONE THE AGENT SHOWED**, and it is not a turn: nobody is told, and
the save notice for a file opened this way is the ordinary one — it went through the same `showAbs`, so it
is in the `served` bookkeeping a save is checked against. A RULE 8 READ INCLUDES LISTINGS: the last listing
is kept like a read (it IS one), so a reload repaints the folder the reader was in.

**A CLICK IS NOT A NEW CAPABILITY.** The page sends a path it was GIVEN, and the server LOOKS IT UP in what
it rendered for the view in front of the person (`files.ts` `renderedNode`, rebuilt with every view by
`renderRendered`) — no string a page sends is ever resolved into a path, exactly as with a save. So a page
can name only what the app already put in front of it, and a path outside `--root` is never rendered at
all: the root is the security boundary at draw time and again at lookup time.

## Back, the download, and the crumb: one rule each (card t20261028-002834-882a)

Three changes that simplify each other, and the ways they are ONE thing rather than three:

**BACK IS THE BROWSER'S HISTORY, AND THE STACK IS THE PAGE'S MODEL OF IT** (cards t20261105-225359-8b14 and
t20261108-081151-a766). Every move (an agent `show`, a row, a crumb segment, a link) stamps a history entry
with `{loomView: <realpath>}` and pushes the view it came from onto `past`; a Back presses `history.back()`
and lets `popstate` send the same `open_path` a row sends, so the menu's Back and the browser's cannot be two
opinions. The item is DISABLED when `past` is empty (inside a closed menu the absence of a row cannot be the
sentence — theme.ts, `.loom-menu-panel`), the SAME path drawn again is not a move (a save, a refresh, an
agent showing one file twice), and THE LANDING REPLACES — it never pushes its own return.

**AND THE TWO MUST AGREE, OR A BACK IS SILENT.** Measured 2026-11-08, in the panel's frame: a document that
boots with a KEPT READ paints the file BEFORE any fetch, so `cur` is already that file when the app's own
frame lands with the same path; the landing was recorded by nothing, the entry the document ARRIVED on stayed
unnamed, and the crumb press after it counted as the document's FIRST view — a REPLACE. `past` then held a
view the browser did not, `history.back()` answered with silence (no popstate, no draw), and `#status` read
"going back…" for ever while nothing moved. Two rules came out of it: the arrival entry is STAMPED with
whatever is on screen even when the draw is memory (`landingMarked` in `src/app.js`), and a Back only
presses the browser when the browser HAS an entry of this document's behind it (`walkable`) — otherwise it
asks the server, which is the walk `past` is. **A press that cannot move must not claim it is going**: every
`popstate` that resolves to no move CLEARS `#status` instead of leaving the sentence standing.

**AND THAT STILL WAS NOT ENOUGH, BECAUSE THE GUARD COUNTS THE PAGE'S PUSHES AND NOT THE BROWSER'S ENTRIES**
(card t20261109-233720-26f0: the owner photographed `going back…` standing in a panel frame while nothing
happened — his SECOND report of it). CHROME STOPS TAKING `pushState` AT FIFTY ENTRIES IN ONE DOCUMENT AND
SAYS NOTHING: pushes 51..60 threw no error and left the count at 50 (measured 2026-11-09 through CDP, and
pinned by the rig's `4k`), so `walkable` can count entries that are not there and `history.back()` then
answers with silence. So the bound is now on the EFFECT: `goBack` says "going back…" and arms `BACK_MS`
(1200ms); a draw, a walk, a refusal and the channel's own failure each SETTLE it (`backSettled`), and a
press whose effect does not land ends in a line that is TRUE about the stack — `nothing to go back to` when
`past` is empty, "nothing went back — the viewer's server is not answering" when it is not. A browser that
was asked and did not walk is not the end of the press either: the page stops trusting its own count
(`historyWorks` false, `walkable` 0) and takes `fallBack()` — the walk `past` is — so an OVER-COUNT costs a
wait and not the press. Two more things fell out of the same rule: a REFUSED `open_path` is said through
`sayAfterDraw`, so its reason survives the refresh read's own draw (that draw is the one writer of `#status`,
and the reason used to be on screen for one frame); and a press with the channel DOWN is answered at once,
with the stack kept, instead of sending `open_path` to a server nobody answers.
`test/browser-test/folder_check.ts` 4g-4k are the claims, and `test/browser-test/evidence-viewer-back/` is
the before and after, photographed in a real panel frame over a listing an agent opened.

**EVERYTHING OPENS: `show` ALWAYS ANSWERS A FRAME, AND THE ANSWER IS RENDERED OR DOWNLOADABLE.** The app
stops deciding which files are openable. A file it cannot put on the page — binary data, anything past the
2 MiB cap, a PDF or a picture past what a registration can carry — answers `kind: "download"`,
the sentence **"file cannot be displayed. Click download to download."** (`DOWNLOAD_SENTENCE`,
viewer_mcp.ts) and a `download` token the menu's row asks the bytes with. Three branches died for it: the
PDF refusal, the picture-past-the-budget refusal, and the truncation banner with `TextDoc.truncated`
behind it, and the deleted gating is asserted as DELETED (a source scan in `tests/app_viewer_test.ts`, so
putting it back is red rather than merely unnecessary). **`kind` IS THE ONLY DISPATCH** — see the next
paragraph — and `downloadable`/`download` are data on the frame.

**THE PAGE'S DRAW IS A FOUR-WAY DISPATCH, AND ONE WRITER PER ELEMENT** (card t20261028-022447-aa96 —
Xiaohu asked whether this page was too complex; it was, and the complexity was DUPLICATION).
`draw(frame)` writes the frame's chrome — the crumb saying where it is, the header saying what it is, the
menu's state — and then hands the frame to the ONE branch that owns the rest of the screen, by `kind`
alone: `listing` / `code`+`markdown` / `pdf`+`image` / `download` (`src/app.js`, the `BRANCH` table). The
branches own DISJOINT elements, so no element has two writers: `#path` and `#title` are `header`'s, the
body's five classes are `skin`'s, `#view`'s display is `setMode`'s. What that cost is the record: two
writers for `#path` meant a fix at the first one did nothing (2026-10-27), and the CodeMirror EDITOR was
created by the read-only paint in a hidden box, which is the blank editor a phone showed on iOS. So THE
EDITOR IS MADE ONLY WHERE ITS BOX IS VISIBLE — for a markdown file that is `enterEdit` and not a draw,
because a markdown's view mode is the server's rendering. `test/browser-test/folder_check.ts` 7j/7k is the
gate: it reads the page's own probe, so a paint that builds an editor it cannot measure fails there
instead of on a phone.

**THE DOWNLOAD'S BYTES COME OVER THE APP'S OWN CHANNEL, IN CHUNKS** (card t20261028-010039-c7a2). `show`
mints a token for the path it already decided to show and puts it in the frame — `download {token, name,
bytes, chunk}` — and the page asks its own `POST __event` with `{event: "download", data: {token, offset}}`,
over and over, until the answer says `done`. It collects the base64 chunks into ONE Blob, makes a `blob:`
URL and presses an `<a download>`. The page never names a path here, exactly as with a save and a click.
ONE DOWNLOAD ON SHOW AT A TIME (`offer` replaces the one slot, `rendered`'s twin) — a page holding an older
frame's token is refused with "press Download again" rather than handed a file from a view nobody is
looking at.

**AND IT IS `__event` BECAUSE THAT IS THE ONE ADDRESS A PHONE CAN REACH.** The route used to be a listener
on `127.0.0.1:0` serving `GET /d/<token>`, and that URL is resolved by THE BROWSER'S machine: Xiaohu pressed
Download on his phone through the relay on 2026-10-28 and NOTHING happened, because 127.0.0.1 there is the
phone. The relay's worker carries `/d/<device>/a/<session>/app/<name>/...` (`relay/peer/sw_source.ts`
`CARRIED_FRAME`), so the app's own data path is the carriage that works from anywhere — and the loopback
listener is DELETED rather than kept beside it, because it served only the case the channel also serves.
`CHUNK_BYTES` is 512 KiB for a measured reason: 699,052 base64 bytes is ONE device-tunnel frame
(`MAX_PAYLOAD_BYTES` = 1 MiB) and ~4% of the relay's message cap (`MAX_MESSAGE_BYTES` = 16 MiB), while the
app's own socket carried 32 MiB without complaint — so nothing in the chain is near its limit, and a
several-MB file is a handful of answers instead of one frame nobody can watch fail.
ONE PRESS IS SEVERAL AWAITS, and that is the one thing not measured here: the `<a download>` is pressed in an
async continuation, not inside the gesture. Chrome does not care (measured, nine megabytes, panel sandbox);
NO iOS was available to this repo's rigs, and Safari is the one that could. If Xiaohu's phone refuses it, the
fallback is not another route — it is an anchor whose href is filled when the blob lands ("press again to
save"), which keeps the carriage and changes only the moment of the press.

**AND THE PANEL HAD TO BE ALLOWED TO SAVE ANYTHING — IT IS NOT SANDBOXED AT ALL NOW.** MEASURED 2026-10-28 in
headless Chrome against this rig: under `sandbox="allow-scripts allow-forms allow-same-origin"` a real
`<a download>` press fired NO download event, for a same-origin and for a cross-origin attachment URL alike;
with **`allow-downloads`** added, both fired. THAT IS HISTORY: on 2026-11-06 `client/conversation.js`
`makeFrame` stopped setting the attribute at all (with allow-scripts beside allow-same-origin it was
escapable, and Chrome said so on every app open), so an app frame saves a file without asking and
`allow-downloads` gates nothing — the rig's harness carries no sandbox either, which is the panel's own
shape. The rig's cell saves NINE MEGABYTES through the real chunks and reads the file back off disk
(`folder_check.ts` 7h, 7h2), and that cell is what found the defect below.

**THE SAVE WAS CANCELLED BY THE PAGE'S OWN LINK HANDLER** (card t20261109-172208-f444, 2026-11-09: the ONE
real defect among the seven red claims the rig had carried since 2026-10-28). `handToBrowser` saves a file
by pressing an anchor it made — `href` the blob, `download` the file's own name — and `src/app.js`'s one
document click listener cancels EVERY anchor's default action inside the panel's frame (the markdown-link
rule). So in the panel, the one place a human presses Download, the nine megabytes arrived, the blob was
made, the press was cancelled, and Chrome saved NOTHING, with no sentence either (`say("")` cleared the one
it had just said). Top-level the same press saved to disk, because the listener returns before the frame
branch — which is why no rig that pressed Download outside the panel ever saw it. **FIXED** in the click
listener: an anchor carrying `download` is the browser's act, and the handler returns before cancelling
anything. `tests/app_viewer_edit_test.ts` ("a save anchor is not a link — its press is the browser's") is
red with the guard removed (measured).

**THE CRUMB IS ONE RULE, AND "WHERE YOU ARE" IS DECIDED BY COMPARISON.** The chain is drawn for a FILE and
for a LISTING now (the listing used to draw none, on the reasoning that its head already said where it was —
a bad call: the same control should behave the same way in both views). The segment whose `path` is the
frame's own `path` is INERT — a `<span class="here">`, not a button — and every other segment opens its
folder: for a listing that is its last segment (its own folder); for a file NONE of them is where the file
is (the file's name is the title above and never a segment), so the whole chain stays clickable, including
the folder the file sits in.

## What you are told, and what to do about it

    notifications/app/saved   the human SAVED a file: its path, +/- lines, the line count now
    notifications/app/closed  the human pressed CLOSE: {by: "user", reason, file, unsaved} — the tab is
                              gone and the server exits; `unsaved` names a file ANOTHER page held unsaved
                              edits to at that moment (its browser keeps them as a draft), else null

Pressing **Save** sends it at once; Cmd/Ctrl-S saves within 3s of each other are one notice
(`--save-notice-ms` changes the window, `--no-save-notice` turns it off). **It costs a turn**: an idle
interactive root is woken by it. That is the point — **anything you read of that file before the notice is
stale; re-read it before you write it**, or your write undoes theirs.

## What it refuses — for the page and for you alike

| the case                                                                 | what happens                                                                                        |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `show` of a path outside `--root`                                        | refused (realpath on both sides, so `..` and a symlink out are the same answer)                     |
| binary, or past the 2 MiB cap, or a PDF/image too big for a registration | **NOT refused**: the DOWNLOAD frame, which states the reason and serves the bytes                   |
| a directory named to `show`                                              | shown, as its LISTING — a folder is a showable object                                               |
| a save to any path `show` did not serve EDITABLE                         | refused — another path, one shown `readonly`, one not editable. The app never picks a path          |
| the file changed on disk since it was shown                              | the SAVE is refused; the page offers **Reload from disk** or **Overwrite**, inline, and never picks |
| a save claiming a base this server never served                          | refused                                                                                             |
| a `#fragment` naming no heading in the file                              | refused — the ids of its markdown headings are the anchors, and nothing else is                     |

**AND NOTHING ABOUT A PAGE'S OWN STATE IS IN THAT TABLE** (2026-10-20). Your `show` is never refused because
a page holds unsaved edits, and a Close is never refused on another page's behalf: what is open or typed in
one page is a fact about THAT page, and it gates nothing — not another page's action, not yours
(`building-a-loom-app/README.md`, the page contract, rule 6). Two rows used to be here, and they were one
disease: with several pages open, one tab's buffer turned your `show` away for ALL of them, and a page that
had crashed without saying `gone` turned it away for ever, in a sentence that told you to ask somebody who
was not there. Nothing was being protected either — that text is also a localStorage DRAFT, offered back on
the next show.

What happens instead: **the show LANDS**. Every page draws it, and a page holding a buffer keeps that text,
says in its status line that the agent showed another file, and opens it when the person is done (the Save
button, or Cancel) — see "Unsaved changes are visible" below. Your tool result names who is holding
something, so you know why the page in front of you still shows the old file:

    showing b.md (…) — version 3. The human can Edit it; you are told when they save. A page holds UNSAVED
    changes to a.md (for 12s): it keeps them, and shows this when the human is done.

The ONE case with nothing to push is a `show` of the file already on the page, unsaved and not `readonly`:
there the frame would carry the DISK text, so the view moves (an optional `line` included) and the human's
edits stay, which is what that result says.

**A REFUSAL IS WRITTEN TWICE, because it has two readers** (t20261009-201706-c56d). You read the tool
result and can run `ls`, call show again, copy a file into the workspace or restart the app with another
`--root`; the HUMAN reads the page's status line verbatim, and a click on a broken markdown link lands
there — so "Check the path with `ls` and call show again" would be shown to somebody who cannot. Each
refusal therefore carries a human sentence as well (`Refused.human` in `files.ts`), and the boundary that
hands it over picks the voice: the tool result gets yours, and every `error`/`save_refused` frame gets
theirs. What the human is told is shorter and never names a verb they do not have.

Saves are atomic: a temp file in the same directory, the original's mode, then `rename`.

## Unsaved changes are visible, and survive the panel going away

A `●` beside the path and `(unsaved)` on the fact line, while the buffer differs from the file — the page's
own state, drawn by the page (the title and loombot's tab strip say the file's name and nothing else since
2026-10-27, card 1325: nothing is reported to the server).

A standalone tab asks before leaving (`beforeunload`). **The panel frame cannot ask** — loombot's iframe
sandbox has no `allow-modals` — so the page keeps a DRAFT in localStorage while dirty, and showing the file
again offers **Restore** (in edit mode, on the base it was made against, so a file that moved since is a
conflict you are shown) or **Discard**. The key is `app:<workspace>:viewer:draft:<path>` — the per-app
prefix, never `loom.`, which is loombot's own (`loom-hq/docs/tracking/features/open/apps-for-non-trivial-uis.md`, G).
A failed draft write is SAID on the page.

## The last read survives a reload, and the bytes have a measured ceiling

The panel reloads an open frame when the app's version moves, and an MCP restart re-registers — so the
reload lands while somebody is reading. The page keeps its last read in **localStorage under
`app:<workspace>:viewer@<agent>:read`** and paints it before the first fetch, so a reload comes back as the
file somebody was reading: the file, the screen they were on, and how far down they were (card
t20261025-061113-3784; the rule is `building-a-loom-app/README.md` rule 8, which this page is the second
worked example of). A failed read never empties the screen — the failure is said in `#status` beside the
file, which is what makes the channel sentence ("the file on screen is the last one read") true. The key
keeps the `@agent` suffix although the draft key strips it: a draft has the base hash to check itself
against, a kept read has nothing, so two agents' viewers of one name must not share.

**The read is BYTES, so the keep has a ceiling and the ceiling is measured, not guessed** — `localStorage`
is about 5 MB of characters for the whole origin, and the drafts live in it too. `KEPT_MAX` is 2 MiB of
JSON characters, measured with the real `files.ts`/`render.ts` against the records themselves: a source
file at the server's own 2 MiB ceiling keeps to a 2,098,213-character record, a 457 KB markdown document to
1,532,672 with its rendering, one level of a directory tree to 2,772. A read past the ceiling is not
dropped: the record degrades to the path, the CRUMB and a `stale` note, and the page paints the header and
says the bytes were too big to keep while it re-reads — the chain is kept with it, because a screen that
kept no bytes must still be one click from where it is — which costs, measured, markdown past ~600 KB of
source and a source file within ~3 KB of the ceiling. The reload the keep exists for re-reads the whole
frame (10.5 ms of server work for the 2 MiB file, 238 ms for the markdown document — the rendering is the
cost — plus the frame on the wire); without the keep the screen was blank for all of it.

## Where the bytes travel, and the budget

The page is `index.html`, `app.js`, `code.js` and the vendored CodeMirror bundle. **A text file travels
over the app channel** (`show` to the page as a change it re-reads, `save` back as one `POST __event`), so
it never competes with the bundle for loombot's
16 MiB `MAX_APP_BYTES`, and showing another text file re-registers only as a RENAME (the tab title): the
panel is relabelled, not reloaded. **A PDF or an image is an asset** (the browser loads it from a URL), and
its registration LEAVES OUT the bundle, so the file gets the whole cap bar a 64 KB page (15.94 MiB).
**A picture INSIDE a markdown file is neither**: it rides the channel with the file, inlined into the html
as a data: URL, because a `src` would be a request to loombot for a file it has never heard of — see "A
picture in a document is read by the SERVER" below.

**CodeMirror loads only for text.** `app.js` has no static import; the first text file it is shown calls
`import("./code.js")`, whose one static import is `./codemirror.js`. A PDF or an image never loads it — and
could not, since its registration does not carry it. Measured 2026-10-09: the page is 817,829 bytes with the
bundle (5% of the cap), 65,436 without it.

## One highlighter, both modes

Source in VIEW mode is CodeMirror, read-only, so pressing Edit does not change a colour — it only makes
the same editor editable. Fenced code in rendered markdown is coloured by the same grammars and style
(`highlightCode` in `code.js`); the server sends a fence as escaped text in `<pre class="fence" data-lang>`.
The viewer's own ~200-line regex highlighter is gone. Markdown RENDERING stays on the server (`render.ts`,
the shared parser `loom/markdown/parse.js`), so the page is handed finished, escaped HTML.

Lezer grammars: TypeScript/JavaScript/TSX/JSX, JSON, Python, Markdown, CSS, HTML, YAML, Rust, Go.
CodeMirror's legacy stream modes: shell (`.sh .bash .zsh`, `.bashrc` …), TOML, **LaTeX** (`.tex .sty .cls
.ltx`) — there is no maintained MIT Lezer grammar for those three (`codemirror-lang-latex` is AGPL-3.0,
which cannot be vendored into loom). Anything else shows as plain text, still editable.

## Long lines: prose wraps, code scrolls

Plain text (anything without a grammar above: `.txt`, `.log`, a bare `LICENSE`) and markdown SOFT-wrap at
the panel's edge; every file with a grammar keeps one screen line per line and scrolls sideways, because
indentation and column alignment are how code is read (Xiaohu, 2026-09-29: "when using the file viewer to
edit a text or md file, long lines should wrap"). It is CodeMirror's `EditorView.lineWrapping` — a class on
the content, `white-space: break-spaces` — so it is visual only: the document, the cursor, undo and the
saved bytes are exactly what was typed. It follows the FILE, not the mode (`wraps(path)` in `code.js`), so a
`.txt` looks the same in view and edit; rendered markdown in view is not the editor and is unchanged.
Measured in Chrome at 1280×800 and 390×844: a 400-character markdown line wraps with `scrollWidth ==
clientWidth`, a click mid-line and typing splices into it, Cmd-Z restores it exactly, and the saved file is
byte-identical to the editor with the same newline count; the same line in a `.ts` stays one row and
scrolls. That run's probe, `viewer_wrap_probe.js`, is GONE with the directory it lived in (see Proof),
and `viewer_header_rig.ts` measures the HEADER, not soft wrap — these are still 2026-10-09's numbers.

## After you change a file the page is showing, SHOW IT AGAIN

**The page is not watching anything.** It holds the `text` from the last `show` frame it was sent, and the
only other refresh is the human pressing "Reload from disk" after a refused save. So when you edit a file
the viewer is showing (a write, an edit, a script), **the page still has the OLD bytes** — and if you then
say "the viewer is up to date", you have made a claim about a page you cannot see, and it is false.

**Call `show` again in the SAME call as the edit.** For a file you can read back, prove it in this order:
read it from disk and list the headings (or the line) you expect ⇒ then `show` ⇒ then say it is updated.
Both, in that order — that is the one sequence that makes the sentence true.

Measured 2026-10-13: an agent edited a design doc it had shown, told the human it was updated, and the
human answered "app 上的内容没有更新". `show` is idempotent and cheap; a false claim is neither.

## The files here

    viewer_mcp.ts          the server: registration, the `show` tool, the page's events, the save notice,
                           and the ONE place a frame's kind is decided (`readCurrent`)
    download.ts            the download's BYTES: the token, the chunking (`CHUNK_BYTES`, `chunk()`), the one
                           slot an offer replaces, and the frame fields a file that cannot be rendered
                           carries (`view`). It listens on NOTHING — the page asks `__event`.
    files.ts               the workspace check, read-for-show (and whether it may be edited), the conflict
                           check, the atomic write, the +/- count, and the pictures a document names
                           (`inlineImages`). Pure of MCP and of sockets — it reads files, nothing else
    render.ts              markdown to HTML, each heading carrying the id that makes it an anchor
                           (`renderDoc` returns the html and the ids from one walk). Pure; its one import
                           is the shared parser
    build.ts               `deno task build`: src/ + vendor/ -> assets/, esbuild and minified, the size
                           table and the assertion that says the artifact really was minified
    deno.json              the app's own `build` task. It borrows the REPOSITORY's config (`--config
                           ../../../deno.json`) rather than pinning esbuild a second time
    src/index.html         the shell, one <link> to loombot's palette, and the CSS that spends its variables
    src/app.js             one POST __event and its answers, the modes, dirty tracking, the draft, the
                           inline questions, PDF/image
    src/code.js            CodeMirror: languages, loombot's colours, the one editor, fence highlighting
    vendor/codemirror.js   CodeMirror 6, VENDORED: one ESM bundle, ~735 KB, versions pinned in its header
                           (written by `vendor/build.sh`, never edited here)
    vendor/codemirror.LICENSE.txt   the MIT licence of every bundled package
    vendor/                package.json + lock (exact versions), entry.js, build.sh
    assets/                THE PAGE, and exactly what `deno task build` writes: index.html, app.js,
                           code.js (minified), plus the two vendored files copied. This is what
                           `viewer_mcp.ts` registers (`PAGE_DIR`), so nothing may be added to it by hand

**Why vendored, not a CDN:** an app page is served from loombot's own origin, so a CDN script would run with
loombot's origin (and its cookie), and a CDN does not work offline. **To bump it:** edit the versions in
`vendor/package.json`, `npm install --package-lock-only` there, then
`sh loom/library/file-viewer/vendor/build.sh`.

## The build: `src/` is written, `assets/` is made (2026-11-09)

The owner's proposal, and this app is the first to do it: `app下面加上src和assets两个文件夹？一个是源代码一个是
bundle后的运行时的代码？这样app的代码也可以最小化。` — one folder for the source a person writes, one for what
a build produced and the runtime serves.

    cd loom/library/file-viewer && deno task build        # writes assets/, prints the size table

**LOOM DID NOT CHANGE.** An app's `--dir` IS its browser assets — `app_mcp.ts` says so in as many words
("loom has no opinion about the layout") — so the split is the app's own business and the whole mechanism
is `PAGE_DIR` pointing at `./assets/` instead of the page's source in `./src/`. `--page <dir>` still names another directory,
which is how a browser rig serves a page it has just built somewhere else.

**WHAT THE MINIFIER BOUGHT, as the build prints it** — the page, everything registered, 929,967 B before
and 826,590 B after (-11.1%; 331,027 -> 295,175 gzip):

    app.js                  minified   22,063 bytes    8,301 gzip   (was 118,620 / 42,135, -81.4%)
    code.js                 minified    6,543 bytes    2,675 gzip   (was  13,363 /  4,693, -51.0%)
    index.html              copied     32,882 bytes   12,046 gzip
    codemirror.js           copied    752,393 bytes  270,880 gzip
    codemirror.LICENSE.txt  copied     12,709 bytes    1,273 gzip

**AND THE NUMBER THAT MATTERS IS THE OTHER ONE.** The bundle is 81% of the page and was already minified
(`vendor/build.sh` builds it with `--minify`), so the whole-page percentage flatters nothing: what came off
the HAND-WRITTEN code is 131,983 -> 28,606 bytes. That is the page a PDF or an image is registered in —
`PAGE_LITE`, every byte but the bundle — which is **177,574 -> 74,197 bytes**, and the PDF's room
(`BUDGET` = `VIEWER_MAX_APP_BYTES` minus it) grew by 103,377 bytes. A 735 KB bundle in that page is still
the thing `tests/app_viewer_edit_test.ts`'s 176 KiB line guards against.

**WHY IT IS NOT BUNDLED.** `src/app.js` imports `./code.js` DYNAMICALLY and only for a text file, and
`code.js` is what pulls the bundle: that laziness is the whole reason a PDF costs 74 KB rather than 827 KB.
A `bundle: true` pass decides for itself which module is reached first and inlines the rest, so each file
is TRANSFORMED ON ITS OWN (`bundle: false`) with every specifier left as written — and the build asserts
that `./code.js` and `./codemirror.js` survive, because a build that quietly rewrote the graph would still
pass a size check.

**WHY `index.html` IS COPIED AND NOT MINIFIED.** It is 32,882 B, about a third comments and about half CSS,
and esbuild does not read HTML — a minifier for it would be a hand-written HTML parser standing between the
document and the four CSS/size gates that assert this page's rules by selector, to save 8 KB (0.9% of the
page). The comments it would strip are exactly the ones a reader needs, and they are all in `src/`.

**WHAT PROVES IT, rather than the size.** Three things, and the build fails on any of them:
`assets/app.js` must NOT contain `whereOf` or `draftKey` — two LOCALS the source declares, so one of them
surviving means the minifier never ran (a frame FIELD like `display` survives as `d.display` and would have
proved nothing); it must still contain `__event` and `code.js`; it must be over 1,000 bytes per line and
smaller than the same source through the same transformer with `minify: false`. And the directory:
`assets/` holds only files this build produces — anything else is PRUNED and named — and a SECOND build
writes nothing, so `deno task build && git status --porcelain` is empty. That is what says the committed
`assets/` is the build's output and not a stale copy of it.

**THE COMPONENTS IN `apps/shared/ui/` WERE NOT COMPILED FOR THIS PAGE.** They are plain `.ts` functions
returning strings, so an esbuild pass COULD make a browser module of them, and this app does not: it has its
own `src/app.js` + `src/code.js` ESM modules and no template layer at all, so there is nothing of that
library here to compile and nothing gained by introducing one. (The `markup` tag in that tree exists because
`deno fmt` reformats the CONTENT of a template tagged `html` — measured 2026-11-09 — which is a trap this
page never meets, having no tagged templates.)

## The protocol between the page and the server

    page -> server   ready {}                        a fresh page: the current file, a text file fresh from disk
                     reload {}                       "Reload from disk" after a conflict: the same, fresh
                     save {path, text, base, force?, done?}   base = the hash served; done = the Save button
                     close {}                        the Close button: the viewer ends, for every page
                     open {href}                     a CLICK on a markdown link: the href as it was drawn, `#fragment`
                                                     included
                     open_path {path}                a row clicked in the listing, its `..`, or a segment of the
                                                     file view's crumb: ONE event, the same path a `show` takes, driven
                                                     by the page — looked up in what the server rendered, never
                                                     resolved from a string it sent
                     (every frame also carries `page`, the page's own id, minted once per load)
    server -> page   show {kind, path, display, text, hash, html?, editable, noEdit, line, version, crumbs}
                                                     `kind: "listing"` is a FOLDER on show: entries (name, path,
                                                     dir, bytes, mtime) and `more`/`moreNote` past the cap.
                                                     `kind: "download"` with `downloadable: true` is a file this
                                                     viewer CANNOT RENDER: `note` is the sentence the page prints,
                                                     `noEdit` the reason, `download {token, name, bytes,
                                                     chunk}` what the page asks the bytes with (see below).
                                                     EVERY kind carries `crumbs` — the chain from the app's root,
                                                     `{name, path}`, root first. A file's ends at the folder it
                                                     sits in; a LISTING's ends at ITSELF.
                     saved {hash, bytes, lines, html?} | save_refused {conflict, reason} | goto {line} | error
                     goto_anchor {anchor, path}      scroll the rendering to that heading id — the ONE frame that goes
                                                     to the page that asked, not to every page (`openLink`)
                     ack                             the app took the event and has nothing to say
                     player_left {app, reason}       the app ended — the answer to THIS page's own Close; a 404 to
                                                     anything else says the same thing (`unreachable`)

(The `close_refused {path, reason}` frame was deleted on 2026-10-20 with the refusal it carried — see
"What it refuses": a page's state never gates another page's action, so there is no question to ask.)

**Close** is shown in VIEW mode only, after Edit, and closes at once (`ch.close`). **A CLOSE ENDS THE
VIEWER** (2026-10-27, card t20261027-025619-fb7e): the ask is a real request, the agent is told
(`notifications/app/closed`, by "user"), the page gets its farewell, the tab leaves the strip, and the next
`show` starts it again — the same path `stopWorker` takes. THE PAGE'S BUFFER GATES NOTHING (the page
contract, rule 6): a page with unsaved text is asked nothing and flushed nothing, and what it typed is
still its own browser's draft. **The escape hatches are gone with the state**: `discard`, `unsaved`,
`close_refused`, and (from 2026-10-20 to 2026-10-27) the `detached` answer to a Close are all deleted —
grep the source before reintroducing one.

**THE SERVER HOLDS NO DIRTY STATE AT ALL** (2026-10-27, card 1325): no `dirty`/`gone` event, no per-page
flag, no `*` in the tab title, no "who is holding something" sentence on a `show` result. That ceremony
bought the agent one fact and cost every page a request per word, and the page was always the holder that
mattered: the human's text, the `●` in the header, the draft in localStorage, and the wait until the human
is done are all inside `src/app.js` (the page contract, rule 6). What is left to tidy up: nothing — a page
that crashed has no stale flag anywhere.

Every request carries an `id` and every answer echoes it, because loombot broadcasts a player's frame to every
browser on the app: a second tab must not take another tab's `saved` as its own — and a tab with unsaved
edits ignores another tab's `show`.

## A markdown link: TWO KINDS, and the renderer decides which

`render.ts` decides it from the one thing it already knows about a href (`workspacePath` / `externalUrl`),
and the two kinds are the whole of this section. It is ONE decision in ONE place — the renderer — and both
halves of the page read it.

- **a PATH IN THIS WORKSPACE** is `<a data-href="..." title="...">`, **no `href` at all**. That is the fix
  of 2026-10-09 (card t20261009-184950-2ba3), and its reason is the frame this page is served into: loombot's
  panel is an iframe with `sandbox="allow-scripts allow-forms allow-same-origin"`, and a press on an href
  inside that frame navigates the FRAME ITSELF — MEASURED in headless Chrome against exactly that sandbox, a
  relative href and an absolute one alike — after which nothing in the panel brings the page back (the tab
  strip does not reload a frame it already has). The measurements are in
  `loom/library/loom-app-frame-navigation/README.md`; the task board's page was fixed the same way one card
  earlier. So the url travels in `data-href`, where no browser will ever follow it, and a CLICK is a message
  to this server (`open`, above).
- **a URL** (`http:`, `https:`, `mailto:`) is a REAL `<a href="…" target="_blank" rel="noopener
  noreferrer">`, and it opens in a TAB of the real browser (2026-11-02 — before that both kinds were
  `data-href` and this server refused the url with a sentence: "a URL is not a file in this workspace",
  true and useless to the person who had just clicked it). Top-level, the page is an ordinary document and
  the browser's own `target` does it. INSIDE the panel it is the PANEL's act: the frame's sandbox withholds
  popups, so `open()` in there returns null (measured 2026-09-24), and the page posts `{type:
  "loom/open-url", url}` to its parent — the channel it already asks for a renewal on — where
  `client/conversation.js` opens the tab. The frame keeps its document, its scroll and its place.

And the style is part of the fix: `src/index.html` colours every `#view.md a` with `var(--you)` and
underlines it, because a browser colours `:link` ONLY and an anchor without an `href` is otherwise prose.
Measured before the fix, in Chrome, on the real page: anchor and body both `rgb(26, 29, 36)`,
`text-decoration-line: none` — the link was invisible as a link and pressable all the same.

The click itself, one message to the server (`open`, above) for a path:

- **a relative href** is resolved against THE FILE ON SHOW — its own directory, so `../loom/x.md` written in
  `docs/a.md` means `loom/x.md` — through the same realpath check `show` makes, and that file is then shown
  here. A link can never become a file browser for the disk.
- **a `#fragment`** is the document addressing ITSELF, and the one click that opens nothing: every markdown
  heading carries the id `render.ts` minted for it (`#why`, `#why-1` for a repeat), the SERVER checks the
  fragment against THOSE ids — it is where they were minted, exactly as it is where a link's path is
  resolved — and answers `goto_anchor`, which makes the page scroll to that heading. In place: no frame
  moves, no location is written, and the second tab of the same file keeps its own place, because the
  answer goes to the page that asked. A fragment naming no id is refused, and says so. (Until
  2026-10-09 this was the refusal: headings had no ids, so `[toc](#x)` reported "no anchors to jump to" —
  card t20261009-201706-c56d.)
- **a URL or a `mailto:` reaching the SERVER is still refused** (`openLink`), in one sentence — but it is a
  GUARD now and not the way a person meets a url: the page never sends one. A url arriving here means a page
  older than the 2026-11-02 rule, and it is answered "is a URL, not a file in this workspace — the page opens
  one in a new tab." The paragraph it replaced argued the point at length, to someone who had only clicked.
- the TITLE on each kind says which: "opens in a new tab" on a url, "opens that file on this page" on a path,
  "jumps to that heading in this file" on a `#fragment`. It used to say one sentence — the refusal — on both
  kinds, which on a path was simply false.
- **a url the allowlist refused** (`javascript:`, `data:`, `file:`, `vbscript:`) is drawn with an empty
  `data-href` and no underline: nothing is sent anywhere, and the page says so.
- **a picture** (`![](shot.png)`) is not a click at all: the server reads it out of the workspace and
  hands the bytes over inside the html, so it draws where it is named (see the section below).
- links INSIDE the rendered text are the only clickable thing in view mode; in edit mode the source is what
  is on screen and there is nothing to click.

A click costs NO TURN and wakes nobody: a human opening another file is a read. It IS refused, exactly as
`show` is, while any page holds unsaved changes — the page prints that reason too.

## A picture in a document is read by the SERVER, through the link's own gate

`![alt](shot.png)` used to draw a broken image: `render.ts` emitted `<img src="shot.png">`, the page is
served by LOOMBOT, so the browser asked loombot for `/a/<ws>/app/<viewer>/shot.png` — and the picture is a file
in the WORKSPACE, which is not an app asset and not a route. The page cannot fetch it either: it holds no
path and has no route of its own. What the page IS handed is the html, so that is where the bytes go now
(t20261009-201706-c56d): the renderer draws a workspace-relative picture as `<img data-src="shot.png">`, a
url nothing follows, and the SERVER replaces it with `<img src="data:image/png;base64,…">` before the frame
is sent (`inlineImages` in `files.ts`).

- **the same gate as a link**: the path is resolved against the file the picture is named in and passed
  through `resolveInWorkspace`, so a `..`, a symlink out, or an absolute path outside the workspace reads
  nothing — a document cannot become a file browser for the disk either.
- **what cannot be filled in keeps NO `src`**: not there, outside the workspace, not a regular file, not a
  kind an `<img>` draws (png, jpg, gif, webp, svg), or past the caps — 2 MiB for one picture, 8 MiB for one
  document's worth — so the browser draws the alt text where the picture would be, and the reason is in the
  tag's `title`. Nothing is silent and nothing is invented.
- **an absolute url is left alone** (`https://…`), because that is the browser's own to fetch, and a url the
  allowlist refused keeps the empty `src` it always had.

The cost is the frame: base64 is 4/3 of the bytes, and they travel over the app channel with the file (a
text file is not in the registration). A document whose pictures are past the caps shows the reason instead
— the fix for the common case, which is the diagram beside the prose.

## It does NOT tell you when nobody is looking — the notice is deleted, and no shipped app had asked for it

`notifications/app/idle` was opt-in per app — `export const notifyWhenIdle = true` in a rules module, a
constant here — and **it was deleted on 2026-10-20, because the measurement was that NO shipped app ever
asked for one.** This app never did: `NOTIFY_WHEN_IDLE = false` was a constant in `viewer_mcp.ts` (there is no
rules module here — this server IS the app), it said yes for one day, and Xiaohu killed it himself on
2026-09-24.

**It asked for that one day, and the day is why the reasons are kept here.** The argument was that a viewer's
cost IS a held process, so "nobody is looking" is exactly when its owner should stop it. Xiaohu, 2026-09-24:
"or the fileview still notifies the agent when no-one is viewing? If so, why do we want the file viewer to
notify?" The argument fails three ways:

- **the signal cannot be interpreted.** A tab switch, a folded panel, a reload and walking away are all zero
  browsers. loombot names the one departure it causes itself; nothing else announces anything.
- **the cost it protects is trivial** — one process of tens of MB, in a session that lasts hours, and every
  app dies with the session anyway.
- **each notice costs you a TURN** whose most obvious action is to stop something the human is still reading.
  That was watched happening.

So: **when you want to know whether anybody has been there, ask.** `state()` answers `watching`, which is
`true` once a page has spoken to the app and `null` before that — there is no `false`, and `/a/<id>/apps`
no longer reports `viewers` at all (card t20261024-022904-fb60: a page has no socket for it to count). Read
it as "somebody has been here", never as "somebody is reading this now". `stopWorker("viewer")` is yours to
call when YOU are done with the file — not something to be prompted into.

**A `show` result says that one thing in its last sentence, and the sentence is `channel.watching()`'s** —
the same two answers `state()` reports, asked once and in one place (t20261009-193432-d5f1). With nothing
having spoken AT ALL it ends ". No page has spoken to this app yet: it will show this file as soon as one
connects."; once a page has, the sentence is silent, because there is then nothing the app can honestly add
— `undefined` is not "nobody", it is UNKNOWN, and the two are worth telling apart in a result you read.

**AND IT USED TO HAVE A THIRD ANSWER, ". No page is open: it will show this file as soon as one is."** It
went with the page's socket (card t20261024-022904-fb60): it was printed when loombot closed the player
cleanly because the last browser's socket had closed, and with pages as requests loombot counts none, so no
state can produce it. Until 2026-10-09 the sentence was built from `toBrowsers`'s return value, which
answers whether there was a SOCKET to push on: the channel redials, so that was silent exactly when it had
something to say.

What you ARE still told is `notifications/app/closed` — the channel could not be re-established at all after
three redials, so nothing this app shows can reach a browser. That one is unambiguous, and it names the verb
that reclaims the process.

## Its colours are LOOMBOT'S, and that is the whole of the theming

    <link rel="stylesheet" href="/theme.css">     <!-- shared/theme.ts, served above the cookie gate -->

That one line is the opt-in, and this page holds **no palette, no hex code and no media query asking the
browser which theme it is in**. It held all three until 2026-09-24, defaulting light while loombot defaults
dark, and Xiaohu's first file came up DARK inside a light panel. Both surfaces "followed the system" — but
a framed document does not see the system: **Firefox gives a nested document the embedder's used colour
scheme as its preference**, and loombot's panel was declaring itself dark-only in a stray line under its own
`color-scheme: dark light`. Chromium propagates nothing, so the mismatch was invisible in one browser and
instant in the other. Measured both ways with the real bytes.

So an app does not guess: it links loombot's variables and spends them. The token classes map onto the four
loombot publishes for its own code blocks — `--str`, `--kw`, `--num`, `--fn` — plus `--dim` for a comment,
with `--line` for every rule and `--panel` for the gutter and code backgrounds. `tests/app_viewer_test.ts`
fails if a palette comes back here, if the link goes, or if loombot renames a variable this page uses.

## Two things that are awkward, and a reader should know before editing

1. **The channel comes from the OTHER library entry.** `../building-a-loom-app/channel.ts` is the app
   channel protocol — registration and its `reveal` flag, the player socket, the clean-close redial, the
   retry ladder, the log, the unmount — shared with `app_mcp.ts`, so a protocol change is one edit
   (2026-09-25, `tracking:one-channel-two-apps`). This file copied ~120 lines of it until then, which is
   what made the same fix land twice three times in one evening. What it costs, and it is the awkward part:
   **this folder is no longer copyable on its own** — mount the viewer from the library where it stands, or
   take `channel.ts` with it.
2. **A PDF does not render in the panel in Chrome, and no change to this app can make it.** See the
   section below; it is the one thing the app promises that it cannot always deliver.

## A PDF in the panel: what renders where, measured

The header and the bytes are right — `contentType` in `loombot/apps.ts` has had a `pdf` entry since
2026-09-24, so the asset arrives as `application/pdf` and the element loads the asset URL directly. What
is left is the SANDBOX. loombot frames an app with

    <iframe id="appframe" title="app" sandbox="allow-scripts allow-forms allow-same-origin">

and a sandboxed browsing context has the **sandboxed plugins flag** set. There is no token in the HTML
spec that unsets it, and Chrome's PDF viewer is a plugin (PDFium via MimeHandlerView). Measured
2026-09-24 with a real loombot, a real registration and a real PDF, in Chrome 153 and Firefox 152:

| element    | Chrome, in the panel                  | Firefox, in the panel     | either, standalone tab |
| ---------- | ------------------------------------- | ------------------------- | ---------------------- |
| `<embed>`  | **empty box**, only a console message | **empty box**, no message | renders                |
| `<iframe>` | broken-document icon                  | **renders** (pdf.js)      | renders                |

Chrome's console says `Failed to load '...' as a plugin, because the frame into which the plugin is
loading is sandboxed`, and the bytes are never even requested. Nothing is visible on the page, which is
why the report that started this read "file viewer does not work for pdf files" with no error quoted.

So the page uses an `<iframe>` — the only element that renders in the panel at all — and when it is
FRAMED it shows one dim line saying a PDF may not render here, with this page's own URL to open in a tab.
That line is **text and not a link**: the same sandbox grants no `allow-popups`, so a `target=_blank`
click from inside the frame is blocked (measured with a real trusted click; Chrome logs the refusal and
opens nothing). The URL is the one `show` already hands back to the agent, and it is drawn as SELECTABLE
TEXT there. There is no longer any control that opens it: the panel's ↗ item went on 2026-10-24 (card
t20261024-open-in-tab), so copying the URL and opening it by hand is what a reader has.

Relaxing the sandbox for app frames, or giving an app a capability that relaxes its own frame, would make
Chrome render it in the panel. Both are policy decisions about every app and neither is this app's to
take.

## Proof

**THE PAGE IS BUILT, SO THERE IS ONE MORE RIG AND IT IS THE ONE THIS CARD ASKED FOR** (2026-11-09):
`test/browser-test/viewer_src_assets.ts` serves the page loombot would register (`assets/`) AND the same page
assembled from source (`src/` for the three hand-written files, `vendor/codemirror.js` for the bundle), in
one Chrome, with one set of frames, at 390x844 and 1280x800 — and asserts that every box the built page draws
is the source page's, to the pixel, in each of the four states: 61 claims, 8 of them that comparison, and a
PNG per state and width in `test/browser-test/evidence-src-assets/`. It also asserts the thing that makes the
comparison mean anything: `draftKey` and `whereOf` are in `src/app.js` and NOT in the bytes a browser is
served. `deno run -A test/browser-test/viewer_src_assets.ts`; it needs Chrome and is not part of `deno test`.

`tests/app_viewer_test.ts` (the app mounted on a real loombot: rendering, escaping, the rename, the PDF with
no bundle, the refusals that ARE refusals, the DOWNLOAD frame AND its route fetched byte for byte, the
palette, and — against a fake DOM — the crumb in both views and Back's stack),
`tests/app_viewer_edit_test.ts` (files.ts as functions —
including the pictures a document names and the two voices of a refusal; the server against a fake bridge —
saves, conflicts, readonly, the notice, a `#fragment` click; the page's modes against a fake DOM — including
the scroll a `goto_anchor` makes, and that only the page that asked moves),
and a real-Chrome session: `~/.loom/library/loombot-page-in-real-chrome/viewer_header_rig.ts` — a loombot
stand-in (it takes the registration, keeps the page bytes handed over, splices `appPageSnippet()` in and
relays both sockets) with the REAL viewer server spawned against it and `show` driven over MCP on its
stdio, and Chrome driven over CDP; it writes one JSON object per cell and a PNG each, and the header's
32-cell before/after tables are kept beside it. **The `viewerhdr2_probe.js` and `viewer_probe.js` this
file used to name are GONE** — the directory had been deleted by 2026-10-15 and both paths were dead. The
rig's README carries the traps: a `beforeunload` dialog stalls `Page.navigate`, every CDP call needs a
deadline, and a page that connects AFTER a `show` draws a different header (`by: "ready"`, no status line).

**AND THE SAME KIND OF RIG FOR THE CLICK-THROUGH, which is the one thing a compiled page cannot show**
(the chain tests in `tests/app_viewer_edit_test.ts` prove the frames, the DOM and the whole wire — page
fetch → loombot route → real viewer subprocess → player socket — end to end; only a browser proves that a
CLICK lands on what a person sees). The 2026-10-21 tree rig measured the two screens this design replaced
(a 14rem column left the file 172px of a 420px panel, which is WHY the tree became a screen; the redesign
replaced both with one full-width view at a time). Its click-per-step recipe
(`Input.dispatchMouseEvent` at the element's centre, after `elementFromPoint` says the pointer is over
it) is what to reuse when the next layout question needs a browser: `show` a file three folders down →
the file view, crumb on → click the crumb → **the listing, 420px, headed `docs/deep/sub`, `../` first**
→ click `deepest.md` → **`docs/deep/sub/deepest.md` on screen, by the page, with no turn** → click the
crumb → the listing again → click `../` → **the listing of `docs/deep`**. Every step's JSON and PNG
written beside the rig; the numbers above are from the 2026-10-21 run, one object per step.

**IT IS `test/browser-test/folder_check.ts` NOW, AND IT CARRIES THE CARD'S TWO NEW CELLS** (2026-10-28):
4b-4f press Back in a real browser (a listing → the file that was on show → the listings it came from, and
a DISABLED Back at the end because the landing never pushes its own return), and 7e-7i press a download
frame's Download row for real — `Browser.setDownloadBehavior` plus `Browser.downloadWillBegin`, which is
the only evidence that a press SAVED rather than drew, and then the nine megabytes in Chrome's download
folder are read back and compared (7h2). Its harness carries NO sandbox any more (the panel dropped the
attribute on 2026-11-06), for the reason the section "Back, the download, and the crumb" states. **RUN IT
WITH `deno task viewer-rig`** (45-90 seconds, one PNG per state into `/tmp/loom-folder-check/; a real
Chrome, no port of its own): on 2026-11-09 seven of its 41 claims were red and had been for a week — four
reading`#facts`, a row commit`6c2b334`removed, one asserting the ".." row`da97e2c`removed, one
holding a band height the crumb lost in`6c2b334`, and the download pair above. Run it whenever the page
moves; a stale claim is REWRITTEN with the commit that made it stale, never deleted.
