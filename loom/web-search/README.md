---
name: "web-search"
description: "Read when a question needs a SEARCH rather than a known URL - a plain fetch cannot do it: DuckDuckGo answers a headless browser with its bot challenge (measured 2026-11-22), so this drives a real Chrome and reads result rows from the DOM."
as_of: "2026-11-22"
---

# Searching the web from a repl

    const s = await loadTools('search', '<this folder>/search.ts');
    await tools.search.search('cloudflare durable objects code update strategy', { limit: 5 });

Returns an array of {title, url, snippet} in the page's own order. The browser is launched headless and closed
before the answer is returned, so a search cannot leave a process behind.

## Why not just fetch

Measured 2026-11-22: fetch of html.duckduckgo.com answers 202 with no results, and a headless Chrome on
html.duckduckgo.com or lite.duckduckgo.com gets the page that says the site thinks you are a bot - two links,
zero results. Bing draws ten li.b_algo rows for the same browser, so Bing is the engine here. A KNOWN URL is
still a fetch; use this only when the question is which URL.

## The two things that bite

1. Bing wraps every hit in a bing.com/ck/a redirect. The cite element carries the address the row shows, and
   that is what this returns; the redirect is only the fallback.
2. ev takes an EXPRESSION, not a function body: a bare return throws Illegal return statement. Wrap it as
   ev('(() => {' + script + '})()').

## What it is not

No caching, no summaries, no ranking of its own: the rows are the engine's. Reading a result is a separate
fetch, and a page that needs JavaScript is the chrome.ts helper beside browser-for-online-tasks.
