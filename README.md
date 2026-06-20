# Risk on Radar App

This repository contains the Risk on Radar product application and supporting pipeline services.

The public landing site is separate and already live at https://riskonradar.com/.

## Repository Layout

```text
apps/
  web/                  Next.js product app
services/
  paper-discovery/      Lightweight paper search/population service
  paper-classifier/     Paper classification and knowledge extraction service
packages/
  shared/               Future shared types and schemas
```

## Local Development

Run the web app:

```sh
npm run dev:web
```

Build the web app:

```sh
npm run build:web
```

Lint the web app:

```sh
npm run lint:web
```

## Architecture Notes

Next.js owns the app UI and lightweight app backend. The paper pipeline is split into two services:

- `paper-discovery` continuously searches journal and publisher sources and stores raw candidate papers.
- `paper-classifier` reads raw candidates, classifies title/abstract relevance with a small model pipeline, and writes structured reliability knowledge separately from raw paper data.

The MVP database is Supabase Postgres. The first migration defines three schemas:

- `app`: Clerk user mirror and Mollie billing records.
- `papers_raw`: discovery runs and raw paper candidates.
- `knowledge`: classifications and evidence records.

Clerk owns authentication. Mollie owns payments. Supabase Postgres owns application data.
