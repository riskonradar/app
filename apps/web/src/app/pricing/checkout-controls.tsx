"use client";

import { SignInButton, useAuth, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useState } from "react";

import type { BillingPlanKey } from "@/lib/billing/plans";

type PricingCheckoutButtonProps = {
  amountValue: string | null;
  planKey: BillingPlanKey;
};

export function PricingCheckoutButton({ amountValue, planKey }: PricingCheckoutButtonProps) {
  const { isSignedIn } = useUser();
  const { getToken } = useAuth();
  const [paymentState, setPaymentState] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");

  async function startCheckout() {
    if (!isSignedIn) {
      setPaymentState("error");
      setMessage("Please sign in before opening Mollie checkout.");
      return;
    }

    setPaymentState("loading");
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
        id?: string;
        checkoutUrl?: string;
        error?: string;
      };
      if (!response.ok || !payload.checkoutUrl) {
        throw new Error(payload.error || "Payment checkout is not available yet.");
      }
      if (payload.id) {
        const pendingPayment = JSON.stringify({
          id: payload.id,
          planKey,
          createdAt: new Date().toISOString(),
        });
        sessionStorage.setItem("riskonradar-pending-mollie-payment", pendingPayment);
        localStorage.setItem("riskonradar-pending-mollie-payment", pendingPayment);
      }
      window.location.assign(payload.checkoutUrl);
    } catch (error) {
      setPaymentState("error");
      setMessage(error instanceof Error ? error.message : "Could not open Mollie checkout.");
    }
  }

  if (!amountValue) {
    return (
      <Link href="/account" className="btn btn-secondary btn-sm btn-full">
        Prepare enterprise setup
      </Link>
    );
  }

  return (
    <div className="pricing-checkout-control">
      <button
        className="btn btn-primary btn-sm btn-full"
        type="button"
        onClick={startCheckout}
        disabled={paymentState === "loading"}
      >
        {paymentState === "loading" ? "Opening checkout" : "Upgrade to Pro"}
      </button>
      {message && (
        <p className={`notice standalone ${paymentState === "error" ? "error" : ""}`}>
          {message}
        </p>
      )}
    </div>
  );
}

export function PricingPageActions() {
  const { isLoaded, isSignedIn } = useUser();

  return (
    <>
      {!isLoaded && <p className="notice standalone">Checking sign-in state...</p>}
      <div className="page-actions">
        {isLoaded && !isSignedIn && (
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
    </>
  );
}
