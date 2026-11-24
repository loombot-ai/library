---
name: "gmail"
description: "Read when a Gmail account has to be reachable from an agent on this machine - the setup that ends with workers.gmail.search_emails(...) working: a Google Cloud OAuth client per user, the state directory, the run script loom starts, and the four traps that cost a session to find."
as_of: "2026-11-22"
---

# Gmail, from a loom agent

One program (`@klodr/gmail-mcp`), one state directory (`~/.loom/apps/gmail/`), and a run script loom starts as an
MCP. The token never leaves this machine, and loom never holds it.

## 1. A Google Cloud project of your own

Work in `console.cloud.google.com` with YOUR OWN project. Do not add this to a project that already does
something else (a sign-in client, another product): the consent screen, the enabled APIs and the test-user list
are per PROJECT, so sharing one changes both things at once.

**1a. The project.** The project selector at the top of the console → **New project** → a name (for example
`loom-gmail`) → **Create**. Make sure the selector now shows it.

**1b. Enable the Gmail API.** Left menu → **APIs & Services → Library** → search `Gmail API` → open it →
**Enable**. (It ends on a page that says *Manage*, which means it is already on.)

**1c. The consent screen.** Left menu → **Google Auth Platform → Branding** (older consoles call it **APIs &
Services → OAuth consent screen**). If it says the platform is not configured, press **Get started** and answer:
app name, your email as support contact, **Audience: External**, your email again as contact, agree to the
policy, **Create**.

**1d. Add yourself as a TEST USER - this is the step people miss.** Left menu → **Google Auth Platform →
Audience** → the **Test users** section → **+ Add users** → your own Gmail address → **Save**. Without this the
consent page refuses you with *“has not completed the Google verification process … can only be accessed by
developer-approved testers”* - and nothing in the console calls that a test-user problem.

**1e. The two scopes.** Left menu → **Google Auth Platform → Data Access → Add or remove scopes** → under
**Manually add scopes** paste, one at a time:

    https://www.googleapis.com/auth/gmail.readonly
    https://www.googleapis.com/auth/gmail.compose

→ **Add to Table** → **Update** → **Save**. (`compose` also allows sending - see trap 1.)

**1f. The client.** Left menu → **APIs & Services → Credentials → Create credentials → OAuth client ID** →
**Application type: Desktop app** → a name → **Create** → **Download JSON** in the row that appears.

## 2. Where the files go

    mkdir -p ~/.loom/apps/gmail/attachments
    mv ~/Downloads/client_secret_*.json ~/.loom/apps/gmail/gcp-oauth.keys.json
    chmod 700 ~/.loom/apps/gmail && chmod 600 ~/.loom/apps/gmail/gcp-oauth.keys.json

Check it is the right file: the top-level key is `installed` and `redirect_uris` is `["http://localhost"]`.
**Do not edit it.**

## 3. Install the program (not `npx`)

    npm i -g @klodr/gmail-mcp@3.0.1

**Not `npx -y`**: loom's mount deadline is 15 s and npx spends longer resolving the package, so the mount fails
with *did not respond within 15s*. The version is whatever that command installed - upgrade by running it again.

## 4. The run script

Write `~/.loom/apps/gmail/run`, then `chmod 700` it:

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

It prints an authorization URL (and the process waits on `localhost:3000` for the callback). Open the URL, pick
the account, and approve. Two screens to expect: **“Google hasn’t verified this app”** → *Advanced* → *Go to
<app name> (unsafe)*, and then the scope list → **Continue/Allow**. It finishes by printing
`Authentication completed successfully` and writing `credentials.json` (0600).

If the URL is old (they expire), run the command again for a fresh one.

## 6. Start it from a repl

    const g = await startWorker.mcp("gmail", "$HOME/.loom/apps/gmail/run");
    await workers.gmail.search_emails({ query: "newer_than:7d", maxResults: 5 });
    await workers.gmail.read_email({ id: "1a2066649e9ae05f" });
    await workers.gmail.list_drafts({});

Every result arrives wrapped in `<untrusted-tool-output>`: mail is written by strangers.

## 7. The four traps

1. **`gmail.compose` includes sending.** `send_email`, `send_draft`, `reply_to_email`, `forward_email` all appear
   with it. Read-only means `gmail.readonly` alone.
2. **`npx` is too slow to mount** (see 3).
3. **The OAuth files live at a path the program names**: `GMAIL_OAUTH_PATH` moves the keys,
   `GMAIL_CREDENTIALS_PATH` the token; without them it reads `~/.gmail-mcp/`.
4. **`GMAIL_MCP_DRY_RUN=1` is the program's own switch**, not a permission. Google's scope is the permission.

## 8. Remove it

    google: account -> Security -> Third-party access -> remove the client
    rm -rf ~/.loom/apps/gmail
    npm rm -g @klodr/gmail-mcp
