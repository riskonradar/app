# Risk on Radar codebase audit

Date: 18 July 2026
Audited baseline: `fbac3da` on `feat/extend-evidence-taxonomies`
Verdict: **not ready for a paid or confidential-data pilot**

This audit covers the authenticated product app, pipeline services, Supabase migrations,
deployment configuration, automated tests, and the current release workflow. The frontend
received the deepest review using the repository's Impeccable product register and its stated
WCAG 2.1 AAA target.

## Anti-pattern verdict

**Pass, with local exceptions.** The static Impeccable detector returned no generic design-slop
findings. The restrained engineering-workspace direction, compact radii, semantic risk colors,
and dense data surfaces are appropriate for the product. The main visual tells to remove are
the repeated tiny uppercase `metric-label` treatment and the custom WebKit scrollbar. Neither
is a release blocker; the functional and integrity issues below are much more important.

## Executive summary

The architecture is materially stronger than the release state. Tenant checks, transactional
FMEA saves, evidence spans, formula-safe exports, webhook signatures, migration discipline,
and pipeline safety all have good foundations. Lint, the production build, all 65 web tests,
all 23 discovery tests, and all 59 classifier tests pass.

That green baseline currently hides two critical FMEA integrity failures:

1. A failed saved-analysis load can leave an empty worksheet attached to the real analysis ID;
   saving it supersedes the saved rows.
2. Editing an accepted row preserves its accepted state and old evidence, so an export can imply
   that a source supports engineer-rewritten text when it does not.

The frontend also fails its own accessibility target. Core mobile navigation disappears,
worksheet Tab handling creates a keyboard trap, dialogs claim modality without implementing it,
and row selection is pointer-only. The final-export path admits unreviewed, rejected, and
incomplete rows. These are workflow failures, not polish preferences.

## Impeccable frontend score

| Dimension | Score | Primary reason |
|---|---:|---|
| Accessibility | 1/4 | Keyboard trap, false-modal dialogs, pointer-only selection, missing associations and labels |
| Performance | 2/4 | Heavy common Clerk bundle, stale JSON bundled into FMEA, repeated table work, request fan-out |
| Responsive behavior | 1/4 | Primary navigation disappears at 820px and the cell editor overflows narrow screens |
| Theming | 2/4 | Good token base, but verified AA/AAA contrast failures and hard-coded state tints |
| Anti-patterns | 3/4 | Purposeful engineering UI; only a few repeated SaaS-style treatments remain |
| **Total** | **9/20** | Major functional gaps block release |

Severity used below:

- **P0**: data loss, false engineering provenance, or an immediate security/release stop.
- **P1**: blocks a core workflow, accessibility level A/AA, or safe production operation.
- **P2**: important reliability, performance, maintainability, or recovery gap.
- **P3**: cleanup or low-risk hardening.

## P0 release blockers

### P0.1 — Failed analysis loading can erase saved rows

`apps/web/src/app/fmea/page.tsx:172` assigns `currentAnalysisId` and opens the table before the
GET succeeds. On failure, the ID remains attached to an empty worksheet, and the Save action at
`apps/web/src/app/fmea/page.tsx:293` remains available. The transaction at
`supabase/migrations/20260717160000_transactional_fmea_saves.sql:544` supersedes every existing
row omitted from the submitted array.

Impact: a transient network/API error followed by Save can effectively erase a saved analysis.

Recommendation: assign the analysis ID only after a successful response, model loading failure
as a distinct non-saveable state, and add a regression test that proves a failed load cannot
submit or supersede rows.

### P0.2 — Editing accepted content preserves stale acceptance and evidence

`apps/web/src/app/fmea/page.tsx:411` merges field edits without changing review state or
invalidating field lineage. `apps/web/src/lib/fmea/types.ts:72` does not expose the database's
`edited` state. `apps/web/src/lib/fmea/export.ts:53` then exports rewritten values beside the old
claim IDs, spans, and confidence.

Impact: the product can produce an apparently accepted, evidence-backed engineering row whose
displayed wording is no longer supported by its cited evidence.

Recommendation: preserve model suggestion and engineer override separately per field. Any edit
to accepted content must transition the row to `edited` or `needs_review`, preserve an audit
event, and require re-acceptance. Export lineage must identify which fields remain source-backed.

## P1 frontend and product-workflow findings

### P1.1 — Final export is not a final, reviewed artifact

