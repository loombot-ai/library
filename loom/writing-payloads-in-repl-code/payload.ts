// Payload-safe helpers, mounted so the escaping is written ONCE and never regenerated per call.
//
// The problem they solve: everything an agent does goes through `repl_run({code})`, so a shell
// payload is nested TWICE — once in the JS literal, once in /bin/sh. Each level has its own
// metacharacters and the product of the two is where the mistakes live. These reduce it to one.

// Built from char codes so this file contains no literal quote characters at all: the source cannot
// be broken by the quoting it implements, and no reader has to count backslashes to check it.
const SQ = String.fromCharCode(39); // apostrophe
const BS = String.fromCharCode(92); // backslash
const ESCAPED = SQ + BS + SQ + SQ; // close, escaped literal, reopen

/**
 * POSIX single-quote one string for /bin/sh. TOTAL — correct for every possible input.
 *
 * Inside single quotes /bin/sh treats every byte literally, so the only thing needing care is the
 * apostrophe itself, and the standard trick handles it: end the quote, emit an escaped apostrophe,
 * start a new one. `JSON.stringify` is NOT a substitute — it leaves $ and backtick untouched, which a
 * shell then expands inside double quotes.
 */
export function shq(s: string): string {
  return SQ + s.split(SQ).join(ESCAPED) + SQ;
}

/** Write lines to a path. An ARRAY is the point: each element is its own short literal, so a stray
 * metacharacter can spoil one line instead of the file, and nothing reaches a shell. */
export async function writeLines(
  path: string,
  lines: string[],
): Promise<number> {
  const text = lines.join(String.fromCharCode(10)) + String.fromCharCode(10);
  await Deno.writeTextFile(path, text);
  return text.length;
}

/** Run a command with an argv ARRAY — no shell parses anything, so there is no second level to
 * escape. Use this instead of `sh` whenever the arguments contain data. */
export async function run(
  cmd: string,
  args: string[] = [],
  opts: { cwd?: string; stdin?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = new Deno.Command(cmd, {
    args,
    cwd: opts.cwd,
    stdin: opts.stdin === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  if (opts.stdin !== undefined) {
    const w = p.stdin.getWriter();
    await w.write(new TextEncoder().encode(opts.stdin));
    await w.close();
  }
  const out = await p.output();
  const dec = new TextDecoder();
  return {
    code: out.code,
    stdout: dec.decode(out.stdout),
    stderr: dec.decode(out.stderr),
  };
}
