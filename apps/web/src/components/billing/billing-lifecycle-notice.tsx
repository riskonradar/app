type BillingLifecycleNoticeProps = {
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: string | null;
  status: string;
};

function readableDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function BillingLifecycleNotice({
  cancelAtPeriodEnd = false,
  currentPeriodEnd,
  status,
}: BillingLifecycleNoticeProps) {
  const periodEnd = readableDate(currentPeriodEnd);

  if (status === "past_due") {
    return (
      <div className="billing-lifecycle-notice is-warning" role="status">
        <strong>Payment needs attention</strong>
        <p>
          Stripe could not collect the latest invoice. Paid workspace limits are paused until an owner or admin updates the payment method.
        </p>
      </div>
    );
  }

  if (status === "cancelled") {
    return (
      <div className="billing-lifecycle-notice" role="status">
        <strong>Subscription ended</strong>
        <p>The workspace now uses free-plan limits. Previous analyses remain available.</p>
      </div>
    );
  }

  if (status === "active" && cancelAtPeriodEnd) {
    return (
      <div className="billing-lifecycle-notice" role="status">
        <strong>Cancellation scheduled</strong>
        <p>
          Paid access continues{periodEnd ? ` through ${periodEnd}` : " through the current billing period"}, then free-plan limits apply.
        </p>
      </div>
    );
  }

  return null;
}
