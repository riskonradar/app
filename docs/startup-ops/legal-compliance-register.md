# Legal And Compliance Register

Status values: `not started`, `in progress`, `operational`, `not applicable`, `monitor`.
Priority values: P0 before customer data/revenue, P1 before repeatable sales, P2 at scale.

## Register

| Area | Priority | Current assessment | Required evidence | Owner | Status |
|---|---:|---|---|---|---|
| Corporate authority | P0 | Contracting entity not confirmed in repository | Deed, KVK extract, UBO evidence, board/signing matrix | CEO | not started |
| Founder ownership | P0 | At least two founders are implied | Signed SHA, vesting, cap table, founder IP assignments | CEO | not started |
| Brand/IP | P0 | Domain and whitepaper exist; assignments unknown | IP register, assignments, BOIP clearance/filing decision | CEO | not started |
| Customer terms | P0 | Stripe/product plans exist; approved legal terms not found | MSA/SaaS terms, order form, clickwrap evidence | Commercial | not started |
| Pilot contracting | P0 | Informal template exists | Signed pilot form, NDA/DPA, success criteria | Commercial | in progress |
| Product liability | P0 | Engineering suggestions may influence safety decisions | Intended-use statement, human-review controls, liability review, insurance | CEO | not started |
| GDPR governance | P0 | User, waitlist, billing, logs, and customer data are processed | Processing register, lawful bases, policies, rights procedure | Privacy | not started |
| Processor obligations | P0 | Product may process customer personnel/internal data | Article 28 DPA, TOMs, subprocessor list, audit process | Privacy | not started |
| International transfers | P0 | Multiple likely US/global vendors | Data maps, adequacy/SCC records, TIAs, supplementary measures | Privacy | not started |
| Cookies/analytics | P0 | Public notice/consent evidence not found | Cookie inventory, consent logs, equal reject, withdrawal | Marketing | not started |
| Security governance | P0 | Enterprise and confidential engineering data are foreseeable | Policies, risk register, access review, incident/BCP/backup tests | Security | in progress |
| Source copyright/TDM | P0 | Scientific abstracts and EASA text feed a commercial database | Source-rights register, lawful-access proof, opt-out checks, display rules | Data rights | not started |
| Marketing substantiation | P0 | Public claims conflict with implemented scope | Claim-to-evidence register and approved website copy | CEO | not started |
| EU AI Act | P0 | Company is provider/deployer of an extraction/suggestion AI system | Classification memo, inventory, intended purpose, AI literacy record | AI owner | not started |
| AI transparency | P1 | Suggestions are generated/extracted with AI | In-product labels, factsheet, limitations, release records | AI owner | in progress |
| AI quality/audit | P1 | Evidence lineage exists; eval/release process incomplete | Model cards, evals, version history, incident/correction process | AI owner | in progress |
| EU Data Act | P0 | SaaS likely qualifies as a data processing service | Switching terms, export format, retrieval/deletion test, web disclosures | Product/legal | not started |
| Accessibility | P1 | Repository says AAA; no independent conformance evidence found | Audit, issue log, public wording review | Product | not started |
| Online company info | P0 | KVK/VAT/company details cannot exist until registration | Website/footer/contact/invoice checklist | Commercial | blocked |
| VAT/tax | P0 | EUR SaaS subscriptions planned | VAT IDs, invoice rules, returns calendar, OSS/ICP decision | Finance | not started |
| Accounting/retention | P0 | Some operating costs exist | Ledger, receipts, bank feed, seven-year archive, close process | Finance | not started |
| DGA/payroll | P0 | Founder/director status unknown | Adviser memo, payroll registration, salary decision | Finance | not started |
| WBSO | P1 | Technical R&D likely eligible | Approved application and contemporaneous hours/project records | Finance/tech | not started |
| Contractors/employees | P1 | Hiring model unknown | Worker-status assessment, signed IP/security terms, payroll setup | People | not started |
| Insurance | P0 | Liability profile is material | PI/cyber/AVB quotes, coverage matrix, certificates | CEO | not started |
| NIS2/Cyberbeveiligingswet | P2 | Likely below size/scope now; customer supply-chain terms may apply | Annual scope memo and contract flow-down register | Security/legal | monitor |
| DSA | P2 | Current product is not a public content-sharing platform | Scope memo; reassess if users publish/share third-party content | Legal | monitor |
| Sector regulation | P1 | Aviation evidence does not itself make the app certified aviation software | Intended-purpose and market review before new regulated uses | Legal/product | monitor |

## GDPR Minimum File

Create and maintain:

1. Data map and Article 30 processing register.
2. Privacy notices for website/waitlist, app users, recruitment, and employees.
3. Lawful-basis register. Do not use consent when contract or legitimate interest is the
   actual basis; record a legitimate-interest assessment where relied upon.
4. Retention schedule with automated deletion where practical.
5. Data-subject request intake, identity check, search, approval, response, and log.
6. Incident plan and breach register with a decision path for the GDPR 72-hour deadline.
7. Vendor DPAs, subprocessor inventory, transfer mechanisms, and TIAs.
8. Privacy-by-design checklist for every new feature/data source.
9. DPIA screening. A GDPR DPIA concerns risk to people, while a separate security/risk
   assessment should cover confidential industrial and safety data.

