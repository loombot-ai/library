---
name: "gmail"
description: "Read when a Gmail account has to be reachable from an agent on this machine - the setup that ends with workers.gmail.search_emails(...) working: a Google Cloud OAuth client per user, the state directory, the run script loom starts, and the four traps that cost a session to find."
as_of: "2026-11-22"
---

# Gmail, from a loom agent

One program (`@klodr/gmail-mcp`), one state directory (`~/.loom/apps/gmail/`), and a run script loom starts as an MCP.
The token never leaves this machine, and loom never holds it.

## 1. A Google Cloud project of your own

    console.cloud.google.com -> new project
    APIs & Services -> Library -> enable the Gmail API
    Google Auth Platform -> Audience: External, and add your own address as a test user
    Credentials -> Create credentials -> OAuth client ID -> type: Desktop app
    Download the JSON

## 2. Where the files go

    mkdir -p ~/.loom/apps/gmail/attachments
    mv ~/Downloads/client_secret_*.json ~/.loom/apps/gmail/gcp-oauth.keys.json
    chmod 700 ~/.loom/apps/gmail && chmod 600 ~/.loom/apps/gmail/gcp-oauth.keys.json

The JSON is exactly what Google gave you: top-level key `installed`, `redirect_uris: ["http://localhost"]`.
**Do not edit it.**

## 3. Install the program (not `npx`)

    npm i -g @klodr/gmail-mcp@3.0.1

**Not `npx -y`**: loom's mount deadline is 15 s and npx spends longer resolving the package, so the mount fails
with *did not respond within 15s*. The version is whatever that command installed - upgrade by running it again.

## 4. The run script

    ~/.loom/apps/gmail/run       (chmod 700)

    #!/bin/sh
    set -e
    APP="$HOME/.loom/apps/gmail"
    export GMAIL_OAUTH_PATH="$APP/gcp-oauth.keys.json"
    export GMAIL_CREDENTIALS_PATH="$APP/credentials.json"
    export GMAIL_MCP_STATE_DIR="$APP"
    export GMAIL_MCP_AUDIT_LOG="$APP/audit.log"
    export GMAIL_MCP_DOWNLOAD_DIR="$APP/attachments"
    export GMAIL_MCP_DRY_RUN="${GMAIL_MCP_DRY_RUN:-1}"
    exec "$HOME/.npm-global/bin/gmail-mcp" "$@"

## 5. Authorize, once

    ~/.loom/apps/gmail/run auth --scopes=gmail.readonly,gmail.compose

It prints an authorization URL. Open it, pick the account, and approve. The process is listening on
`localhost:3000` for the callback and writes `credentials.json` (0600) when the code is exchanged.

## 6. Start it from a repl

    const g = await startWorker.mcp("gmail", "/Users/<you>/.loom/apps/gmail/run");
    await workers.gmail.search_emails({ query: "newer_than:7d", maxResults: 5 });
    await workers.gmail.read_email({ id: "1a2066649e9ae05f" });
    await workers.gmail.list_drafts({});

Every result arrives wrapped in `<untrusted-tool-output>`: mail is written by strangers.

## 7. The four traps

1. **`gmail.compose` includes sending.** `send_email`, `send_draft`, `reply_to_email`, `forward_email` all
   appear with it. Read-only means `gmail.readonly` alone.
2. **`npx` is too slow to mount** (see 3).
3. **The OAuth files live at a path the program names**, not where an env var feels right: `GMAIL_OAUTH_PATH`
   moves the keys, `GMAIL_CREDENTIALS_PATH` the token; without them it reads `~/.gmail-mcp/`.
4. **`GMAIL_MCP_DRY_RUN=1` is the program's own switch**, not a permission. Google's scope is the permission.

## 8. Remove it

    google: account -> Security -> Third-party access -> remove the client
    rm -rf ~/.loom/apps/gmail
    npm rm -g @klodr/gmail-mcp