New evidence and manual rows default to `needs_review` and `included: true` at
`apps/web/src/lib/fmea/worksheet.ts:167` and `:244`. Export eligibility at
`apps/web/src/app/fmea/page.tsx:146` checks only whether any row is included. Rejected and
incomplete rows are not excluded, while `apps/web/src/lib/fmea/export.ts:4` omits row status,
reviewer, review timestamp, classifier version, and whether an output is a draft.

Recommendation: make final export accepted-only; offer a clearly marked draft export for other
states; automatically exclude rejected rows; and include review/model lineage columns.

### P1.2 — The worksheet traps keyboard focus

`apps/web/src/app/fmea/page.tsx:437` prevents every Tab/Shift+Tab and clamps navigation to the
first or last cell. Focus cannot leave the table normally. Pagination makes the issue worse
because `visibleRows` includes rows not rendered on the current page, so the target ref may not
exist.

Standard: WCAG 2.1 SC 2.1.2, No Keyboard Trap.

Recommendation: preserve native Tab order at table boundaries, navigate only among rendered
cells, and cover first/last cell plus pagination in a browser test.

### P1.3 — Dialogs claim modality without modal behavior

The evidence drawer, help dialog, unsaved-changes dialog, and cell editor use
`aria-modal="true"` at `apps/web/src/components/fmea/evidence-drawer.tsx:44`,
`apps/web/src/components/fmea/worksheet-help-dialog.tsx:52`, and
`apps/web/src/app/fmea/page.tsx:1559`, but do not consistently move focus in, contain focus,
make the background inert, or restore focus to the trigger.

Standard: WCAG 2.1 SC 2.4.3 and the WAI-ARIA modal-dialog pattern.

Recommendation: use one tested dialog primitive for every modal flow.

### P1.4 — Mobile and zoomed users lose primary navigation

All internal destinations live in `.nav-link` elements at
`apps/web/src/components/app-nav.tsx:25`. At 820px and below,
`apps/web/src/app/globals.css:3755` hides all of them and provides no menu. The remaining
wordmark links to the external marketing site.

Standard: WCAG 2.1 SC 1.4.10, Reflow, because functionality is lost.

Recommendation: add a keyboard-accessible mobile navigation disclosure and an active-route
state. The product wordmark should default to the product dashboard, with the public site as an
explicit external link.

### P1.5 — Core worksheet selection is pointer-only

`apps/web/src/app/fmea/page.tsx:1483` puts selection on a non-focusable table row `onClick`.
There is no keyboard handler, selection checkbox, or `aria-selected`. Assistive technology
cannot operate or identify individual batch selection.

Recommendation: add an explicit selection column with native checkboxes and a visible batch
action toolbar.

### P1.6 — Global shortcuts override normal editing

The document handler at `apps/web/src/app/fmea/page.tsx:371` always prevents Cmd/Ctrl+A and
selects worksheet rows, even when focus is in a text field. Cmd/Ctrl+D similarly overrides a
standard browser shortcut.

Recommendation: scope shortcuts to the worksheet when focus is not in an editable control, and
avoid browser-reserved combinations.

### P1.7 — Unsaved work is guarded on only one exit path

`apps/web/src/app/fmea/page.tsx:669` protects the bespoke Dashboard button. App navigation,
browser close/back, knowledge search, BOM import, template loading, and opening another analysis
can replace current work without the same save/discard/cancel decision.

Recommendation: centralize dirty-state guarding for every destructive transition and add a
`beforeunload` fallback.

### P1.8 — Manual worksheets fabricate engineering content

`apps/web/src/lib/fmea/worksheet.ts:244` creates one row per component with placeholder function,
requirement, industry, and a rotated generic control such as visual inspection or vibration
monitoring. The rows are immediately included in export even though they have no evidence.

Recommendation: start manual engineering fields blank, or mark them explicitly as unconfirmed
suggestions and exclude them from final export until reviewed.

### P1.9 — Cross-domain evidence is merged without adaptation context

The frontend does not send the API's domain filter at `apps/web/src/app/fmea/page.tsx:537`.
`apps/web/src/lib/fmea/worksheet.ts:106` then merges causes, effects, and controls using only
component and failure-mode keys. Source operating context can disappear into a combined row.

Recommendation: preserve source-domain contributions separately, expose operating context, and
require an engineer-authored adaptation rationale before transferring evidence across domains.

### P1.10 — Evidence review is display-only

The evidence drawer at `apps/web/src/components/fmea/evidence-drawer.tsx:27` has no accept, edit,
reject, or annotate action. `apps/web/src/app/api/knowledge/review/route.ts:9` exists but has no
frontend caller. Inference rationale and runtime model metadata are not shown.

