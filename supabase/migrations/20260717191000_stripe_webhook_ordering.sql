-- Make Stripe webhook claiming atomic and reject out-of-order subscription mutations.

ALTER TABLE app.stripe_webhook_events
  ADD COLUMN IF NOT EXISTS event_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 1
    CHECK (attempt_count > 0);

UPDATE app.stripe_webhook_events
SET event_created_at = created_at
WHERE event_created_at IS NULL;

ALTER TABLE app.stripe_webhook_events
  ALTER COLUMN event_created_at SET NOT NULL;

ALTER TABLE app.billing_subscriptions
  ADD COLUMN IF NOT EXISTS last_stripe_event_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_stripe_event_id text;

UPDATE app.subscription_plans
SET metadata = metadata || jsonb_build_object(
  'included_seats', 3,
  'additional_seat_amount_value', 99.00,
  'additional_seat_currency', 'EUR'
)
WHERE key = 'team';

CREATE OR REPLACE FUNCTION app.claim_stripe_webhook_event(
  p_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(claimed boolean, event_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows integer;
  v_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO app.stripe_webhook_events (
    id,
    type,
    status,
    metadata,
    event_created_at,
    claimed_at,
    attempt_count
  )
  VALUES (
    p_event_id,
    p_event_type,
    'processing',
    COALESCE(p_metadata, '{}'::jsonb),
    p_event_created_at,
    pg_catalog.now(),
    1
  )
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 1 THEN
    RETURN QUERY SELECT true, 'processing'::text;
    RETURN;
  END IF;

  UPDATE app.stripe_webhook_events
  SET
    status = 'processing',
    metadata = COALESCE(p_metadata, '{}'::jsonb),
    event_created_at = p_event_created_at,
    claimed_at = pg_catalog.now(),
    processed_at = NULL,
    attempt_count = attempt_count + 1
  WHERE id = p_event_id
    AND (
      status = 'failed'
      OR (
        status = 'processing'
        AND claimed_at < pg_catalog.now() - pg_catalog.make_interval(mins => 5)
      )
    )
  RETURNING status INTO v_status;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_status;
    RETURN;
  END IF;

  SELECT status
  INTO v_status
  FROM app.stripe_webhook_events
  WHERE id = p_event_id;

  RETURN QUERY SELECT false, v_status;
END;
$$;

CREATE OR REPLACE FUNCTION app.apply_stripe_subscription_event(
  p_organization_id uuid,
  p_user_account_id uuid,
  p_plan_key text,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_status text,
  p_seats integer,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_metadata jsonb,
  p_billing_status text,
  p_event_id text DEFAULT NULL,
  p_event_created_at timestamptz DEFAULT NULL
)
RETURNS TABLE(applied boolean, current_event boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subscription_id uuid;
  v_last_event_created_at timestamptz;
  v_last_event_id text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = '42501';
  END IF;

  IF p_seats < 1 THEN
    RAISE EXCEPTION 'subscription seats must be positive' USING ERRCODE = '22023';
  END IF;

  -- Serializes the first insert as well as later updates for one Stripe subscription.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_stripe_subscription_id, 0)
  );

  SELECT
    id,
    last_stripe_event_created_at,
    last_stripe_event_id
  INTO
    v_subscription_id,
    v_last_event_created_at,
    v_last_event_id
  FROM app.billing_subscriptions
  WHERE stripe_subscription_id = p_stripe_subscription_id
  FOR UPDATE;

  -- An exact-event retry may be needed when the database commit succeeded but
  -- a later external side effect (for example Clerk seat sync) failed.
  IF v_subscription_id IS NOT NULL
    AND p_event_id IS NOT NULL
    AND p_event_id = v_last_event_id
  THEN
    RETURN QUERY SELECT false, true;
    RETURN;
  END IF;

  IF v_subscription_id IS NOT NULL
    AND p_event_created_at IS NOT NULL
    AND v_last_event_created_at IS NOT NULL
    AND p_event_created_at < v_last_event_created_at
  THEN
    RETURN QUERY SELECT false, false;
    RETURN;
  END IF;

  IF v_subscription_id IS NULL THEN
    INSERT INTO app.billing_subscriptions (
      organization_id,
      user_account_id,
      plan_key,
      stripe_customer_id,
      stripe_subscription_id,
      status,
      seats,
      current_period_start,
      current_period_end,
      metadata,
      last_stripe_event_created_at,
      last_stripe_event_id
    )
    VALUES (
      p_organization_id,
      p_user_account_id,
      p_plan_key,
      p_stripe_customer_id,
      p_stripe_subscription_id,
      p_status,
      p_seats,
      p_current_period_start,
      p_current_period_end,
      COALESCE(p_metadata, '{}'::jsonb),
      p_event_created_at,
      p_event_id
    );
  ELSE
    UPDATE app.billing_subscriptions
    SET
      organization_id = p_organization_id,
      user_account_id = p_user_account_id,
      plan_key = p_plan_key,
      stripe_customer_id = p_stripe_customer_id,
      status = p_status,
      seats = p_seats,
      current_period_start = p_current_period_start,
      current_period_end = p_current_period_end,
      metadata = COALESCE(p_metadata, '{}'::jsonb),
      last_stripe_event_created_at = COALESCE(
        p_event_created_at,
        last_stripe_event_created_at
      ),
      last_stripe_event_id = CASE
        WHEN p_event_created_at IS NULL THEN last_stripe_event_id
        ELSE p_event_id
      END,
      updated_at = pg_catalog.now()
    WHERE id = v_subscription_id;
  END IF;

  UPDATE app.billing_payments
  SET
    seats = p_seats,
    updated_at = pg_catalog.now()
  WHERE stripe_subscription_id = p_stripe_subscription_id;

  IF p_billing_status IS NOT NULL THEN
    UPDATE app.organizations
    SET
      billing_status = p_billing_status,
      plan_key = CASE
        WHEN p_billing_status = 'active' THEN p_plan_key
        ELSE plan_key
      END,
      seat_limit = CASE
        WHEN p_billing_status = 'active' THEN p_seats
        ELSE seat_limit
      END,
      updated_at = pg_catalog.now()
    WHERE id = p_organization_id;
  END IF;

  INSERT INTO app.account_audit_events (
    organization_id,
    user_account_id,
    actor_clerk_user_id,
    event_type,
    metadata
  )
  VALUES (
    p_organization_id,
    p_user_account_id,
    p_metadata->>'clerkUserId',
    'stripe.subscription_status_updated',
    pg_catalog.jsonb_build_object(
      'stripeCustomerId', p_stripe_customer_id,
      'stripeSubscriptionId', p_stripe_subscription_id,
      'status', p_status,
      'planKey', p_plan_key,
      'seats', p_seats,
      'stripeEventCreatedAt', p_event_created_at,
      'stripeEventId', p_event_id
    )
  );

  RETURN QUERY SELECT true, true;
END;
$$;

REVOKE ALL ON FUNCTION app.claim_stripe_webhook_event(text, text, timestamptz, jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.claim_stripe_webhook_event(text, text, timestamptz, jsonb)
TO service_role;

REVOKE ALL ON FUNCTION app.apply_stripe_subscription_event(
  uuid, uuid, text, text, text, text, integer, timestamptz, timestamptz,
  jsonb, text, text, timestamptz
)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.apply_stripe_subscription_event(
  uuid, uuid, text, text, text, text, integer, timestamptz, timestamptz,
  jsonb, text, text, timestamptz
)
TO service_role;
