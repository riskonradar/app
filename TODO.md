# Risk on Radar - Delivery Status

Updated 2026-07-17 after the production-readiness implementation and audit.

This file records what is implemented in the repository and what still requires a human,
paid account, production secret, or engineering judgment. A checked item means code and
tests exist; it does not claim that an external service has been configured or deployed.

## Implemented

### Security and tenancy

- [x] All knowledge, FMEA, system, account, billing, and admin routes require Clerk auth.
- [x] Service-role database access stays server-side and every product query is scoped to
      the resolved personal or organization workspace.
- [x] Owner/admin/member mutation permissions are enforced consistently.
- [x] `/admin` is bookmark-only, middleware-protected, and hard-gated by `ADMIN_EMAILS` with
      `notFound()` for no user or a non-admin email.
- [x] Localhost billing bypasses and committed Clerk development keys are removed.
- [x] Account synchronization no longer overwrites Stripe-owned plan and seat state.
- [x] Security-definer functions have explicit search paths, role checks, revokes, and grants.
- [x] The pipeline has a dedicated least-privilege database runtime role.

### Evidence and FMEA product loop

- [x] `/fmea` opens on live taxonomy-aware evidence search, not bundled demo data.
- [x] Component and failure-mode search share deterministic taxonomy matching and expose
      unresolved labels through the taxonomy inbox.
- [x] Exact source spans, offsets, DOI/source metadata, confidence, support type, and review
      state are visible in an evidence drawer.
- [x] Severity, occurrence, and detection are explicit engineer inputs with reference guides;
      heuristic values are suggestions only.
- [x] Saves are transactional, workspace-scoped, and preserve field-level claim lineage plus
      review/audit events.
- [x] CSV/XLSX exports include traceability without spreadsheet-formula injection.
- [x] The previous monolithic worksheet is split into typed helpers and focused components.
- [x] Removed/retracted sources are excluded from active search, lineage, and reasoning.

### Shared taxonomy

- [x] Hierarchical component and failure-mode taxonomies use exact, alias, trigram-fuzzy, and
      inbox fallback linking after every classification batch and through `link-taxonomy`.
- [x] Analysis-method and application taxonomies use the same schema, linker, inbox, and
      backfill pattern.
- [x] Keyword fallback loads the canonical database taxonomies once per batch instead of
      maintaining duplicate Python vocabularies.
- [x] Specific LLM phrases are stored without destructive pre-normalization.
- [x] Cause, effect, control, corrective-action, operating-context, material, and environment
      remain open evidence text. The audited corpus does not support a useful closed tree.
- [x] Detection/inspection vocabulary remains a future narrow taxonomy only if more data
      demonstrates stable clustering; it is not forced into the current release.

### Pipeline reliability

- [x] OpenAlex is the only routine discovery API; inserts are concurrency-safe.
- [x] Incremental discovery never globally marks unseen corpus, EASA, or old papers stale.
- [x] OA URLs, citation counts, and bounded licensed full-text ingestion are implemented.
- [x] PDF downloads reject private-network/unsafe redirects and pin validated public peers;
      parsing runs in a resource-limited subprocess under a hardened systemd unit.
- [x] Completed classifier jobs are immutable and idempotent; retry attempts cannot delete
      accepted or cited evidence.
- [x] Keyword diagnostics cannot supersede LLM evidence or masquerade as an LLM job.
- [x] Failed classification attempts have a three-attempt terminal cutoff.
- [x] Discovery, classifier, and full-text services support Healthchecks-compatible start,
      success, and failure signals.
- [x] A fixed-sample evaluation harness, schemas, fixtures, comparison metrics, and report
      command exist for model/prompt selection.
- [x] The legacy `knowledge.paper_classifications`, duplicate classifier dictionaries,
      prototype exporters, and turbofan-only serving RPC are retired.

### Commercial layer

- [x] Personal and Clerk organization workspaces have membership UI, invitations, roles,
      audit events, and seat enforcement.
- [x] Stripe checkout is subscription-only and enforces Individual = personal workspace and
      Team = organization workspace.
- [x] Team billing uses one base item for three included seats plus a separate extra-seat item.
- [x] Checkout/customer creation is serialized and idempotent; one billing customer and one
      non-terminal subscription are allowed per workspace.
- [x] Webhooks are signed, retry-safe, recover failed processing, fetch current subscription
      state, and derive entitlements only from configured Stripe price IDs.
- [x] Seat limits synchronize to Clerk from valid Stripe subscription state.
- [x] Customer Portal access is owner-only and live mode requires a configuration that
      disables unsafe plan/quantity changes.
- [x] Stripe Tax is required before live checkout; billing lifecycle and dunning states are
      shown in the product.

### System-level analysis

- [x] `/systems` supports tenant-defined assets, component hierarchies linked to taxonomy,
      dependencies, reviewed propagation edges, conservative cascade paths, and audit history.