Recommendation: add organization-scoped claim review controls and show inference rationale,
model/version, review history, and how each claim contributes to each FMEA field.

### P1.11 — The worksheet table loses component relationships for screen readers

The real component column is filtered out at `apps/web/src/app/fmea/page.tsx:1442`; component
groups are full-width data cells rather than rowgroup headers, and child cells are not associated
with a component header.

Standard: WCAG 2.1 SC 1.3.1, Info and Relationships.

Recommendation: use semantic row groups/headers or retain a properly scoped component header.

### P1.12 — Form semantics and route identity are incomplete

The cell-editor textarea at `apps/web/src/app/fmea/page.tsx:1605` has no accessible label.
Review-state options at `:950` expose only `!`, `✓`, and `×`. Every route inherits the generic
document title from `apps/web/src/app/layout.tsx:5`.

Recommendation: label the editor, give options full accessible text, and provide per-route
metadata titles.

### P1.13 — Verified contrast failures contradict the AAA product target

Accent text `#0b7a8c` on accent-subtle `#e2f0f2` is about 4.30:1 and drops lower on the deeper
surfaces; small worksheet headers therefore miss AA. Dimmed table cells at
`apps/web/src/app/globals.css:1820` fall to roughly 3.1:1. White on the primary accent is 5.03:1,
which passes AA but not the declared 7:1 AAA target for normal text.

Recommendation: define tested semantic foreground/background pairs and enforce them with an
automated contrast check. Do not use opacity to dim essential table context.

### P1.14 — Account failures are presented as valid account truth

When workspace or billing reads fail, `apps/web/src/app/account/page.tsx:15` falls back to a
Personal, Free, Owner, one-member account. This can misstate authorization and billing during an
outage.

Recommendation: show a partial/unavailable state with retry. Never fabricate commercial state.

## P2 frontend findings

### Performance and bundle size

- A production Pricing response referenced about 361 KB gzip of initial JavaScript. The global
  `AppAuthProvider` in `apps/web/src/app/layout.tsx:22` makes Clerk client code common to every
  route; its main chunk was about 163 KB gzip.
- `apps/web/src/lib/fmea/worksheet.ts:1` imports a roughly 205 KB historical FMEA JSON file only
  to read its component names. The complete snapshot is present in the FMEA client chunk.
- FMEA columns are rebuilt on every render at `apps/web/src/app/fmea/page.tsx:815`; each displayed
  row scans the table row model at `:1490`; and the `rows` effect at `:220` re-expands every
  component after ordinary edits.
- Loading the turbofan template performs one concurrent request per component through the
  unbounded `Promise.all` at `apps/web/src/app/fmea/page.tsx:556`.
- Google Fonts is loaded through a render-blocking CSS `@import` at
  `apps/web/src/app/globals.css:1`, contradicting `apps/web/README.md:120`.
- Permanent `will-change: transform` is applied broadly at
  `apps/web/src/app/globals.css:1677`, potentially promoting many dense-table controls.

### Responsive and interaction gaps

- The cell editor's `min-width: 400px` at `apps/web/src/app/globals.css:2200` necessarily
  overflows its padded dialog on a 360px viewport.
- Many controls miss the stated AAA 44-by-44 target: 34px small buttons, a 13px FMEA checkbox,
  16px header-help controls, 28px pagination controls, and a 36px dialog close button.
- The export popup declares menu semantics without a complete menu-button interaction model at
  `apps/web/src/app/fmea/page.tsx:1215`.
- Payment and checkout status changes are not live-announced, and billing return polling at
  `apps/web/src/app/billing/return/page.tsx:64` has no attempt limit or manual recovery state.
- The app has no route-level `loading.tsx`, `error.tsx`, or product `not-found.tsx` boundaries.

### Workflow completeness

- Search stops at 100 claims and discards the returned `hasNext` metadata, which can imply that a
  generated worksheet is complete.
- Engineers cannot add a second failure-mode row for an existing component or directly add,
  duplicate, and delete individual rows.
- System propagation review does not show enough evidence, rationale, source, or trigger context
  before Accept/Reject.
- System audit history fetches 100 events across all assets before the client filters to one;
  events for a busy asset can disappear from the visible history.
- Assets, instances, dependencies, and propagation rules can be created/deleted but not edited.

### Regression coverage

