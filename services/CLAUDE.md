# Risk on Radar Services Context

This file is a quick-start context document for agents working specifically in `services/`.

## Mental Model

The services build the living failure knowledge engine:

1. `paper-discovery` finds candidate papers.
2. Supabase stores raw candidates and queue state.
3. `paper-classifier` extracts reliability evidence.
4. The web app reads classified evidence for reviewable FMEA workflows.

The services should produce auditable evidence, not unreviewed engineering decisions.

## Non-Negotiables

- Preserve source provenance for every useful claim.
- Every extracted field needs either an evidence span or an explicit inference marker.
- Store inference separately from directly extracted facts.
- Keep raw paper data separate from classified knowledge.
- Do not hard-delete routine discovery results; use lifecycle state.
- Do not commit secrets, API keys, database URLs, or droplet env files.
- Do not present classifier output as validated engineering truth.

## Database Contract

Use Supabase Postgres. Pipeline services connect with `DATABASE_URL` or `SUPABASE_DB_URL`.

Important tables:

- `papers_raw.discovery_runs`
- `papers_raw.paper_candidates`
- `knowledge.classification_jobs`
- `knowledge.evidence_claims`
- `knowledge.evidence_spans`
- `knowledge.claim_relationships`

Always schema-qualify SQL. Do not assume product tables are in `public`.

## Queue Contract

The queue is `papers_raw.paper_candidates`.

Relevant fields:

- `classification_status`: coarse classifier queue state such as `pending`, `classified`, or `failed`.
- `lifecycle_status`: discovery lifecycle state.
- `canonical_doi`, `title_fingerprint`, `abstract_hash`: dedupe fields.
- `first_seen_at`, `last_seen_at`, `stale_at`, `removed_at`: lifecycle timestamps.
- `external_ids`, `discovery_score`, `discovery_metadata`: discovery metadata.

Lifecycle:

```text
discovered -> pending_classification -> classified -> stale -> removed
```

Classifier should skip `stale` and `removed` papers. Discovery can restore stale/removed papers if a trusted source sees them again.

## Discovery Details

`paper-discovery` is deliberately simple. It should:

- Search trusted sources.
- Fetch metadata only.
- Upsert candidates.
- Deduplicate.
- Update lifecycle timestamps.

It should not:

- Extract FMEA claims.
- Score severity/occurrence/detection.
- Validate engineering truth.
- Make frontend-facing recommendations.

Trusted journals live in `paper-discovery/data/journals.json`. Query packs live in `paper-discovery/data/queries.json`.

Queries are broad recall filters. They are not the source of truth for components or failures.

## Classifier Details

`paper-classifier` reads pending candidates and writes atomic evidence records.

The LLM prompt requires structured JSON. Direct claims are only acceptable when the supporting `evidence_text` appears in the source field. Inferred claims require supporting evidence and an inference rationale.

Production should prefer:

```sh
paper-classifier classify --extractor llm --limit 25 --mode incremental --watch --interval-seconds 300 --workers 1
```

Use `--extractor keyword` for tests and diagnostics. Be cautious with `--extractor auto`: it can fall back to keyword extraction when an LLM provider fails.

## DigitalOcean Bot Deployment

The current bot host is:

```text
164.92.153.187
```

Connect with:

```sh
ssh -i ~/.ssh/riskonradar_do_ed25519 root@164.92.153.187
```

Server layout:

```text
/opt/riskonradar                  repository snapshot
/opt/riskonradar/venv             Python virtualenv
/etc/riskonradar/pipeline.env     production env vars, not committed
```

Systemd units:

```sh
riskonradar-discovery.timer
riskonradar-discovery.service
riskonradar-classifier.service
```

Runtime checks:

```sh
systemctl status riskonradar-discovery.timer
systemctl status riskonradar-classifier.service
systemctl list-timers riskonradar-discovery.timer
journalctl -u riskonradar-discovery.service -n 100 --no-pager
journalctl -u riskonradar-classifier.service -n 100 --no-pager
```

Current schedule:

- Discovery runs weekly.
- Classifier polls every 5 minutes.
- Provider/model is an environment decision that must be verified from completed job metadata.
- Worker count is `1` to protect quota/cost.

Do not silently switch providers. Keep `--extractor llm` so failed LLM calls remain failed and
observable instead of being represented as another model's output.

## Changing Production

For service code changes:

1. Update local repo.
2. Run focused tests.
3. Copy changed service files to `/opt/riskonradar`.
4. Reinstall editable packages if package metadata changed.
5. Restart the affected systemd unit.
6. Check logs.

For database changes:

1. Add a Supabase migration.
2. Make migrations idempotent where practical.
3. Run `supabase migration list`.
4. Run `supabase db push`.
5. Verify schema/row state with explicit queries.

## Common Commands

Local tests:

```sh
cd services/paper-discovery
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src python3 -m unittest discover -s tests

cd services/paper-classifier
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src python3 -m unittest discover -s tests
```

Dry-run classifier database read:

```sh
paper-classifier classify --extractor keyword --limit 1 --mode incremental --dry-run --workers 1
```

Manual discovery run:

```sh
paper-discovery --limit 5 --since-days 30
```