The GDPR requires lawful, transparent, purpose-limited, minimised, accurate, time-limited,
and secure processing. See the [European Commission's principles](https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/principles-gdpr/overview-principles/what-data-can-we-process-and-under-which-conditions_en).
Processors require Article 28 contracts and sufficient guarantees; international transfers
need adequacy or safeguards such as SCCs. See the Commission's guides on
[processors](https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/obligations/controllerprocessor/can-someone-else-process-data-my-organisations-behalf_en)
and [international transfers](https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/obligations/what-rules-apply-if-my-organisation-transfers-data-outside-eu_en).

## AI Act Position

Initial, non-binding assessment:

- Risk on Radar is an AI-system provider for its evidence extraction and suggestion layer;
  using a third-party model does not remove product-level responsibilities.
- On the stated intended purpose, the current B2B FMEA research copilot is not obviously an
  Annex III high-risk use case.
- It could become high-risk if intended and placed on the market as a safety component of a
  regulated product that requires third-party conformity assessment. Classification turns
  on intended purpose, claims, instructions, and real deployment, not the word `copilot`.
- Keep the intended purpose narrow: evidence discovery and preparation for competent human
  review. Do not market autonomous safety decisions, certification, or guaranteed risk scores.
- AI literacy duties have applied since 2 February 2025. Record role-based training now.
- From 2 August 2026, applicable transparency rules include informing people when they
  interact with certain AI systems. Clearly identify AI-generated/extracted suggestions even
  if the exact Article 50 category needs counsel review.

Maintain an AI file containing system inventory, provider/model, intended purpose, prohibited
uses, data/source lineage, evaluation results, accuracy limitations, logging, human oversight,
security, change approvals, incidents, customer information, and annual classification review.
The EU explains the risk classification and timeline in its
[AI Act FAQ](https://digital-strategy.ec.europa.eu/en/faqs/navigating-ai-act) and confirms that
[AI literacy measures already apply](https://digital-strategy.ec.europa.eu/en/faqs/ai-literacy-questions-answers).

## Scientific Content And Database Rights

Do not treat `publicly visible`, `indexed by OpenAlex`, `has a DOI`, `abstract available`,
`open access`, and `commercial reuse permitted` as synonyms.

For every source family record:

- Provider and dataset/API version.
- What was accessed: metadata, abstract, full text, figures, regulatory text, or database.
- Lawful-access basis and applicable terms/licence.
- Copyright and database-right holder where known.
- Whether commercial TDM rights were expressly reserved/opted out.
- API rate, attribution, caching, retention, and redistribution terms.
- Whether exact spans may be displayed to customers and the maximum display policy.
- Removal/change monitoring and rights-holder contact/takedown procedure.
- Provenance down to each displayed claim and quote.

EU/Dutch law contains TDM exceptions, but the general commercial exception can be reserved
by rights holders and lawful access remains important. TDM permission also does not
automatically permit redistributing source text in a paid product. Have specialist counsel
review the exact ingestion/display design before full-text expansion. Start with
[Dutch official copyright guidance](https://business.gov.nl/regulations/copyright/) and the
[EU copyright/TDM explanation](https://digital-strategy.ec.europa.eu/en/faqs/copyright-reform-questions-and-answers).

## Data Act SaaS Switching

The EU Data Act applies to data processing services and contains SaaS-relevant contractual
and technical switching duties. Customer contracts should specify:

- How a customer initiates switch, export, on-premises transfer, or deletion.
- A notice period no longer than two months.
- A normal maximum transition of 30 calendar days, with the regulated exception process
  where technically infeasible.
- Exhaustive exportable-data and excluded internal-data categories.
- Machine-readable formats, interfaces, known limitations, and estimated timing.
- At least 30 days of retrieval after the transition/termination point.
- Final deletion and confirmation.
- Security and business continuity during switching.
- Applicable switching charges; the Regulation removes them from 12 January 2027.

Build this into product export/deletion behavior and contracts, not only a privacy-policy
paragraph. See [Data Act Article 25 and related provisions](https://eur-lex.europa.eu/eli/reg/2023/2854).

## Tax And Online Trading

- Dutch SaaS supplied domestically will normally carry 21% VAT.
- EU B2B services are usually reverse-charged after validating the customer's VAT ID and
  generally require VAT/ICP reporting. EU B2C digital services can require destination VAT
  and OSS. Confirm the exact Stripe Tax configuration with the accountant.
- B.V.s file annual corporate income tax; 2026 rates are 19% and 25.8% across the applicable
  profit brackets. See [the official corporate-tax guide](https://business.gov.nl/finance-and-taxes/filing-tax-returns/filing-your-corporate-tax-return-vpb-in-the-netherlands/).
- Online materials and invoices must state the registered entity information and required
  KVK/VAT/contact details. Online sales information must be clear before purchase. See the
  [official online-sales checklist](https://business.gov.nl/regulations/long-distance-sales-and-purchases/).
- If non-essential cookies or tracking are used, obtain active consent, offer an equally
  clear reject option, keep proof, and make withdrawal as easy as consent. See the
  [official cookie rules](https://business.gov.nl/regulations/cookies/).

## Evidence Folder Structure

Store signed and sensitive evidence in access-controlled company storage, not Git:

```text
00 Corporate
01 Board and shareholders
02 Finance and tax
03 IP and source rights
04 Customer contracts
05 Privacy
06 Security and continuity
07 AI governance
08 People
09 Insurance
10 Grants
11 Fundraising data room
```

The repository may contain blank templates and public policies. It must not contain IDs,
signatures, tax credentials, bank data, sensitive cap-table documents, customer confidential
material, insurance applications, or signed agreements.

