# Risk on Radar Startup Operations

Last reviewed: 11 July 2026

This pack is the non-technical operating plan for launching Risk on Radar from the
Netherlands. It is based on the product repository, the public website, and the 28 May
2026 whitepaper.

It is an execution guide, not legal or tax advice. A Dutch civil-law notary, startup
lawyer, tax adviser, and insurance broker should approve the items marked **professional
sign-off**.

## Product And Risk Baseline

Risk on Radar is a B2B SaaS decision-support product for reliability and quality
engineers. It converts scientific and regulatory evidence into reviewable FMEA content.
The engineer accepts, edits, or rejects suggestions; the product must remain a copilot,
not an autonomous engineering authority.

The current product is narrower than the long-term whitepaper vision:

- Live scope: an initial turbofan/aviation dataset and evidence-backed FMEA workflow.
- Planned scope: system-level propagation and cross-domain reliability intelligence.
- Inputs: paper titles and abstracts, EASA airworthiness directives, account data,
  customer-created FMEA analyses, and potentially customer confidential engineering data.
- AI: third-party LLMs extract claims and relationships; outputs retain model, evidence,
  confidence, timestamps, and review state.
- Commercial model: individual and organisation workspaces with Stripe subscriptions.

This creates five material non-technical risks:

1. An engineer could over-rely on an incomplete or incorrect suggestion.
2. Scientific text, databases, and regulatory material have different reuse terms.
3. Customer uploads may contain confidential asset, incident, or safety information.
4. EU privacy, AI, and cloud-switching rules apply to parts of the service.
5. Public claims can imply capabilities, standards support, or validation that the
   implemented product does not yet provide.

## Recommended Company Shape

For two founders planning B2B contracts, investment, and valuable IP, obtain a quote for:

```text
Founder A Holding B.V. ----\
                           >---- Risk on Radar B.V. (operating company)
Founder B Holding B.V. ----/
```

The operating company should own the product IP, brand, domains, customer contracts,
employment and contractor contracts, and revenue. Each founder's holding owns shares in
the operating company. This is a recommendation to evaluate, not a decision to implement
without tax and notarial advice. A single operating B.V. with founders holding shares
directly is cheaper, but can be less flexible later.

