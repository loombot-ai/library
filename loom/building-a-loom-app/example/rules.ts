/**
 * The RULES half of the example app — the fast layer, and the whole point of the design.
 *
 * `app_mcp.ts` imports this module from the app directory and asks it about every browser event. The
 * contract is three exports, two of them optional:
 *
 *     export const initial            state when there is no channel-state.json yet
 *     export function event(name, data, state)   REQUIRED
 *         return {state?, actions?}   MECHANICAL — answered here, in microseconds, agent never involved
 *         return null                 a DECISION — becomes one MCP notification, costs a turn boundary
 *     export const tools              OPTIONAL: the agent's OWN verbs — and an answer to a decision IS
 *                                     one, a request with a reply, not a frame pushed at nobody
 *
 * **Read the split below as the rule for every app you write.** Everything a computer can decide is
 * decided here; the agent is asked exactly one kind of question. In this app:
 *
 *     bump    +1 / -1 within [0, limit]      MECHANICAL. A refusal at the limit is instant, and it has
 *                                            to be: 2 seconds to be told "that is the limit" reads as
 *                                            broken, while 2 seconds for a judgement reads as thinking.
 *     hello   a page that just loaded        MECHANICAL. A reload must not cost a model call.
 *     reset   back to zero                   MECHANICAL. The rule is arithmetic; nobody need approve it.
 *     raise   "let me go past the limit"     A DECISION. There is no rule for it — that is precisely why
 *                                            it is the agent's, and why the human typed a reason.
 *     verdict the agent's answer to a raise   THE AGENT'S VERB, declared below: one call, one reply, and
 *                                            the decision folded into state in that same call.
 *
 * No import: a rules module is a plain Deno module with no dependency on loom, so it type-checks on its
 * own and an app directory can be copied anywhere.
 */

/** This app's state. Its shape is the app's business — `app_mcp.ts` only stores and passes it. */
interface Tally {
  count: number;
  limit: number;
  /** How many times the agent has granted a raise, so the state file shows the history of decisions. */
  raises: number;
  /**
   * THE AGENT'S LAST ANSWER, and the page's only source for it. A frame written while no request is
   * waiting is a push, and a push's action name is delivered to nobody (`app_mcp.ts`, above `Handled`)
   * — so the decision's answer reaches a page as the state this field is part of, on the re-read the
   * broadcast causes. Absent until a decision has been folded: a page whose ask is still out says
   * "asking the agent…" from its own click, and this field is what replaces that line.
   */
  verdict?: "granted" | "denied";
}
/** The two outcomes a decision can have, DECLARED ONCE: the state field above reads it as a union and the
 * tool's schema derives its enum from it (the list audit caught the two spellings drifting apart). */
export const VERDICT_OUTCOMES = ["granted", "denied"] as const;

type Rec = Record<string, unknown>;
interface Handled {
  state?: Tally;
  actions?: { action: string; data?: Rec }[];
}

export const initial: Tally = { count: 0, limit: 10, raises: 0 };

/** The full picture, which is also the redraw: one action the page can render from nothing. */
function shown(s: Tally): { action: string; data: Rec } {
  return { action: "state", data: { ...s } };
}

export function event(name: string, data: Rec, s: Tally): Handled | null {
  switch (name) {
    // A page reading the app: on load, and again on every "this app changed". Answered from memory —
    // this is why a reload is free.
    case "hello":
      return { actions: [shown(s)] };

    case "bump": {
      const by = data.by === -1 ? -1 : 1;
      const next = s.count + by;
      // THE VALIDATED LIMIT, and it is refused HERE. The page gets a reason it can show immediately,
      // and the agent never learns this happened — there is nothing to decide about arithmetic.
      if (next > s.limit) {
        return {
          actions: [{
            action: "refused",
            data: {
              reason: "the limit is " + s.limit + " — ask for a higher one if you need it",
              ...s,
            },
          }],
        };
      }
      if (next < 0) {
        return {
          actions: [{ action: "refused", data: { reason: "it cannot go below zero", ...s } }],
        };
      }
      const after = { ...s, count: next };
      return { state: after, actions: [shown(after)] };
    }

    case "reset": {
      const after = { ...s, count: 0 };
      return { state: after, actions: [shown(after)] };
    }

    // A DECISION. `null` is the whole of how an app says "this one needs judgement": the server turns
    // it into one notification carrying `data` and the state, and its text names the tool below as the
    // way to answer — `workers.<app>.verdict({outcome, limit})`. The page gets no frame either way:
    // what the tool folds is adopted, persisted and BROADCAST, which reaches a page as one "this app
    // changed" and the re-read that answers it.
    case "raise":
      return null;

    default:
      // An unknown event is NOT a decision. Waking a model for a typo in your own page would teach it to
      // debug your JavaScript by hand, one turn boundary at a time.
      return { actions: [{ action: "error", data: { reason: "unknown event: " + name } }] };
  }
}