The 65 passing web tests do not include an end-to-end browser suite, axe/pa11y checks, visual
regression, mobile viewport assertions, text-zoom/reflow checks, or keyboard traversal tests.
That is why the navigation loss, keyboard trap, dialog behavior, and overflow all pass CI.
Several files named as integration tests also assert against source-code strings rather than
executing authenticated API and database behavior, including
`apps/web/test/production-hardening.integration.test.tsx:147`.

## Backend, data, and release engineering findings

### P1 — A worktree-only auth regression must not be committed

At audit time, `apps/web/src/proxy.ts:19` had a pre-existing uncommitted change that skips all
middleware protection whenever the public Clerk key is absent. The committed `fbac3da` version
always calls `auth.protect()` for product routes. API handlers still perform their own workspace
checks, so no direct tenant-data disclosure was demonstrated, but the modified behavior is
fail-open and contradicts the repository's release contract.

Recommendation: do not commit that change. Keep production auth fail-closed and solve local
build ergonomics without weakening the route boundary.

### P1 — FMEA saves have no request or transaction-size bounds

`apps/web/src/lib/fmea/server.ts:253` accepts an unlimited row array, analysis name, field text,
and evidence payload before invoking the service-role save function. The RPC at
`supabase/migrations/20260717160000_transactional_fmea_saves.sql:210` verifies only that rows are
an array, then validates and writes every row and lineage record, snapshots every mutation, and
scans omitted rows for supersession.

Impact: any authenticated member can create an arbitrarily large database transaction and audit
trail, causing avoidable database load, timeouts, and storage growth.

Recommendation: enforce request-body, row-count, field-length, and evidence-count limits in the
API and RPC. Add per-workspace rate limits, a database statement timeout, and boundary tests.

### P1 — Membership bootstrap can undo a Clerk deletion webhook

Every authenticated workspace resolution unconditionally upserts the current organization
membership as `status='active'` at `apps/web/src/lib/account/server.ts:121`. The Clerk deletion
webhook only marks the mirrored row removed at
`apps/web/src/app/api/webhooks/clerk/route.ts:216`. A stale or in-flight token can therefore race
the webhook and reactivate the local membership. Membership webhooks also return success without
persisting anything when their organization or user mirror has not arrived yet at
`apps/web/src/app/api/webhooks/clerk/route.ts:110`.

Impact: when Clerk-to-Supabase organization access is enabled, webhook ordering or token races can
restore tenant access that should have been revoked.

Recommendation: make authoritative webhook state monotonic and replayable. Request-time bootstrap
must not change a removed membership without a fresh Clerk Backend API verification, and
out-of-order events need retry/deferred reconciliation.

### P1 — Main deploys without a verification gate

`.github/workflows/deploy.yml:30` builds and deploys on every push to `main`, but does not run web
lint/tests, either Python service suite, migration checks, dependency audit, or an environment
preflight. There is no PR validation workflow or deploy concurrency control, and third-party
actions are referenced by floating major tags rather than immutable commit SHAs.

Recommendation: add a required CI workflow; make deployment depend on it; use a deployment
environment with approval and concurrency; and verify required runtime secret names before
publishing.

### P1 — Python production dependencies are not reproducible

Both service `pyproject.toml` files specify only broad lower bounds, and there is no Python lock
or constraints file. Reinstalling the droplet environment can silently select different
`httpx`, `psycopg`, or `pypdf` versions.

Recommendation: generate and review a Python lock/constraints artifact, install from hashes in
deployment, and add a scheduled vulnerability scan.

### P1 — Pipeline services run as root by default

The discovery and classifier systemd units omit `User=` and `DynamicUser=`, so system units run
as root. They have only partial sandboxing at
`services/deploy/systemd/riskonradar-discovery.service:6` and
`services/deploy/systemd/riskonradar-classifier.service:8`. The full-text service demonstrates a
much stronger pattern with `DynamicUser`, `ProtectSystem=strict`, capability removal, and resource
limits.

Recommendation: apply a least-privilege service account or `DynamicUser` and compatible systemd
sandboxing to discovery/classification as well.

### P1 — Account/workspace deletion is documented but not implemented

The Clerk webhook handles membership deletion but not `user.deleted` or
`organization.deleted`, and the product has no account/workspace deletion endpoint. This does
not meet the repository's own retention schedule for account/workspace deletion.

Recommendation: implement a tested deletion/export workflow with explicit retention exceptions,
then run the documented customer data-export/deletion tabletop before a confidential pilot.

### P2 — Pipeline concurrency and transaction semantics can duplicate or partially apply work

