# Risk on Radar Web App

Next.js product application for the Risk on Radar reliability intelligence workspace.

This app owns:

- product UI
- authenticated workspace screens
- lightweight app API routes/server actions
- ordinary product database reads/writes

The paper discovery and classification pipelines live in `services/`.

## Commands

From the repository root:

```sh
npm run dev:web
npm run lint:web
npm run build:web
```

From this directory:

```sh
npm run dev
npm run lint
npm run build
```

## Notes

The app intentionally avoids remote build-time font fetching so local and CI builds work without external font network access.
