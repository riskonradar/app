"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { AppNav } from "@/components/app-nav";

function BillingReturnContent() {
  const searchParams = useSearchParams();
  const { getToken } = useAuth();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
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

    async function checkPaymentStatus() {
      const paymentId =
        searchParams.get("payment_id") ??
        searchParams.get("id") ??
        searchParams.get("paymentId") ??
        storedPaymentId();

      if (!paymentId) {
        setStatus("error");
        setMessage("No payment ID found for this checkout. Please start checkout again from pricing.");
        return;
      }

      try {
        const token = await getToken();
        const response = await fetch(`/api/billing/payment-status?payment_id=${paymentId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await readResponseJson(response);

        if (!response.ok) {
          // If payment record doesn't exist yet (webhook might not have fired),
          // show a message to wait a bit and retry
          if (response.status === 404) {
            setStatus("loading");
            setMessage("Payment is being processed. Please wait...");
            setTimeout(checkPaymentStatus, 3000);
            return;
          }
          throw new Error(data.error || "Could not verify payment status. Please try again in a moment.");
        }

        if (data.status === "paid" || data.status === "authorized") {
          clearStoredPayment();
          localStorage.setItem(
            "riskonradar-membership",
            JSON.stringify({
              planKey: "individual",
              status: "paid",
              paidAt: new Date().toISOString(),
            }),
          );
          setStatus("success");
          setMessage("Payment successful. You are now a Pro member.");
        } else if (data.status === "pending") {
          setStatus("loading");
          setMessage("Payment is being processed. Please wait...");
          // Retry after a delay
          setTimeout(checkPaymentStatus, 3000);
        } else if (data.status === "failed" || data.status === "expired" || data.status === "canceled") {
          clearStoredPayment();
          setStatus("error");
          setMessage(`Payment ${data.status}. Please try again or contact support.`);
        } else if (data.status === "open") {
          setStatus("loading");
          setMessage("Payment is still open. Waiting for completion...");
          setTimeout(checkPaymentStatus, 3000);
        } else {
          setStatus("loading");
          setMessage(`Payment status: ${data.status}. Waiting for completion...`);
          // Retry after a delay for other statuses
          setTimeout(checkPaymentStatus, 3000);
        }
      } catch (error) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Could not verify payment status. Please contact support.");
      }
    }

    checkPaymentStatus();
  }, [getToken, searchParams]);

  return (
    <div className="app-shell">
      <AppNav />
      <main className="app-main">
        <section className="page-card">
          <div className="page-heading">
            <h1>Payment Status</h1>
          </div>

          {status === "loading" && (
            <p className="notice">{message}</p>
          )}

          {status === "success" && (
            <>
              <div className="payment-success-mark" aria-hidden="true">✓</div>
              <p className="notice success">{message}</p>
              <div className="page-actions">
                <Link href="/dashboard" className="btn btn-primary btn-sm">
                  Go to Dashboard
                </Link>
              </div>
            </>
          )}

          {status === "error" && (
            <>
              <p className="notice error">{message}</p>
              <div className="page-actions">
                <Link href="/pricing" className="btn btn-primary btn-sm">
                  Try Again
                </Link>
                <Link href="/" className="btn btn-secondary btn-sm">
                  Back to Home
                </Link>
              </div>
            </>
          )}
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
