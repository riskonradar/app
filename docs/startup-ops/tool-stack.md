# Lean Operating Tool Stack

## Rule

Use one system per job. Do not buy a broad startup stack before a workflow has an owner.
The company is early enough that secure defaults and clean records matter more than
automation.

## Recommended Stack Now

| Function | Start with | Operating rule | Upgrade trigger |
|---|---|---|---|
| Identity/email/calendar | Google Workspace Business Standard | Company accounts only; MFA/passkeys; no shared logins | Move up a tier for stronger endpoint/retention controls |
| Passwords/secrets for people | 1Password Business | Separate vaults; recovery owners; quarterly access review | Keep as company grows |
| Signed files/data room | Google Shared Drives | B.V. owns files; least privilege; signed PDFs immutable | Dedicated VDR for financing only |
| Company handbook/ops wiki | Notion | Policies and procedures; signed records stay in Drive | Add workflow tool only when owners need it |
| Engineering delivery | GitHub + existing issue tool | Keep product decisions close to code | Do not duplicate tasks into Notion |
| Internal chat | Skip initially or use Google Chat | Decisions move to docs; no customer secrets in chat | Slack when team communication genuinely needs it |
| CRM | HubSpot Free | One pipeline, next action, value, source, consent status | Paid automation after repeatable sales motion |
| Customer support | Shared `support@` inbox | Ticket owner and response log | Help Scout/Intercom after volume exceeds inbox |
| E-signature | SignRequest or DocuSign | Approved templates; final copy to Shared Drive | Procurement/customer requirement |
| Banking | Dutch business bank selected after UBO/onboarding comparison | Two-person approval over agreed threshold | Add spend management with employees |
| Bookkeeping | Moneybird plus Dutch accountant | Bank feed, receipts, projects, monthly close | Exact/AFAS when accountant or scale requires it |
| Payroll | Accountant's Nmbrs/Loket.nl setup | No manual founder/employee payroll | Keep provider unless international hiring requires EOR |
| Billing | Existing Stripe Billing | Accountant-approved VAT, invoice, refund, and dunning setup | Add RevOps tooling only at material volume |
| Legal register | Notion register + signed files in Drive | Owner, renewal, notice date, counterparty, DPA status | Contract lifecycle tool after dozens of contracts |
| Privacy/cookie consent | Lightweight EU CMP only if non-essential tracking exists | Prefer privacy-friendly analytics and fewer cookies | CMP automation for multiple properties/regions |
| Security awareness | Short role-based training + incident exercises | Record completion; include AI literacy | Managed platform after hiring |

Google Workspace is the lean default, not a permanent mandate. If target aerospace and
industrial customers require Microsoft collaboration, choose Microsoft 365 instead at the
start; do not operate both suites without a customer-driven reason.

## Business Bank Selection Criteria

Request comparable offers from one established Dutch bank and one regulated fintech. Score:

- Ability to onboard all founders/holdings and non-Dutch UBOs, if relevant.
- Deposit protection/entity, multi-user approval, cards, SEPA, iDEAL, and Stripe payouts.
- Bank feed quality for the chosen bookkeeping package.
- Grant/investor comfort and availability of account confirmation letters.
- Support quality, FX costs, limits, and monthly cost.
- Whether each holding also needs an account and the total structure cost.

Do not choose based only on the lowest monthly fee. Banking friction during a funding round,
notarial transfer, or enterprise vendor check is more expensive than a small fee difference.

## Finance Controls From Day One

- One bank/card per legal entity; never mix holding and operating-company expenses.
- Receipt attached to every transaction and project/customer tag where relevant.
- Two-person approval for payments above a founder-agreed threshold.
- Vendor record includes legal entity, VAT ID, contract owner, renewal, and DPA status.
- Monthly close by day 10: reconcile bank/Stripe, debtors, creditors, VAT, payroll, and cash.
- Thirteen-week cash forecast and 12-month runway forecast.
- Tax/VAT/payroll cash held separately in forecasting even if not in a separate account.
- No founder reimbursement without receipt and business purpose.
- Preserve accounting records for at least seven years in an accessible format.

For EU B2B SaaS, validate and retain the customer's VAT ID, apply reverse charge where
appropriate, and file ICP as advised. For EU B2C digital services, configure destination VAT
and OSS if applicable. The official overview is at
[Business.gov.nl](https://business.gov.nl/finance-and-taxes/vat/vat-rates-and-exemptions/).

## CRM Fields That Matter

- Account, sector, country, size, and target asset/system.
- Contact role, budget owner, technical reviewer, security/procurement stakeholders.
- Last interaction, next action/date, stage, expected value, probability, and close date.
- Problem frequency, current process/time, consequence, and buying trigger.
- Data/security constraints and required standards.
- Pilot scope, fee, success criteria, reviewer, end date, and conversion decision.
- Lead source, marketing lawful basis/consent status, and opt-out.
- Loss reason using a controlled list, not free-text only.

Do not put customer incident reports, proprietary FMEAs, credentials, or sensitive technical
attachments in the CRM. Link to a restricted customer folder.

## Data Room Index

Prepare these before investor outreach:

- Incorporation deed, articles, KVK/UBO evidence, group chart.
- Shareholders agreement, cap table, option/convertible instruments, board resolutions.
- Founder, employee, and contractor IP assignments.
- Trademark/domain records and source-rights register.
- Management accounts, forecast, bank statements, tax filings, WBSO decisions.
- Customer pipeline, signed pilots/contracts, anonymised usage and retention metrics.
- Product roadmap and honest current-versus-planned capability matrix.
- Privacy, security, AI governance, insurance, and material incidents.
- Material vendor/customer contracts and change-of-control clauses.

Use an access log and a clean investor-specific data-room view. Do not expose production
credentials, raw customer data, unnecessary personal data, or the complete proprietary
knowledge corpus.

