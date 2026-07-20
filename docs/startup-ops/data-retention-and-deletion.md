# Data Retention And Deletion Schedule

Last reviewed: 17 July 2026

This is a practical starting schedule for pilots. It should be reviewed by counsel before paid pilots or pilots involving confidential customer data.

## Principles

- Keep personal data only as long as needed for the stated purpose.
- Keep business administration records for statutory periods where required.
- Delete or return customer pilot data at the end of the pilot unless a contract says otherwise.
- Do not keep customer confidential data in Git, personal chats, unmanaged local folders, or Trello cards.
- Backups may retain deleted data for a limited overwrite period; disclose this in the DPA/security schedule.

## Schedule

| Data category | Examples | Default retention | Deletion trigger | Notes |
|---|---|---:|---|---|
| Website/contact leads | Name, email, company, message | 24 months after last interaction | Deletion request or stale lead cleanup | Shorten if no business reason remains. |
| App user/account data | Name, email, auth IDs, workspace membership | Account lifetime plus 30 days | Account/workspace deletion | Some logs/admin records may remain longer for security/legal reasons. |
| Billing/accounting records | Invoices, payment status, VAT/admin records | 7 years | Statutory period expires | Align with Dutch business administration retention. |
| Customer pilot input data | Uploaded FMEA files, asset notes, incident reports, customer-provided evidence | Pilot term plus 30 days | Pilot end, unless converted or extended | Return/export before deletion if agreed. |
| Customer pilot output data | FMEA suggestions, review decisions, annotations, exports | Pilot term plus 30 days | Pilot end, unless converted or extended | If converted, move to subscription retention terms. |
| Public knowledge corpus | Public/regulatory/open metadata, claims, evidence spans | Indefinite while source rights allow | Source takedown, rights issue, quality issue | Track source rights and display permissions. |
| Security logs | Access logs, audit logs, security events | 90-180 days | Rolling deletion | Keep longer only for active investigation/legal need. |
| Support messages | Emails, support tickets, troubleshooting context | 24 months after resolution | Cleanup cycle or deletion request | Avoid including unnecessary customer confidential data. |
| Signed contracts | NDA, pilot agreement, DPA, order forms | Contract term plus 7 years | Legal/admin retention expires | Store in restricted company Drive, not Git. |
| Backups | Database and file backups | 30-90 days overwrite cycle | Backup rotation | Deleted data may remain until backups rotate out. |

## Pilot Deletion Procedure

1. Confirm pilot end date and whether the customer is converting.
2. Export agreed customer data if requested.
3. Delete customer pilot input/output data from application storage.
4. Remove local working copies.
5. Confirm no customer confidential data is in Trello, GitHub, personal notes, or chat.
6. Wait for backup rotation period.
7. Send deletion confirmation if contract requires it.
8. Retain contracts, invoices, and minimal audit evidence as required.

## DPA Wording To Align

The DPA should say that, at the end of the pilot or services, Risk on Radar will delete or return Customer Personal Data at the customer's choice unless applicable law requires retention. It should also explain that residual copies may remain in encrypted backups until normal rotation.

## Open Decisions

- Exact backup retention period once production hosting is final.
- Whether pilots permit customer confidential data in LLM prompts.
- Whether customer data is EU-only.
- Whether audit logs need longer retention for enterprise customers.

## Current Product Deletion Path

Verified Clerk `user.deleted`, `organization.deleted`, and membership-deletion webhooks now
remove application access immediately. User profile fields are anonymized and workspaces are
archived; FMEA review history, billing records, and engineering audit records are retained so
their provenance is not silently destroyed.

Self-service deletion of all workspace engineering data is intentionally not exposed yet. The
owner must first choose whether the workspace should be exported, transferred to another owner,
or deleted, and billing/legal retention may apply. Until that policy and backup rotation are
configured, account and workspace erasure requests use the documented support process and the
pilot deletion procedure above. This is a product/legal decision, not a hidden automatic delete.
