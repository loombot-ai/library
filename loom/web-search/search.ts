/**
 * A web SEARCH, with a real browser behind it.
 *
 * WHY A BROWSER. The HTML endpoints refuse a plain fetch: measured 2026-11-22, html.duckduckgo.com and
 * lite.duckduckgo.com both answered with the challenge page ("Unfortunately, bots use DuckDuckGo too") - two
 * links, no results - to a headless Chrome. Bing draws its results for this browser and yields ten rows, so
 * Bing is the engine here; a second one can be added the day one works.
 *
 * WHAT IT RETURNS: [{title, url, snippet}], at most limit, in the page's own order. Nothing is cached, nothing is
 * written, and the browser is closed before the answer is returned - a search cannot leave a process behind.
 */
// A SIBLING ENTRY, reached by a relative path: this folder and `browser-for-online-tasks` are both entries under the
// library root, so the same specifier holds in the checkout and in `loom/library/` after `library:sync`.
import * as chrome from "../browser-for-online-tasks/chrome.ts";

export interface Hit {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

// BING WRAPS EVERY HIT in bing.com/ck/a?... - a redirect, not the answer. The cite element carries the address
// the row shows, which is what a reader copies; the redirect is only a fallback.
const READ = [
  "return JSON.stringify([].slice.call(document.querySelectorAll('li.b_algo')).map(function (r) {",
  "  var a = r.querySelector('h2 a');",
  "  if (!a) return null;",
  "  var c = r.querySelector('cite');",
  "  var p = r.querySelector('.b_caption p, .b_algoSlug, p');",
  "  return { title: (a.innerText || '').trim(),",
  "           url: (c ? (c.innerText || '').trim() : '') || a.href || '',",
  "           snippet: p ? (p.innerText || '').trim() : '' };",
  "}).filter(Boolean));",
].join("\n");

export async function search(query: string, opts: { limit?: number } = {}): Promise<Hit[]> {
  const url = "https://www.bing.com/search?setlang=en&q=" + encodeURIComponent(query);
  await chrome.launch({ headless: true, url: "about:blank" });
  try {
    await chrome.attach();
    await chrome.goto(url, 3500);
    // ev takes an EXPRESSION: the page evaluates it, so a return needs a function around it.
    const raw = String(await chrome.ev("(() => {" + READ + "})()"));
    return (JSON.parse(raw) as Hit[]).slice(0, opts.limit ?? 8);
  } finally {
    await chrome.close();
  }
}
