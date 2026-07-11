# Paper-Classifier Model Selection

Status: proposal, July 2026. Applies to `services/paper-classifier` at classifier version
`llm-extractor-v3`. The incumbent (Gemini 2.5 Flash-Lite, temperature 0, forced JSON,
thinking disabled) was a hackathon-era cost pick and has never been evaluated against
alternatives. This document defines what "better" means for this task, how to measure it
without labels, how to validate the measurement once with a hand-scored gold set, and
which model to test first.

---

## 1. Task profile — what actually determines quality

One LLM call per paper: title + abstract in (~1.6k tokens), one JSON object out (~1k
tokens) with `relevance`, `confidence`, `claims[]` (13 types), `relationships[]` (8 typed
edges). Post-processing in `src/paper_classifier/llm.py` then gates the output. The gates
are **one-sided filters**: they can drop model output, never repair it. That single fact
shapes everything below.

### 1.1 JSON validity = paper-level success

`_parse_json_object` accepts one JSON object (markdown fences stripped). A parse failure
raises, retries up to 3× with backoff — but at temperature 0 the model will usually
reproduce the same broken output, so a parse failure is effectively a **paper-level
failure**. Providers differ materially in how hard they guarantee JSON (see §2); a model
that emits valid JSON 100% of the time removes an entire failure class.

### 1.2 The span gate: quote fidelity IS recall

Every claim's `evidence_text` must be found in the title or abstract by `_find_span`:
tokens split on whitespace, rejoined with `\s+`, matched case-insensitively
(`re.escape`d, so tokens must match **verbatim including punctuation**). v3 made the gate
whitespace-tolerant, so line-wrap and spacing drift no longer cost claims. What still
kills a claim, silently:

- any paraphrase, synonym substitution, or word reordering;
- "cleaning up" the quote — dropped commas, expanded abbreviations, normalized unicode
  (curly quotes → straight, en-dash → hyphen, ligatures — all common in publisher
  abstracts);
- eliding with `...` or stitching two sentences into one quote;
- quoting from the wrong field (`source_field` must name where the quote lives).

Consequence: **a model that paraphrases loses claims, and it loses them silently** — no
error, no retry, just a smaller knowledge base. Since v3 removed whitespace noise, the
span-gate survival rate is now a *clean* measurement of token-level quote fidelity. This
is a transcription-discipline skill, not a reasoning skill, and it is the single quality
axis that most plausibly separates a small model from a mid-tier one. (No public
benchmark isolates this axis — a search in July 2026 found verbatim-grounding work like
CogCanvas and copy-paste-style hallucination mitigation, but no small-vs-mid fidelity
comparison — which is exactly why the label-free proxy in §3 is worth running.)

### 1.3 v3: relationships now pass the same gate

`_relationship_from_payload` now requires `relationship_evidence_text` for every
`direct_span` relationship and verifies it through the same `_find_span` (against title,
then abstract), storing the source's own slice. Inferred relationships still require a
rationale. So **relationship recall is now quote-fidelity-bound too**: a model that
correctly identifies "fatigue → caused_by → cyclic loading" but paraphrases the
supporting sentence loses the edge.

### 1.4 The direction matrix — and a silent index-shift hazard

Relationships must satisfy `_relationship_direction_is_valid` (component
→`has_failure_mode`→ failure_mode; failure_mode →`caused_by`→ cause; etc.). Getting
subject/object typing right across 8 edge types × 13 claim types is the one genuinely
reasoning-flavored part of the task — the part most plausibly hurt by
`thinkingBudget: 0`.

There is a compounding hazard in the current code: relationship indices are validated
against the **filtered** claims list, but the model's `subject_claim_index` /
`object_claim_index` refer to its **original** claims array. Every claim dropped by the
span gate shifts all subsequent indices by one. A shifted relationship either fails the
direction matrix (dropped — visible) or lands on a *wrong claim whose type happens to
satisfy the matrix* (kept — **silently misattached evidence**, a provenance violation).
Two implications:

1. Span-gate survival is not just about claim count — it protects **relationship graph
   integrity**. A model at 95% survival corrupts far fewer edges than one at 75%.
