import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

describe("Stripe billing checkout hardening", () => {
  test("Stripe configuration uses server-only secrets and price IDs", async () => {
    const [configSource, stripeSource, packageSource] = await Promise.all([
      readFile("src/lib/config.ts", "utf8"),
      readFile("src/lib/stripe/server.ts", "utf8"),
      readFile("package.json", "utf8"),
    ]);

    expect(packageSource).toContain('"stripe"');
    expect(configSource).toContain("STRIPE_SECRET_KEY");
    expect(configSource).toContain("STRIPE_WEBHOOK_SECRET");
    expect(configSource).toContain("isStripeConfigured");
    expect(configSource).toContain("STRIPE_TAX_ENABLED");
    expect(configSource).toContain("isStripeLiveMode");
    expect(stripeSource).toContain("STRIPE_INDIVIDUAL_PRICE_ID");
    expect(stripeSource).toContain("STRIPE_TEAM_PRICE_ID");
    expect(stripeSource).toContain("STRIPE_TEAM_EXTRA_SEAT_PRICE_ID");
    expect(stripeSource).toContain("2026-06-24.dahlia");
  });

  test("checkout creates a Stripe subscription Checkout Session for workspace owners and admins", async () => {
    const source = await readFile("src/app/api/billing/create-payment/route.ts", "utf8");

    expect(source).toContain('requireWorkspaceMutationAccess(request, "billing")');
    expect(source).toContain('mode: "subscription"');
    expect(source).toContain("getStripePriceId(plan.key)");
    expect(source).toContain("plan.billingScope !== workspaceBillingScope");
    expect(source).toContain("Switch to your personal workspace");
    expect(source).toContain("stripe.checkout.sessions.create");
    expect(source).toContain("stripe_checkout_session_id");
    expect(source).toContain("stripe.checkout_session_created");
    expect(source).toContain("Stripe did not return a checkout URL");
    expect(source).toContain('rpc("claim_billing_checkout"');
    expect(source).toContain("checkoutClaim.claim_expires_at");
    expect(source).toContain("riskonradar-checkout-${checkoutClaimToken}");
    expect(source).toContain("stripe.checkout.sessions.expire(session.id)");
    expect(source).toContain("releaseBillingCheckoutClaim");
    expect(source).toContain("Could not persist Stripe Checkout");
    expect(source).toContain("quantity: 1");
    expect(source).toContain("quantity: additionalSeats");
    expect(source).toContain("getPlanMonthlyAmount(plan, seats)");
    expect(source).not.toContain("quantity: seats");
    expect(source).toContain('billing_address_collection: "required"');
    expect(source).toContain("tax_id_collection");
    expect(source).toContain("automatic_tax");
    expect(source).toContain("Live Stripe Checkout is blocked until Stripe Tax is configured and enabled.");
  });

  test("Stripe webhooks verify signatures and process app-created sessions idempotently", async () => {
    const [webhookSource, billingSource] = await Promise.all([
      readFile("src/app/api/billing/stripe-webhook/route.ts", "utf8"),
      readFile("src/lib/billing/server.ts", "utf8"),
    ]);

    expect(webhookSource).toContain('request.headers.get("stripe-signature")');
    expect(webhookSource).toContain("request.text()");
    expect(webhookSource).toContain("webhooks.constructEvent");
    expect(webhookSource).toContain("beginStripeWebhookEvent(event)");
    expect(webhookSource).toContain("completeStripeWebhookEvent(event.id)");
    expect(webhookSource).toContain("failStripeWebhookEvent(event.id");
    expect(webhookSource).toContain('headers: { "Retry-After": "60" }');
    expect(webhookSource).toContain("checkout.session.completed");
    expect(webhookSource).toContain("checkout.session.expired");
    expect(webhookSource).toContain("persistStripeExpiredCheckoutSession");
    expect(webhookSource).toContain("customer.subscription.updated");
    expect(webhookSource).toContain("subscriptions.retrieve(eventSubscription.id)");
    expect(billingSource).toContain("Stripe Checkout Session was not created by this application.");
    expect(billingSource).toContain("stripe_webhook_events");
    expect(billingSource).toContain('rpc("claim_stripe_webhook_event"');
    expect(billingSource).toContain('"apply_stripe_subscription_event"');
    expect(billingSource).toContain("eventContext.eventCreated");
    expect(billingSource).toContain("maxAllowedMemberships: seats");
    expect(billingSource).toContain('status: "expired"');
    expect(billingSource).toContain('checkout_url: null');
    expect(billingSource).toContain('rpc("release_billing_checkout_claim"');
  });

  test("customer portal is workspace-gated and returns a Stripe-hosted session", async () => {
    const source = await readFile("src/app/api/billing/customer-portal/route.ts", "utf8");

    expect(source).toContain('requireWorkspaceMutationAccess(request, "billing")');
    expect(source).toContain('from("billing_customers")');
    expect(source).toContain("billingPortal.sessions.create");
    expect(source).toContain("getStripeCustomerPortalConfigurationId");
    expect(source).toContain("isStripeLiveMode() && !configuration");
    expect(source).toContain("billingPortal.configurations.retrieve(configuration)");
    expect(source).toContain("features.subscription_update.enabled");
    expect(source).toContain("resolveStripeSubscriptionBilling");
    expect(source).toContain("...(configuration ? { configuration } : {})");
    expect(source).toContain('return_url: `${appBaseUrl(request)}/account`');
    expect(source).toContain("stripe.customer_portal_opened");
  });

  test("billing schema migration stores Stripe identifiers and webhook event ids", async () => {
    const [source, orderingSource, checkoutClaimSource] = await Promise.all([
      readFile("../../supabase/migrations/20260711100000_stripe_billing.sql", "utf8"),
      readFile("../../supabase/migrations/20260717191000_stripe_webhook_ordering.sql", "utf8"),
      readFile("../../supabase/migrations/20260717194000_billing_checkout_claims.sql", "utf8"),
    ]);
    const legacyProviderPrefix = ["mol", "lie"].join("");

    expect(source).toContain("stripe_checkout_session_id");
    expect(source).toContain("stripe_customer_id");
    expect(source).toContain("stripe_subscription_id");
    expect(source).toContain("app.stripe_webhook_events");
    expect(source).toContain("CHECK (status IN ('processing', 'completed', 'failed'))");
    expect(source).toContain(`DROP COLUMN IF EXISTS ${legacyProviderPrefix}_payment_id`);
    expect(source).toContain(`DROP COLUMN IF EXISTS ${legacyProviderPrefix}_subscription_id`);
    expect(orderingSource).toContain("app.claim_stripe_webhook_event");
    expect(orderingSource).toContain("ON CONFLICT (id) DO NOTHING");
    expect(orderingSource).toContain("status = 'failed'");
    expect(orderingSource).toContain("claimed_at < pg_catalog.now()");
    expect(orderingSource).toContain("pg_advisory_xact_lock");
    expect(orderingSource).toContain("last_stripe_event_created_at");
    expect(orderingSource).toContain("p_event_created_at < v_last_event_created_at");
    expect(orderingSource).not.toContain("COALESCE(p_event_id, '') <=");
    expect(orderingSource).toContain("UPDATE app.organizations");
    expect(orderingSource).toContain("stripe.subscription_status_updated");
    expect(orderingSource).toContain("INSERT INTO app.account_audit_events");
    expect(checkoutClaimSource).toContain("app.claim_billing_checkout");
    expect(checkoutClaimSource).toContain("pg_advisory_xact_lock");
    expect(checkoutClaimSource).toContain("v_fingerprint = p_fingerprint");
    expect(checkoutClaimSource).toContain("'claim_reused'::text");
    expect(checkoutClaimSource).toContain("app.release_billing_checkout_claim");
    expect(checkoutClaimSource).toContain("billing_checkout_claim_token = p_claim_token");
    expect(checkoutClaimSource).toContain(
      "billing_subscriptions_one_non_terminal_per_organization_idx",
    );
    expect(checkoutClaimSource).toContain("'active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'");
  });

  test("same-second subscription events reconcile from Stripe current state", async () => {
    const [webhookSource, orderingSource] = await Promise.all([
      readFile("src/app/api/billing/stripe-webhook/route.ts", "utf8"),
      readFile("../../supabase/migrations/20260717191000_stripe_webhook_ordering.sql", "utf8"),
    ]);

    expect(webhookSource).toContain("subscriptions.retrieve(eventSubscription.id)");
    expect(webhookSource).toContain("subscriptionEventContext(event)");
    expect(orderingSource).toContain("p_event_created_at < v_last_event_created_at");
    expect(orderingSource).not.toContain("p_event_created_at = v_last_event_created_at");
    expect(orderingSource).not.toContain("p_event_id < v_last_event_id");
  });
});
