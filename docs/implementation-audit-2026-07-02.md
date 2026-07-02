# VitalSage Implementation Audit — AI Quality, Signal Quality, and the Closing Loop

**Date:** July 2, 2026
**Scope:** AI enhancement layer (`agent/analysis/src/ai/*`, agent `enhance()`), signal collection (`sdk/client`, `sdk/simulator`), and the identify → fix → validate loop (`vitalsage fix`).
**Method:** full code review of the layers above, cross-referenced against live audit runs performed against tumblr.com and oyyo.ai (NVIDIA NIM / llama-3.1-8b) earlier this session. Findings marked **[confirmed]** were reproduced empirically or verified by typecheck; the rest are code-level analysis.

---

## Executive summary

VitalSage's architecture is sound: rule-based agents produce grounded findings, AI enhancement adds depth, and the schema-validated XML parser prevents malformed output from reaching users. But three systemic problems cap the quality ceiling:

1. **The closing loop is broken.** `vitalsage fix` does not compile (calls a method that doesn't exist), and even after fixing that, its audit step always returns the "insufficient data" placeholder — so the AI would be asked to "fix" the placeholder message. It also never rolls back failed patches, so regressions compound.
2. **The AI reasons over partially wrong data.** Several signals fed into prompts are fabricated, zeroed, or semantically mismatched (synthetic font data is hardcoded, TTFB breakdowns are all zeros for synthetic runs, "preload" detection is a URL-substring hack). Confident garbage in → confident garbage out — this was observed live in the oyyo.ai audit, where the model fabricated a "639ms style recalculation" figure and drew a causally impossible conclusion (forced layouts → TTFB).
3. **There is no defense against hallucination and no timeout on AI calls.** A hung provider connection stalls the entire audit indefinitely (observed live: 10+ minutes against NVIDIA NIM), and nothing validates that the numbers the model cites exist in the input data.

The single highest-leverage signal upgrade is adopting `web-vitals/attribution` — the SDK currently asks the AI to *guess* things (INP phase breakdown, CLS shift sources) that the library can *measure*.

---

## Part 1 — AI enhancement quality

### A1. No request timeout in any provider — **[confirmed live]** · P0

`OpenAIProvider`, `AnthropicProvider` (and by pattern `GeminiProvider`) call `fetch` with no `AbortController`. A connection that hangs never resolves, the retry loop never advances, and `Promise.allSettled` in `engine.analyzeRoute` waits forever. Observed live: `vitalsage trace` hung for 10+ minutes when `deepseek-v4-flash` on NVIDIA NIM stopped responding, while the same key answered in 32ms with another model.

**Fix:** per-attempt `AbortController` timeout (~60s), an overall per-agent deadline, and a clear "AI enhancement timed out — showing rule-based findings" message.

### A2. No grounding validation of AI output — **[confirmed live]** · P0

`parser.ts` validates structure (severity/effort enums, confidence clamping) but never checks content. The oyyo.ai audit produced this finding from the model:

> "The forced layout count is 6, which is likely causing the 639ms spent on style recalculation … can improve TTFB."

Three failures in one suggestion: the 639ms figure appears nowhere in the input data (fabricated), forced layouts cannot affect TTFB (causally impossible), and "with a sample size of 1 session" leaked prompt internals into user-facing text.

**Fix (layered):**
- **Numeric grounding check:** extract quantitative claims (`\d+ms`, counts, percentages) from AI output and verify each appears in the prompt data; reject or downgrade suggestions with unverifiable numbers.
- **Causal lint:** a small allowlist of metric → cause mappings (TTFB ← redirect/DNS/TLS/server only; CLS ← layout/fonts/injection; etc.). Reject suggestions whose title/detail crosses domains impossibly.
- **Evidence field:** require the model to quote the input line supporting each suggestion (`<evidence>`); empty or non-matching evidence → drop.

### A3. The prompts force findings into existence · P1

Every prompt ends with "Generate 1–3 specific suggestions the rule-based layer did not catch." When there is nothing real to find (oyyo.ai is a healthy page), the model invents something to comply. The system prompt never offers abstention.

**Fix:** explicitly permit and reward "no additional findings" (`<suggestions/>`), and instruct that an empty response is preferred over a low-confidence one. This is the cheapest possible hallucination reduction.

### A4. The system prompt lies about the data source · P1

`AI_SYSTEM_PROMPT` says "real-user measurement (RUM) data from a production website" — but the same prompt is used for synthetic-only trace runs (`minSamples: 1`, 3 Playwright runs). The model then writes findings with RUM-grade authority over single-run lab noise. Severity guidance exists only for LCP; nothing tells the model to hedge at low sample sizes.

**Fix:** parameterize the system prompt on data source (RUM / synthetic / mixed) and sample size; cap severity at `warning` when confidence is `low`/`insufficient`.

### A5. XML output format silently eats code examples · P1

`beforeCode`/`afterCode` routinely contain HTML (`<img src="...">`). Inside an XML document without CDATA, angle brackets become child elements — `str(el, 'beforeCode')` then returns `undefined` and the code example is dropped silently; in worse cases the whole parse fails and *all* suggestions are lost. Nothing in the prompts instructs the model to use CDATA. Notably, `fix-parser.ts` extracts the `<fixes>…</fixes>` substring before parsing (defensive), but `parser.ts` does not — a model that wraps output in markdown fences produces a silent empty result.

**Fix:** either (a) instruct CDATA usage and add fence-stripping + substring extraction to `parseAIResponse`, or (b) migrate to JSON with provider-native structured output (OpenAI `response_format: json_schema`, Anthropic forced tool-use). Option (b) also eliminates the enum-validation rejections.

### A6. Failures are invisible · P1

`enhance()` catches all errors and silently returns rule-based results; the parser returns `[]` on malformed XML. A user cannot distinguish "AI ran and found nothing" from "AI call failed" from "AI output was unparseable." During the tumblr/oyyo runs there was no way to tell whether all 9 agents' AI calls succeeded.

**Fix:** collect per-agent AI outcomes (`ok / timeout / api-error / parse-error` + token counts) into `AnalysisReport`, render a one-line status in reports ("AI enhancement: 6/7 agents, 1 parse failure, 14.2k tokens").

### A7. Duplicate suggestions slip through the rule/AI seam · P2

Dedup between rule and AI findings compares the first 40 characters of lowercase titles — the model restating a rule finding in different words passes. `rankAndDeduplicate` dedups only by ID (hash of agent+metric+title), so near-identical suggestions from *different* agents (render-block and LCP both suggesting script deferral) both surface.

**Fix:** a coarse topic taxonomy (e.g. `defer-scripts`, `preload-lcp`, `font-display`) assigned by keyword matching, dedup on (metric, topic); ask the AI to list which rule findings its suggestion relates to.

### A8. Provider layer hygiene · P2

- `tokensUsed` is collected then discarded — no cost accounting anywhere.
- `client.ts` passes `maxTokens`/`temperature` into provider constructors that ignore them (dead config).
- Anthropic endpoint is hardcoded — no `ANTHROPIC_BASE_URL` parity with the OpenAI fix; same for Gemini.
- Model defaults are stale (`gpt-4o`, `claude-sonnet-4-20250514`).
- No response caching: re-auditing an unchanged page re-pays every token.
- 429 handling ignores the `Retry-After` header.

### A9. Prompt data bugs (garbage-in) · P1

- **LCP prompt:** `page.resources.filter(r => r.initiatorType === 'link' && r.name.includes('preload'))` — counts resources whose *URL contains the string "preload"*. Same for the preconnect count. Both are essentially always 0 or wrong.
- **INP prompt:** "Event-heavy selectors: N first-party scripts" — the label describes data that isn't collected; the value is just a script count.
- **Render-block prompt:** external script sizes are always 0 KB (only inline sizes are collected — see B6), so "Total size: 0KB" undermines the model's cost ranking.
- **Trace prompt:** the network/viewport profile of the trace run is never included — the model can't judge whether 4.3s LCP is alarming (it's a 4g-throttled lab run, not real users).