- [x] Aggregate system reasoning is preview-first and requires an explicit execute command.
- [x] Reasoning inputs are a bounded accepted-relationship closure rooted in asset components,
      not all claims from a relevant paper.
- [x] Reasoning outputs are strict-schema, lineage-checked, review-only suggestions and never
      mutate accepted FMEA or system truth automatically.
- [x] Reasoning jobs are idempotent and leased so crashed workers can be reclaimed safely.

### Internal operations

- [x] `/admin` shows pipeline totals, status breakdowns, latest discovery, failed/stuck jobs,
      7/30-day evidence growth, paginated papers, and unresolved taxonomy labels.
- [x] The product UI uses a light, restrained engineering-workspace theme with risk colors
      reserved for actual risk semantics.
- [x] Example environment files list every required integration variable without real secrets.
- [x] Repository documentation no longer hard-codes mutable corpus counts or claims an
      unverified production model/deployment state.

## Human and external steps before a paid pilot

These cannot be completed safely from source code. Do them in this order.

1. [ ] Review this branch, the database migration dry run, and the verification results; then
       merge through a pull request rather than pushing directly to `main`.
2. [ ] Create production Clerk configuration: production instance, sign-in methods,
       Organizations enabled, webhook endpoint/signing secret, and deployed production keys.
3. [ ] Set `ADMIN_EMAILS` as a real deployment secret containing the two founder emails.
4. [ ] Register the Dutch company and obtain its KvK and VAT details before enabling live
       payments or displaying a live iDEAL checkout.
5. [ ] Create Stripe products/prices matching the code exactly: Individual EUR 49/month;
       Team base EUR 399/month including three seats; Team extra seat EUR 99/month.
6. [ ] Configure Stripe Tax, EU VAT/tax-ID collection, a signed webhook endpoint, dunning,
       and a dedicated Customer Portal configuration with subscription plan/quantity updates
       disabled. Store only the resulting IDs and secrets in the deployment secret manager.
7. [ ] Upgrade Supabase to Pro before relying on it for a paid production workload.
8. [ ] Create three Healthchecks.io checks and set `DISCOVERY_HEALTHCHECK_URL`,
       `CLASSIFIER_HEALTHCHECK_URL`, and `FULL_TEXT_HEALTHCHECK_URL` on the pipeline host.
9. [x] After applying the migrations, generate a strong password for the NOLOGIN
       `riskonradar_pipeline` role, enable LOGIN in the Supabase SQL editor, and replace the
       stale droplet `DATABASE_URL` with that role's session-pooler URL. Never put the
       password in this repository or a shell transcript.
10. [ ] Deploy the reviewed service snapshot and systemd units to `/opt/riskonradar`, enable
        the discovery/full-text timers, run the taxonomy and OA backfills, and inspect logs.
        Snapshot/unit deployment, timers, database connectivity, and taxonomy linking are
        verified. The OA run now requires a free `OPENALEX_API_KEY`; the anonymous daily
        allowance was exhausted and the retry loop was stopped.
11. [ ] Hand-label roughly 50 representative papers in the evaluation annotation file, run
       the candidate-model comparison, review errors with both founders, and select the
       production extraction model. Do not start continuous classification before this.
12. [ ] Perform a real test-mode Stripe checkout, renewal/update, failed-payment recovery,
        cancellation, seat-change, and webhook-retry test with a Clerk organization.
13. [ ] Complete the customer-facing pilot contract pack: mutual NDA where needed, pilot
        agreement/SOW, DPA, privacy notice, security schedule, subprocessor list, and agreed
        liability cap backed by professional-indemnity and cyber-insurance quotes.

## Deliberate product decisions

- [x] Browser application only; no desktop build.
- [x] Clerk remains the identity and organization system.
- [x] Supabase Postgres remains the application and knowledge database.
- [x] The app is an engineering copilot. Machine claims stay unverified until an engineer
      accepts them in a taxonomy, FMEA, or system-review workflow.
- [x] No forced cause/effect/control taxonomy.
- [x] No real-time dashboard, admin write controls, or bespoke authorization framework.
- [ ] Founders must approve final pricing before live activation.
- [ ] Customer discovery must determine whether 8D, RCA, FMECA, RCM, or additional export
      formats come next.
- [ ] Elsevier or another publisher TDM agreement is a later commercial decision; ordinary
      human subscription access is not treated as machine-processing permission.

## Release commands

Run only after review and with production credentials supplied out of band:

```sh
supabase migration list --linked
supabase db push --linked --dry-run --include-all
supabase db push --linked --include-all

cd services/paper-classifier
paper-classifier link-taxonomy

cd ../paper-discovery
paper-discovery --backfill-oa --limit 15000
```

Deploy the versioned units from `services/deploy/systemd/`, enable the discovery and
full-text timers, and keep the continuous classifier stopped until the human evaluation and
model choice are complete.
