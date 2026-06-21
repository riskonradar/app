import { resolvePlanDisplay } from "@/lib/account/display";

type MembershipStatusProps = {
  serverStatus?: string | null;
  serverPlan?: string | null;
};

export function MembershipStatus({ serverStatus, serverPlan }: MembershipStatusProps) {
  const plan = resolvePlanDisplay({
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
