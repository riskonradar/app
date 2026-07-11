# Risk on Radar — Master TODO

High-level roadmap from the 2026-07-09 architecture review. Technical detail lives in the
review artifact; this file is the grand-scheme checklist.

## Decisions made

- [x] **Switch billing to Stripe Billing.** Blocked on business registration (KvK) — Stripe
      requires a registered entity to go live, and iDEAL scheme rules require the KvK number
      displayed on the site. App code now uses Stripe Checkout + Billing in test/live mode
      depending on the configured Stripe keys and Price IDs.
- [ ] **Keep Clerk for all auth** — personal accounts + organizations. The org schema and
      webhooks already exist in the codebase; what's missing is the org UI and role checks.
      Clerk free tier covers us for a long time (orgs included).
- [ ] **Stay on Supabase Postgres.** Move Free → Pro (~$25/mo) before launch: free projects
      pause after 1 week of inactivity and cap at 500 MB, both incompatible with a weekly
      pipeline and a growing corpus.
- [ ] **Standalone web app, no desktop build.** (Onshape is browser-based too.)
- [x] **Discovery: OpenAlex-only.** Crossref support removed from the codebase entirely
      (2026-07-10): abstract-less papers are unclassifiable, and OpenAlex ingests Crossref
      data with better abstract coverage. Weekly sweep is now 476 API calls (was 952).
      ⚠ On next droplet deploy, update the discovery systemd unit: drop `--source all`
      (the flag no longer exists and will error).
- [ ] **Full-text ingestion strategy.** Today we extract from abstracts only (~250 words).
      Step 1 (free, legal): OpenAlex exposes `open_access.oa_url` — fetch open-access PDFs
      (~40–50% of papers) and extract from full text. Step 2 (paid, later): Elsevier TDM
      (text-and-data-mining) commercial licence — 12 of our 17 journals are Elsevier, so one
      agreement covers most of the corpus. Subscriptions for humans ≠ TDM rights; we need
      the TDM licence specifically for machine processing.
- [ ] **Prompt experiments ride the eval harness.** Any prompt change = classifier version
      bump + run against the fixed eval sample (same harness as the model comparison in
      docs/model-selection.md). Never tweak the prompt blind.
- [ ] **Two-model pipeline (future, Phase 4).** Keep a cheap extractor model per paper;
      add a stronger reasoning model that works over the aggregated claims graph
      (system-level interactions, FMEA narrative) — per-corpus calls, not per-paper, so a
      big model is affordable there.
- [ ] **Use citation counts / citation graph.** OpenAlex returns `cited_by_count` and
      `referenced_works` per paper; we fetch neither. Step 1: add `cited_by_count` to the
      discovery `select`, store it, use it as a ranking/confidence signal. Step 2 (later):
      citation snowballing — walk references/citers of confirmed-relevant papers as a second
      discovery channel beyond keyword sweeps.

## Open decisions

