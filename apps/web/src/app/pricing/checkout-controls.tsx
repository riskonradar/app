"use client";

import { SignInButton, useAuth, useOrganization, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useRef, useState } from "react";

import type { BillingPlanKey } from "@/lib/billing/plans";

type PricingCheckoutButtonProps = {
  amountValue: string | null;
  additionalSeatPriceLabel: string | null;
  billingScope: "user" | "organization";
  includedSeats: number | null;
  planKey: BillingPlanKey;
};

export function PricingCheckoutButton(props: PricingCheckoutButtonProps) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) {
    return (
      <Link href="/sign-in" className="btn btn-primary btn-sm btn-full">
        Sign in to upgrade
      </Link>
    );
  }

  return <ConfiguredPricingCheckoutButton {...props} />;
}

function ConfiguredPricingCheckoutButton({
  amountValue,
  additionalSeatPriceLabel,
  billingScope,
  includedSeats,
  planKey,
}: PricingCheckoutButtonProps) {
  const { isSignedIn } = useUser();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const minimumSeats = includedSeats ?? 1;
  const [seats, setSeats] = useState(minimumSeats);
  const [paymentState, setPaymentState] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");
  const checkoutInFlight = useRef(false);

  async function startCheckout() {
    if (checkoutInFlight.current) return;

    if (!isSignedIn) {
      setPaymentState("error");
      setMessage("Please sign in before opening Stripe Checkout.");
      return;
    }

    checkoutInFlight.current = true;
    setPaymentState("loading");
    setMessage("");
    try {
      const token = await getToken();
      const response = await fetch("/api/billing/create-payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ planKey, seats }),
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
        sessionStorage.setItem("riskonradar-pending-stripe-session", pendingPayment);
        localStorage.setItem("riskonradar-pending-stripe-session", pendingPayment);
      }
      window.location.assign(payload.checkoutUrl);
    } catch (error) {
      checkoutInFlight.current = false;
      setPaymentState("error");
      setMessage(error instanceof Error ? error.message : "Could not open Stripe Checkout.");
    }
  }

  if (!amountValue) {
    return (
      <Link href="/account" className="btn btn-secondary btn-sm btn-full">
        Prepare enterprise setup
      </Link>
    );
  }

  const needsOrganization = billingScope === "organization" && !organization;

  return (
    <div className="pricing-checkout-control">
      {billingScope === "organization" ? (
        <>
          <label className="seat-quantity-control">
            <span>Seats</span>
            <input
              type="number"
              min={minimumSeats}
              max={100}
              step={1}
              value={seats}
              onChange={(event) => {
                const nextSeats = Number.parseInt(event.target.value, 10);
                setSeats(Math.min(100, Math.max(minimumSeats, nextSeats || minimumSeats)));
              }}
            />
          </label>
          {additionalSeatPriceLabel ? (
            <p className="pricing-organization-note">
              {minimumSeats} seats are included. {additionalSeatPriceLabel} after that.
            </p>
          ) : null}
        </>
      ) : null}
      {needsOrganization ? (
        <p className="pricing-organization-note">
          Select or create an organization before buying team seats.
        </p>
      ) : null}
      <button
        className="btn btn-primary btn-sm btn-full"
        type="button"
        onClick={startCheckout}
        disabled={paymentState === "loading" || needsOrganization}
      >
        {paymentState === "loading"
          ? "Opening checkout"
          : billingScope === "organization"
            ? `Buy ${seats} seats`
            : "Upgrade to Pro"}
      </button>
      {needsOrganization ? (
        <Link href="/account" className="btn btn-secondary btn-sm btn-full">
          Choose workspace
        </Link>
      ) : null}
      {paymentState === "error" && message && (
        <p className={`notice standalone ${paymentState === "error" ? "error" : ""}`}>
          {message}
        </p>
      )}
    </div>
  );
}

export function PricingPageActions() {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) {
    return (
      <div className="page-actions">
        <Link href="/sign-in" className="btn btn-primary btn-sm">
          Sign in to buy
        </Link>
        <Link href="/account" className="btn btn-secondary btn-sm">
          Manage account
        </Link>
        <Link href="/dashboard" className="btn btn-secondary btn-sm">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return <ConfiguredPricingPageActions />;
}

function ConfiguredPricingPageActions() {
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
