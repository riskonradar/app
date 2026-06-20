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

SQLite is acceptable for early local prototyping, but the data model should be designed for a future Postgres migration.
