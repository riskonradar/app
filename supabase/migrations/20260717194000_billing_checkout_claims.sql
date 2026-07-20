-- Serialize Stripe Checkout creation per workspace without holding a database
-- transaction open across Stripe API calls. Identical requests share a short
-- idempotency lease; different plan/seat requests fail until that lease ends.

ALTER TABLE app.organizations
  ADD COLUMN billing_checkout_claim_token uuid,
  ADD COLUMN billing_checkout_claimed_at timestamptz,
  ADD COLUMN billing_checkout_fingerprint text;

ALTER TABLE app.organizations
  ADD CONSTRAINT organizations_billing_checkout_claim_check CHECK (
    (
      billing_checkout_claim_token IS NULL
      AND billing_checkout_claimed_at IS NULL
      AND billing_checkout_fingerprint IS NULL
    )
    OR (
      billing_checkout_claim_token IS NOT NULL
      AND billing_checkout_claimed_at IS NOT NULL
      AND nullif(btrim(billing_checkout_fingerprint), '') IS NOT NULL
    )
  );

CREATE UNIQUE INDEX billing_customers_organization_unique_idx
  ON app.billing_customers(organization_id)
  WHERE organization_id IS NOT NULL;

CREATE UNIQUE INDEX billing_subscriptions_one_non_terminal_per_organization_idx
  ON app.billing_subscriptions(organization_id)
  WHERE organization_id IS NOT NULL
    AND status IN (
      'active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'
    );

CREATE OR REPLACE FUNCTION app.claim_billing_checkout(
  p_organization_id uuid,
  p_fingerprint text
)
RETURNS TABLE(
  claimed boolean,
  claim_token uuid,
  claim_expires_at timestamptz,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token uuid;
  v_claimed_at timestamptz;
  v_fingerprint text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = '42501';
  END IF;
  IF nullif(pg_catalog.btrim(p_fingerprint), '') IS NULL THEN
    RAISE EXCEPTION 'checkout fingerprint is required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM app.billing_subscriptions subscription
    WHERE subscription.organization_id = p_organization_id
      AND subscription.status IN (
        'active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'
      )
  ) THEN
    RETURN QUERY SELECT
      false,
      null::uuid,
      null::timestamptz,
      'subscription_exists'::text;
    RETURN;
  END IF;

  SELECT
    organization.billing_checkout_claim_token,
    organization.billing_checkout_claimed_at,
    organization.billing_checkout_fingerprint
  INTO v_token, v_claimed_at, v_fingerprint
  FROM app.organizations organization
  WHERE organization.id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_token IS NOT NULL
    AND v_claimed_at >= pg_catalog.now() - pg_catalog.make_interval(mins => 35)
  THEN
    IF v_fingerprint = p_fingerprint THEN
      -- Concurrent and retried identical requests are safe because both Stripe
      -- customer and Checkout creation use this token as their idempotency key.
      RETURN QUERY SELECT
        true,
        v_token,
        v_claimed_at + pg_catalog.make_interval(mins => 35),
        'claim_reused'::text;
    ELSE
      RETURN QUERY SELECT
        false,
        null::uuid,
        v_claimed_at + pg_catalog.make_interval(mins => 35),
        'checkout_in_progress'::text;
    END IF;
    RETURN;
  END IF;

  -- An expired lease must receive a fresh Stripe idempotency key. Reusing the
  -- old token would keep returning the old, expired Checkout Session forever.
  v_token := extensions.gen_random_uuid();
  v_claimed_at := pg_catalog.now();

  UPDATE app.organizations
  SET
    billing_checkout_claim_token = v_token,
    billing_checkout_claimed_at = v_claimed_at,
    billing_checkout_fingerprint = p_fingerprint,
    updated_at = pg_catalog.now()
  WHERE id = p_organization_id;

  RETURN QUERY SELECT
    true,
    v_token,
    v_claimed_at + pg_catalog.make_interval(mins => 35),
    'claimed'::text;
END;
$$;

CREATE OR REPLACE FUNCTION app.release_billing_checkout_claim(
  p_organization_id uuid,
  p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = '42501';
  END IF;

  UPDATE app.organizations
  SET
    billing_checkout_claim_token = NULL,
    billing_checkout_claimed_at = NULL,
    billing_checkout_fingerprint = NULL,
    updated_at = pg_catalog.now()
  WHERE id = p_organization_id
    AND billing_checkout_claim_token = p_claim_token;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

CREATE OR REPLACE FUNCTION app.clear_billing_checkout_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.organization_id IS NOT NULL
    AND NEW.status IN (
      'active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'
    )
  THEN
    UPDATE app.organizations
    SET
      billing_checkout_claim_token = NULL,
      billing_checkout_claimed_at = NULL,
      billing_checkout_fingerprint = NULL,
      updated_at = pg_catalog.now()
    WHERE id = NEW.organization_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER clear_billing_checkout_claim_on_subscription
  AFTER INSERT OR UPDATE OF status ON app.billing_subscriptions
  FOR EACH ROW EXECUTE FUNCTION app.clear_billing_checkout_claim();

REVOKE ALL ON FUNCTION app.claim_billing_checkout(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.claim_billing_checkout(uuid, text)
  TO service_role;
REVOKE ALL ON FUNCTION app.release_billing_checkout_claim(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.release_billing_checkout_claim(uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION app.clear_billing_checkout_claim()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.clear_billing_checkout_claim()
  TO service_role;
