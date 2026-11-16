/**
 * BUILD THE BOARD'S PAGE: `src/` -> `assets/`, and `assets/` is only what this file writes.
 *
 *     cd loom/library/task-board && deno task build      (or: deno run -A --config ../../../deno.json build.ts)
 *
 * THE SHAPE, and it is the same shape in all four apps in this library (card t20261109-233649-9f35): `src/`
 * is HAND-WRITTEN — the shell (`index.html`), the page's behaviour (`app.js`) and its own layout
 * (`board.css`) — and `assets/` is what a browser gets, produced by nothing but this file. `rules.ts`,
 * `tasks.ts` and `board_mcp.ts` stay at the top: a `.ts` is never handed to a browser (registration strips
 * it), so it is not page bytes and does not belong in `src/`. `board_mcp.ts` passes `--dir assets`.
 *
 * WHY IT IS NOT BUNDLED: `src/app.js` is ONE module with no imports, so a bundle would only inline it. Each
 * file is transformed on its own (`bundle: false`) with every specifier left as written, which keeps the
 * module graph in `assets/` the module graph in `src/` — and the HTML is COPIED rather than minified,
 * because esbuild does not read HTML and a hand-written HTML minifier between a 6 KB document and the three
 * CSS/size gates that assert this page's rules (`tests/app_icon_test.ts`, `tests/app_input_size_test.ts`,
 * `tests/hidden_attribute_pages_test.ts`) is the wrong trade at this size. The rows below report the copy as
 * a copy.
 *
 * WHAT THE GATES READ: a page's rules now live in `src/board.css` and are built into `assets/board.css`, so
 * a test that used to slice the page's `<style>` reads the sheet the page links
 * (`tests/page_css.ts` does the resolution, once).
 *
 * THE SIZE TABLE, THE MINIFICATION SIGNATURES AND THE WRITE/PRUNE STEP ARE `loom/library/build_step.ts`,
 * shared by all four apps; this file says only what to transform and what to copy.
 */
import { fromFileUrl, join } from "@std/path";
import { assertMinified, minifyCss, minifyJs, row, sizeTable, writeAssets } from "../build_step.ts";

/** The app's own directory, wherever this checkout is. */
const APP = fromFileUrl(new URL("./", import.meta.url)).replace(/\/$/, "");
/** `--out` is for the browser rigs, which build into a scratch directory; the DEFAULT is `assets/`. */
const AT = Deno.args.indexOf("--out");
if (AT >= 0 && Deno.args[AT + 1] === undefined) throw new Error("--out needs a directory after it");
const OUT = AT >= 0 ? Deno.args[AT + 1] : join(APP, "assets");

async function main(): Promise<void> {
  const src = {
    html: await Deno.readTextFile(join(APP, "src/index.html")),
    app: await Deno.readTextFile(join(APP, "src/app.js")),
    css: await Deno.readTextFile(join(APP, "src/board.css")),
  };

  // ── app.js: the page's behaviour, minified ────────────────────────────────────────────────────────────
  const appMin = await minifyJs(src.app, true);
  assertMinified("assets/app.js", appMin, {
    // `drawable` and `keepViewSoon` are LOCALS the source declares: the minifier renames them, so either
    // name in the artifact means the minifier never ran. A field would be the wrong probe (`rows` survives).
    probes: [
      { source: src.app, identifier: "drawable" },
      { source: src.app, identifier: "keepViewSoon" },
    ],
    // `__event` is the one POST this page makes; it must survive, and its survival is also what says the
    // artifact is not an empty file.
    markers: ["__event"],
    bytesPerLine: 1000,
    unminified: await minifyJs(src.app, false),
  });

  // ── board.css: the page's own layout, minified ────────────────────────────────────────────────────────
  const cssMin = await minifyCss(src.css, true);
  assertMinified("assets/board.css", cssMin, {
    // A CSS minifier does not rename a class — it strips the COMMENTS — so the probe is a word that lives
    // only in one of them, and the source is re-read first so a comment that lost this word fails here.
    probes: [{ source: src.css, identifier: "THUMB" }],
    markers: [".rowtop"],
    // A sheet comes out as ONE line: measured, `board.css` is thousands of bytes per line.
    bytesPerLine: 300,
    unminified: await minifyCss(src.css, false),
  });

  // ── the shell names the two artifacts it loads, and the palette every app links ───────────────────────
  for (const want of ['src="app.js"', 'href="board.css"', 'href="/theme.css"']) {
    if (!src.html.includes(want)) {
      throw new Error(
        "src/index.html does not carry `" + want +
          "`: the shell names what it runs, and this build is " +
          "about to copy it to a directory where that name is the only pointer",
      );
    }
  }

  const produced = [
    await row("app.js", appMin, { before: src.app, how: "minified" }),
    await row("board.css", cssMin, { before: src.css, how: "minified" }),
    await row("index.html", src.html, { how: "copied" }),
  ];

  const total = produced.reduce((n, p) => n + p.row.bytes, 0);
  const before = produced.reduce((n, p) => n + (p.row.before ?? p.row.bytes), 0);
  console.log(
    "\n" + sizeTable(produced.map((p) => p.row)) + "\n\n  the page, everything in " + OUT + ":  " +
      total +
      " bytes, was " + before + " B of source\n",
  );
  await writeAssets(OUT, produced);
}

if (import.meta.main) await main();
