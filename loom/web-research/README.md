---
name: web-research
description: "Read before answering a question whose answer is on the web — which endpoints a bot can actually reach, and which silently refuse"
as_of: "2026-10-10"
---

# Researching something on the web

Read this before your second `fetch`. The first one usually fails, and the useful knowledge is not how to parse HTML — it is **which hosts serve a bot at all**. Everything below was measured from two GAIA trials, and the difference between them was 15 turns against 56.

`fetch` is available whenever the network is. There is no search tool and no browser: no JavaScript runs, so a page that renders client-side gives you its skeleton and nothing else.

## What a search engine does when it notices you

| endpoint                       | what actually comes back                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `html.duckduckgo.com/html/?q=` | a **CAPTCHA** — "Select all squares containing a duck". No results.                                                                                   |
| `lite.duckduckgo.com/lite/?q=` | same treatment                                                                                                                                        |
| `www.bing.com/search?q=`       | real HTML, but the result links you want are often **absent** — one measured run extracted `[]` YouTube links from a page reporting "405,000 results" |
| most other sites               | **403**, often without a body worth reading                                                                                                           |

So **do not plan on a search engine.** Two consequences worth internalising: a query that "returns a page" has not necessarily returned results, so check that you extracted something before reasoning about it; and a 403 is not a transient — retrying the same host costs a turn and returns the same
403. One measured trial spent most of 56 messages on repeated 403s and a DNS failure before answering from memory, and answered wrongly.

## Go at the source instead

The site that owns the data usually serves it, because it wants to be crawled. This worked first time where three search engines had failed:

```js
async function get(u) {
  const r = await fetch(u, {
    headers: {
      // Without a browser UA some hosts 403 outright. This is not a trick, it is the minimum a
      // server expects; a bare Deno UA is what gets refused.
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  return await r.text();
}
```

**YouTube**, measured and working:

```js
// Search: the results page embeds its data as JSON in the HTML.
const html = await get("https://www.youtube.com/results?search_query=" + encodeURIComponent(q));
const hits = [...html.matchAll(/"videoRenderer":\{"videoId":"(.*?)".*?"text":"(.*?)"/g)]
  .map((m) => [m[1], m[2]]);

// One video: the watch page carries its description without any API key.
const page = await get("https://www.youtube.com/watch?v=" + id);
const desc = page.match(/"shortDescription":"(.*?)","isCrawlable"/)?.[1];
```

The same shape works elsewhere: Wikipedia's `/api/rest_v1/page/summary/<title>` and its `action=query` API, arXiv's `export.arxiv.org/api/query`, GitHub's `api.github.com`, and most government and library catalogues. **Prefer an API the owner publishes to scraping the page a search engine would have shown you.**

## Do the failing steps at once

Because most attempts fail, discovering _which_ fail is the expensive part — and the attempts do not depend on each other, so they belong in one `repl_run`:

```js
const [a, b, c] = await Promise.all([get(u1), get(u2), get(u3)]);
```

A measured run did exactly this with two search engines and learned both were useless in a single round trip. Serially that is three turns to learn three dead ends.

## When the answer is not reachable

Say so, and say what you tried. An answer assembled from memory and presented as researched is the worst outcome available: one measured trial answered a 1961-interview question with a confidently reasoned wrong name after its fetches were blocked. If the network refused you, that is a finding about the environment — report it rather than dressing up a recollection as a result.
