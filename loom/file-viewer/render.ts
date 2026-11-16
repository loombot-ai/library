/**
 * The file viewer's MARKDOWN RENDERING: markdown to HTML, for the view mode of a `.md` file.
 *
 * **It runs in the MCP SERVER, not in the page.** `show` renders here and sends the RESULT with the file,
 * so the page is handed finished, escaped HTML and puts it in one `innerHTML`. Two reasons that split is
 * the right one:
 *
 *  1. **The page never reads the filesystem.** The bytes it shows arrived from this server, so a tab
 *     cannot be talked into fetching `/etc/passwd` — there is no path parameter anywhere in the page.
 *  2. **It is testable without a DOM.** Every claim about the markup is a claim about this module's
 *     return value, which a test asserts directly (`tests/file_viewer_render_test.ts`).
 *
 * **There is no highlighter here any more.** Source files and fenced code blocks are coloured by
 * CodeMirror in the page — the same highlighter the edit mode uses, so pressing Edit changes nothing
 * about the colours. A fence arrives as escaped text in `<pre class="fence" data-lang>`, and the page
 * highlights it once the bundle is loaded; until then (or for a language it lacks) it is plain text.
 * This file held a ~200-line regex highlighter until the text editor merged into the viewer (2026-09-25).
 *
 * **One import: the shared markdown parser** (`loom/markdown/parse.js`, by relative path — Xiaohu,
 * 2026-09-25). The TUI and loombot's page walk the same tree; this file is its HTML output.
 */
import { type Block, type Inline, type ListItem, parse, plainText } from "../../markdown/parse.js";

/** HTML text escape. `&` first, or the others' ampersands get double-escaped. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A URL safe to OFFER this page: http, https, mailto or relative; any other scheme becomes nothing.
 *
 * An ALLOWLIST, decided on the string the BROWSER will parse rather than the one we were given: the WHATWG
 * URL parser drops leading and trailing C0 controls and spaces and every tab/CR/LF inside, so
 * `\x01javascript:` and `java\tscript:` are javascript: URLs. This was a denylist of three schemes
 * after a `trim()`, which a leading \x01 walked straight through (`tests/file_viewer_render_test.ts`).
 */
function safeUrl(raw: string): string {
  const url = raw.trim();
  // deno-lint-ignore no-control-regex -- the C0 range IS the point: it is what the URL parser strips
  const probe = url.replace(/^[\x00-\x20]+/, "").replace(/[\t\n\r]/g, "");
  const scheme = /^([A-Za-z][A-Za-z0-9+.\-]*):/.exec(probe);
  if (scheme && !/^(?:https?|mailto)$/i.test(scheme[1])) return "";
  return escapeHtml(url);
}

// ── markdown ─────────────────────────────────────────────────────────────────────────────────────────
//
// The HTML output of the shared parser (`loom/markdown/parse.js`): this walks its tree and parses
// nothing. Text is escaped on the way OUT — raw HTML in a file is shown, never passed through, because
// this renders files from a repo into a page that holds a session cookie — and a link's url goes through
// `safeUrl`. A soft line break is a space, as the browser would draw one anyway. A picture's url does
// too, and a WORKSPACE-relative one is handed on in `data-src` for the server to fill in, because a src
// here is a request to loombot, which serves this app and knows nothing about the workspace (files.ts).

/**
 * A PATH INSIDE THE WORKSPACE, which is the only kind of picture the SERVER can fill in (`data-src`). An
 * absolute url is the browser's own to fetch, a `//host/x` and a `/x` are another origin's or loombot's
 * own, and a scheme is not a path at all — `safeUrl` has already emptied the ones nothing may follow.
 */
const workspacePath = (url: string): boolean =>
  url !== "" && !/^[A-Za-z][A-Za-z0-9+.\-]*:/.test(url) && !url.startsWith("//") &&
  !url.startsWith("/");

