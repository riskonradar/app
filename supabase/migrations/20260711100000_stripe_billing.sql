-- Replace the previous billing provider state with Stripe Billing / Checkout state.
-- Legacy provider IDs are intentionally removed from the active schema.

ALTER TABLE app.billing_customers
  DROP COLUMN IF EXISTS mollie_customer_id;

ALTER TABLE app.billing_customers
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

CREATE UNIQUE INDEX IF NOT EXISTS billing_customers_stripe_customer_id_idx
ON app.billing_customers(stripe_customer_id)
WHERE stripe_customer_id IS NOT NULL;

ALTER TABLE app.billing_payments
  DROP COLUMN IF EXISTS mollie_payment_id;

ALTER TABLE app.billing_payments
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_invoice_id text;

CREATE UNIQUE INDEX IF NOT EXISTS billing_payments_stripe_checkout_session_id_idx
ON app.billing_payments(stripe_checkout_session_id)
WHERE stripe_checkout_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_payments_stripe_subscription_id_idx
ON app.billing_payments(stripe_subscription_id)
WHERE stripe_subscription_id IS NOT NULL;

ALTER TABLE app.billing_subscriptions
  DROP COLUMN IF EXISTS mollie_customer_id,
  DROP COLUMN IF EXISTS mollie_subscription_id;

ALTER TABLE app.billing_subscriptions
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_stripe_subscription_id_idx
ON app.billing_subscriptions(stripe_subscription_id)
WHERE stripe_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_subscriptions_stripe_customer_id_idx
ON app.billing_subscriptions(stripe_customer_id)
WHERE stripe_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.stripe_webhook_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE app.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role all stripe_webhook_events" ON app.stripe_webhook_events;
CREATE POLICY "service role all stripe_webhook_events"
  ON app.stripe_webhook_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON app.stripe_webhook_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON app.stripe_webhook_events TO service_role;
