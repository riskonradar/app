export type BillingPlanKey = "individual" | "team" | "enterprise";

export type BillingPlan = {
  key: BillingPlanKey;
  name: string;
  priceLabel: string;
  amountValue: string | null;
  includedSeats: number | null;
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
    billingScope: "user",
    description: "For one engineer validating evidence-backed reliability work.",
    features: [
      "Personal workspace",
      "Evidence-linked FMEA exports",
      "Saved analyses and review state",
      "Mollie checkout",
    ],
  },
  {
    key: "team",
    name: "Team",
    priceLabel: "EUR 399 / month",
    amountValue: "399.00",
    includedSeats: 3,
    billingScope: "organization",
    description: "For reliability teams that need shared review and traceability.",
    features: [
      "Organization workspace",
      "Member invitations and roles",
      "Shared FMEA projects",
      "Audit trail for review decisions",
    ],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    priceLabel: "Custom",
    amountValue: null,
    includedSeats: null,
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
