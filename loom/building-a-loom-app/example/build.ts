/**
 * BUILD THE TALLY EXAMPLE'S PAGE: `src/` -> `assets/`. The other example an agent copies, and the SMALLER
 * read: `example-ttt/build.ts` states the shape at length, and this one is the same shape in one screen.
 *
 *     cd loom/library/building-a-loom-app/example && deno task build
 *
 * THE SHAPE (card t20261109-233649-9f35): `src/` is hand-written (index.html, app.js, tally.css); `assets/`
 * is only what this file writes and is what the MCP registers (`--dir assets`); `rules.ts` stays at the top,
 * because a `.ts` is never handed to a browser. A page's own rules are a source FILE, not a `<style>` block,
 * so they are minified like the rest and `deno task app-shape` can read them.
 *
 * THE SIZE TABLE, THE MINIFICATION SIGNATURES AND THE WRITE/PRUNE STEP ARE `loom/library/build_step.ts` —
 * shared by all four apps, so an app copied from this one inherits the assertions instead of a copy of them.
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
    css: await Deno.readTextFile(join(APP, "src/tally.css")),
  };

  const appMin = await minifyJs(src.app, true);
  assertMinified("assets/app.js", appMin, {
    // LOCALS the source declares, so a minifier renames them; the source is re-read first, so a probe whose
    // binding was renamed fails here instead of passing forever.
    probes: [
      { source: src.app, identifier: "paintLastRead" },
      { source: src.app, identifier: "unreachable" },
    ],
    markers: ["__event"],
    bytesPerLine: 1000,
    unminified: await minifyJs(src.app, false),
  });

  const cssMin = await minifyCss(src.css, true);
  assertMinified("assets/tally.css", cssMin, {
    // A comment-only word: a CSS minifier strips comments and does not rename a class.
    probes: [{ source: src.css, identifier: "ORANGE" }],
    markers: ["tabular-nums"],
    bytesPerLine: 300,
    unminified: await minifyCss(src.css, false),
  });

  for (const want of ['src="app.js"', 'href="tally.css"', 'href="/theme.css"']) {
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
    await row("tally.css", cssMin, { before: src.css, how: "minified" }),
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