A Dutch B.V. is incorporated by civil-law notarial deed; the notary normally registers
the B.V. and UBOs. KVK states indicative notary costs of EUR 500-1,500 for a B.V., before
additional holding, shareholders' agreement, or bespoke work. A director holding at least
5% is generally a DGA; the 2026 customary salary reference is EUR 58,000, but loss-making
startups should obtain written tax advice on the defensible salary position rather than
silently paying less. See [KVK's B.V. guide](https://www.kvk.nl/en/starting/private-limited-company-bv/).

## The First 90 Days

### Days 0-14: Ownership And Incorporation

- [ ] Complete [founder-intake.md](founder-intake.md).
- [ ] Agree founder roles, time commitments, cash contributions, equity, vesting,
  decision rights, and what happens if a founder leaves.
- [ ] Ask a notary for two quotes: one operating B.V. versus two personal holdings plus
  one operating B.V.
- [ ] Ask a tax adviser about DGA salary, payroll, VAT, WBSO, and founder share structure.
- [ ] Sign a founders/shareholders agreement with reverse vesting, good/bad leaver,
  deadlock, reserved matters, drag/tag, pre-emption, confidentiality, and IP assignment.
- [ ] Assign all pre-incorporation IP and accounts to the operating company: code,
  database rights, taxonomies, prompts, designs, whitepaper, domains, social accounts,
  customer research, and brand assets.
- [ ] Register the B.V., UBOs, and trade names; obtain KVK, RSIN, and VAT details.
- [ ] Open a business bank account and separate all company spending from personal spend.
- [ ] Obtain eHerkenning level EH3 for tax and RVO workflows.
- [ ] Start bookkeeping from the first pre-incorporation expense and preserve receipts.
- [ ] Run a BOIP clearance search and decide whether to file `Risk on Radar` in Benelux
  classes appropriate to downloadable software and SaaS/engineering services.

**Gate:** no live Stripe payments, customer contract, grant application, or paid contractor
before the contracting entity and signing authority are clear.

### Days 15-30: Contract And Compliance Minimum

- [ ] Approve a B2B master subscription agreement or SaaS terms.
- [ ] Approve an order form, pilot agreement, mutual NDA, data processing agreement,
  security schedule, acceptable-use policy, and subprocessor list.
- [ ] Publish website/app privacy and cookie notices with company identity, KVK number,
  VAT ID, address, contact route, and complaint process where required.
- [ ] Create the processing register, retention schedule, data-subject request procedure,
  breach register, and 72-hour incident decision process.
- [ ] Complete vendor privacy/security reviews and international-transfer records for
  Clerk, Supabase, Stripe, Cloudflare, DigitalOcean, the LLM provider, email, analytics,
  support, CRM, and document tools.
- [ ] Complete the initial AI Act classification memo and an AI literacy briefing for
  everyone who builds, sells, supports, or uses model output internally.
- [ ] Create a source-rights register for OpenAlex records, each publisher or repository,
  EASA material, and any customer-provided content.
- [ ] Implement the contract/export/deletion terms required for customer switching under
  the EU Data Act.
- [ ] Obtain professional indemnity and cyber insurance quotes; add AVB if founders work
  at customer sites. Check that the policy covers AI-enabled engineering software and US
  claims if selling there.

**Gate:** do not accept confidential customer engineering data until the DPA, security
schedule, access rules, deletion process, and incident response owner exist.

### Days 31-60: Sell Controlled Pilots

- [ ] Pick one initial customer profile and one paid pilot outcome. The current credible
  scope is evidence-backed FMEA research for a bounded turbofan or aviation subsystem.
- [ ] Use the existing customer-discovery and pilot templates; require a named engineering
  reviewer and measurable acceptance/edit/rejection outcomes.
- [ ] Execute a pilot order form, NDA/DPA where needed, success criteria, data handling
  rules, and a conversion decision date.
- [ ] Set a founder-led sales pipeline: lead, qualified problem, technical validation,
  security/legal review, proposal, pilot, subscription, lost.
- [ ] Create a procurement pack: company extract, VAT/bank details, insurance certificate,
  DPA, security overview, subprocessors, architecture/data-flow summary, AI factsheet,
  and support contacts.
- [ ] Track evidence of value: research time saved, relevant failure modes found, evidence
  accepted, rows edited/rejected, missing evidence, and willingness to pay.
- [ ] Apply for WBSO before eligible work periods where possible. RVO's 2026 scheme offers
  an R&D payroll-tax credit and requires contemporaneous project/hour records. See
  [RVO's WBSO guide](https://english.rvo.nl/subsidies-financing/wbso/tax-credit-benefit).

### Days 61-90: Launch Readiness

- [ ] Resolve every P0 item in [legal-compliance-register.md](legal-compliance-register.md).
- [ ] Complete the public-claims audit below.
- [ ] Run a tabletop security incident and a customer data-export/deletion test.
- [ ] Confirm backups, recovery ownership, supplier outage procedures, and support targets.
- [ ] Have counsel review the final customer terms and source-rights approach.
- [ ] Have the accountant confirm VAT treatment, invoice fields, DGA/payroll status,
  expense policy, and tax calendar.
- [ ] Start quarterly founder/board reporting: cash, runway, pipeline, revenue, churn,
  product usage, model quality, incidents, compliance exceptions, and key risks.
- [ ] Prepare the due-diligence data room before fundraising, not during it.

## Public Claims Audit: Immediate P0

The public website currently conflicts with the repository in several places. Correct or
substantiate these before active sales:

| Public claim | Repository state | Required action |
|---|---|---|
| `2,800+` papers and other fixed counts | Counts change and must come from the database | Render live verified counts or date-stamp a documented snapshot |
| Ingestion via Crossref, Elsevier TDM, and Springer Nature APIs | Current discovery is OpenAlex-only; publisher TDM is planned | Remove or label as planned until contracts and code exist |
| Human validation at every ingestion stage | Claims begin `needs_review`; full manual validation is not performed | Say evidence-linked and subject to engineer review |
| ISO 26262 and IEC 61508 support | Standards mappings are roadmap items | Remove present-tense support claims |
| AIAG-VDA ready/support | Scoring/form support must be verified feature by feature | Describe only implemented workflow; avoid certification implication |
| Broad multi-industry coverage | Current searchable dataset is turbofan-focused | State the launch dataset and label other domains as roadmap |
| Predictive/system-level capabilities in the whitepaper | Phases 2 and 3 are planned | Keep future tense and separate vision from available product |

Also avoid claiming WCAG 2.1 AAA compliance until an independent audit and remediation
record support it. A design target is not compliance.

## Recurring Operating Calendar

| Cadence | Owner | Required review |
|---|---|---|
| Weekly | CEO/founders | Cash position, pipeline, pilot blockers, incidents |
| Monthly | Board/founders | Management accounts, runway, KPI dashboard, risk register |
| Quarterly | Finance owner | VAT return/payment; ICP where EU B2B services were reverse-charged |
| Quarterly | Security/privacy owner | Access review, vendor changes, subprocessors, incidents, restore sample |
| Every model/release | AI owner | Version, evaluation, source lineage, limitations, release approval |
| Annually | Accountant/board | Accounts, corporate tax, KVK filing, insurance, contracts, UBO data |
| Annually | Privacy/AI owner | Processing register, retention, AI classification, DPIA need, training |
| Before each new data source | Data-rights owner | Lawful access, licence, TDM reservation, display rights, retention |

Dutch B.V.s file annual financial statements with KVK and corporate income tax returns.
Business records are generally retained for at least seven years. See the official guides
on [financial-statement filing](https://business.gov.nl/regulations/filing-financial-statements/)
and [record retention](https://business.gov.nl/regulations/keeping-business-records/).

## Pack Contents

- [founder-intake.md](founder-intake.md): facts needed before documents or accounts can be finalised.
- [company-and-contracts.md](company-and-contracts.md): entity, ownership, IP, insurance, and contract suite.
- [legal-compliance-register.md](legal-compliance-register.md): product-specific obligations, evidence, and owners.
- [pre-pilot-privacy-and-data-checklist.md](pre-pilot-privacy-and-data-checklist.md): GDPR/DPA/NDA/subprocessor gate before pilots.
- [subprocessors.md](subprocessors.md): working subprocessor list and publication plan.
- [data-retention-and-deletion.md](data-retention-and-deletion.md): pilot retention and deletion schedule.
- [tool-stack.md](tool-stack.md): a lean operating system without duplicate platforms.

## Authoritative Starting Sources

- [KVK: Dutch private limited company](https://www.kvk.nl/en/starting/private-limited-company-bv/)
- [Business.gov.nl: online sales information](https://business.gov.nl/regulations/long-distance-sales-and-purchases/)
- [Business.gov.nl: cookies](https://business.gov.nl/regulations/cookies/)
- [European Commission: GDPR for organisations](https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations_en)
- [EU AI Act implementation](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)
- [EU Data Act, including SaaS switching terms](https://eur-lex.europa.eu/eli/reg/2023/2854)
- [Business.gov.nl: Dutch copyright and TDM](https://business.gov.nl/regulations/copyright/)
- [Business.gov.nl: first employee](https://business.gov.nl/staff/employing-staff/employing-your-first-staff/)
- [Business.gov.nl: false self-employment](https://business.gov.nl/starting-your-business/starting-as-a-self-employed-professional/avoid-false-self-employment/)
