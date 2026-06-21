"use client";

import { SignInButton, useAuth, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useState } from "react";

import { AppNav } from "@/components/app-nav";
import { type BillingPlanKey, billingPlans } from "@/lib/billing/plans";

export default function PricingPage() {
  const { isLoaded, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const [paymentState, setPaymentState] = useState<"idle" | "loading" | "error">("idle");
  const [selectedPlan, setSelectedPlan] = useState<BillingPlanKey | null>(null);
  const [message, setMessage] = useState(
    "Individual is for pilots. Team is the default workspace plan for B2B engineering teams.",
  );

  async function startCheckout(planKey: BillingPlanKey) {
    if (!isSignedIn) {
      setPaymentState("error");
      setSelectedPlan(planKey);
      setMessage("Please sign in before opening Mollie checkout.");
      return;
    }

    setPaymentState("loading");
    setSelectedPlan(planKey);
    setMessage("Opening Mollie checkout...");
    try {
      const token = await getToken();
      const response = await fetch("/api/billing/create-payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ planKey }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        checkoutUrl?: string;
        error?: string;
      };
      if (!response.ok || !payload.checkoutUrl) {
        throw new Error(payload.error || "Payment checkout is not available yet.");
      }
      window.location.assign(payload.checkoutUrl);
    } catch (error) {
      setPaymentState("error");
      setMessage(error instanceof Error ? error.message : "Could not open Mollie checkout.");
    }
  }

  return (
    <div className="app-shell">
      <AppNav />
      <main className="app-main pricing-main">
        <section className="page-card pricing-card pricing-card-wide">
          <div className="page-heading">
            <span className="metric-label">Pricing</span>
            <h1>Workspace plans for reliability teams</h1>
            <p>
              Price around the reviewed engineering workflow, not paper counts or AI calls. Use
              Individual for pilots, Team for shared FMEA review, and Enterprise when procurement
              requires SSO or custom terms.
            </p>
          </div>

          <div className="pricing-grid">
            {billingPlans.map((plan) => (
              <article key={plan.key} className={`pricing-plan ${plan.key === "team" ? "primary" : ""}`}>
                <div>
                  <span className="metric-label">{plan.name}</span>
                  <strong>{plan.priceLabel}</strong>
                  {plan.includedSeats ? (
                    <small>{plan.includedSeats} included named seat{plan.includedSeats === 1 ? "" : "s"}</small>
                  ) : (
                    <small>Annual agreement</small>
                  )}
                  <p>{plan.description}</p>
                </div>
                <ul>
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                {plan.amountValue ? (
                  <button
                    className="btn btn-primary btn-sm btn-full"
                    type="button"
                    onClick={() => startCheckout(plan.key)}
                    disabled={paymentState === "loading" && selectedPlan === plan.key}
                  >
                    {paymentState === "loading" && selectedPlan === plan.key
                      ? "Opening checkout"
                      : plan.key === "team"
                        ? "Buy team plan"
                        : "Buy individual"}
                  </button>
                ) : (
                  <Link href="/account" className="btn btn-secondary btn-sm btn-full">
                    Prepare enterprise setup
                  </Link>
                )}
              </article>
            ))}
          </div>

          <p className={`notice standalone ${paymentState === "error" ? "error" : ""}`}>
            {isLoaded ? message : "Checking sign-in state..."}
          </p>

          <div className="page-actions">
            {!isSignedIn && (
              <SignInButton mode="modal">
                <button className="btn btn-primary btn-sm" type="button">
                  Sign in to buy
                </button>
              </SignInButton>
            )}
            <Link href="/account" className="btn btn-secondary btn-sm">
              Manage account
            </Link>
            <Link href="/dashboard" className="btn btn-secondary btn-sm">
              Back to dashboard
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
