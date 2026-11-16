/**
 * BUILD THE PAGE THE MCP REGISTERS: `src/` + `vendor/` -> `assets/`, and `assets/` is only what this writes.
 *
 *     cd loom/library/file-viewer && deno task build      (or: deno run -A --config ../../../deno.json build.ts)
 *
 * WHY THREE FOLDERS, AND WHAT EACH MAY HOLD. `src/` is HAND-WRITTEN: the shell (`index.html`), the page's
 * behaviour (`app.js`), its CodeMirror half (`code.js`) and its own layout (`viewer.css`) — the comments live
 * here and this is where a change is made. `vendor/` is THIRD-PARTY BYTES BESIDE THE RECIPE THAT MADE THEM
 * (`build.sh`, `entry.js`, two lockfiles): `vendor/codemirror.js` is what `sh vendor/build.sh` wrote, and no
 * step of this file edits it. `assets/` is ONLY WHAT THIS FILE WRITES — nothing else, ever — because it is
 * what `viewer_mcp.ts` hands loombot (`PAGE_DIR`, and `--page`/`--dir` when a test asks for another
 * directory), so what a browser gets is exactly what a build produced, and a byte sitting there that no step
 * makes is a byte nobody can reproduce. A file this build does not produce is PRUNED and named.
 *
 * ONE WRITER OF `assets/`, WHICH IS WHY `vendor/build.sh` WRITES `vendor/`. The vendored bundle is produced
 * by npm and esbuild from `vendor/package-lock.json` (a recipe that needs a network), and this build COPIES
 * it into `assets/` — so `deno task build` needs no network, runs in about a second, and a second run
 * rewrites every file with identical bytes: `git status` is clean, which is the proof that the committed
 * `assets/` IS the build's output and not a stale copy of it.
 *
 * WHY IT IS NOT BUNDLED, AND THIS IS A DECISION RATHER THAN AN OMISSION. `src/app.js` imports `./code.js`
 * DYNAMICALLY, only when a text file is shown, and `code.js` is what pulls the 735 KB CodeMirror bundle —
 * that laziness is the whole reason a PDF's page costs the app's own bytes rather than every byte the app
 * owns (`PAGE_LITE` in `viewer_mcp.ts`, and the PDF's room is `VIEWER_MAX_APP_BYTES` minus it). A
 * `bundle: true` pass decides for itself which module is reached first and inlines the rest, which is
 * exactly the property this page is built around. So each file is TRANSFORMED ON ITS OWN (`bundle: false`)
 * with every specifier left as written, and the module graph in `assets/` is the module graph in `src/` —
 * asserted below, because a build that quietly rewrote `./code.js` would still pass a size check.
 *
 * THE PAGE'S OWN CSS IS A SOURCE FILE NOW (card t20261109-233649-9f35). `src/index.html` used to carry
 * 24.6 KB of `<style>`; it carries a `<link href="viewer.css">` and the sheet is built and minified into
 * `assets/` like every other byte. That is what makes the page 8.3 KB instead of 32.9 KB, and it is what
 * lets `deno task app-shape` read this page's rules and refuse one that re-answers a class /theme.css
 * already answers. The palette is still the theme's — this sheet is LAYOUT only.
 *
 * WHY `assets/` IS EXCLUDED FROM FMT AND LINT IN TWO `deno.json` FILES, MEASURED 2026-11-09 (and this is the
 * trap that cost an hour): **a deno config does not nest**, so the moment `loom/library/file-viewer/deno.json`
 * exists the repository's `fmt`/`lint` settings stop applying to this subtree — every `src/*.js` here went
 * red at the default 80 columns. And a `deno fmt`/`deno lint` run FROM THE TREE ROOT reads the ROOT config
 * for every path under it: with the exclusions only in this folder's config, that run reported the four
 * built/vendored files as unformatted and read 7,182 lint diagnostics out of the minified bytes. So the
 * exclusions are in BOTH files. Neither carries a comment saying so, because this repo's `deno.json` is
 * imported as a JSON MODULE (`loom/version.ts`, for the version) and a JSON module import does not accept the
 * comments the config loader does — which is why this paragraph is here instead. The same two-file rule
 * applies to every app that gains a `deno.json`: `task-board/`, `example/` and `example-ttt/`.
 *
 * THE SIZE TABLE, THE MINIFICATION SIGNATURES AND THE WRITE/PRUNE STEP ARE `loom/library/build_step.ts` now
 * — shared with the three other apps, which is a change from the copy this file used to carry: it was copied
 * from `loom-hq/apps/shared/build_step.ts` because the dependency there runs one way (loom-hq depends on
 * loom), and that reason no longer holds for a module inside this library. What this file keeps is what is
 * ITS: which files to transform, which to copy, and the two claims only this page can make (the dynamic
 * import survived, and the vendored bundle is still the minified one).
 */
import { fromFileUrl, join } from "@std/path";
import { assertMinified, minifyCss, minifyJs, row, sizeTable, writeAssets } from "../build_step.ts";

/** The app's own directory, wherever this checkout is. */
const APP = fromFileUrl(new URL("./", import.meta.url)).replace(/\/$/, "");
/**
 * WHERE THE BUILT PAGE GOES, and the one directory this file is allowed to write. `--out` exists for the
 * browser rigs, which build into a scratch directory and serve that; the DEFAULT is the committed `assets/`.
 */