/**
 * A URL THIS VIEWER MUST NOT FOLLOW ITSELF: a scheme, or a protocol-relative host.
 *
 * It is the complement of `workspacePath` FOR A LINK, and the two differ in exactly one place: a link that
 * starts with `/` names a file from the workspace root (`viewer_mcp.ts` `openLink` reads it that way) and an
 * image with the same spelling would be loombot's own route — so the image rule is narrower on purpose and
 * this one is what a link is decided by.
 */
const externalUrl = (url: string): boolean =>
  /^[A-Za-z][A-Za-z0-9+.\-]*:/.test(url) || url.startsWith("//");

/**
 * WHAT HOVERS OVER A MARKDOWN LINK: ONE SHORT SENTENCE, and there are two of them because there are two
 * kinds of link (t20261009-184950-2ba3, revised 2026-11-02). A workspace path is opened ON THIS PAGE and a
 * url is opened in a TAB of the real browser, so the title says which.
 *
 * It used to say one thing on both — "a URL is not a file in this workspace — copy it from this file's own
 * source" — which on a path was simply false and on a url was a refusal dressed as help, arriving before
 * the person could even click.
 *
 * A `#fragment` says something else again, because it is the one url that opens nothing: the headings of
 * the file on show carry the ids this file minted, so that click is a jump IN the document
 * (t20261009-201706-c56d).
 */
function linkTitle(url: string): string {
  if (!url) return "not a url this viewer may open";
  if (url.startsWith("#")) return "jumps to that heading in this file";
  if (externalUrl(url)) return "opens in a new tab";
  return "opens that file on this page";
}

/** A tree's inlines as HTML. */
function inlineHtml(nodes: Inline[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.type === "text") out += escapeHtml(n.text);
    else if (n.type === "softbreak") out += " ";
    // THE VIEWER DOES NOT TYPESET (it carries no KaTeX), so a formula is ESCAPED TEXT like any other:
    // n.raw is the source with its delimiters, which is what the author wrote and what marks it as math.
    else if (n.type === "math") out += "<code>" + escapeHtml(n.raw) + "</code>";
    else if (n.type === "code") out += "<code>" + escapeHtml(n.text) + "</code>";
    else if (n.type === "image") {
      // A RELATIVE PICTURE CARRIES NO `src` (t20261009-201706-c56d). The page is served by loombot, so a
      // relative src is a request to LOOMBOT — /a/<ws>/app/<name>/shot.png — and loombot has never heard of
      // the picture: it is a file in the WORKSPACE, which is not an app asset and not a route. So the url
      // travels in `data-src` and the SERVER fills it in from the workspace before the page is handed the
      // html (files.ts `inlineImages`), as a data: URL that needs no request at all. An absolute url is
      // the browser's own business and keeps its src; a url the allowlist refused keeps the empty src it
      // has always had, because nothing may follow it.
      const url = safeUrl(n.href);
      out += '<img alt="' + escapeHtml(plainText(n.children)) + '" ' +
        (workspacePath(url) ? 'data-src="' + url + '"' : 'src="' + url + '"') + " />";
    } else if (n.type === "link") {
      // A LINK IS ONE OF TWO THINGS, and which one is decided HERE, because this is where a url's kind is
      // already known (`externalUrl` above, `safeUrl` before it). t20261009-184950-2ba3, revised
      // 2026-11-02 — the revision is the second row, which used to be the first row's sentence and a
      // refusal.
      //
      //   A WORKSPACE PATH  an `a` with NO `href`, the url in `data-href`. This html is put into a page
      //                     running inside loombot's app panel -- an iframe with `sandbox="allow-scripts
      //                     allow-forms allow-same-origin"` -- where an href press is a ONE-WAY TRIP:
      //                     MEASURED in headless Chrome against exactly that sandbox, a RELATIVE href and an
      //                     ABSOLUTE one alike navigate the FRAME itself, and the panel has no back
      //                     (loom/library/loom-app-frame-navigation/README.md). So the page owns the click:
      //                     it asks the server to open that file here (`open`, viewer_mcp.ts).
      //
      //   A URL             a REAL `href`, `target="_blank"` and `rel="noopener noreferrer"`: a tab of the
      //                     real browser, which is the one place a url can open without taking the frame
      //                     away. The sandbox has no allow-popups, so inside the panel the press is handed
      //                     to the PANEL (`loom/open-url`, src/app.js and conversation.js); the page on its
      //                     own is an ordinary document and the browser opens the tab itself.
      //
      // What the allowlist above still decides is whether a url may be offered at all -- an empty one is
      // text with a title that says so.
      const url = safeUrl(n.href);
      out += externalUrl(url)
        ? '<a href="' + url + '" target="_blank" rel="noopener noreferrer" title="' +
          linkTitle(url) +
          '">' + inlineHtml(n.children) + "</a>"
        : '<a data-href="' + url + '" title="' + linkTitle(url) + '">' + inlineHtml(n.children) +
          "</a>";
    } else {
      const tag = n.type === "strike" ? "del" : n.type;
      out += "<" + tag + ">" + inlineHtml(n.children) + "</" + tag + ">";
    }
  }
  return out;
}

