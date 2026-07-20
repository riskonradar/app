"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { AppNav } from "@/components/app-nav";

const STATUS_POLL_INTERVAL_MS = 3_000;
const MAX_STATUS_CHECKS = 20;

type BillingCheckState = {
  kind: "checking" | "delayed" | "error";
  message: string;
};

function BillingReturnContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const [checkState, setCheckState] = useState<BillingCheckState>({
    kind: "checking",
    message: "Checking Stripe Checkout status…",
  });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let attempts = 0;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    function markPaymentSuccessful() {
      router.replace("/billing/success");
    }

    function markPaymentFailed(reason: string) {
      const params = new URLSearchParams({ reason });
      router.replace(`/billing/failed?${params.toString()}`);
    }

    async function readResponseJson(response: Response) {
      const text = await response.text();
      if (!text.trim()) return {};
      try {
        return JSON.parse(text) as {
          error?: string;
          status?: string;
          paymentStatus?: string;
          subscriptionStatus?: string | null;
        };
      } catch {
        return {};
      }
    }

    function storedPaymentId() {
      const raw =
        sessionStorage.getItem("riskonradar-pending-stripe-session") ??
        localStorage.getItem("riskonradar-pending-stripe-session");
      if (!raw) return null;

      try {
        const parsed = JSON.parse(raw) as { id?: unknown };
        return typeof parsed.id === "string" && parsed.id.trim() ? parsed.id : null;
      } catch {
        return null;
      }
    }

    function clearStoredPayment() {
      sessionStorage.removeItem("riskonradar-pending-stripe-session");
      localStorage.removeItem("riskonradar-pending-stripe-session");
    }

    function completePayment() {
      clearStoredPayment();
      markPaymentSuccessful();
    }

    const sessionId = searchParams.get("session_id") ?? searchParams.get("id") ?? storedPaymentId();

    function waitForStripe(message: string) {
      if (cancelled) return;
      if (attempts >= MAX_STATUS_CHECKS) {
        setCheckState({
          kind: "delayed",
          message: "Stripe is taking longer than expected. Your payment has not been marked as failed; check again or review the workspace plan from Account.",
        });
        return;
      }
      setCheckState({ kind: "checking", message });
      timeoutId = setTimeout(checkPaymentStatus, STATUS_POLL_INTERVAL_MS);
    }

    async function checkPaymentStatus() {
      if (cancelled) return;

      if (!sessionId) {
        markPaymentFailed("No Checkout Session found. Please start checkout again from pricing.");
        return;
      }

      try {
        attempts += 1;
        controller = new AbortController();
        const token = await getToken();
        const response = await fetch(`/api/billing/payment-status?session_id=${encodeURIComponent(sessionId)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        });
        const data = await readResponseJson(response);
        if (cancelled) return;

        if (!response.ok) {
          if (response.status === 404) {
            waitForStripe("Payment is being processed. Waiting for Stripe confirmation…");
            return;
          }
          throw new Error(data.error || "Could not verify payment status. Please try again in a moment.");
        }

        if (
          data.status === "complete" ||
          data.paymentStatus === "paid" ||
          data.subscriptionStatus === "active" ||
          data.subscriptionStatus === "trialing"
        ) {
          completePayment();
        } else if (data.status === "open") {
          waitForStripe("Checkout is still open. Waiting for completion…");
        } else if (data.status === "expired" || data.subscriptionStatus === "canceled") {
          clearStoredPayment();
          markPaymentFailed("Stripe Checkout did not complete. Please try again or contact support.");
        } else {
          waitForStripe("Stripe has not finalized the checkout yet. Waiting for confirmation…");
        }
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        setCheckState({
          kind: "error",
          message: error instanceof Error
            ? error.message
            : "Could not verify payment status. Your plan has not been changed in the browser.",
        });
      }
    }

    void checkPaymentStatus();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      controller?.abort();
    };
  }, [getToken, retryKey, router, searchParams]);

  const canRetry = checkState.kind === "delayed" || checkState.kind === "error";

  return (
    <div className="app-shell">
      <AppNav />
      <main id="main-content" className="app-main billing-result-main" tabIndex={-1}>
        <section className="page-card billing-status-card" aria-labelledby="billing-status-title">
          <div className="page-heading">
            <span className="metric-label">Secure checkout</span>
            <h1 id="billing-status-title">Confirming your payment</h1>
            <p>Plan access changes only after the server verifies Stripe’s checkout status.</p>
          </div>

          <p
            className={`notice standalone ${checkState.kind === "error" ? "error" : ""}`}
            role={checkState.kind === "error" ? "alert" : "status"}
            aria-live={checkState.kind === "error" ? "assertive" : "polite"}
            aria-busy={checkState.kind === "checking"}
          >
            {checkState.message}
          </p>
          {canRetry ? (
            <div className="page-actions">
              <button
                className="btn btn-primary btn-sm"
                type="button"
                onClick={() => {
                  setCheckState({ kind: "checking", message: "Checking Stripe Checkout status again…" });
                  setRetryKey((value) => value + 1);
                }}
              >
                Check again
              </button>
              <Link href="/account" className="btn btn-secondary btn-sm">View account</Link>
              <Link href="/pricing" className="btn btn-secondary btn-sm">Return to pricing</Link>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}

export default function BillingReturnPage() {
  return (
    <Suspense
      fallback={
        <div className="app-shell">
          <AppNav />
          <main id="main-content" className="app-main billing-result-main" tabIndex={-1}>
            <section className="page-card billing-status-card" aria-busy="true">
              <h1 className="visually-hidden">Confirming your payment</h1>
              <p className="notice" role="status">Loading billing status…</p>
            </section>
          </main>
        </div>
      }
    >
      <BillingReturnContent />
    </Suspense>
  );
}
