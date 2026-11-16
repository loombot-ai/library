---
name: prompt-cache-cost-and-ttl
description: Read before changing loom's cache points or TTLs, or when re-pricing prompt caching - what the cache cost us ($2,530 of prompt), the placement fix and the 1h/5m TTL strategy that shipped, the provider TTL facts, and the probe and live-check numbers behind them.
keywords: 缓存, 计费
as_of: 2026-09-27
---

# Prompt cache: what it cost, what shipped, and the TTL strategy

STATE: BUILT 2026-09-27. Fix 1 (placement) and fix 2 (per-turn cache numbers) on `main` at `d6548ef`; the TTL strategy (using the free 1h marker) on `main` at `35dbdba`, for every agent, root and sub-agent alike. Checked live on Opus 5.5. COMMITS: `9391742`, `0b7198f` (rebased as `d6548ef`); `35dbdba`.

## What the cache cost

Rebuilt from every `handoff.log` on this machine (**19,349 requests, 276 agents, 3.0B context tokens**), with idle gaps from message timestamps and a replay of the cache rules. The replay matched `meta.json`'s real read/write/uncached split within about 1-10% on all 7 agents that have one (a 224-turn root: 55.29M read vs 55.30M actual), so there were almost no unexplained prefix changes: the system prompt is built once per agent and holds no date, count or worker list.