/** A DOCUMENT BEING RENDERED: the html is built, and the ids its headings were given are collected.
 *
 * The ids are minted ONCE, here, and the same walk hands them back (`renderDoc`), so a `#fragment` the
 * server checks and the `id` the page can scroll to can never disagree about how one is spelled.
 */
interface Doc {
  seen: Map<string, number>;
  ids: string[];
}

/**
 * THE ID A HEADING CARRIES, so a `[toc](#why)` is a jump in the document and not a refusal
 * (t20261009-201706-c56d, where the missing ids were a small step BACKWARDS from a browser).
 *
 * GitHub's rule, near enough to be unsurprising: the heading's own text, lowercased, every character
 * that is not a letter, a digit, a space, `-` or `_` dropped, runs of space become one `-`, and a text
 * already used gets `-1`, `-2`… A heading of nothing but punctuation still gets an id it can be linked to.
 */
function slug(text: string, doc: Doc): string {
  const base = text.toLowerCase().replace(/[^\p{L}\p{N} _-]+/gu, "").trim().replace(/\s+/g, "-") ||
    "section";
  const n = doc.seen.get(base) ?? 0;
  doc.seen.set(base, n + 1);
  const id = n === 0 ? base : base + "-" + n;
  doc.ids.push(id);
  return id;
}

/**
 * A LIST, AND EVERY LIST INSIDE IT. The parser is the one place indentation becomes depth (`nestItems`),
 * so an item's `items` are a list of the SAME KIND drawn INSIDE its `<li>` -- which is the whole of what
 * indents a sub-item here: this page styles no `ul`/`ol` at all, so the step comes from the browser's own
 * `ol { padding-left: 40px }` and a list nested in an `li` gets one more of them (measured in Chrome,
 * 2026-10-22: seventeen items flat were all at 52px, and `src/viewer.css` has no list rule to fix).
 *
 * THE NUMBERING IS PER LEVEL. CommonMark numbers a list from its FIRST item and ignores every number
 * after it, and an HTML ol starts at 1 -- so a list written 3. 4. 5. drew as 1. 2. 3. without this
 * (Xiaohu, 2026-10-06). Only a start other than 1 is emitted, which is what the spec reference renderer
 * does, and a start of 0 is not dropped along with it. Each nested list gets its own `start`, so the four
 * `1.`s a document writes under a parent restart there at 1 instead of continuing the outer count.
 */
