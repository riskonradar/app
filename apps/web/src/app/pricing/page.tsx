"use client";

import { SignInButton, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useState } from "react";

import { AppNav } from "@/components/app-nav";

export default function PricingPage() {
  const { isLoaded, isSignedIn } = useUser();
  const [paymentState, setPaymentState] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("Sign in to purchase the paid plan with Mollie.");

  async function upgradePlan() {
    if (!isSignedIn) {
      setPaymentState("error");
      setMessage("Please sign in before opening Mollie checkout.");
      return;
    }

    setPaymentState("loading");
    setMessage("Opening Mollie checkout...");
    try {
      const response = await fetch("/api/billing/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountValue: "49.00",
          description: "Risk on Radar paid workspace",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        checkoutUrl?: string;
        error?: string;
      };
      if (!response.ok || !payload.checkoutUrl) {
        throw new Error(payload.error || "Payment checkout is not available yet.");
      }
      window.location.href = payload.checkoutUrl;
    } catch (error) {
      setPaymentState("error");
      setMessage(error instanceof Error ? error.message : "Could not open Mollie checkout.");
    }
  }

  return (
    <div className="app-shell">
      <AppNav />
      <main className="app-main">
        <section className="page-card pricing-card">
          <div className="page-heading">
            <span className="metric-label">Pricing</span>
            <h1>Paid reliability workspace</h1>
            <p>
              Purchase access for saved FMEA projects, export workflows, review history, and future
              team collaboration features.
            </p>
          </div>

          <div className="pricing-panel">
            <div>
              <span className="metric-label">Monthly</span>
              <strong>EUR 49</strong>
              <p>For engineering teams validating evidence-backed FMEA worksheets.</p>
            </div>
            <ul>
              <li>Saved reliability projects</li>
              <li>Evidence-linked FMEA exports</li>
              <li>Review state and audit history</li>
              <li>Dashboard project tracking</li>
            </ul>
          </div>

          <p className={`notice standalone ${paymentState === "error" ? "error" : ""}`}>
            {isLoaded ? message : "Checking sign-in state..."}
          </p>

          <div className="page-actions">
            {isSignedIn ? (
              <button
                className="btn btn-primary btn-sm"
                type="button"
                onClick={upgradePlan}
                disabled={paymentState === "loading"}
              >
                {paymentState === "loading" ? "Opening checkout" : "Buy with Mollie"}
              </button>
            ) : (
              <SignInButton mode="modal">
                <button className="btn btn-primary btn-sm" type="button">
                  Sign in to buy
                </button>
              </SignInButton>
            )}
            <Link href="/" className="btn btn-secondary btn-sm">
              Back to home
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
