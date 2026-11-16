/**
 * THE BUILD EVERY LOOM APP RUNS — `src/` (hand-written) into `assets/` (what a browser gets).
 *
 * ONE MODULE, FOUR APPS. `loom/library/file-viewer/build.ts` used to carry all of this, and its own header
 * said why it was a COPY rather than an import: the file viewer was the only app with a build, and the model
 * it copied lived in a repo that depends on this one, so the dependency could not run the other way. That
 * reason is gone — the apps are all inside this library now, so the module they share can be this one. What
 * is shared is the MEASUREMENT, never the steps: an app's `build.ts` says which files it transforms and
 * which it copies, and this file says how a build proves what it did.
 *
 *                       bytes and gzip, and the row it was before
 *   sizeTable     ───▶  the table a build prints, one row per artifact, `-78.1%` where there is a delta
 *   assertMinified ───▶ a signature that cannot pass by accident (see below)
 *   minifyJs      ───▶ esbuild.transform, ONE module, `bundle: false`
 *   minifyCss     ───▶ the same, for a sheet
 *   writeAssets   ───▶ write what changed, PRUNE what this build does not make, and say which is which
 *
 * WHY `bundle: false`, and this is the viewer's decision rather than an omission: its page reaches its
 * CodeMirror half through a DYNAMIC import, only when a text file is shown, and that laziness is the whole
 * reason a PDF costs the app's own bytes instead of every byte the app owns. A bundler decides for itself
 * which module is reached first and inlines the rest. So each file is TRANSFORMED ON ITS OWN, every
 * specifier left as written, and an app that cares asserts the specifier survived (the viewer does).
 *
 * WHY A SECOND BUILD WRITES NOTHING: `assets/` is committed, so the only thing that says those bytes are a
 * build's output and not a stale copy of it is running the build again — same bytes, no write, `git status`
 * clean. `writeAssets` reports that in one line rather than leaving it to be checked by hand.
 *
 * THE THREE SIGNATURES OF A MINIFIED ARTIFACT (a size passes by accident — a build that shipped half the
 * code is small), from a shared build step in a repo that depends on this one, where four apps measured
 * each one:
 *
 *   1. A PROBE IS GONE. A `probe` names a binding the SOURCE declares, and a minifier renames a local — so
 *      that name in the artifact means the minifier did not run over it. The probe is checked against the
 *      SOURCE FIRST: a check whose evidence quietly expired (the binding was renamed in the source, so the
 *      probe holds nothing) FAILS here instead of passing forever. For CSS the probe is a word that lives
 *      only in a COMMENT, because a minifier does not rename a class — it strips the comments.
 *   2. A MARKER IS THERE. Something the artifact must still carry, asserted present, so an empty artifact
 *      cannot satisfy signature 1 by holding no bytes at all.
 *   3. THE SHAPE. bytes per line: an artifact laid out one statement per line is not minified whatever its
 *      name says. Measured floors: a minified page script is thousands of bytes per line, a minified sheet is
 *      tens of thousands (a sheet is ONE line), and esbuild's unminified output is 40-80.
 *
 * AND A FOURTH WHERE THE STEP CAN AFFORD IT: `unminified` is the same source through the same transformer
 * with `minify: false`, so the claim is "the flag reached the bundler" rather than "the file is small". That
 * pair has no accident available to it, and it is what each app's sheet step spends.
 */
import * as esbuild from "esbuild";

const enc = new TextEncoder();

// ── the size table, one row per artifact ────────────────────────────────────────────────────────────────

/** One row of a build's size table: what the artifact is, its bytes, and its gzip'd bytes. */
export interface SizeRow {
  artifact: string;
  bytes: number;
  gzip: number;
  /** What the same artifact weighed BEFORE this step minified it, when the step built both. */
  before?: number;
  beforeGzip?: number;
  /** What the step did, in one word, so a row with no delta says why it has none. */
  how: string;
}

