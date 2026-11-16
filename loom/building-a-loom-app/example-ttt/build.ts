/**
 * BUILD THE BOARD EXAMPLE'S PAGE: `src/` -> `assets/`. **AN AGENT COPIES THIS FOLDER WHEN SOMEONE ASKS FOR AN
 * APP, which is why this file is the shape stated as a rule rather than as one app's habit.**
 *
 *     cd loom/library/building-a-loom-app/example-ttt && deno task build
 *
 * THE SHAPE (card t20261109-233649-9f35, the owner's `我觉得都应该重构，你觉得呢？这是统一的loombot app的shape`):
 *
 *     src/       HAND-WRITTEN: index.html, app.js, ttt.css. This is where a change is made.
 *     assets/    ONLY what `deno task build` writes. What the MCP registers (`--dir assets`), so what a
 *                browser gets is exactly what a build produced. A second run writes nothing.
 *     rules.ts   the mechanical half, at the top: `.ts` is never handed to a browser.
 *     build.ts   this file: one `deno task build` per app, esbuild, minified, a size table, and a prune.
 *
 * AN APP IS FOUR FILES AND ONE COMMAND, and the four are `src/index.html`, `src/app.js`, `src/<name>.css`
 * and `rules.ts` — copied from here, renamed, comments kept. Start it with `--dir <app>/assets` (and
 * `--rules <app>/rules.ts` if the rules are not at the app's top), which is the one command line that
 * matters in the README beside this file.
 *
 * WHY A CSS FILE AND NOT A `<style>` BLOCK: /theme.css (shared/theme.ts) is the sheet every app page links,
 * and a page's own rules are its LAYOUT. Keeping them in a source file with the comments is what lets this
 * build minify them like every other byte, and what lets `deno task app-shape` read them and refuse a page
 * that re-answers a class the theme already answers. A NEW SHARED COMPONENT (an icon button, a menu panel)
 * belongs in shared/theme.ts, not copied in here — the icon button was copied by three pages once and
 * `tests/app_icon_test.ts` is the file that exists because of it.
 *
 * THE HTML IS COPIED, NOT MINIFIED: esbuild does not read HTML, and what a minifier would buy here is a
 * few hundred bytes off a 3 KB document that tests assert by selector and by comment. The row below says
 * "copied" rather than pretending a saving that was not made.
 *
 * THE SIZE TABLE, THE MINIFICATION SIGNATURES AND THE WRITE/PRUNE STEP ARE `loom/library/build_step.ts`,
 * shared by all four apps — so this file says only what to transform and what to copy, and an app copied
 * from this one inherits the assertions without inheriting a copy of them.
 */
import { fromFileUrl, join } from "@std/path";
import {
  assertMinified,
  minifyCss,
  minifyJs,
  row,
  sizeTable,
  writeAssets,
} from "../../build_step.ts";

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
    css: await Deno.readTextFile(join(APP, "src/ttt.css")),
  };

  // ── app.js: the page's behaviour, minified ────────────────────────────────────────────────────────────
  const appMin = await minifyJs(src.app, true);
  assertMinified("assets/app.js", appMin, {
    // `askOpponent` and `renderChannel` are LOCALS the source declares: the minifier renames them, so either
    // name in the artifact means the minifier never ran over it.
    probes: [
      { source: src.app, identifier: "askOpponent" },
      { source: src.app, identifier: "renderChannel" },
    ],
    // `__event` is the one POST this page makes (rule 8 of the page contract): it must survive, and a page
    // that lost it would still be a valid artifact of the wrong app.
    markers: ["__event"],
    bytesPerLine: 1000,
    unminified: await minifyJs(src.app, false),
  });

  // ── ttt.css: the board's own layout, minified ─────────────────────────────────────────────────────────
  const cssMin = await minifyCss(src.css, true);
  assertMinified("assets/ttt.css", cssMin, {
    // A CSS minifier does not rename a class — it strips the COMMENTS — so the probe is a word that lives
    // only in one of them ("square BY CONSTRUCTION", the note that a cell is square without two lengths).
    probes: [{ source: src.css, identifier: "CONSTRUCTION" }],
    // The one declaration the board's squareness depends on, from the grid rule.
    markers: ["aspect-ratio"],
    // A sheet comes out as ONE line: measured, `ttt.css` is thousands of bytes per line.
    bytesPerLine: 300,
    unminified: await minifyCss(src.css, false),
  });

  // ── the shell names the two artifacts it loads, and the palette every app links ───────────────────────
  for (const want of ['src="app.js"', 'href="ttt.css"', 'href="/theme.css"']) {
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
    await row("ttt.css", cssMin, { before: src.css, how: "minified" }),
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