Prompt cost about **$2,530**, plus ~$480 of output. **At least $1,829 is unavoidable** (re-reading context, and writing each turn's new tokens once). The rest:

    1  TTL expiry at the root                      $386  273 gaps over 5 min on ~250k-token contexts
    2  cache points placed badly                   $296  the newest point lagged the tail by up to 7 messages: 52.7M tokens at full input price
    3  compaction rewrites                         $28   37 compactions; a new prefix is written once
    4  sub-agent TTL expiry                        >=$10 a floor: most sub-agent traces are gone
    5  sub-agents not sharing the parent's prefix  $7    own workdir and library text; compactors do share (~99% read)

Root idle gaps over 5 min: 117 of 5-10 min, 97 of 10-30, 22 of 30-60, 19 over an hour.

## Shipped (`d6548ef`)

1. **Placement** (`loom/providers/cache_points.ts`, both Bedrock and Anthropic): points on the last message, on the message before the newest assistant turn, and one fixed point every 8 messages. Same 11-turn task on Opus 5.5: **uncached input 12,394 -> 24, prompt cost $0.229 -> $0.163 (-29%)**; about 12% of the whole bill.
2. **Per-turn numbers**: each `handoff.log` turn line ends `(cache read R, write W, uncached I; out O)`.

## TTL facts (provider facts, true for anyone)

- **Only two lifetimes exist: 5 min and 1 hour.** Probed on Bedrock (Opus 5.5): `5m` and `1h` accepted; `10m`, `15m`, `30m`, `2h`, `24h` refused (`ValidationException`). The Anthropic API documents the same two.
- **Price** (Anthropic's ratios; Opus base input $5/M): 5-min write 1.25x, 1-hour write 2x, read 0.1x either way.
- **Bedrock supports `ttl: "1h"`** in Converse `cachePoint` for Claude Opus 4.5-5, Sonnet 4.5-5 and Haiku 4.5; verified live on Opus 5.5.
- **Mixing is documented**: 1-hour entries must come BEFORE 5-minute ones. Billing uses three positions: A = the highest cache hit, B = the highest 1-hour point after A (or A), C = the last point. You pay a cache read for A, 1-hour writes for (B - A), 5-minute writes for (C - B).
- **Hits refresh the lifetime** at no cost, measured from the start of the request that wrote or read the entry.
- **A breakpoint writes exactly one entry, at itself** - a hash of the prefix ending at that block; no entries for earlier positions. Lookback is 20 blocks (a run of tool_use/tool_result counts as one position on the Claude API; Bedrock's counting is not documented).

## Probes (Opus 5.5, fresh prefixes, a 6.5-minute wait so every 5-minute entry expires)

    X1 fresh: 1h on old history + 5m on the tail   write 6780 = 1h 4916 (old) + 5m 1864 (recent)
    Y1 fresh: 5m on the tail only                  write 6781, all 5m
    Y2 same + a 1h point on old history            read 6781, write 4 (1h)
    X2 after 6.5 min                               READ 4916 (the old part survived), rewrite 1864
    Y3 after 6.5 min                               READ 4917 (the old part survived), rewrite 1864

X is the documented behaviour: a prefix WRITTEN under a 1-hour point lives an hour. Y follows from the documented rules too: the 1-hour marker of Y2 is a breakpoint, so it writes its own entry, and it sat below the highest hit A, so (B - A) = 0 bills nothing; Y3 is that entry being read. Observed identically on Bedrock.

## The TTL strategy (built)

`loom/providers/cache_points.ts` `cacheTtls`, applied by both `bedrock.ts` (`cachePoint.ttl`) and `anthropic.ts` (`cache_control.ttl`) at the same points:

- **The system prompt's point and the stride point carry `ttl: "1h"`; the tail and the previous request's tail carry 5m** - the tail even when it lands on a stride message. That prefix is written at 5m as a tail, and the NEXT request's 1h stride marker sits below its highest hit: it writes a 1-hour entry and bills nothing (B - A = 0). Every later request re-marks it, so it keeps an hour's life from the latest request. **So the only 1h write ever billed is the system prompt's, once per agent.**
- **One exception, for the documented order**: a previous tail that lies BEFORE a 1h stride point is 1h too - at the cache hit, so it bills nothing.
- **After a pause under an hour**: the prefix up to the stride point is read; only the last <=8 messages are rewritten at 5m. Past an hour it expires as before.
- **Only on models that accept `ttl`** (`acceptsTtl`: Opus 4.5-5.x, Sonnet 4.5-5, Haiku 4.5, Fable 5). Any other model sends no `ttl` field: the request is byte-identical to before (pinned by tests). `--no-cache`: no points, as before.
- **The one gap it leaves**: a pause right after the request whose tail landed ON a stride point finds that entry expired, so the read falls back to the previous stride point - up to 16 messages rewritten, IF Bedrock's lookback reaches it (8 messages back); if not, to the system prompt. In the traces: **16 of 105 timed root pauses (5 min-1 h) were of this kind; they cost $1.03 extra against writing the stride 1h at once when lookback reaches 8 messages, $33.86 when it reaches none.**

**How to see the silent failure**: in a root's `handoff.log`, on an Opus model, a turn after a gap of more than 5 minutes whose line reads `cache read` near 0 and a `write` near the whole context. A healthy system-prompt entry shows as `write W of which 1h H` on each agent's first turn.

## Re-priced (`ttl_sim.mjs`, 2026-09-27)

Every `handoff.log` under `.loom/sessions` (**18,268 requests, 51 roots, 194 sub-agents**); timed: 3,185 root turns (21 roots) and 513 sub-agent turns (8 sub-agents - most sub-agent traces are gone). Untimed turns count as 20 s apart, so their savings are a floor. $ at Xiaohu's prices ($6.25 in and 5m write, $10 1h write, $0.50 read):

    agents                             today   built (1h marker)  first design (1h write)  all 1h
    roots, all (lookback: none)        $928    $853 (-$74)        $897                     $861
    roots, all (lookback >= 8 messages)$928    $787 (-$140)       $842                     $861
    roots, timed only (lookback >= 8)  $701    $560 (-$141)       $593                     $608
    sub-agents, all (no idle known)    $966    $970 (+$4.85)      $1,022 (+$56)            $1,094
    sub-agents, timed only             $67.9   $67.9 (-$0.03)     $70.4                    $74.2
    sub-agents, untimed given gaps*    -       -$5 to -$30        -                        -

Timed sub-agents idled past 5 min on 2 of 513 turns; roots on 109 of 3,185 (4 past an hour). **Scope, decided by this table: every agent** - with the free marker the only premium left is the system prompt's 1h write, ~2.5 cents per agent (+$4.85 over 194 sub-agents, a ceiling that assumes they never idle), against -$0.03 on the timed ones. So no root/sub plumbing: the cache code does not know which it is.

## Live check (Opus 5.5, `ttl_live_check.mjs`, 2026-09-27)

Two synthetic sessions side by side, each request built by loom's own `toConverse`; ~3.6k tokens a message, ~14k system prompt.

    R0 (1 msg)        NEW: write 17,932 = 1h 14,312 (system) + 5m 3,620     OLD: write 17,932 (5m)
    R8 (tail ON 16)   NEW: sys 1h, 14 5m, 16 5m; read 68,349, write 7,133 (5m)
    R9 (marker on 16) NEW: sys 1h, 16 1h, 18 5m; read 75,482, write 7,133, all 5m: 1h 0
    _pause 6.5 min_
    R10 (21 msgs)     NEW: read 75,482, write 14,266 (5m)   OLD: read 0, write 89,748

So the stride prefix (to message 16) was first written at 5m as a tail (R8), marked 1h for nothing (R9: no 1h write in `cacheDetails`), and READ after the pause (R10); only messages 17-20 were rewritten. R10 at Xiaohu's prices: **$0.127 against $0.561**. The whole check (22 requests) cost about $2.

## Options not taken (and why)

- **The first design** (approved, then changed by Xiaohu): a tail on a stride message makes that request all 1h, so the new stride prefix is WRITTEN at 1h and billed (B - A); +$56 on sub-agents, $33-55 worse than the built rule on roots.
- **1 hour on every point**: premium on every write; worse than the built rule for everyone.
- **Naming the old stride point instead of the previous tail** (`crossing-anchor`): removes the lookback dependence of the one gap, but keeps the first design's 1h writes ($842 on roots against the built rule's $787).
- **1 hour on the system prompt only**: ~4k tokens of a ~250-340k context, so ~3 cents per pause.
- **Keep-warm pings** (a read every 4.5 min): ~$254 net, but requests while nobody is working, and each ping reads the whole context.

Note: this doc cites a workdir library entry `loom-prompt-cache` (with `ttl_sim.mjs` and `ttl_live_check.mjs`) that no longer exists under either live root - the ONE-user-library model retired the workdir root on 2026-10-05 (`loom-one-library-model`).

The cache HIT percentage on loombot's agent table is a DIFFERENT number from every cost figure above - its
formula, and why images make it fall without anything being lost, is the entry `cache-hit-percent-and-images`
(2026-10-11).
