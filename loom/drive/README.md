---
name: "drive"
description: "Read when a Google Drive has to be reachable from an agent on this machine - searching ALL of a Drive (which drive.file cannot do), reading Docs/Sheets as text, and uploading files; the scope list to pin, the state directory, the run script, and what drive.file will refuse."
as_of: "2026-11-22"
---

# Google Drive, from a loom agent

`@jo3zik/google-drive-mcp` (130 tools: Drive, Docs, Sheets, Slides, Calendar), one state directory
(`~/.loom/apps/drive/`), started by a `run` script. **The scopes are pinned in that script** - the package's
default set is broad (read AND write across Docs/Sheets/Slides/Calendar).

## 1. In the Google Cloud project (once per project)

**1a.** APIs & Services -> Library -> enable **Google Drive API** (not *Drive Activity*).

**1b.** Google Auth Platform -> **Data Access** -> Add or remove scopes -> add, one at a time:

    https://www.googleapis.com/auth/drive.readonly    (find and read ANY file: whole-Drive search)
    https://www.googleapis.com/auth/drive.file        (create and manage only files this app made)

A scope that is not declared here makes the authorization fail with `invalid_scope`, and nothing says why.

**1c.** An OAuth client (desktop) already exists for this project if another app uses it - the same
`gcp-oauth.keys.json` works for both. Otherwise: Credentials -> Create credentials -> OAuth client ID ->
**Desktop app** -> Download JSON.

## 2. The directory

    mkdir -p ~/.loom/apps/drive/xdg
    cp <somewhere>/gcp-oauth.keys.json ~/.loom/apps/drive/
    chmod 700 ~/.loom/apps/drive && chmod 600 ~/.loom/apps/drive/gcp-oauth.keys.json

## 3. The run script

`~/.loom/apps/drive/run`, `chmod 700`:

    #!/bin/sh
    set -e
    APP="$HOME/.loom/apps/drive"
    export GOOGLE_DRIVE_OAUTH_CREDENTIALS="$APP/gcp-oauth.keys.json"
    export GOOGLE_DRIVE_MCP_SCOPES="drive.readonly,drive.file"
    export GOOGLE_DRIVE_MCP_AUTH_PORT=3100
    export XDG_CONFIG_HOME="$APP/xdg"
    exec "$HOME/.npm-global/bin/google-drive-mcp" "$@"

Install the program first: `npm i -g @jo3zik/google-drive-mcp`.

## 4. Authorize, once

    ~/.loom/apps/drive/run auth

It opens a browser (and prints the URL). The callback is `http://127.0.0.1:3100/oauth2callback`; the consent
page shows *Google hasn't verified this app* -> Advanced -> Go to <app> (unsafe). It ends with
`Authentication successful. Account 'default' is ready.` and writes `$XDG_CONFIG_HOME/google-drive-mcp/tokens.json`.

## 5. Start it, and check what was granted

    await startWorker.mcp("drive", "$HOME/.loom/apps/drive/run");
    await workers.drive.authListScopes({});          // requested == granted, missingScopes: []
    await workers.drive.search({ query: "invoice" }); // whole Drive, by name
    await workers.drive.readTextFile({ fileId: "..." });
    await workers.drive.createFolder({ name: "loom" });
    await workers.drive.uploadFile({ localPath: "/tmp/x.txt", parentFolderId: "<id>" });

`authListScopes` is the check worth keeping: it reports requested, granted and missing, so "did it really get
only these two" is a call rather than a belief.

## 6. What `drive.file` will refuse

Writing is limited to files and folders this app created (or that a picker handed it). Expect `403`/not-found
when writing into an existing folder you made in the Drive UI. Reading anything is unaffected: `drive.readonly`
covers the whole Drive.

## 7. The traps

1. **The default scopes are broad.** Without `GOOGLE_DRIVE_MCP_SCOPES` it asks for Drive/Docs/Sheets/Slides/
   Calendar, read and write. Pin the list in `run`.
2. **`XDG_CONFIG_HOME` decides where the token lands** (`$XDG_CONFIG_HOME/google-drive-mcp/tokens.json`),
   otherwise `~/.config/google-drive-mcp/`. Set it, or the token is somewhere you did not choose.
3. **`drive.file` cannot search the whole Drive** - that is what `drive.readonly` is for. Needing "search all my
   files" rules out `drive.file`-only servers.
4. **The auth port is fixed by default (3000).** `GOOGLE_DRIVE_MCP_AUTH_PORT` moves it; it then tries five
   consecutive ports, so a busy port is survivable.

## 8. Remove it

    google: Security -> Third-party access -> remove the client
    rm -rf ~/.loom/apps/drive
    npm rm -g @jo3zik/google-drive-mcp