/** WHAT A BROWSER (or an upload) pays for these bytes: the text's UTF-8 length. */
export function bytesOf(text: string): number {
  return enc.encode(text).length;
}

/** ...and what it pays after gzip, from the platform's own compressor. */
export async function gzipBytes(text: string): Promise<number> {
  const gz = new Blob([enc.encode(text)]).stream().pipeThrough(new CompressionStream("gzip"));
  return (await new Response(gz).arrayBuffer()).byteLength;
}

/** THE TABLE, ALIGNED, ONE ROW PER ARTIFACT. A row that has a `before` prints the delta it bought. */
export function sizeTable(rows: SizeRow[]): string {
  const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+$)/g, ",");
  const cells = rows.map((r) => ({
    artifact: r.artifact,
    how: r.how,
    bytes: thousands(r.bytes),
    gzip: thousands(r.gzip),
    before: r.before === undefined ? "" : thousands(r.before),
    beforeGzip: r.beforeGzip === undefined ? "" : thousands(r.beforeGzip),
    delta: r.before === undefined || r.before === 0 ? "" : (r.bytes < r.before ? "-" : "+") +
      (100 * Math.abs(r.before - r.bytes) / r.before).toFixed(1) +
      "%",
  }));
  const width = (k: "artifact" | "how" | "bytes" | "gzip" | "before" | "beforeGzip" | "delta") =>
    Math.max(...cells.map((c) => c[k].length));
  const w = {
    artifact: width("artifact"),
    how: width("how"),
    bytes: width("bytes"),
    gzip: width("gzip"),
    before: width("before"),
    beforeGzip: width("beforeGzip"),
    delta: width("delta"),
  };
  return cells.map((c) =>
    "  " + c.artifact.padEnd(w.artifact) + "  " + c.how.padEnd(w.how) + "  " +
    c.bytes.padStart(w.bytes) +
    " bytes  " + c.gzip.padStart(w.gzip) + " gzip" +
    (c.before === "" ? "" : "   (was " + c.before.padStart(w.before) + " bytes / " +
      c.beforeGzip.padStart(w.beforeGzip) + " gzip, " + c.delta.padStart(w.delta) + ")")
  ).join("\n");
}

// ── a minified artifact, asserted rather than assumed ───────────────────────────────────────────────────

export interface MinifySignature {
  probes: { source: string; identifier: string }[];
  markers: string[];
  bytesPerLine?: number;
  unminified?: string;
}

export function assertMinified(label: string, text: string, sig: MinifySignature): void {
  const floor = sig.bytesPerLine ?? 300;
  for (const probe of sig.probes) {
    const word = new RegExp("\\b" + probe.identifier + "\\b");
    if (!word.test(probe.source)) {
      throw new Error(
        label + ": the minification probe `" + probe.identifier +
          "` is no longer in the source, " +
          "so this check holds nothing. Name something the source still has - this assertion is not " +
          "allowed to pass on expired evidence.",
      );
    }
    if (word.test(text)) {
      throw new Error(
        label + ": `" + probe.identifier + "` survived from the source into the artifact, so the " +
          "minifier did not take it away: these bytes are NOT minified",
      );
    }
  }
  for (const marker of sig.markers) {
    if (!text.includes(marker)) {
      throw new Error(
        label + ": the artifact does not contain `" + marker +
          "`, which it must carry - so what was " +
          "measured is not this artifact, or it lost a byte it cannot lose",
      );
    }
  }
  // THE TRAILING NEWLINE IS NOT A LINE: esbuild ends its output with one, and counting it halved every
  // small sheet's bytes-per-line (measured: an 874-byte minified sheet read as 437/line over "2 lines").
  const lines = text.replace(/\n+$/, "").split("\n").length;
  const perLine = bytesOf(text) / lines;
  if (perLine < floor) {
    throw new Error(
      label + ": " + Math.round(perLine) + " bytes per line over " + lines +
        " lines, below the floor of " +
        floor + " - the shape of an unminified artifact (one statement per line)",
    );
  }
  if (sig.unminified !== undefined && bytesOf(text) >= bytesOf(sig.unminified)) {
    throw new Error(
      label + ": the build with the minifier ON is not smaller than the same build with it OFF (" +
        bytesOf(text) + " vs " + bytesOf(sig.unminified) +
        " bytes), so whatever this step measured, the " +
        "flag did not reach the transformer",
    );
  }
}

