import Link from "next/link";

import { AppNav } from "@/components/app-nav";
import { billingPlans } from "@/lib/billing/plans";
import { PricingCheckoutButton, PricingPageActions } from "./checkout-controls";

const selfServePlans = billingPlans.filter(
  (plan) => plan.key === "individual" || plan.key === "team",
);
const freePlan = {
  name: "Free",
  priceLabel: "EUR 0",
  description: "For trying the Failure Mode and Effects Analysis workspace before upgrading.",
  features: [
    "1 saved Failure Mode and Effects Analysis table",
    "Evidence-backed worksheet editing",
    "CSV and XLSX export preview",
  ],
};

export default function PricingPage() {
  return (
    <div className="app-shell">
      <AppNav />
      <main className="app-main pricing-main">
        <section className="page-card pricing-card pricing-card-wide">
          <div className="page-heading">
            <span className="metric-label">Pricing</span>
            <h1>Risk on Radar plans</h1>
            <p>
              Start with one Failure Mode and Effects Analysis table, then upgrade for unlimited individual or team workflows.
            </p>
          </div>

          <div className="pricing-grid">
            <article className="pricing-plan">
              <div>
                <span className="metric-label">{freePlan.name}</span>
                <strong>{freePlan.priceLabel}</strong>
                <small>1 Failure Mode and Effects Analysis table</small>
                <p>{freePlan.description}</p>
              </div>
              <ul>
                {freePlan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <Link href="/fmea?mode=new" className="btn btn-secondary btn-sm btn-full">
                Start free
              </Link>
            </article>
            {selfServePlans.map((plan) => (
              <article key={plan.key} className="pricing-plan primary">
                <div>
                  <span className="metric-label">{plan.name}</span>
                  <strong>{plan.priceLabel}</strong>
                  <small>
                    {plan.billingScope === "organization"
                      ? `${plan.includedSeats ?? 1} seats included`
                      : "1 named user"}
                  </small>
                  <p>{plan.description}</p>
                </div>
                <ul>
                  {["Unlimited saved Failure Mode and Effects Analysis tables", ...plan.features].map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <PricingCheckoutButton
                  amountValue={plan.amountValue}
                  additionalSeatPriceLabel={plan.additionalSeatPriceLabel}
                  billingScope={plan.billingScope}
                  includedSeats={plan.includedSeats}
                  planKey={plan.key}
                />
              </article>
            ))}
          </div>

          <PricingPageActions />
        </section>
      </main>
    </div>
  );
}