2. Independent of model choice, `_result_from_payload` should build an
   original-index → filtered-index remap and drop any relationship that references a
   dropped claim. (~10 lines; recommended regardless of the outcome of this evaluation.)

### 1.5 Failure-mode canonicalization

`canonical_failure_mode_label` maps `normalized_value + raw_value` against ~26 canonical
mechanism labels; symptom-like labels (noise, generic vibration) drop the claim; anything
unmatched **passes through as free text** (note: the README says unmatched values are
dropped — the code keeps them). A model that uses the canonical vocabulary from the
prompt produces a cleaner taxonomy; hit rate against the canonical set is measurable for
free.

### 1.6 Everything else

Relevance triage (`not_relevant` rules for RUL-only and non-aero papers) is instruction
following. Latency is irrelevant (weekly discovery, 5-minute polling, batch re-runs), so
provider batch tiers are usable. Cost is nearly irrelevant (§2) — **quality is the only
criterion that matters.**

### What "the best model for this task" means

Maximize, in order: (1) valid-JSON rate → paper success; (2) claim span-gate survival ×
claims extracted → grounded claim recall; (3) relationship quote survival + direction
correctness → grounded edge recall and graph integrity; (4) canonical-label discipline
and relevance-rule compliance. This is an instruction-following + transcription-fidelity
profile with a light reasoning component — mid-tier non-reasoning-heavy models are the
sweet spot on priors; heavyweight reasoners buy little because the "reasoning" (direction
matrix, index bookkeeping) is shallow but the fidelity requirement is strict.

---

## 2. Candidate matrix

Volumes: 3,417 papers × (1.6k in + ~1.0k out) → **5.47M input / 3.42M output tokens per
full corpus re-run**; ~50–300 new papers/week (≤ 0.8M tokens). Prices are the verified
July-2026 numbers per 1M tokens (in/out). Reasoning-token output (OpenAI `gpt-5.4`
family, Gemini thinking) bills as output and can grow the output figure 1.5–2×; the range
below reflects that.

| Candidate | $/1M in/out | Full re-run (≈) | Structured-output mechanism | Expected strengths | Risks for this task | Code fix needed in `llm.py` |
|---|---|---|---|---|---|---|
| **Gemini 2.5 Flash-Lite** (incumbent) | 0.10 / 0.40 | **$1.9** (batch ~$1) | `responseMimeType: application/json` (syntax only, no schema) | Cheap, fast, JSON mode reliable | Bottom of capability range; paraphrase-prone on quotes; direction typing with thinking off; never evaluated | None (baseline). Pin the model — `gemini-flash-latest` is a floating alias baked into `classifier_version`, so an upstream swap changes behavior without a version bump |
| **Gemini 2.5 Flash** + thinking | 0.30 / 2.50 | **$10–19** (batch ~half) | Same as above; can add `responseSchema` for enum enforcement | Same caller and JSON path as prod → cleanest A/B; thinking should help direction matrix + index bookkeeping; strong long-instruction following | Thinking inflates output cost; dynamic thinking adds run-to-run variance at temp 0 | 1-line: drop `thinkingBudget: 0` (or set a modest budget, e.g. 1024); set `GEMINI_MODEL=gemini-2.5-flash` (pinned) |
| **gpt-5.4-nano** | 0.20 / 1.25 (cached in 0.02) | **$5–9** | Responses API `json_object` today; **`json_schema` strict available** — guarantees shape *and* enums | Strict schema zeroes parse-failure + enum-drop classes; cached input nearly free (prompt is ~1.1k static tokens) | Nano-tier quote fidelity is the open question; reasoning defaults unpinned in code (cost/behavior drift) | Switch `text.format` to `json_schema` + schema; pin `reasoning: {"effort": "low"}` |
| **gpt-5.4-mini** | 0.75 / 4.50 | **$19–30** (batch ~half) | Same — `json_schema` strict | Best structural guarantees + mid-tier fidelity; likely strongest recall-per-dollar challenger from OpenAI | Reasoning tokens inflate output; slower | Same two changes as nano |
| **Claude Haiku 4.5** | 1 / 5 | **$23** (Batches ~$11) | **None wired today** — prompt-only JSON | Anthropic small models are strong at verbatim extraction & instruction following; Batches API halves cost | **Caller is currently broken for this task**: `max_tokens: 1800` truncates claim-rich papers → parse fail → 3 retries → paper fails; no JSON forcing | **Mandatory:** `max_tokens` 1800 → 4096; add `output_config: {"format": {"type": "json_schema", "schema": ...}}` (GA on Haiku 4.5). Do *not* use assistant-prefill `{` — it 400s on Sonnet 4.6 and is the wrong pattern going forward |
| **Claude Sonnet 4.6** | 3 / 15 | **$68** (Batches ~$34) | Same `output_config.format` | Quality ceiling / calibration point: shows how much headroom the task has above small models | Overkill if the task saturates below it; priciest | Same fixes as Haiku |
| **Groq llama-3.3-70b** (free tier) | 0 | n/a — 100k tok/day ≈ 38 papers/day | OpenAI-compat `json_object` | Free pilot datapoint for open-weights | Cannot re-run the corpus (~90 days at free tier); weakest JSON discipline of the set | None (already rate-limited to ~17 papers/min in code) |