// ── the steps ──────────────────────────────────────────────────────────────────────────────────────────

export type Produced = { name: string; text: string; row: SizeRow };

/**
 * ONE MODULE, MINIFIED IN PLACE OF ITSELF: `bundle: false`, `format: "esm"`, and therefore every `import`
 * specifier byte for byte as the source wrote it. Not `sourcemap`: a page served out of loombot's own origin
 * has no upload step for one, and a map beside a 22 KB artifact is a cost nobody reads.
 */
export async function minifyJs(source: string, minify = true): Promise<string> {
  const out = await esbuild.transform(source, {
    loader: "js",
    format: "esm",
    minify,
    legalComments: "none",
  });
  return out.code;
}

/**
 * A SHEET, THE SAME WAY. `loader: "css"` minifies it (`minify` collapses the whitespace, drops the comments
 * and shortens `0.5rem` to `.5rem`); it does NOT rename a class — CSS has no locals — so a CSS probe is a
 * word that lives only in a COMMENT, and the sheet's shape is one line. `format` is not an option here:
 * esbuild refuses it for a css loader.
 */
export async function minifyCss(source: string, minify = true): Promise<string> {
  const out = await esbuild.transform(source, { loader: "css", minify, legalComments: "none" });
  return out.code;
}

/** One artifact's text and its row, with the gzip of both the text and what it weighed before. */
export async function row(
  name: string,
  text: string,
  opts: { before?: string; how: string },
): Promise<Produced> {
  return {
    name,
    text,
    row: {
      artifact: name,
      how: opts.how,
      bytes: bytesOf(text),
      gzip: await gzipBytes(text),
      before: opts.before === undefined ? undefined : bytesOf(opts.before),
      beforeGzip: opts.before === undefined ? undefined : await gzipBytes(opts.before),
    },
  };
}

/**
 * WRITE `assets/`, PRUNE WHAT THIS BUILD DOES NOT PRODUCE, AND SAY WHICH IS WHICH.
 *
 * `assets/` has ONE writer and it is this function: a byte left there that no step makes is a byte nobody
 * can reproduce, and it is also a byte loombot would hand a browser (`--dir assets`). So anything this build
 * did not produce is REMOVED and NAMED — never left behind to look like output.
 */
export async function writeAssets(
  out: string,
  produced: Produced[],
): Promise<{ wrote: string[]; same: string[]; pruned: string[] }> {
  await Deno.mkdir(out, { recursive: true });
  const wrote: string[] = [];
  const same: string[] = [];
  for (const p of produced) {
    const target = out + "/" + p.name;
    const old = await Deno.readTextFile(target).catch(() => null);
    if (old === p.text) {
      same.push(p.name);
      continue;
    }
    await Deno.writeTextFile(target, p.text);
    wrote.push(p.name);
  }
  const pruned: string[] = [];
  for await (const e of Deno.readDir(out)) {
    if (produced.some((p) => p.name === e.name)) continue;
    await Deno.remove(out + "/" + e.name, { recursive: true });
    pruned.push(e.name);
  }
  console.log(
    "  wrote " + wrote.length + " of " + produced.length + " (" + (wrote.join(", ") || "none") +
      ")" +
      (same.length ? "; unchanged: " + same.join(", ") : "") +
      (pruned.length ? "; PRUNED (this build does not make it): " + pruned.join(", ") : ""),
  );
  if (!wrote.length && !pruned.length) {
    console.log(
      "  a second build of the same source writes nothing: assets/ IS this build's output",
    );
  }
  return { wrote, same, pruned };
}
