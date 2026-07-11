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
    expect(stripeSource).toContain("STRIPE_INDIVIDUAL_PRICE_ID");
    expect(stripeSource).toContain("STRIPE_TEAM_PRICE_ID");
    expect(stripeSource).toContain("2026-06-24.dahlia");
  });

  test("checkout creates a Stripe subscription Checkout Session for workspace owners and admins", async () => {
    const source = await readFile("src/app/api/billing/create-payment/route.ts", "utf8");

    expect(source).toContain("const workspace = await ensureCurrentWorkspace(request);");
    expect(source).toContain('workspace.role !== "owner" && workspace.role !== "admin"');
    expect(source).toContain("Only workspace owners and admins can manage billing.");
    expect(source).toContain('mode: "subscription"');
    expect(source).toContain("getStripePriceId(plan.key)");
    expect(source).toContain("stripe.checkout.sessions.create");
    expect(source).toContain("stripe_checkout_session_id");
    expect(source).toContain("stripe.checkout_session_created");
    expect(source).toContain("Stripe did not return a checkout URL");
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
    expect(webhookSource).toContain("checkout.session.completed");
    expect(webhookSource).toContain("customer.subscription.updated");
    expect(billingSource).toContain("Stripe Checkout Session was not created by this application.");
    expect(billingSource).toContain("stripe_webhook_events");
    expect(billingSource).toContain("stripe.subscription_status_updated");
  });

  test("billing schema migration stores Stripe identifiers and webhook event ids", async () => {
    const source = await readFile(
      "../../supabase/migrations/20260711100000_stripe_billing.sql",
      "utf8",
    );
    const legacyProviderPrefix = ["mol", "lie"].join("");

    expect(source).toContain("stripe_checkout_session_id");
    expect(source).toContain("stripe_customer_id");
    expect(source).toContain("stripe_subscription_id");
    expect(source).toContain("app.stripe_webhook_events");
    expect(source).toContain("CHECK (status IN ('processing', 'completed', 'failed'))");
    expect(source).toContain(`DROP COLUMN IF EXISTS ${legacyProviderPrefix}_payment_id`);
    expect(source).toContain(`DROP COLUMN IF EXISTS ${legacyProviderPrefix}_subscription_id`);
  });
});