function listHtml(items: ListItem[], ordered: boolean): string {
  const tag = ordered ? "ol" : "ul";
  let start = "";
  if (ordered) {
    const n = Number.parseInt(items[0]?.marker ?? "1", 10);
    if (!Number.isNaN(n) && n !== 1) start = ' start="' + n + '"';
  }
  const lis = items.map((it) =>
    "<li>" + inlineHtml(it.children) + (it.items ? "\n" + listHtml(it.items, ordered) + "\n" : "") +
    "</li>"
  );
  return ["<" + tag + start + ">", ...lis, "</" + tag + ">"].join("\n");
}

/** One block as HTML. `doc` is the slug memory, so two headings with one text get two ids. */
function blockHtml(b: Block, doc: Doc): string {
  switch (b.type) {
    case "paragraph":
      return "<p>" + inlineHtml(b.children) + "</p>";
    case "heading":
      // The slug is minted from the heading's TEXT, and the text itself is drawn unchanged.
      return "<h" + b.level + ' id="' + slug(plainText(b.children), doc) + '">' +
        inlineHtml(b.children) + "</h" + b.level + ">";
    case "code":
      // Escaped TEXT: the page's CodeMirror highlights it as `data-lang` (the fence's info word).
      return '<pre class="fence" data-lang="' +
        escapeHtml(b.lang.trim().toLowerCase().split(/\s/)[0] ?? "") +
        '"><code>' + escapeHtml(b.text.replace(/\n$/, "")) + "</code></pre>";
    case "rule":
      return "<hr />";
    case "quote":
      return "<blockquote>" + inlineHtml(b.children) + "</blockquote>";
    case "list":
      return listHtml(b.items, b.ordered);
    case "table": {
      const cell = (tag: string, c: Inline[], k: number): string => {
        const a = b.align[k] ? ' style="text-align:' + b.align[k] + '"' : "";
        return "<" + tag + a + ">" + inlineHtml(c) + "</" + tag + ">";
      };
      // **IN A SCROLL CONTAINER OF ITS OWN, WITH THE PANEL'S OWN TWO NAMES** (card
      // t20261108-043648-5961). A table is drawn at its natural width, so a five-column one on a phone is
      // wider than the panel it is read in: without a wrapper the cells run past the edge and nothing
      // scrolls, so the right-hand column is simply lost (measured, 390x844: a 620px table in a 366px
      // #view, every right-hand cell off screen).
      //
      // THE CLASSES ARE NOT THIS FILE'S TO CHOOSE: `tablewrap` and `md` are the names shared/theme.ts
      // already spends (`.tablewrap` carries the scrollbar, `table.md` the geometry), and this function is
      // the ONE place a panel document gets its table from -- the file viewer's view mode AND the board's
      // card detail (`task-board/rules.ts` `rendered`). So the fix is here, at the seam where the markup is
      // made, and never a second wrapper rule in each page's sheet.
      return '<div class="tablewrap"><table class="md"><thead><tr>' +
        b.head.map((h, k) => cell("th", h, k)).join("") +
        "</tr></thead><tbody>" +
        b.rows.map((r) => "<tr>" + r.map((c, k) => cell("td", c, k)).join("") + "</tr>").join("") +
        "</tbody></table></div>";
    }
  }
}

/**
 * MARKDOWN TO HTML, AND THE ANCHORS IT CARRIES, from ONE walk. `markdownHtml` is what the page is handed;
 * `headingIds` is what a `#fragment` is checked against (viewer_mcp.ts `openLink`), so the two can never
 * be two spellings of one rule.
 *
 * Fenced code is left as escaped text for the page's CodeMirror to colour.
 */
export function renderDoc(src: string): { html: string; ids: string[] } {
  const doc: Doc = { seen: new Map(), ids: [] };
  const html = parse(src).children.map((b) => blockHtml(b, doc)).join("\n");
  return { html, ids: doc.ids };
}

/** Markdown to HTML — the rendering alone. */
export function markdownHtml(src: string): string {
  return renderDoc(src).html;
}

/** The ids the headings of this markdown were given, in document order. */
export function headingIds(src: string): string[] {
  return renderDoc(src).ids;
}