/** What an app-declared tool answers with, exactly as `example-ttt/rules.ts` declares its own. */
export interface ToolAnswer {
  ok: true;
  /** What the agent reads back: the decision as it was folded. */
  text?: string;
  /** Adopted, persisted and broadcast by `app_mcp.ts` — the new state and the redraw. */
  handled?: Handled;
}
/** A REFUSED CALL. The reason is the tool's MCP error text, and nothing else in the process moves. */
export interface ToolRefusal {
  ok: false;
  error: string;
}
export type ToolOutcome = ToolAnswer | ToolRefusal;

export interface AppTool {
  name: string;
  description: string;
  /** JSON Schema, listed verbatim — this is how the agent learns what `verdict` takes. */
  inputSchema: Rec;
  run(args: Rec, s: Tally): ToolOutcome;
}

/**
 * THE AGENT'S DOOR, and the decision's one fold. The notification that asks a raise names this tool,
 * so the answer arrives as `workers.<app>.verdict({outcome, limit})` — a REQUEST with a reply, which
 * is the whole reason it is a tool and not a pushed frame: the agent learns what its answer did in the
 * call it made, and an illegal one (a misspelled outcome, a grant with no limit) is this tool's ERROR,
 * read and corrected in the same turn. A `run` that answered ok without folding would be the old lie
 * in a new shape — the page would ask for ever — so the fold and the reply are one return: `handled`
 * is adopted, persisted and broadcast, and only then is the call answered.
 *
 * This fold used to live in an `action(name, data, state)` export, reached through the generic `send`.
 * `action` is still the server contract for an app that declares NO tools (README.md, "Writing
 * rules.ts"); an app that declares its verb folds here instead, so there is one fold, one reply, and
 * nothing for the two to drift into.
 */
export const tools: AppTool[] = [
  {
    name: "verdict",
    description: [
      'Answer the raise the page asked for. outcome is "granted" or "denied"; a grant says the new',
      "limit (a number — the page asked for one, and the state that came with the question carries it).",
      "The decision is folded into the app's state and every open page re-reads it, so the person sees",
      "the answer; the call itself replies with what was folded. A wrong outcome, or a grant with no",
      "limit, is THIS CALL'S error — nothing moves, and you can retry in the same turn.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          // THE SAME TWO WORDS AS THE STATE FIELD ABOVE, and the list audit exists to catch exactly this:
          // one declaration, two spellings. The schema derives its enum from the union's members so a third
          // outcome or a rename cannot make the tool and the state disagree.
          enum: VERDICT_OUTCOMES,
          description: "The decision on the pending raise.",
        },
        limit: {
          type: "number",
          description:
            "The new limit, when granting. Required for a grant; meaningless when denying.",
        },
      },
      required: ["outcome"],
    },
    run(args, s) {
      if (args.outcome !== "granted" && args.outcome !== "denied") {
        return { ok: false, error: 'outcome must be "granted" or "denied"' };
      }
      if (args.outcome === "denied") {
        // A DENIAL CHANGES THE ANSWER AND NOTHING ELSE — but the answer itself is state, so this still
        // folds, persists and broadcasts: the page's verdict line needs a re-read to draw "denied"
        // from, and no re-read happens over a state that did not move.
        const after: Tally = { ...s, verdict: "denied" };
        return {
          ok: true,
          text: "recorded: the raise is denied and the limit stays " + s.limit +
            " — folded into state; the page re-reads and its verdict line names it.",
          handled: { state: after, actions: [shown(after)] },
        };
      }
      if (typeof args.limit !== "number" || !Number.isFinite(args.limit)) {
        return { ok: false, error: "a granted verdict must say the new limit (a number)" };
      }
      // The agent is trusted for the DECISION, not for arithmetic: a granted limit below the current
      // count would make the page render an impossible state.
      const limit = Math.max(Math.floor(args.limit), s.count);
      const after: Tally = { ...s, limit, raises: s.raises + 1, verdict: "granted" };
      return {
        ok: true,
        text: "granted: the limit is " + limit +
          " — folded into state; the page re-reads and its verdict line names it.",
        handled: { state: after, actions: [shown(after)] },
      };
    },
  },
];
