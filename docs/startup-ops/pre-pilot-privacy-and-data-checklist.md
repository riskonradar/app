# Pre-Pilot Privacy And Data Checklist

Last reviewed: 17 July 2026

This checklist is for the first Risk on Radar pilot. It is operational guidance, not legal advice. A lawyer should review the customer-facing documents before a paid pilot or any pilot using confidential customer data.

## Pilot Gate

### Public-data or demo-only pilot

This is acceptable before a B.V. if the pilot is unpaid, uses only demo/public data, and the customer does not upload confidential or personal data.

Minimum required:
- Privacy notice naming the actual controller/contact.
- Pilot scope email or lightweight pilot terms.
- Subprocessor list.
- Clear "no confidential/customer personal data uploads" rule.
- AI/data-use note saying only public/demo data is processed.

### Paid or confidential-data pilot

Set up the B.V. first, or at least have the notary process underway and understand personal liability if contracting as `B.V. i.o.`.

Minimum required:
- Signed pilot agreement or order form.
- Mutual NDA.
- DPA if customer personal data is processed on the customer's behalf.
- Subprocessor list attached or linked from the DPA.
- Data retention and deletion schedule.
- AI/data-use clause.
- Security schedule describing access, hosting, backups, incidents, and deletion.

## Where Each Document Lives

| Item | Where it should live | Who signs or approves it |
|---|---|---|
| Privacy notice | Public website/app legal page; copy in restricted company Drive | Published by Risk on Radar as controller |
| DPA | Appendix to pilot agreement/MSA; signed PDF in customer contract folder | Customer controller and Risk on Radar processor |
| NDA | Standalone signed PDF before confidential exchange | Both parties |
| Subprocessor list | Public legal page plus appendix/link in DPA; internal source copy in company Drive | Approved by Risk on Radar; customers are notified of changes |
| Data retention/deletion schedule | Public/legal summary plus internal operational procedure | Approved internally; referenced in DPA/pilot agreement |
| AI data-use terms | Pilot agreement data schedule, DPA/security schedule, and product limitations page | Customer agrees in pilot/order form |
| Security schedule | Attachment to pilot agreement/MSA; internal copy in company Drive | Risk on Radar provides; customer may review |

The repository may contain templates and public versions. Do not commit signed contracts, customer confidential documents, IDs, bank data, or private cap-table documents.

## Privacy Policy Before A B.V.

A privacy policy can exist before a B.V., but it must identify the real controller. If no B.V. exists, the controller is likely the individual or pre-incorporation business actually operating the service. Do not write `Risk on Radar B.V.` until the B.V. exists.

Use one of these placeholders until incorporation:

```text
Controller: [Founder legal name / business name], operating the Risk on Radar pilot.
Contact: [privacy contact email]
```

After incorporation, update:
- legal entity name
- KVK number
- VAT number if applicable
- registered address
- contact email
- subprocessor list owner
- contract signatory

## DPA Position

Risk on Radar is likely:
- Controller for account, billing, support, security logs, website analytics, and marketing contacts.
- Processor for customer-uploaded pilot/FMEA/asset data processed only to provide the service.
- Controller or separate rights holder/operator for its own public knowledge corpus, depending on source rights and licensing.

A DPA is needed when customer personal data is processed on behalf of the customer. If a customer only views a public-data demo and no personal/customer data is uploaded beyond normal user accounts, a full customer DPA may be unnecessary, but the app privacy notice still applies.

## AI Data-Use Clause

Default for the first pilot:
- No model training on customer confidential data.
- No customer confidential data sent to third-party LLMs unless expressly agreed in the pilot data schedule.
- Prefer public/demo data for the first pilot.
- If customer data must be processed by an LLM, disclose the provider in the subprocessor list and identify the purpose, data categories, and transfer mechanism.
- Human engineering review is required; outputs are suggestions, not validated safety decisions.

Use this in the pilot agreement or data schedule:

```text
Risk on Radar may use AI systems to extract, classify, summarize, and suggest reliability evidence solely to provide the pilot services. Risk on Radar will not use Customer Confidential Information or Customer Personal Data to train foundation models. Risk on Radar will not submit Customer Confidential Information to third-party AI providers unless the Order Form or Data Schedule expressly permits that provider and processing purpose. Customer remains responsible for engineering review, validation, and decisions.
```

## Pre-Pilot Checklist

- [ ] Decide pilot type: demo-only, unpaid design partner, paid pilot, or confidential-data pilot.
- [ ] Decide legal entity/signatory. Avoid paid/confidential pilot until B.V. path is clear.
- [ ] Publish or prepare privacy notice.
- [ ] Prepare subprocessor list.
- [ ] Prepare data retention/deletion schedule.
- [ ] Prepare NDA.
- [ ] Prepare pilot agreement/order form.
- [ ] Prepare DPA if processing customer personal data.
- [ ] Prepare security schedule.
- [ ] Define AI data-use rule for the specific pilot.
- [ ] Define allowed and prohibited customer data.
- [ ] Define deletion/export date at pilot end.
- [ ] Store signed documents in restricted company storage, not Git.

## Source Notes

- GDPR Article 28 requires a written processor contract where processing is carried out on behalf of a controller.
- Dutch official guidance says a privacy statement is required when processing personal data.
- Business.gov.nl notes a B.V. requires civil-law notarial incorporation and that acting as `B.V. i.o.` can leave personal liability until registration/adoption.
