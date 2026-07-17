/* eslint-disable @typescript-eslint/no-explicit-any */

import { getSupabaseServiceClient } from "@/lib/supabase/server";

export type WorkspaceBillingDetails = {
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  hasStripeCustomer: boolean;
  seats: number | null;
  subscriptionStatus: string | null;
};

export async function getWorkspaceBillingDetails(
  organizationId: string | null | undefined,
): Promise<WorkspaceBillingDetails | null> {
  if (!organizationId) return null;

  const app = (getSupabaseServiceClient() as any).schema("app");
  const [{ data: subscription, error: subscriptionError }, { count, error: customerError }] =
    await Promise.all([
      app
        .from("billing_subscriptions")
        .select("status, seats, current_period_end, metadata")
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      app
        .from("billing_customers")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .not("stripe_customer_id", "is", null),
    ]);

  if (subscriptionError) throw subscriptionError;
  if (customerError) throw customerError;

  const metadata = (subscription?.metadata ?? {}) as Record<string, unknown>;
  return {
    cancelAtPeriodEnd: metadata.cancelAtPeriodEnd === true,
    currentPeriodEnd: subscription?.current_period_end ?? null,
    hasStripeCustomer: (count ?? 0) > 0,
    seats: subscription?.seats ?? null,
    subscriptionStatus: subscription?.status ?? null,
  };
}