const AT = Deno.args.indexOf("--out");
if (AT >= 0 && Deno.args[AT + 1] === undefined) throw new Error("--out needs a directory after it");
const OUT = AT >= 0 ? Deno.args[AT + 1] : join(APP, "assets");

async function main(): Promise<void> {
  const src = {
    html: await Deno.readTextFile(join(APP, "src/index.html")),
    app: await Deno.readTextFile(join(APP, "src/app.js")),
    code: await Deno.readTextFile(join(APP, "src/code.js")),
    css: await Deno.readTextFile(join(APP, "src/viewer.css")),
    bundle: await Deno.readTextFile(join(APP, "vendor/codemirror.js")),
    licence: await Deno.readTextFile(join(APP, "vendor/codemirror.LICENSE.txt")),
  };

  // ── app.js: the page's behaviour, minified ────────────────────────────────────────────────────────────
  const appMin = await minifyJs(src.app, true);
  assertMinified("assets/app.js", appMin, {
    // `whereOf` and `draftKey` are LOCALS: the minifier renames a local binding, so either name in the
    // artifact means the minifier never ran. A frame FIELD would be the wrong probe (`display` survives as
    // `d.display`, measured on this very source) - a name the output keeps proves nothing.
    probes: [
      { source: src.app, identifier: "whereOf" },
      { source: src.app, identifier: "draftKey" },
    ],
    // `__event` is the one POST this page makes and `code.js` is the specifier of its dynamic import:
    // both must survive minification, and the specifier surviving is how this build says it did NOT
    // rewrite the module graph.
    markers: ["__event", "code.js"],
    bytesPerLine: 1000,
    unminified: await minifyJs(src.app, false),
  });
  if (!appMin.includes("./code.js")) {
    throw new Error("assets/app.js lost `./code.js`: the page's one dynamic import was rewritten");
  }

  // ── code.js: the CodeMirror half, minified ────────────────────────────────────────────────────────────
  const codeMin = await minifyJs(src.code, true);
  assertMinified("assets/code.js", codeMin, {
    probes: [
      { source: src.code, identifier: "langFor" },
      { source: src.code, identifier: "modeExt" },
    ],
    // The bundle's own specifier, for the reason above: this module is where the 735 KB is reached from.
    markers: ["./codemirror.js"],
    bytesPerLine: 1000,
    unminified: await minifyJs(src.code, false),
  });

  // ── viewer.css: the page's own layout, minified ───────────────────────────────────────────────────────
  const cssMin = await minifyCss(src.css, true);
  assertMinified("assets/viewer.css", cssMin, {
    // A CSS minifier strips COMMENTS and never renames a class, so the probe is a word that lives only in
    // a comment — and the source is re-read first, so a comment that lost this word fails here.
    probes: [{ source: src.css, identifier: "COVERED" }],
    // The body's size comes from the theme (`--fs-body`), and this page SPENDS the name: if the artifact
    // lost it, the page fell back to a number of its own.
    markers: ["--fs-body"],
    // Minified, a sheet is ONE line of thousands of bytes.
    bytesPerLine: 300,
    unminified: await minifyCss(src.css, false),
  });

  // ── the shell names the three artifacts it loads ─────────────────────────────────────────────────────
  for (const want of ['src="app.js"', 'href="viewer.css"', 'href="/theme.css"']) {
    if (!src.html.includes(want)) {
      throw new Error(
        "src/index.html does not carry `" + want +
          "`: the shell names what it runs, and this build is " +
          "about to copy it to a directory where that name is the only pointer",
      );
    }
  }

  // ── THE VENDORED BUNDLE MUST STILL BE THE MINIFIED ONE. It is copied rather than re-minified (below), so
  // nothing about these bytes changes here - and a rebuilt `vendor/codemirror.js` that came out unminified
  // from `build.sh` (a lost `--minify`) would otherwise sail through as "the bundle, 735 KB, unchanged".
  assertMinified("assets/codemirror.js", src.bundle, {
    probes: [],
    markers: ["CodeMirror 6, VENDORED"],
    bytesPerLine: 300,
  });

  const produced = [
    await row("app.js", appMin, { before: src.app, how: "minified" }),
    await row("code.js", codeMin, { before: src.code, how: "minified" }),
    await row("viewer.css", cssMin, { before: src.css, how: "minified" }),
    await row("index.html", src.html, { how: "copied" }),
    await row("codemirror.js", src.bundle, { how: "copied" }),
    await row("codemirror.LICENSE.txt", src.licence, { how: "copied" }),
  ];

  // ── the table, and what this run did to the directory ────────────────────────────────────────────────
  const total = produced.reduce((n, p) => n + p.row.bytes, 0);
  const before = produced.reduce((n, p) => n + (p.row.before ?? p.row.bytes), 0);
  const lite = produced.filter((p) => p.name !== "codemirror.js");
  const liteBytes = lite.reduce((n, p) => n + p.row.bytes, 0);
  const liteBefore = lite.reduce((n, p) => n + (p.row.before ?? p.row.bytes), 0);
  console.log(
    "\n" + sizeTable(produced.map((p) => p.row)) + "\n\n" +
      "  the page, everything in " + OUT + ":  " + total + " bytes, was " + before + "\n" +
      "  without the bundle (the page a PDF or an image is registered in):  " + liteBytes +
      " bytes, was " + liteBefore + "\n",
  );
  await writeAssets(OUT, produced);
}

if (import.meta.main) await main();
