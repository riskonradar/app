import Link from "next/link";

import { AppNav } from "@/components/app-nav";
import { billingPlans } from "@/lib/billing/plans";
import { PricingCheckoutButton, PricingPageActions } from "./checkout-controls";

const demoPlans = billingPlans.filter((plan) => plan.key === "individual");
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
            <h1>Risk on Radar Individual plan</h1>
            <p>
              Start with one Failure Mode and Effects Analysis table, then upgrade when you need unlimited reliability analyses.
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
            {demoPlans.map((plan) => (
              <article key={plan.key} className="pricing-plan primary">
                <div>
                  <span className="metric-label">Pro</span>
                  <strong>{plan.priceLabel}</strong>
                  <small>Unlimited Failure Mode and Effects Analysis tables</small>
                  <p>{plan.description}</p>
                </div>
                <ul>
                  {["Unlimited saved Failure Mode and Effects Analysis tables", ...plan.features.filter((feature) => feature !== "Mollie checkout")].map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <PricingCheckoutButton amountValue={plan.amountValue} planKey={plan.key} />
              </article>
            ))}
          </div>

          <PricingPageActions />
        </section>
      </main>
    </div>
  );
}
