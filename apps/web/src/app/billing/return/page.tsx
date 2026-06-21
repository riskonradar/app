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
    async function checkPaymentStatus() {
      const paymentId = searchParams.get("payment_id");

      if (!paymentId) {
        setStatus("error");
        setMessage("No payment ID found in return URL.");
        return;
      }

      try {
        const token = await getToken();
        const response = await fetch(`/api/billing/payment-status?payment_id=${paymentId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await response.json();

        if (!response.ok) {
          // If payment record doesn't exist yet (webhook might not have fired),
          // show a message to wait a bit and retry
          if (response.status === 404) {
            setStatus("loading");
            setMessage("Payment is being processed. Please wait...");
            setTimeout(checkPaymentStatus, 3000);
            return;
          }
          throw new Error(data.error || "Could not verify payment status.");
        }

        if (data.status === "paid") {
          setStatus("success");
          setMessage("Payment completed successfully! You now have access to the paid plan.");
        } else if (data.status === "pending") {
          setStatus("loading");
          setMessage("Payment is being processed. Please wait...");
          // Retry after a delay
          setTimeout(checkPaymentStatus, 3000);
        } else if (data.status === "failed" || data.status === "expired" || data.status === "canceled") {
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