Cost bottom line: worst case is ~$68 full-price Sonnet, ~$34 batched; the weekly
increment is ≤ ~$6 even on Sonnet; a 50-paper eval run is **pennies on every provider**.
Cost cannot decide this — run the eval on all of them.

---

## 3. Label-free evaluation — measurable now, zero human labels

### 3.1 Protocol

Run the identical fixed sample through each provider with **no DB writes**:

```sh
cd services/paper-classifier
export LLM_PROVIDER=gemini GEMINI_MODEL=gemini-2.5-flash-lite   # swap per candidate
paper-classifier classify --extractor llm --dry-run \
  --limit 50 --classifier-version eval-2026-07 --workers 4
```

Why this yields the *same* 50 papers for every provider: `pending_candidates` treats a
paper as pending when no completed job exists for the given `classifier_version`. The
fresh `eval-2026-07` string has no completed jobs, so the queue returns the whole corpus
ordered by `publication_year DESC, created_at ASC` — a deterministic top-50, incumbent
included (its prod version string would otherwise exclude already-classified papers).
`--dry-run` short-circuits `save_classification` before any write, so runs are
repeatable. Two cautions: (a) run all providers back-to-back on the same day — the weekly
discovery run inserts newer papers and would shift the top-50; log the 50 paper IDs from
the first run and assert identity. (b) Check the sample's composition once (it should mix
corpus papers and EASA ADs; if it's all one publication year of journal papers, use
`--topic` filters or a second 50-paper slice to cover ADs).

### 3.2 Required instrumentation (small, one function)

Today the pipeline only prints *kept* counts; survival rates need denominators. Extend
`_result_from_payload` (and its two helpers) to count, per paper, into
`result.metadata`: `claims_returned`, drops by reason (`enum_invalid`,
`missing_fields`, `span_failed`, `rationale_missing`, `failure_mode_dropped`),
`relationships_returned`, drops by reason (`enum_invalid`, `index_invalid`,
`direction_invalid`, `quote_span_failed`, `rationale_missing`), plus per-claim
`support_type` and span lengths. ~20 lines, no behavior change; print the metadata dict
in the dry-run log line and scrape it. (On real runs this metadata already persists into
`knowledge.classification_jobs.classifier_metadata`, so the same counters become
permanent per-paper telemetry for free.)

### 3.3 Metrics