- Classifier candidate selection at
  `services/paper-classifier/src/paper_classifier/repository.py:209` is a plain read. No lease or
  atomic claim exists before the paid LLM call at
  `services/paper-classifier/src/paper_classifier/main.py:391`; overlapping timer/manual runs can
  classify the same paper and pay twice before the later uniqueness check suppresses a duplicate
  write. Add an expiring database lease using an atomic claim/`SKIP LOCKED` pattern.
- Discovery connects with `autocommit=True` at
  `services/paper-discovery/src/paper_discovery/repository.py:35`, so its final `commit()` does not
  make the run atomic. A failed run can retain a partial set of candidate writes while the run is
  recorded as failed. Either transact bounded batches explicitly or expose partial progress as a
  first-class run state.

### P2 — Component taxonomy counts cross sibling path boundaries

`public.get_component_taxonomy` joins descendants with
`subtree.path LIKE c.path || '%'` at
`supabase/migrations/20260717140000_fix_remaining_stale_classifier_version_pins.sql:193`.
Because both `rotating-machinery/gear` and `rotating-machinery/gearbox` exist, Gear's displayed
linked-claim count includes Gearbox claims.

Recommendation: match exact path or `c.path || '/%'`, and add a sibling-prefix regression test.

### P2 — Local Supabase cannot reproduce the app's Data API contract

`supabase/config.toml:7` exposes only `public` and `graphql_public`, while runtime server code uses
`app`, `knowledge`, and `papers_raw`. Seed loading points at a missing `supabase/seed.sql`, and the
Clerk third-party auth block is disabled. Local resets therefore cannot exercise the hosted
schema/RLS/auth paths faithfully.

Recommendation: align the local exposed schemas and auth contract, add a minimal deterministic
seed, and run executable two-tenant, role, membership-deletion, and RLS tests against a reset DB.

### P2 — Current production dependency scan has one moderate advisory

`pnpm audit --prod --json` found one moderate advisory: PostCSS `<8.5.10`,
[GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93), pulled through
Next.js. The vulnerable pattern requires untrusted CSS to be parsed, stringified, and embedded;
that path was not found in this app, so exploitability appears low.

Recommendation: update the framework/transitive dependency when a compatible patched resolution
is available and retain the advisory scan in CI.

### P2 — Production hosting is not codified for the intended Railway migration

The repository contains a Cloudflare Workers deployment workflow and `wrangler.toml`, but no
Railway service definition, Dockerfile, start command, health endpoint, or environment contract.
The intended production domain and external Clerk/Stripe configuration remain human steps.

Recommendation: decide the hosting target before adding more platform-specific work. For
Railway, codify the web service, build/start commands, health check, domains, secrets, and a
rollback procedure in source control without committing secret values.

### P3 — Public integration status reveals configuration state

`apps/web/src/app/api/integrations/status/route.ts:8` is unprotected and reports whether Clerk,
Stripe, and Supabase credentials are configured. It exposes no values, but gives unnecessary
production reconnaissance.

Recommendation: restrict it to admin/local diagnostics or remove it from production.

### P3 — Package and documentation drift

- Both `pnpm-lock.yaml` and an incomplete npm `package-lock.json` are tracked despite pnpm being
  the declared package manager.
- The web README documents npm commands and says fonts do not fetch remotely, while the app uses
  a Google Fonts CSS import.
- `three`, `@types/three`, and about 3.8 MB of turbine/Draco/image assets have no source imports.

## Pipeline and OpenAlex quota decision

OpenAlex is used for two jobs only: discovering paper metadata/abstracts and enriching existing
DOIs with open-access/citation metadata. It is not the classifier and does not make engineering
claims.

