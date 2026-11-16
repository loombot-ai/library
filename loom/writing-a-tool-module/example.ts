/**
 * The worked example for `writing-a-tool-module`: two tools, a `spec` that documents both, and a
 * cleanup function named `shutdown` rather than `dispose`, so it is yours to call: `unloadTools` runs an
 * export named `dispose` and nothing else, and a reload runs nothing at all.
 *
 * Load it and see the report for yourself:
 *
 *     await loadTools("tally", "loom/library/writing-a-tool-module/example.ts")
 */
let ticks = 0;
let timer: ReturnType<typeof setInterval> | undefined;

export function watch(everyMs: number): string {
  if (timer !== undefined) clearInterval(timer);
  timer = setInterval(() => ticks++, everyMs);
  return `watching every ${everyMs}ms`;
}

export function ticksSoFar(): number {
  return ticks;
}

/** Named anything you like: the `spec` entry below is what makes it the cleanup. */
export function shutdown(): void {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
}

export const VERSION = "1";

export const spec = {
  watch: {
    description: "Start the tick counter. Call again to restart it.",
    positional: ["everyMs"],
    returns: "a confirmation string",
    inputSchema: {
      type: "object",
      properties: { everyMs: { type: "number", description: "tick interval" } },
      required: ["everyMs"],
    },
  },
  ticksSoFar: { description: "Ticks since the last watch().", returns: "a number" },
  shutdown: {
    description: "Clear the interval so a reload leaves nothing behind.",
  },
};