| # | Metric | Definition | What it detects |
|---|---|---|---|
| 1 | JSON paper-failure rate | papers failing all 3 parse attempts ÷ 50 (also log per-attempt) | Structural discipline; should be ~0 for schema-enforced providers |
| 2 | Enum validity | claims/relationships dropped for invalid `claim_type` / `relationship_type` / `support_type` ÷ returned | Schema drift; zeroed by strict `json_schema` |
| 3 | **Claim span-gate survival** | direct claims kept ÷ direct claims returned | **True token-level quote fidelity** (v3 already forgives whitespace) |
| 4 | **Relationship quote survival** (new, v3) | direct relationships passing `_find_span` ÷ direct relationships reaching that check | Quote fidelity on edge evidence |
| 5 | Relationship survival, by drop reason | kept ÷ returned, split index-invalid / direction-invalid / quote-failed | Direction-matrix competence vs index bookkeeping vs fidelity |
| 6 | Kept claims per paper | mean/median kept claims, and per-`claim_type` distribution | Extraction yield (recall lower bound) |
| 7 | Canonical failure-mode hit rate | kept failure_mode claims whose normalized value ∈ 26-label canonical set ÷ kept failure_mode claims | Taxonomy discipline (unmatched values pass through as free text) |
| 8 | Direct-claim share (guard) | `direct_span` ÷ kept claims | **Anti-gaming**: marking everything `inferred_from_span` dodges both quote gates; challenger must stay within ~5 pts of incumbent |
| 9 | Span-length sanity (guard) | median / p90 evidence-span characters | Quoting whole sentences trivially survives the gate but destroys atomicity |
| 10 | Relevance distribution | share relevant / possibly / not_relevant vs incumbent | Rule-following on the negative rules; big shifts need gold-set adjudication |

### 3.4 Why "span survival × claims/paper" is a strong quality proxy

The headline score is **metric 3 × metric 6** (and its edge analogue, 4 × kept
relationships/paper). It works because the gates are one-sided: nothing that survives can
be an ungrounded quote, so *every kept claim is verbatim-grounded by construction* —
grounding precision is ~1.0 for free, and kept-claims-per-paper is therefore a lower
bound on grounded recall. The two factors separate the two ways a model fails:

- **Timid but faithful** — extracts 4 claims, all survive: high survival, low yield.
- **Ambitious but paraphrasing** — extracts 12, 6 survive: high yield offered, low
  survival, and (per §1.4) a corrupted relationship graph.

The product punishes both, and the ratio isolates transcription fidelity from extraction
ambition, so it compares models with different verbosity fairly. Its blind spots are
exactly what the guards (8, 9) and the gold set (§4) cover: mislabeled claim types,
non-atomic mega-spans, wrong normalized values, silently misattached relationships, and
relevance errors — a verbatim quote can still support the wrong claim.

---

## 4. Gold-set design — validate the proxy once

A one-time, ~2–3 founder-day investment that converts the proxy from "plausible" to
"trusted for every future model/prompt bump."

**Sample (~50 papers, fixed forever, stored as IDs in the repo):** ~35 corpus papers
stratified across component families (bearings, blades, gears, pumps, welds, pipelines,
batteries, structural); ~10 EASA ADs; ~5 known-negatives (RUL/prognostics-only,
non-aviation wind turbine) to score relevance gating. Overlap with the §3 dry-run sample
where possible so proxy and gold numbers come from the same papers.

