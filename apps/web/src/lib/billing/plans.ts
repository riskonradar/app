export type BillingPlanKey = "individual" | "team" | "enterprise";

export type BillingPlan = {
  key: BillingPlanKey;
  name: string;
  priceLabel: string;
  amountValue: string | null;
  includedSeats: number | null;
  additionalSeatAmountValue: string | null;
  additionalSeatPriceLabel: string | null;
  billingScope: "user" | "organization";
  description: string;
  features: string[];
};

export const billingPlans: BillingPlan[] = [
  {
    key: "individual",
    name: "Individual",
    priceLabel: "EUR 49 / month",
    amountValue: "49.00",
    includedSeats: 1,
    additionalSeatAmountValue: null,
    additionalSeatPriceLabel: null,
    billingScope: "user",
    description: "For one engineer validating evidence-backed reliability work.",
    features: [
      "Personal workspace",
      "Evidence-linked Failure Mode and Effects Analysis exports",
      "Saved analyses and review state",
      "Stripe-hosted checkout",
    ],
  },
  {
    key: "team",
    name: "Team",
    priceLabel: "EUR 399 / month",
    amountValue: "399.00",
    includedSeats: 3,
    additionalSeatAmountValue: "99.00",
    additionalSeatPriceLabel: "EUR 99 / additional seat / month",
    billingScope: "organization",
    description: "For reliability teams that need shared review and traceability.",
    features: [
      "Organization workspace",
      "3 named seats included",
      "Member invitations and roles",
      "Shared Failure Mode and Effects Analysis projects",
      "Audit trail for review decisions",
    ],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    priceLabel: "Custom",
    amountValue: null,
    includedSeats: null,
    additionalSeatAmountValue: null,
    additionalSeatPriceLabel: null,
    billingScope: "organization",
    description: "For procurement-led deployments with enterprise identity requirements.",
    features: [
      "SAML/OIDC SSO readiness",
      "Domain-controlled rollout",
      "Custom security and retention review",
      "Procurement-friendly billing",
    ],
  },
];

export function getBillingPlan(planKey: string | null | undefined) {
  return billingPlans.find((plan) => plan.key === planKey);
}

export function getPlanMonthlyAmount(plan: BillingPlan, seats: number) {
  const baseAmount = Number(plan.amountValue ?? 0);
  const includedSeats = plan.includedSeats ?? 1;
  const additionalSeatAmount = Number(plan.additionalSeatAmountValue ?? 0);
  const additionalSeats = Math.max(0, seats - includedSeats);

  return Number((baseAmount + additionalSeats * additionalSeatAmount).toFixed(2));
}
