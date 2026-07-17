"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { AppNav } from "@/components/app-nav";

function BillingReturnContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const [message, setMessage] = useState("");

  useEffect(() => {
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

    async function checkPaymentStatus() {
      const sessionId = searchParams.get("session_id") ?? searchParams.get("id") ?? storedPaymentId();

      if (!sessionId) {
        markPaymentFailed("No Checkout Session found. Please start checkout again from pricing.");
        return;
      }

      try {
        const token = await getToken();
        const response = await fetch(`/api/billing/payment-status?session_id=${sessionId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await readResponseJson(response);

        if (!response.ok) {
          // If payment record doesn't exist yet (webhook might not have fired),
          // show a message to wait a bit and retry
          if (response.status === 404) {
            setMessage("Payment is being processed. Please wait...");
            setTimeout(checkPaymentStatus, 3000);
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
          setMessage("Checkout is still open. Waiting for completion...");
          // Retry after a delay
          setTimeout(checkPaymentStatus, 3000);
        } else if (data.status === "expired" || data.subscriptionStatus === "canceled") {
          clearStoredPayment();
          markPaymentFailed("Stripe Checkout did not complete. Please try again or contact support.");
        } else {
          setMessage(`Checkout status: ${data.status}. Waiting for completion...`);
          // Retry after a delay for other statuses
          setTimeout(checkPaymentStatus, 3000);
        }
      } catch (error) {
        markPaymentFailed(error instanceof Error ? error.message : "Could not verify payment status. Please contact support.");
      }
    }

    checkPaymentStatus();
  }, [getToken, router, searchParams]);

  return (
    <div className="app-shell">
      <AppNav />
      <main className="app-main">
        <section className="page-card">
          <div className="page-heading">
            <h1>Billing Status</h1>
          </div>

          <p className="notice">{message || "Checking Stripe Checkout status..."}</p>
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
          <main className="app-main">
            <section className="page-card">
              <p className="notice">Loading billing status...</p>
            </section>
          </main>
        </div>
      }
    >
      <BillingReturnContent />
    </Suspense>
  );
}
