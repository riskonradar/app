import type Stripe from "stripe";
import { describe, expect, test } from "vitest";

import { normalizeClerkOrganizationRole } from "@/lib/auth/roles";
import { getBillingPlan, getPlanMonthlyAmount } from "@/lib/billing/plans";
import {
  resolveStripeSubscriptionBilling,
  resolveStripeSubscriptionBillingForPersistence,
} from "@/lib/billing/stripe-seats";
import { readFile } from "node:fs/promises";

function subscription(
  items: Array<{ priceId: string; quantity: number | null }>,
  metadata: Record<string, string> = {},
  status: Stripe.Subscription.Status = "active",
) {
  return {
    items: {
      data: items.map((item) => ({
        price: { id: item.priceId },
        quantity: item.quantity,
      })),
    },
    metadata,
    status,
  } as unknown as Stripe.Subscription;
}

const configuredPrices = {
  individualPriceId: "price_individual",
  teamPriceId: "price_team_base",
  teamExtraSeatPriceId: "price_team_extra",
};

describe("billing safety primitives", () => {
  test("the Team base price includes three seats and only extras add cost", () => {
    const team = getBillingPlan("team");
    expect(team).toBeDefined();
    expect(team?.includedSeats).toBe(3);
    expect(team?.additionalSeatAmountValue).toBe("99.00");
    expect(getPlanMonthlyAmount(team!, 3)).toBe(399);
    expect(getPlanMonthlyAmount(team!, 4)).toBe(498);
    expect(getPlanMonthlyAmount(team!, 7)).toBe(795);
  });

  test("Team entitlements require the configured base and count only configured extras", () => {
    const stripeSubscription = subscription([
      { priceId: "price_team_base", quantity: 1 },
      { priceId: "price_team_extra", quantity: 2 },
    ]);

    expect(
      resolveStripeSubscriptionBilling(
        stripeSubscription,
        configuredPrices,
      ),
    ).toEqual({ planKey: "team", seats: 5 });
    expect(
      resolveStripeSubscriptionBilling(
        subscription([{ priceId: "price_team_base", quantity: 99 }]),
        configuredPrices,
      ),
    ).toBeNull();
  });

  test("unknown prices and metadata-only seat claims fail closed", () => {
    expect(
      resolveStripeSubscriptionBilling(
        subscription([{ priceId: "price_unknown", quantity: 1 }], { seats: "6" }),
        configuredPrices,
      ),
    ).toBeNull();
  });

  test("Stripe prices override tampered plan and seat metadata", () => {
    expect(
      resolveStripeSubscriptionBilling(
        subscription(
          [{ priceId: "price_individual", quantity: 1 }],
          { planKey: "team", seats: "100" },
        ),
        configuredPrices,
      ),
    ).toEqual({ planKey: "individual", seats: 1 });

    expect(
      resolveStripeSubscriptionBilling(
        subscription(
          [{ priceId: "price_team_base", quantity: 1 }],
          { planKey: "individual", seats: "1" },
        ),
        configuredPrices,
      ),
    ).toEqual({ planKey: "team", seats: 3 });
  });

  test("duplicate, malformed, and mixed Stripe line items fail closed", () => {
    const unsafeItemSets = [
      [
        { priceId: "price_team_base", quantity: 1 },
        { priceId: "price_unknown", quantity: 1 },
      ],
      [
        { priceId: "price_team_base", quantity: 1 },
        { priceId: "price_team_extra", quantity: 1 },
        { priceId: "price_team_extra", quantity: 1 },
      ],
      [{ priceId: "price_team_extra", quantity: 2 }],
      [{ priceId: "price_individual", quantity: 0 }],
      [{ priceId: "price_team_base", quantity: null }],
      [{ priceId: "price_team_base", quantity: 1.5 }],
    ];

    for (const items of unsafeItemSets) {
      expect(
        resolveStripeSubscriptionBilling(subscription(items), configuredPrices),
      ).toBeNull();
    }
  });

  test("ambiguous configured Stripe price IDs fail closed", () => {
    expect(
      resolveStripeSubscriptionBilling(
        subscription([{ priceId: "price_shared", quantity: 1 }]),
        {
          individualPriceId: "price_shared",
          teamPriceId: "price_shared",
          teamExtraSeatPriceId: "price_extra",
        },
      ),
    ).toBeNull();
  });

  test("known non-entitling states can revoke a persisted unknown-price subscription", () => {
    for (const status of ["canceled", "incomplete_expired", "past_due", "paused"] as const) {
      expect(
        resolveStripeSubscriptionBillingForPersistence(
          subscription([{ priceId: "price_retired", quantity: 1 }], {}, status),
          configuredPrices,
          { planKey: "team", seats: 5 },
        ),
      ).toEqual({ planKey: "team", seats: 5 });
    }
  });

  test("unknown prices never entitle and terminal fallback requires a persisted subscription", () => {
    for (const status of ["active", "trialing"] as const) {
      expect(
        resolveStripeSubscriptionBillingForPersistence(
          subscription([{ priceId: "price_unknown", quantity: 1 }], {}, status),
          configuredPrices,
          { planKey: "team", seats: 5 },
        ),
      ).toBeNull();
    }

    expect(
      resolveStripeSubscriptionBillingForPersistence(
        subscription([{ priceId: "price_unknown", quantity: 1 }], {}, "canceled"),
        configuredPrices,
      ),
    ).toBeNull();
  });

  test("Clerk roles fail closed and map viewer explicitly", () => {
    expect(normalizeClerkOrganizationRole("org:owner")).toBe("owner");
    expect(normalizeClerkOrganizationRole("org:admin")).toBe("admin");
    expect(normalizeClerkOrganizationRole("org:member")).toBe("member");
    expect(normalizeClerkOrganizationRole("org:viewer")).toBe("viewer");
    expect(normalizeClerkOrganizationRole("future:custom-role")).toBe("viewer");
    expect(normalizeClerkOrganizationRole(undefined)).toBe("viewer");
  });

  test("exact Stripe event retries can recover external seat synchronization", async () => {
    const [migration, server] = await Promise.all([
      readFile("../../supabase/migrations/20260717191000_stripe_webhook_ordering.sql", "utf8"),
      readFile("src/lib/billing/server.ts", "utf8"),
    ]);

    expect(migration).toContain("p_event_id = v_last_event_id");
    expect(migration).toContain("RETURN QUERY SELECT false, true");
    expect(migration).toContain("INSERT INTO app.account_audit_events");
    expect(server).toContain("applyRow?.current_event !== true");
    expect(server.lastIndexOf("syncClerkOrganizationSeatLimit(")).toBeGreaterThan(
      server.indexOf("applyRow?.current_event !== true"),
    );
  });
});
