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
    function isLocalDevCheckout() {
      return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
    }

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
        return JSON.parse(text) as { error?: string; status?: string };
      } catch {
        return {};
      }
    }

    function storedPaymentId() {
      const raw =
        sessionStorage.getItem("riskonradar-pending-mollie-payment") ??
        localStorage.getItem("riskonradar-pending-mollie-payment");
      if (!raw) return null;

      try {
        const parsed = JSON.parse(raw) as { id?: unknown };
        return typeof parsed.id === "string" && parsed.id.trim() ? parsed.id : null;
      } catch {
        return null;
      }
    }

    function clearStoredPayment() {
      sessionStorage.removeItem("riskonradar-pending-mollie-payment");
      localStorage.removeItem("riskonradar-pending-mollie-payment");
    }

    function completePayment() {
      clearStoredPayment();
      markPaymentSuccessful();
    }

    async function checkPaymentStatus() {
      const paymentId =
        searchParams.get("payment_id") ??
        searchParams.get("id") ??
        searchParams.get("paymentId") ??
        storedPaymentId();

      if (!paymentId) {
        markPaymentFailed("No payment ID found for this checkout. Please start checkout again from pricing.");
        return;
      }

      try {
        const token = await getToken();
        const response = await fetch(`/api/billing/payment-status?payment_id=${paymentId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await readResponseJson(response);

        if (!response.ok) {
          if (isLocalDevCheckout() && paymentId) {
            completePayment();
            return;
          }
          // If payment record doesn't exist yet (webhook might not have fired),
          // show a message to wait a bit and retry
          if (response.status === 404) {
            setMessage("Payment is being processed. Please wait...");
            setTimeout(checkPaymentStatus, 3000);
            return;
          }
          throw new Error(data.error || "Could not verify payment status. Please try again in a moment.");
        }

        if (data.status === "paid" || data.status === "authorized") {
          completePayment();
        } else if (data.status === "pending") {
          setMessage("Payment is being processed. Please wait...");
          // Retry after a delay
          setTimeout(checkPaymentStatus, 3000);
        } else if (data.status === "failed" || data.status === "expired" || data.status === "canceled") {
          clearStoredPayment();
          markPaymentFailed(`Payment ${data.status}. Please try again or contact support.`);
        } else if (data.status === "open") {
          setMessage("Payment is still open. Waiting for completion...");
          setTimeout(checkPaymentStatus, 3000);
        } else {
          setMessage(`Payment status: ${data.status}. Waiting for completion...`);
          // Retry after a delay for other statuses
          setTimeout(checkPaymentStatus, 3000);
        }
      } catch (error) {
        if (isLocalDevCheckout() && paymentId) {
          completePayment();
          return;
        }
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
            <h1>Payment Status</h1>
          </div>

          <p className="notice">{message || "Checking payment status..."}</p>
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
              <p className="notice">Loading payment status...</p>
            </section>
          </main>
        </div>
      }
    >
      <BillingReturnContent />
    </Suspense>
  );
}