- [ ] **Classifier LLM.** Production currently runs Gemini 2.5 Flash-Lite (GPT-5.4-nano is a
      configured alternative, not what's live). Cost is negligible on every candidate model
      (~€2–25 for a full 3.4k-corpus re-run), so decide on *quality*: build a ~50-paper
      hand-scored eval set and compare Flash-Lite vs GPT-5.4-nano vs Claude Haiku 4.5.
- [ ] **UI theme.** Light-first professional workspace (Onshape-like) vs current dark theme;
      pick a new restrained accent (drop the heavy orange); reserve red/amber/green strictly
      for risk semantics (severity / action priority) in an FMEA tool.
- [ ] **Knowledge API exposure.** The whole corpus is publicly dumpable via unauthenticated
      endpoints today. Decide: public marketing surface vs login-gated IP. Gate by default.
- [ ] **Pricing model** — with Mikhail (see agenda below).

## Done 2026-07-11 (classifier v3 + discovery — needs deploy)

- [x] Aviation/turbofan relevance gate removed from the LLM prompt (cross-domain unblocked).
- [x] Classifier failures persist: `failed` jobs with `last_error`, retry capped at 3
      attempts; abstract-less papers marked `skipped` (terminal) — no more infinite retries.
- [x] Re-classification supersedes old unreviewed claims instead of deleting them
      (review work and FMEA citations survive re-runs). Migration
      `20260711090000_exclude_superseded_claims.sql` updates the serving RPCs.
- [x] Relationship quotes are now span-verified like claim quotes (last hallucination
      door closed); span matching is whitespace-tolerant (recall win, guarantee intact).
- [x] Discovery `--since-days N`: incremental OpenAlex sweeps by publication date.
- [x] Classifier version bumped to `llm-extractor-v3`.
- [x] Relationship index-shift bug fixed (found by the model-selection analysis): edges
      referenced the LLM's original claim positions, but gates drop claims — edges could
      silently attach to the wrong claim. Indices now remap to surviving claims.
- [ ] Pre-eval code fixes from docs/model-selection.md: pin the Gemini model (the
      `gemini-flash-latest` floating alias is baked into the audited classifier_version),
      repair the Anthropic caller (max_tokens 1800 → 4096 + forced JSON), move OpenAI to
      strict json_schema, add label-free eval counters to `_result_from_payload`.

⚠ **Deploy checklist (in this order):**
1. `supabase db push` (superseded-claims migration BEFORE the classifier redeploy).
2. Deploy classifier to droplet; v3 will re-classify the whole corpus (~€2 Gemini).
3. Update discovery systemd unit: drop `--source all`, add `--since-days 30`.
4. Pin the model in `/etc/riskonradar/pipeline.env`: `GEMINI_MODEL=gemini-2.5-flash-lite`
   (the deployed `gemini-flash-latest` is a floating alias baked into the audited
   classifier version string).
5. One-time: run `paper-discovery --backfill-oa --limit 4000` to annotate the whole
   corpus with open-access URLs + citation counts (~6 min, free) — tells us the real
   OA coverage % for the full-text plan.

## Phase 0 — Stop the bleeding (days)

- [ ] Fix the security holes (grouped; full list in review): unauthenticated write RPC on
      review state, open knowledge endpoints, permissive `USING (true)` RLS policies, no auth
      middleware in the web app, Clerk dev-instance key in production, localhost payment
      auto-success bypass.
- [ ] Classifier hygiene: persist failures (4 abstract-less papers currently retry every
      5 minutes forever); stop upserts clobbering user profiles and org plan fields on every
      request.
- [ ] Reproducibility: make `supabase db push` work on a fresh project (migration order bug,
      missing GRANTs); script the droplet deploy (currently manual scp).

## Phase 1 — Shared taxonomy (1–2 weeks) ← the core fix

- [ ] Wire in `knowledge.components` — a 38-node hierarchical taxonomy with aliases, fuzzy
      auto-linker, and subtree search already exists in the DB with **zero callers**.
      Backfill-link all ~15k existing claims (no LLM calls needed).
- [ ] Add `knowledge.failure_modes` with the same pattern (fatigue → LCF / HCF / fretting;
      corrosion → pitting / SCC / galvanic).
- [ ] Add a resolution step after LLM extraction: exact match → alias → fuzzy → human
      "taxonomy inbox" for unresolved labels. The taxonomy grows under human control.
- [ ] Delete the four duplicated vocabularies (two Python maps, exporter maps, inline SQL).
- [ ] Remove the hard-coded turbofan/aviation filter from the LLM prompt; replace the
      `%turbofan%` RPC with parameterized component/domain search.
- [ ] Reprocessing must supersede old claims, not delete them (today it destroys human
      review work and breaks on FMEA-cited claims).

## Phase 2 — Close the product loop (2–4 weeks)

- [ ] Real search UI against the knowledge base (today the default view renders a bundled
      static JSON snapshot; "search" filters already-loaded rows in the browser).
- [ ] Evidence drawer: exact spans with offsets, per-claim confidence, DOI citations —
      all already in the DB, never shown to the user.
- [ ] Severity/Occurrence/Detection become explicit engineer inputs with the reference
      tables alongside; current keyword heuristics demoted to clearly-marked suggestions.
- [ ] Write field-level evidence lineage and review audit trail on save; include claim IDs,
      spans, and confidence in exports.
- [ ] Split the 2,700-line worksheet component; make saves transactional.

## Phase 3 — Commercial layer (when we start selling)

- [ ] Org UX: Clerk Organizations components, member management, role enforcement on every
      mutation, seat limits (schema exists, code never checks roles).
- [ ] Stripe Billing: subscriptions (iDEAL first payment → SEPA Direct Debit recurring),
      Stripe Tax for EU VAT reverse-charge, invoices, dunning/downgrade, customer portal.

## Phase 4 — System-level analysis (whitepaper Phase 2)

- [ ] Tenant-defined system trees whose component instances reference taxonomy nodes;
      failure-propagation edges between instances; graph view. Designed to need zero
      `knowledge.*` schema changes if Phase 1 lands first.

## To discuss with co-founder

- [ ] **Manual review of every paper, or auto-publish?** Proposal: auto-publish extracted
      claims as "unverified — evidence-linked", human review happens (a) in a curation queue
      for the taxonomy inbox and low-confidence claims, and (b) at FMEA-build time where the
      engineer accepts/rejects rows anyway. Full manual review of 15k claims doesn't scale.
- [ ] **Analysis formats beyond FMEA:** 8D problem solving, root-cause analysis, FMECA,
      RCM worksheets; export templates per standard (AIAG-VDA form, ISO-style).
      Which do customers actually ask for? (market research input)
- [ ] **Pricing** — free tier scope, individual vs team price points, seat model.

## Expected monthly costs (sources + math in the review)

| Item                        | Now (building) | At launch |
|-----------------------------|----------------|-----------|
| Clerk (auth + orgs)         | €0             | €0–23     |
| Stripe                      | €0             | per-transaction only (~1.5% + €0.25 cards; iDEAL flat; +~0.7% Billing) |
| Supabase Postgres           | €0             | ~€23 (Pro $25) |
| Cloudflare Workers (web)    | €0             | ~€5       |
| DigitalOcean droplet (bots) | ~€6–11         | ~€6–11    |
| LLM — Gemini 2.5 Flash-Lite | ~€1–5          | ~€1–5     |
| **Total**                   | **~€10–15**    | **~€40–70** |