### A10. No evaluation harness · P2

There are unit tests for the parser but no prompt/finding-quality evals. Prompt edits ship blind. The repo already contains the perfect eval substrate: the example apps with *deliberately injected issues* (DOM bloat, layout thrashing, long tasks) and their fixed variants.

**Fix:** a golden eval: run analysis against each example app (broken + fixed), assert the known issue is found (recall), assert no findings on the fixed variant reference fabricated numbers (precision/grounding). Run on every prompt change.

---

## Part 2 — Signal collection quality

### B1. Synthetic `PageContext.navigationTiming` is all zeros — **[confirmed]** · P0

`extractor.ts` extracts real navigation timing (`extractNavTiming`) but only uses it to compute the TTFB metric value. The `PageContext` built by `collectPageContext` hardcodes `navigationTiming` to all zeros — and that's what reaches the TTFB agent and its AI prompt. Every synthetic audit shows the AI "Redirect: 0ms, DNS: 0ms, TLS: 0ms, Server: 0ms" and asks it to identify which component dominates.

**Fix:** merge the real `extractNavTiming()` result into the page context. One-line-class fix, immediately improves every TTFB analysis.

### B2. Synthetic font signals are fabricated — **[confirmed]** · P0

`collectPageContext` maps `document.fonts` with hardcoded `display: 'auto'`, `isPreloaded: false`, `hasCrossOrigin: false`. The FontAgent therefore sees "every font causes FOIT, nothing is preloaded" on every synthetic run — systematic false positives, and the font AI prompt reasons over invented data.

