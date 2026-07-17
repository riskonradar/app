"use client";

import { useAuth } from "@clerk/nextjs";
import { useState } from "react";

export function CustomerPortalButton() {
  const { getToken } = useAuth();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");

  async function openPortal() {
    setState("loading");
    setMessage("");

    try {
      const token = await getToken();
      const response = await fetch("/api/billing/customer-portal", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        url?: string;
      };

      if (!response.ok || !payload.url) {
        throw new Error(payload.error || "Billing management is unavailable.");
      }

      window.location.assign(payload.url);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Could not open billing management.");
    }
  }

  return (
    <div className="billing-portal-control">
      <button
        className="btn btn-secondary btn-sm"
        type="button"
        onClick={openPortal}
        disabled={state === "loading"}
      >
        {state === "loading" ? "Opening billing" : "Billing and invoices"}
      </button>
      {state === "error" && message ? (
        <p className="notice standalone error" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
