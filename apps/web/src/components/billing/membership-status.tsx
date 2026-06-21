"use client";

import { useMemo, useSyncExternalStore } from "react";

import { parseLocalMembership, resolvePlanDisplay } from "@/lib/account/display";

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
    return parseLocalMembership(localStatusSnapshot);
  }, [localStatusSnapshot]);

  const plan = resolvePlanDisplay({
    localMembership: localStatus,
    serverPlan,
    serverStatus,
  });
  const isPro = plan.name === "Pro";

  return (
    <div className={`membership-status ${isPro ? "is-pro" : ""}`} aria-live="polite">
      <span>{plan.label}</span>
      <strong>{isPro ? "You are a Pro member" : `${plan.name} workspace`}</strong>
      <small>{plan.detail}</small>
    </div>
  );
}
