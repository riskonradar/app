"use client";

import { useMemo, useSyncExternalStore } from "react";

type MembershipStatusProps = {
  serverStatus?: string | null;
  serverPlan?: string | null;
};

function subscribeToMembership(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("riskonradar-membership-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("riskonradar-membership-change", callback);
  };
}

function getMembershipSnapshot() {
  return window.localStorage.getItem("riskonradar-membership");
}

function getServerMembershipSnapshot() {
  return null;
}

export function MembershipStatus({ serverStatus, serverPlan }: MembershipStatusProps) {
  const localStatusSnapshot = useSyncExternalStore(
    subscribeToMembership,
    getMembershipSnapshot,
    getServerMembershipSnapshot,
  );
  const localStatus = useMemo(() => {
    if (!localStatusSnapshot) return null;
    try {
      return JSON.parse(localStatusSnapshot) as { status?: string };
    } catch {
      return null;
    }
  }, [localStatusSnapshot]);

  const isPro = serverStatus === "active" || localStatus?.status === "paid";
  const planLabel = isPro ? "Pro member" : serverPlan === "individual" ? "Free tier" : "Workspace plan";
  const detail = isPro ? "Unlimited FMEA tables are available." : "Free tier includes 1 saved FMEA table.";

  return (
    <div className={`membership-status ${isPro ? "is-pro" : ""}`} aria-live="polite">
      <span>{planLabel}</span>
      <strong>{isPro ? "You are a Pro member" : "Free workspace"}</strong>
      <small>{detail}</small>
    </div>
  );
}