**Fix:** port the SDK client's `CSSFontFaceRule` walker (which reads real `font-display`, preload links, URLs) into the injected simulator collector.

### B3. `hasCrossOrigin` means two different things · P1

The SDK collector sets `hasCrossOrigin` = "the font *URL* is on another origin." The analysis layer (CLS/font prompts and rules: `f.isPreloaded && !f.hasCrossOrigin`) reads it as "the preload link carries the `crossorigin` *attribute*" — which is what actually matters for font preloads (they're always CORS requests). The signal as computed is unusable for its consumer.

**Fix:** split into `isCrossOrigin` (URL origin) and `preloadHasCrossOriginAttr` (attribute on the matching `<link rel="preload">`), update rules/prompts.

### B4. LCP preload/priority detection is fragile · P1

- Simulator: `isPreloaded: !!document.querySelector('link[rel="preload"][as="image"]')` — true if *any* image preload exists, not the LCP one.
- SDK: matches the LCP image by `img[src="..."]` selector — misses `srcset`/`currentSrc` resolution, `<picture>`, and CSS background images entirely.
- Font preload matching compares absolute `link.href` against raw (possibly relative) CSS `url()` values — mostly false negatives.

**Fix:** resolve all URLs through `new URL(raw, document.baseURI).href` before comparing; match LCP images via `currentSrc`; for background-image LCP, walk `getComputedStyle`.

### B5. Resource hints are not collected as first-class data · P1

There is no inventory of `<link rel="preload|preconnect|dns-prefetch|modulepreload">` in `PageContext` — which is why prompts fall back to the URL-substring hack (A9). The resource-hint agent is starved of exactly the data it's named after.

**Fix:** add `PageContext.hints: Array<{ rel, href, as?, crossorigin? }>` (one `querySelectorAll` at collect time), feed it to the resource-hint and LCP prompts.

### B6. External script/stylesheet sizes missing · P1

`ScriptEntry.size` is set only for inline scripts; `StylesheetEntry` has no size field populated. The render-block prompt sums these into "Total size: 0KB". The data already exists in `resources[]` (transferSize by URL) — it just isn't joined.

**Fix:** join scripts/stylesheets to resource entries by resolved URL at collection (or in `synthesizeContext`).

### B7. Not using `web-vitals/attribution` — the biggest signal upgrade available · P1

The SDK imports plain `web-vitals`. The attribution build provides, for free:
- **LCP:** phase breakdown (TTFB / resource load delay / resource load time / element render delay) — the exact decomposition the LCP prompt currently asks the model to *infer*.
- **INP:** `inputDelay` / `processingDuration` / `presentationDelay` + the interaction target selector + the responsible LoAF entry — the INP prompt literally asks the model to guess "which phase is likely dominant."
- **CLS:** `largestShiftTarget`, shift time, load state.

**Fix:** switch to `web-vitals/attribution`, extend `RawMetricValue` with the attribution payload, and surface it in the LCP/INP/CLS prompts. This converts three "speculate about the cause" prompts into "here is the measured cause; propose the fix."

### B8. Synthetic INP is unreliable and the interaction can destroy the run — **[confirmed live]** · P1

INP showed "no data" in all six tumblr/oyyo runs. The simulator's interaction phase clicks the first `button, a[href], [role="button"]` — clicking a link can navigate away from the page *before* `extractSessionReport` runs (extraction happens after the click), and the click failure is swallowed. Also, `web-vitals` finalizes INP on visibility change, which never happens in the headless session.

**Fix:** interact only with non-navigating targets (dispatch pointer events on `document.body` or elements verified to have no `href`); before extraction, force INP finalization (CDP `Page.setWebLifecycleState('hidden')` or dispatching `visibilitychange`); assert the page URL is unchanged after interaction.

### B9. PageContext is snapshotted after scroll + click mutations · P2

Extraction runs after the scroll-to-bottom/scroll-back/click sequence, so lazy-loaded content inflates `domNodeCount`, above-fold classification runs on a mutated DOM, and image inventories differ from what the load-time metrics describe.

**Fix:** snapshot `PageContext` at the load-settled point (before interactions); keep interaction-phase data in a separate field.

### B10. CLS sources and INP timings are captured but never used · P1

`serialize.ts` already captures `LayoutShift.sources` (element descriptions + shift values) and `PerformanceEventTiming` processing timestamps. None of it reaches the prompts — the CLS prompt asks the model to *guess* what's injecting content while the SDK holds the actual shifted-element list.

**Fix:** aggregate top shift sources across sessions (element description → cumulative shift value) into the CLS prompt; pass INP entry timings into the INP prompt. Zero new collection needed — this is pure wiring.

### B11. Signal-definition drift between SDK and simulator · P2

`isRenderBlocking` for scripts: the SDK requires the script to be in `<head>`; the simulator flags any sync external script including ones in `<body>` (which don't block rendering of content above them in the same way). Synthetic and real sessions thus disagree on the same page. Simulator also loses `elementType` fidelity (only `img`/`text`; video/svg/background-image collapse to `text`).

### B12. Mobile simulation is viewport-only · P2

`hardwareConcurrency` is hardcoded to 4 and there is no CPU throttling (`Emulation.setCPUThrottlingRate` never sent). "Mobile" runs are desktop CPUs with narrow screens, so mobile/desktop comparisons in prompts (and the LCP mobile-gap rule) under-detect real mobile issues on synthetic data.

**Fix:** apply 4× CPU throttle for mobile viewport profiles; set `hardwareConcurrency` via CDP to match the device class.

### B13. Run-to-run noise is unquantified · P2

Two identical tumblr traces 15 minutes apart measured LCP at 4,300ms and 6,423ms (+49%) and TBT at 107ms vs 1,783ms (16×). No variance is reported to the user, and downstream decisions (severity, fix validation) treat point estimates as truth. Report min/max/CV across runs; flag findings that flip between runs (the "consistent across ≥2/3 runs" gate exists in trace mode — extend it everywhere).

---

## Part 3 — The closing loop (`vitalsage fix`)

### C1. It does not compile — **[confirmed by typecheck]** · P0

`fix.ts:88` calls `sim.run({...})`; `PlaywrightSimulator` only has `simulate()` (TS2339). The config passed also lacks `outputDir`, which `simulate()` requires for its `mkdir`. The loop has never executed end-to-end in its current form. This also means typecheck is not gating the build (tsup bundles without it).

**Fix:** rename to `simulate()`, pass a temp `outputDir`, add a CI job that runs `pnpm -r typecheck`, and add one smoke test that runs the loop against the vanilla example with a mock AI provider.

### C2. The audit step always returns "insufficient data" — **[confirmed by code path]** · P0

`engine.analyze(previousSnapshot.sessions)` is called with no options → `minSamples` defaults to **50**, but `measure()` produces **3** sessions. Every cycle therefore yields `buildInsufficientReport`, whose only suggestion is the info-level placeholder "Only 3 sessions collected — insufficient for reliable analysis." That placeholder becomes `sorted[0]` — the "top issue" the AI is asked to patch source code for. (`capture.ts` gets this right with `{ minSamples: 1 }`.)

**Fix:** pass `{ minSamples: 1 }` in the fix loop.

### C3. No rollback — failed fixes become the new baseline · P0

When an attempt shows no improvement, the patches stay applied and `previousSnapshot = afterSnapshot` makes the (possibly degraded) state the next comparison base. Consequences: a harmful patch is never reverted; cumulative regressions vs the true baseline are invisible; each retry stacks new patches on top of unvalidated ones.

**Fix:** require a clean git tree at start; commit per attempt; on non-improvement, `git checkout` the attempt's changes before retrying; always compare candidate snapshots against the *original* baseline; final summary reports net change from baseline.

### C4. Validation statistics cannot support the decisions being made · P0

- "p75" of 3 runs (`Math.ceil(3 × 0.75) − 1 = index 2`) is the **maximum** — the noisiest possible estimator.
- The improvement threshold is ±3%, while observed run-to-run noise on a real page was +49% LCP (B13). Improvement/regression verdicts at n=3 with a 3% gate are coin flips.
- `isImprovement` votes across all five metrics equally, so a TTFB fix can be "validated" by INP noise, and CLS differences of 0.001 count the same as 500ms of LCP.

**Fix:** ≥5 runs per snapshot (alternating A/B to cancel drift); median (or trimmed mean) instead of max; per-metric noise floors (LCP ±10%, CLS ±0.02, TBT ±30%); the decision must be gated on the metric the fix targeted, with other metrics checked only for regression beyond their noise floor.

### C5. Structural verification is missing · P1

The loop validates only by metric movement — but most fixes have a cheap deterministic check: if the fix added `fetchpriority="high"`, assert the attribute exists in the live DOM; if it added a preload, assert the link tag is present and the resource shows `fromCache`/earlier `fetchStart`. Two-tier validation (1: the fix landed structurally; 2: metrics improved beyond noise) separates "patch didn't apply/HMR didn't rebuild" from "patch applied but didn't help" — currently indistinguishable.

### C6. The XML patch format breaks on real patches · P1

`<search>`/`<replace>` carry raw HTML/JS. Unescaped `<img …>` inside XML becomes child elements, `str()` returns `undefined`, and the patch is dropped (the schema example in `fix-parser.ts`'s own doc comment is invalid XML for this exact reason). Additionally `applyPatches` uses `String.replace(search, replace)` — `$&`/`$1` patterns in the replacement corrupt output, and only the first occurrence is replaced with no ambiguity check.

**Fix:** JSON patch format (or mandated CDATA), literal-string replacement (`split().join()`), and reject patches whose search string matches more than once.

### C7. Context selection for the fixer is blind · P1

`readSourceFiles` takes the first 20 files in `readdir` order, truncates at 25KB, and sends everything to the model regardless of relevance. On any real project the file containing the LCP `<img>` may never be included, while 20 irrelevant files burn the context window. There's also no ledger of previously attempted fixes — on retry with unchanged metrics, the same top suggestion returns and the model regenerates the same patch.

**Fix:** rank files by relevance to the suggestion (match script/image URLs from the finding against file paths and contents; prefer entry HTML for markup fixes); pass an attempted-fixes ledger ("previously tried X — it did not improve; do not repeat") into the fixer prompt.

### C8. Rebuild latency race · P2

After `applyPatches`, re-measurement starts immediately. Against a dev server, HMR/rebuild may not have completed — the "after" snapshot can measure the *old* code, producing a false "no improvement" verdict (and, with C3, a wrongly kept-then-abandoned patch chain).

**Fix:** poll until the served content reflects the patch (fetch the page and check for the patched substring) or accept a `--rebuild-cmd`/`--wait-ms` option.

### C9. The loop leaves no audit trail · P2

Results exist only as console output. For a tool whose purpose is trust in automated changes, each run should emit a machine-readable record: per attempt — the finding targeted, patch diffs, structural check results, before/after distributions with variance, decision, and rollback status. This artifact is also exactly what a future CI/PR integration would consume.

---

## Prioritized roadmap

### P0 — Correctness (est. 2–4 days total; do first)

| # | Item | Findings | Effort |
|---|------|----------|--------|
| 1 | Fix `sim.run` → `simulate` + `outputDir` + `minSamples: 1`; add CI typecheck + loop smoke test | C1, C2 | ~0.5 day |
| 2 | AbortController timeouts in all three providers + surface AI outcomes in reports | A1, A6 | ~0.5 day |
| 3 | Merge real navigation timing into synthetic `PageContext`; port real font collection into the simulator | B1, B2 | ~1 day |
| 4 | Git-based rollback in the fix loop; compare against original baseline | C3 | ~1 day |

### P1 — Signal & statistics (est. 1–2 weeks)

| # | Item | Findings | Effort |
|---|------|----------|--------|
| 5 | Adopt `web-vitals/attribution`; wire LCP phases, INP phases + target, CLS sources into prompts | B7, B10 | ~3 days |
| 6 | First-class resource-hint inventory; join script/stylesheet sizes from resources; split `hasCrossOrigin` semantics; robust URL matching | B3–B6, A9 | ~2 days |
| 7 | Noise-aware validation: ≥5 runs, median, per-metric noise floors, target-metric gating, structural fix verification | C4, C5, B13 | ~2 days |
| 8 | Structured outputs: JSON (or CDATA-hardened XML) for suggestions and patches; fence-stripping in `parseAIResponse`; literal patch application | A5, C6 | ~2 days |
| 9 | Honest prompts: synthetic-vs-RUM system prompt, abstention allowed, trace run profile included, severity capped at low confidence | A3, A4 | ~1 day |

### P2 — Quality systems (est. 2–3 weeks, parallelizable)

| # | Item | Findings | Effort |
|---|------|----------|--------|
| 10 | Grounding validator (numeric claims + causal lint + evidence quotes) | A2 | ~3 days |
| 11 | Eval harness using example apps' injected issues (recall + precision + grounding score per prompt change) | A10 | ~3 days |
| 12 | Semantic dedup via topic taxonomy across rules/AI/agents | A7 | ~2 days |
| 13 | Fixer context ranking + attempted-fixes ledger + rebuild-latency guard + run artifact (JSON/MD per fix run) | C7, C8, C9 | ~3 days |
| 14 | Provider hygiene: cost telemetry, response caching, `Retry-After`, base-URL parity, current model defaults | A8 | ~2 days |
| 15 | Mobile CPU throttling; pre-interaction context snapshot; INP finalization + safe interactions | B8, B9, B12 | ~2 days |

### Suggested sequencing

Week 1: items 1–4 (everything above them is built on sand until these land).
Week 2–3: items 5–9 — this is where finding *specificity* improves most; attribution data (item 5) alone upgrades three agents from speculation to measurement.
Week 4+: items 10–15 — these institutionalize quality (evals, grounding, telemetry) so future prompt/model changes are measurable rather than vibes.

---

## What "closed loop" should look like when done

```
identify:  audit (rules + AI on attributed signals, grounded output)
              │  finding + structural fingerprint (e.g. "img#hero lacks fetchpriority")
fix:       ranked-context patch generation → git commit per attempt
              │  patch + expected structural change + expected metric delta
validate:  1. structural check (attribute/tag present in live DOM)
           2. rebuild-settled re-measure, ≥5 runs, median, noise floors
           3. target metric improved beyond floor AND no other metric regressed
              │  pass → keep commit, record in run artifact
              │  fail → git rollback, add to attempted-ledger, next finding
```

Every piece of this loop exists in the codebase today in partial form; the roadmap above is about making each stage trustworthy enough that the loop can run unattended.
