# Risk on Radar App Context

This file gives Claude and other coding agents the project context needed to work in this repository.

Risk on Radar is a B2B application for adaptive reliability intelligence. It helps reliability and quality engineering teams turn fragmented failure evidence into traceable FMEA, root-cause analysis, predictive maintenance, and system-level risk assessment workflows.

## Repository Boundary

This repository is for the product application.

The public landing site is separate:

- Live site: https://riskonradar.com/
- Whitepaper: https://riskonradar.com/whitepaper.pdf
- Landing repo: https://github.com/riskonradar/landing

Do not turn this repository into the landing page. Marketing pages, waitlist content, SEO pages, and public launch copy belong in the landing repo. This repo should contain the authenticated app experience, product workflows, app services, domain models, tests, and product documentation.

## What the Product Does

Risk on Radar indexes peer-reviewed failure literature and engineering evidence into structured reliability knowledge, then surfaces that knowledge inside engineering workflows.

The core user workflow:

1. Search by component, system, asset, or operating context.
2. Review ranked failure modes with causes, effects, controls, citations, confidence, and evidence spans.
3. Accept, edit, reject, or annotate suggestions.
4. Build traceable FMEA rows.
5. Export or reuse validated reliability knowledge.

The product is a copilot, not an autopilot. Engineers remain responsible for review and approval.

## Product Pillars

### Living Failure Knowledge Engine

Continuously structures fragmented failure knowledge from scientific literature, industrial reports, reliability studies, sensor technologies, NDT investigations, standards, and validated internal sources.

Expected normalized records include:

- component
- failure mode
- cause
- effect
- control
- operating context
- source DOI or citation
- evidence text span
- confidence
- validation status
- reviewer history

### System-Level Risk Analysis

Models engineering assets as interconnected systems, not isolated parts. Future workflows should support subsystem dependencies, failure propagation, cascading risk, interface failure modes, and user-defined engineering systems.

### Cross-Domain Failure Intelligence

Transfers reliability knowledge across domains by comparing component context, operating conditions, failure mechanisms, and evidence signatures. Never copy risk scores blindly from one domain to another; adapt them to the target operating context and show uncertainty.

## Roadmap Context

Phase 1 is the Failure Intelligence Engine:

- Living knowledge graph from peer-reviewed failure papers.
- Structured ingestion through sources such as Crossref, Elsevier TDM, and Springer Nature APIs.
- Component to failure mode to cause to effect to control taxonomy.
- DOI-linked citations, confidence scoring, evidence spans.
- Human-in-the-loop validation.

Phase 2 is System-Level Risk Analysis:

- Graph-based failure propagation.
- Cross-component dependency visualization.
- Interface failure mode library.
- Existing and user-defined engineering systems.

Phase 3 is Cross-Domain Failure Intelligence:

- Multi-domain taxonomy alignment.
- Cross-industry failure pattern detection.
- Domain-adapted severity and occurrence tables.
- Standards mappings such as ISO 26262, IEC 61508, and DO-178C.

## Users

Design and implementation should serve:

- reliability engineers
- quality engineers
- FMEA facilitators
- asset owners
- engineering managers
- maintenance and operations teams
- safety and compliance stakeholders

The app should feel like a professional engineering workspace: dense, clear, auditable, and built for repeated review work.

## Domain Language

Use these terms consistently:

- Asset: a physical engineering system or equipment item.
- System: a collection of dependent subsystems and components.
- Subsystem: a functional part of a larger system.
- Component: an engineering part with possible failure behavior.
- Failure mode: how something fails.
- Cause: why a failure occurs.
- Effect: local, subsystem, system, safety, operational, or financial consequence.
- Control: prevention, detection, inspection, design, maintenance, or mitigation action.
- Evidence: source-backed support for a reliability claim.
- Citation: DOI, source URL, title, authors, publication metadata, and source trace.
- Confidence: the app's assessment of extraction quality, relevance, source strength, and validation state.
- Operating context: environmental and operational conditions affecting failure behavior.
- FMEA row: the structured, reviewed reliability record used in the user's FMEA workflow.

## Standards and Workflows

Known methods and standards in product scope:

- AIAG-VDA FMEA and Action Priority scoring.
- ISO 26262.
- IEC 61508.
- DO-178C as later standards mapping.
- 8D problem solving.
- Six Sigma.
- Reliability-centered maintenance.
- Root-cause analysis.
- Predictive maintenance and asset reliability management.

Do not claim a standard is supported unless the implementation actually supports it. Use explicit labels for planned, partial, draft, validated, and exported states.

## AI and Evidence Rules

Evidence traceability is a core product requirement.

- Every suggestion must be tied to evidence or clearly marked as inference.
- Preserve provenance through ingestion, search, review, export, and audit logs.
- Store review state separately from model output.
- Show confidence and uncertainty.
- Do not present model-generated content as verified engineering truth.
- Human approval is required before suggestions become validated FMEA content.
- Keep enough metadata to audit how a suggestion was produced.

## UX Direction

Do not build marketing-style screens in this repo unless explicitly requested.

Prefer:

- searchable evidence tables
- FMEA builder tables
- split-pane review flows
- citations and evidence drawers
- confidence indicators
- filters by component, failure mode, source, domain, standard, confidence, and review state
- graph views for assets, dependencies, and propagation paths
- export controls
- review queues and audit history

Avoid:

- oversized hero sections
- public waitlist flows
- untraceable AI chat as the primary workflow
- automatic engineering decisions
- vague risk claims without source evidence

## Current Technical Status

This repository is new and is being initialized as a small monorepo.

Approved starting architecture:

- `apps/web`: Next.js application for the product UI, authenticated workspace, lightweight app API routes/server actions, and normal database reads/writes.
- `services/paper-discovery`: lightweight service that continuously searches journal/publisher sources by keywords and stores raw candidate papers in the database.
- `services/paper-classifier`: heavier classification service that reads candidate paper titles/abstracts, uses a small LLM/classifier pipeline, and writes classified reliability knowledge into a separate classified knowledge store or schema.
- `packages/shared`: optional shared types/schemas once contracts stabilize.

Backend direction:

- Do not add a separate general-purpose backend service yet.
- Use Next.js for the app backend unless the app API becomes too large or needs independent scaling.
- Keep paper discovery and paper classification outside Next.js because they are background pipeline concerns.

Database direction:

- SQLite is acceptable for early local prototyping.
- Design the domain model with an expected move to Postgres.
- Keep raw paper candidate data separate from classified/validated reliability knowledge.

Do not change this architecture without explicit user approval.

When a stack is chosen, update this file with:

- install command
- dev command
- test command
- build command
- lint/typecheck command
- environment variables
- deployment target
- database and migration workflow

## First Build Target

The first app milestone should be an evidence-backed FMEA workflow:

1. Define typed domain models for evidence records, citations, failure suggestions, review states, and FMEA rows.
2. Create a search and filtering interface for component/system/context queries.
3. Display ranked failure suggestions with citations and confidence.
4. Add accept, edit, reject, and annotate states.
5. Generate traceable FMEA rows from reviewed suggestions.
6. Add export or persistence only after the review model is clear.

Keep all implementation decisions aligned with auditability, engineering traceability, and human-in-the-loop review.

Do not add new architecture, repository structure, or stack decisions to this file unless the user explicitly approves them first.