The configured sweep is 17 journals by 28 search queries, or 476 OpenAlex search calls even when
the date filter returns few results. Current OpenAlex pricing gives anonymous access $0.10 of
daily usage and a free API key $1.00 daily. A direct search costs $0.001, so anonymous operation
fits about 100 searches per day while a free key fits about 1,000. The full sweep therefore costs
about $0.476 and fits comfortably inside one free-key day. Batched DOI filters are much cheaper
and already group up to 100 DOIs per request. See the
[OpenAlex authentication and pricing documentation](https://developers.openalex.org/api-reference/authentication).

Yes, anonymous operation is technically possible, but the current production CLI deliberately
requires `OPENALEX_API_KEY` at `services/paper-discovery/src/paper_discovery/main.py:92`. A safe
no-key design would need a persistent five-day shard/checkpoint, budget-header monitoring, and a
schedule that reserves capacity for DOI backfills. Simply slowing requests does not increase the
daily allowance.

**Recommendation:** keep the fail-fast behavior and use the free key. It is free, the whole sweep
fits within its daily allowance, and it is simpler and more observable than maintaining a
multi-day anonymous cursor.

## What Healthchecks is for

Healthchecks-compatible URLs are optional dead-man-switch monitoring for scheduled background
jobs. A service pings `/start`, success, or `/fail`; if an expected weekly ping never arrives,
the monitoring service alerts a human. It does not run the pipeline, store product data, or affect
results. The units already make monitoring failure non-fatal.

It is not a product release blocker for local/demo work. It becomes important once discovery and
full-text timers are expected to run unattended, because systemd logs alone do not proactively
tell anyone that a weekly job never ran. Any equivalent scheduler alerting can replace
Healthchecks.io.

## Strong foundations to preserve

- Web API mutations resolve Clerk identity/workspace and enforce role checks before service-role
  database access.
- FMEA saves are transactional and reconstruct authoritative evidence lineage server-side.
- Evidence spans retain exact text, offsets, support type, confidence, source, and claim ID.
- License-safe filtering is enforced, and CSV/XLSX export neutralizes spreadsheet formulas.
- Stripe and Clerk webhooks verify signatures; Stripe processing is retry-aware and idempotent.
- System cascades use accepted propagation edges only.
- The full-text downloader rejects unsafe/private targets, validates license/PDF constraints,
  runs parsing in a resource-limited subprocess, and has a hardened systemd sandbox.
- Discovery now batches DOI lookups, throttles requests, fails fast on exhausted daily allowance,
  and does not leak request secrets through errors.
- All local migrations match the linked production migration history.
- The UI has useful tokens, high-contrast body text, a global focus-visible treatment,
  reduced-motion handling, forced-colors support, and good evidence/error states in several
  focused components.

## Verification evidence

| Check | Result |
|---|---|
| `pnpm lint:web` | Pass |
| `pnpm test:web` | Pass — 65 tests across 8 files |
| `pnpm build:web` | Pass — all routes compiled and TypeScript passed |
| Discovery unit tests | Pass — 23 tests |
| Classifier unit tests | Pass — 59 tests |
| Impeccable static detector | Pass — no generic anti-pattern findings |
| Production dependency advisory scan | One moderate PostCSS advisory; no high/critical findings |
| Repository secret-pattern scan | No committed credential found |
| Supabase migration list | All 35 local migrations matched remote history |
| Supabase database lint | Not verified — linked lint stalled during connection initialization and was stopped |
| Live visual/browser pass | Not verified — no browser binding was available; responsive issues were verified from compiled output, DOM behavior, and CSS dimensions |

## Recommended release order

1. Fix both P0 FMEA integrity defects and add destructive-path regression tests.
2. Keep auth fail-closed; resolve the proxy change and membership-deletion reactivation race.
3. Bound FMEA request/transaction sizes and add abuse/concurrency tests.
4. Make final export accepted-only and implement edited-field lineage/re-review.
5. Fix keyboard trapping, dialogs, mobile navigation, row selection, labels, and AA contrast.
6. Centralize unsaved-change protection and explicit load/error/recovery states.
7. Remove fabricated manual engineering values and preserve operating-context boundaries.
8. Add claim review UI and complete the evidence-to-FMEA review loop.
9. Add required PR CI, browser accessibility/E2E tests, dependency scanning, and Python locking.
10. Add classifier leasing, explicit discovery transaction semantics, and sibling-path tests.
11. Harden discovery/classifier identities and configure scheduler alerting.
12. Codify Railway deployment, production domain, secrets, health checks, and rollback.
13. Complete the hand-labeled model evaluation before starting continuous classification.
14. Run a real Clerk organization plus Stripe test-mode lifecycle before any paid pilot.

## Recommended Impeccable follow-up passes

Ask for these as separate implementation passes, in this order:

1. `harden` the FMEA load/edit/review/export workflow.
2. `adapt` primary navigation, dialogs, and the worksheet for 320px, 375px, 768px, and 200% text.
3. `clarify` evidence review, draft/final export language, dirty state, and recovery messages.
4. `optimize` Clerk loading, FMEA data imports, table rendering, and request batching.
5. `distill` the 1,656-line FMEA page and 4,452-line global stylesheet into tested workflow
   components and scoped styles.
6. Re-run `audit` with a real signed-in browser session and automated axe/keyboard checks.
