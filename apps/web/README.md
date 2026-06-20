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

## Environment

Copy `.env.example` to `.env.local` and fill in the missing values.

Required for full integration:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MOLLIE_API_KEY`

The local `.env.local` is intentionally ignored by git. Never commit real Clerk, Supabase service-role, or Mollie secrets.

## Auth

The MVP uses Clerk with one account per person. Organizations are intentionally out of scope for now.

Files:

- `src/components/auth/app-auth-provider.tsx`
- `src/components/auth/auth-controls.tsx`
- `src/proxy.ts`
- `src/app/sign-in/[[...sign-in]]/page.tsx`
- `src/app/sign-up/[[...sign-up]]/page.tsx`

The scaffold does not crash if Clerk keys are missing. Without keys, the nav falls back to the landing waitlist button.

## Database

The MVP uses Supabase Postgres, not SQLite.

Current project URL:

```text
https://rqzwdzhphxuayqwptqia.supabase.co
```

Use the migration in `../../supabase/migrations/` as the schema starting point. The app uses lazy Supabase clients in `src/lib/supabase/server.ts` so builds do not require DB env vars.

## Billing

Mollie is scaffolded for payments.

Files:

- `src/lib/mollie/server.ts`
- `src/app/api/billing/create-payment/route.ts`
- `src/app/api/billing/mollie-webhook/route.ts`

Mollie must only be called from server-side code. The browser must never receive `MOLLIE_API_KEY`.

## Integration Health

Use this endpoint locally to see which integrations have env vars:

```text
/api/integrations/status
```

## Notes

The app intentionally avoids remote build-time font fetching so local and CI builds work without external font network access.