**What to label per paper (from title + abstract ONLY — the model's input):**

1. Relevance: relevant / possibly_relevant / not_relevant.
2. Exhaustive atomic claim list: `(claim_type, value, supporting sentence)` — every
   claim a careful reliability engineer would extract, one fact per row.
3. Relationship list: `(subject claim, relationship_type, object claim)` with correct
   direction per the §1.4 matrix.
4. For each failure mode: the correct canonical label from the 26-label set (or
   "no canonical fit").

**Scoring rubric:**

- **Claim recall** = gold claims matched ÷ gold claims; **claim precision** = model
  claims matched ÷ model kept claims. A match = same `claim_type` + values referring to
  the same entity/mechanism (semantic equivalence judged by the annotator:
  "fatigue crack initiation" ≈ "fatigue cracking"; "bearing" ≠ "bearing housing").
- **Relationship correctness** = edges where both endpoints match gold entities AND type
  AND direction ÷ gold edges (recall) and ÷ model kept edges (precision). This is the
  only place misattached-index edges become visible — score it strictly.
- **Normalized-value quality**, per claim: 0 = wrong/misleading, 1 = acceptable free
  text, 2 = correct canonical label. Report mean and the share of 2s for failure modes.
- **Relevance accuracy** against the 5 known-negatives and the labeled positives.

**Process:** two annotators label the same 25 papers first (~20–30 min/paper), measure
agreement, adjudicate disagreements into a labeling guide, then split the remaining 25.
Store gold labels as JSON keyed by paper ID next to this doc.

**Use:** score every candidate's §3 dry-run output against gold once. If model ranking by
proxy (span-survival × claims/paper) matches ranking by gold claim-F1 (Spearman ≥ 0.8
over the 4–6 candidates), the proxy is validated — future classifier-version bumps only
need the free dry-run. Re-validate only when the prompt or schema changes materially.

---

## 5. Recommendation

**Primary candidate: Gemini 2.5 Flash (pinned version, thinking enabled).** Reasons:

1. It is the *minimum-delta, maximum-hypothesis* test: same caller, same forced-JSON
   path, two config changes — so any proxy movement is attributable to model capability
   and thinking, not integration differences.
2. The two axes v3 made decisive — token-level quote fidelity and relationship
   typing/quoting — are the axes where Flash-Lite sits at the bottom of the candidate
   range, and where a mid-tier sibling most plausibly pays. Disabled thinking is most
   suspect precisely on the direction matrix + index bookkeeping (§1.4).
3. Worst-case cost delta is ~$17 per full re-run and ~$5/week incremental — noise.

**Run the whole slate anyway** — the eval costs pennies per provider: gpt-5.4-mini
(strict `json_schema`, `effort: low`) as the structural-guarantees challenger,
gpt-5.4-nano (cheapest strict-schema option), Claude Haiku 4.5 *after* the mandatory
caller fixes (`max_tokens` 4096 + `output_config.format`; today's caller fails
claim-rich papers by truncation at 1800 tokens, so any pre-fix Anthropic result is
invalid), and one Sonnet 4.6 run as the ceiling calibration: if Sonnet barely beats
Flash on the proxy, the task is saturated and the cheap model wins by default.

**Decision rule — switch production when a challenger, on the same 50-paper dry-run:**

1. JSON paper-failure rate ≤ incumbent (target 0);
2. direct-claim share ≥ incumbent − 5 pts and median span length ≤ 2× incumbent
   (anti-gaming guards);
3. **claim span-survival × kept-claims-per-paper improves ≥ 15%** over the incumbent;
4. relationship (quote-survival × kept-edges-per-paper) not worse than −5%.

Then: validate the winner once against the gold set (claim F1 and relationship F1 ≥
incumbent), bump `classifier_version`, full corpus re-run (≤ ~$35 worst case, batch
tier), and spot-review ~20 papers in the review UI before trusting the new version.

**Honest uncertainty.** It is genuinely possible Flash-Lite is already near-saturated:
abstracts are short, the prompt is heavily constrained, and v3's whitespace tolerance
removed the cheapest failure mode. If no challenger clears the +15% bar, the right
outcome is *keep Flash-Lite* and bank the code fixes instead. Second, thinking-enabled
runs may shift the relevance distribution (stricter application of the not_relevant
rules) — that shows up in metric 10 and needs gold-set adjudication, not a reflexive
revert. Third, the +15% threshold is a judgment call sized to exceed run-to-run noise on
50 papers; if two candidates land within ±5% of each other, prefer the one with strict
schema enforcement (fewer silent failure classes) and the lower operational delta.

### Do these regardless of model choice

1. **Fix the relationship index-shift bug** (§1.4): remap model indices to
   post-filter indices; drop edges referencing dropped claims. This is a live silent
   provenance corruption in prod.
2. **Pin model versions.** `gemini-flash-latest` inside `classifier_version` means the
   audited version string can point at different upstream models over time.
3. **Repair the Anthropic caller** (max_tokens, structured output) even if Anthropic
   isn't chosen — a wired-but-broken provider is worse than an absent one.
4. **Land the §3.2 instrumentation** — it doubles as permanent per-paper extraction
   telemetry via `classifier_metadata` on every real run.

---

*Search context (July 2026): no public benchmark isolates verbatim-quote fidelity by
model size; adjacent work includes [CogCanvas (verbatim-grounded extraction)](https://www.arxiv.org/pdf/2601.00821v2),
[copy-paste-style hallucination mitigation](https://arxiv.org/html/2510.00508v2), and
[medical-document IE benchmarking](https://www.medrxiv.org/content/10.64898/2026.01.19.26344287v1.full) —
none answer the small-vs-mid fidelity question for this pipeline, hence §3.*
