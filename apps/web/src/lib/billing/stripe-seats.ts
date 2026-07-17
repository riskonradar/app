import type Stripe from "stripe";

export type StripePriceConfiguration = {
  individualPriceId: string | null;
  teamPriceId: string | null;
  teamExtraSeatPriceId: string | null;
};

export type PersistedSubscriptionBilling = {
  planKey: string | null | undefined;
  seats: number | null | undefined;
};

const KNOWN_NON_ENTITLING_STATUSES = new Set([
  "canceled",
  "incomplete",
  "incomplete_expired",
  "past_due",
  "paused",
  "unpaid",
]);

function objectId(value: string | { id: string } | null | undefined) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

export function resolveStripeSubscriptionBilling(
  subscription: Stripe.Subscription,
  prices: StripePriceConfiguration,
): { planKey: "individual" | "team"; seats: number } | null {
  const configuredPriceIds = [
    prices.individualPriceId,
    prices.teamPriceId,
    prices.teamExtraSeatPriceId,
  ].filter((priceId): priceId is string => Boolean(priceId));
  if (new Set(configuredPriceIds).size !== configuredPriceIds.length) {
    return null;
  }

  const items = subscription.items.data.map((item) => ({
    priceId: objectId(item.price),
    quantity: positiveInteger(item.quantity),
  }));

  if (
    prices.individualPriceId
    && items.length === 1
    && items[0].priceId === prices.individualPriceId
    && items[0].quantity === 1
  ) {
    return { planKey: "individual", seats: 1 };
  }

  if (!prices.teamPriceId) return null;
  const baseItems = items.filter((item) => item.priceId === prices.teamPriceId);
  const extraItems = prices.teamExtraSeatPriceId
    ? items.filter((item) => item.priceId === prices.teamExtraSeatPriceId)
    : [];
  const allowedPriceIds = new Set(
    [prices.teamPriceId, prices.teamExtraSeatPriceId].filter(Boolean),
  );
  if (
    baseItems.length !== 1
    || baseItems[0].quantity !== 1
    || extraItems.length > 1
    || items.length !== 1 + extraItems.length
    || items.some((item) => item.quantity === null)
    || items.some((item) => !item.priceId || !allowedPriceIds.has(item.priceId))
    || (!prices.teamExtraSeatPriceId && items.length !== 1)
  ) {
    return null;
  }

  return {
    planKey: "team",
    seats: 3 + extraItems.reduce((total, item) => total + (item.quantity ?? 0), 0),
  };
}

export function resolveStripeSubscriptionBillingForPersistence(
  subscription: Stripe.Subscription,
  prices: StripePriceConfiguration,
  persisted?: PersistedSubscriptionBilling | null,
): { planKey: string; seats: number } | null {
  const priceDerived = resolveStripeSubscriptionBilling(subscription, prices);
  if (priceDerived) return priceDerived;

  // Unknown prices must never grant or extend entitlement. For an existing
  // subscription moving to a known non-entitling state, however, retaining the
  // stored identity is necessary so cancellation/past-due state can be applied.
  if (
    !KNOWN_NON_ENTITLING_STATUSES.has(subscription.status)
    || !persisted?.planKey
    || typeof persisted.seats !== "number"
    || !Number.isSafeInteger(persisted.seats)
    || persisted.seats < 1
  ) {
    return null;
  }

  return {
    planKey: persisted.planKey,
    seats: persisted.seats,
  };
}
