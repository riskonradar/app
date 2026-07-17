# Subprocessor List

Last reviewed: 17 July 2026

This is the working subprocessor list for Risk on Radar pilot readiness. Publish a customer-facing version on the website/app legal page before any confidential-data or paid pilot, and attach or link it from the DPA.

## Change Notice

Risk on Radar should give customers reasonable advance notice before adding or replacing subprocessors that process Customer Personal Data, unless urgent security, availability, or legal reasons require faster change.

Suggested notice period for early pilots: 14 days.

## Current Subprocessors

| Subprocessor | Purpose | Data categories | Location / transfer note | Status |
|---|---|---|---|---|
| Supabase | Hosted Postgres database and database APIs | Account records, workspace data, product data, customer pilot data if uploaded | Confirm region and transfer mechanism before confidential-data pilot | Active |
| Railway | Application/service hosting for web app and workers | Request data, logs, service environment metadata, customer pilot data processed by app | Confirm region and transfer mechanism before confidential-data pilot | Planned/active depending deployment |
| Clerk | Authentication and user/organization management | User names, emails, authentication identifiers, organization metadata | Confirm DPA and transfer mechanism | Active |
| Stripe | Payments and billing | Billing contacts, payment metadata, customer IDs, invoice/payment status | Payment processor; confirm Stripe DPA/terms | Active for paid plans |
| Google Workspace / Drive | Internal business documents and customer contract storage | Business emails, contracts, operational documents; customer data only if intentionally stored | Use restricted access; confirm workspace region/settings | Planned |
| Moneybird | Bookkeeping, invoicing, accounting records | Customer billing details, invoices, VAT/admin records | Planned after B.V./invoicing | Planned |
| SignRequest | Electronic signatures | Signatory names, emails, signed documents, audit trail | Planned for contracts/NDAs/DPAs | Planned |
| LLM provider: Gemini / OpenAI / Anthropic / other | AI extraction, classification, summarization, suggestions | Public/demo data by default; customer confidential data only if expressly permitted | Provider must be disclosed before customer data is sent | Conditional |

## Not Subprocessors

These may be vendors or tools but should not receive Customer Personal Data unless separately approved:
- GitHub: code repository and issue tracking only.
- Trello: task management only; do not put customer confidential data in cards.
- Personal messaging apps: coordination only; no customer confidential data.

## Customer-Facing Placement

Use all three placements:

1. Public page: `riskonradar.com/legal/subprocessors` or equivalent app legal page.
2. DPA: include this list as an appendix or link.
3. Internal source of truth: restricted company Drive folder with owner, update date, and approval history.

## Before Confidential Customer Data

- [ ] Confirm each active vendor has acceptable DPA/data protection terms.
- [ ] Confirm processing region and international transfer mechanism.
- [ ] Decide whether LLM providers are allowed for the pilot.
- [ ] Remove planned vendors that are not actually used.
- [ ] Publish the customer-facing list and freeze it for the pilot.
